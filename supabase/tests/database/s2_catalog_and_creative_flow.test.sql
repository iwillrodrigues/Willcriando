-- S2 database tests: catalog, analysis, selections, generation, concepts,
-- finalists and presentations.
--
-- Runs as one transaction and rolls back, so no fixture survives. Fixtures
-- are fictional: users A and B, and a 67-node test catalog with the approved
-- shape (1.2-1.6 without a parent, 2-52 with 9 and 23 as empty group headers,
-- 9.1-9.6, 23.1-23.5) whose entries are labelled "Caminho fictício <code>".
-- They are not the editorial catalog.
--
-- Same single-payload format as the S1 tests: output goes to pg_temp.tap,
-- any "not ok" raises, and finish(true) raises on a plan mismatch.

begin;

create temporary table tap (n serial, line text) on commit drop;
grant all on table tap to public;
grant usage on sequence tap_n_seq to public;

select extensions.plan(70);

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-8000-00000000000a', 'usuario.a@exemplo.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'usuario.b@exemplo.test', 'authenticated', 'authenticated');

create temporary table fixture_catalog on commit drop as
with codes as (
  select '1.' || m as code from generate_series(2, 6) m
  union all select n::text from generate_series(2, 52) n
  union all select '9.' || m from generate_series(1, 6) m
  union all select '23.' || m from generate_series(1, 5) m
)
select jsonb_agg(jsonb_build_object(
         'source_page_id', 'pagina-ficticia-' || code,
         'editorial_code', code,
         'title', 'Caminho fictício ' || code,
         'section', case when code like '%.%' then 'Subcaminho' else 'Caminho' end,
         'content', case when code in ('9', '23') then '' else 'Explicação fictícia do caminho ' || code || '.' end,
         'prompt_text', case when code in ('9', '23') then '' else 'Prompt fictício ' || code || '.' end,
         'source_last_edited_at', '2026-09-01T00:00:00Z') order by code) as paths
from codes;
grant select on fixture_catalog to public;

-- The fixture with one node changed, removed or added, by editorial code.
create function pg_temp.fixture_with(p_code text, p_node jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(case when e ->> 'editorial_code' = p_code then p_node else e end)
                    filter (where e ->> 'editorial_code' <> p_code or p_node is not null), '[]'::jsonb)
  from fixture_catalog, jsonb_array_elements(paths) e
$$;
create function pg_temp.fixture_node(p_code text) returns jsonb language sql as $$
  select e from fixture_catalog, jsonb_array_elements(paths) e where e ->> 'editorial_code' = p_code
$$;
grant execute on function pg_temp.fixture_with(text, jsonb) to public;
grant execute on function pg_temp.fixture_node(text) to public;

-- ---------------------------------------------------------------------------
-- 1. Structure, grants and function hardening
-- ---------------------------------------------------------------------------

create temporary table s2_tables on commit drop as
select unnest(array['catalog_snapshots', 'creative_paths', 'generation_requests', 'briefing_analyses',
                    'path_recommendations', 'path_draws', 'path_selections', 'concepts', 'presentations']) as t;
grant select on s2_tables to public;

insert into tap(line) select extensions.is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'every table in public has RLS enabled');

insert into tap(line) select extensions.is(
  (select count(*)::int from s2_tables
   where has_table_privilege('anon', 'public.' || t, 'select, insert, update, delete, truncate')),
  0, 'anon has no privilege on any S2 table');

insert into tap(line) select extensions.is(
  (select count(*)::int from s2_tables
   where has_table_privilege('authenticated', 'public.' || t, 'insert, update, delete, truncate')),
  0, 'authenticated cannot write any S2 table directly');

insert into tap(line) select extensions.is(
  (select count(*)::int from s2_tables
   where has_table_privilege('service_role', 'public.' || t, 'insert, update, delete, truncate')),
  0, 'service_role cannot write any S2 table directly');

insert into tap(line) select extensions.is(
  has_column_privilege('authenticated', 'public.creative_paths', 'source_page_id', 'select'), false,
  'clients cannot read the source page id of a path');

insert into tap(line) select extensions.is(
  has_column_privilege('authenticated', 'public.catalog_snapshots', 'source_database_id', 'select'), false,
  'clients cannot read the source database id');

insert into tap(line) select extensions.ok(
  has_column_privilege('authenticated', 'public.creative_paths', 'editorial_code', 'select')
  and has_column_privilege('authenticated', 'public.creative_paths', 'selectable', 'select'),
  'clients can read the editorial code and whether a node is selectable');

insert into tap(line) select extensions.is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(array['save_briefing_revision','import_catalog_snapshot','draw_random_path','select_path','update_concept','set_concept_finalist','update_presentation','begin_generation','complete_analysis','complete_concepts','complete_presentation','fail_generation'])
     and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false))),
  0, 'every app function is SECURITY DEFINER with an empty search_path');

insert into tap(line) select extensions.is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(array['save_briefing_revision','import_catalog_snapshot','draw_random_path','select_path','update_concept','set_concept_finalist','update_presentation','begin_generation','complete_analysis','complete_concepts','complete_presentation','fail_generation']) and has_function_privilege('anon', p.oid, 'execute')),
  0, 'anon cannot execute any app function');

insert into tap(line) select extensions.is(
  (select count(*)::int from unnest(array[
     'public.import_catalog_snapshot(text, jsonb)',
     'public.begin_generation(uuid, uuid, public.generation_kind, text, text, uuid, uuid)',
     'public.complete_analysis(uuid, uuid, text, jsonb, jsonb)',
     'public.complete_concepts(uuid, uuid, text, jsonb)',
     'public.complete_presentation(uuid, uuid, text, jsonb)',
     'public.fail_generation(uuid, uuid, text)']) f
   where has_function_privilege('authenticated', f, 'execute')),
  0, 'authenticated cannot execute backend-only functions');

-- ---------------------------------------------------------------------------
-- 2. Catalog import (service_role)
-- ---------------------------------------------------------------------------

set local role service_role;

insert into tap(line) select extensions.throws_ok(
  $q$ select public.import_catalog_snapshot('base-ficticia', pg_temp.fixture_with('52', null)) $q$,
  '22023', 'TRILHA_INVALID_CATALOG', 'a catalog with 66 nodes is rejected');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.import_catalog_snapshot('base-ficticia',
        (select paths from fixture_catalog) || jsonb_build_array(
          pg_temp.fixture_node('52') || '{"editorial_code":"53","source_page_id":"pagina-ficticia-53"}')) $q$,
  '22023', 'TRILHA_INVALID_CATALOG', 'a catalog with 68 nodes is rejected');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.import_catalog_snapshot('base-ficticia',
        pg_temp.fixture_with('52', pg_temp.fixture_node('52') || '{"editorial_code":"51"}')) $q$,
  '22023', 'TRILHA_INVALID_CATALOG', 'duplicate editorial codes are rejected');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.import_catalog_snapshot('base-ficticia',
        pg_temp.fixture_with('52', pg_temp.fixture_node('52') || '{"source_page_id":"pagina-ficticia-51"}')) $q$,
  '22023', 'TRILHA_INVALID_CATALOG', 'duplicate source page ids are rejected');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.import_catalog_snapshot('base-ficticia',
        pg_temp.fixture_with('52', pg_temp.fixture_node('52') || '{"editorial_code":"0"}')) $q$,
  '22023', 'TRILHA_INVALID_CATALOG', 'an editorial code that is not N or N.M is rejected');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.import_catalog_snapshot('base-ficticia',
        pg_temp.fixture_with('9.3', pg_temp.fixture_node('9.3') || '{"content":"  ","prompt_text":""}')) $q$,
  '22023', 'TRILHA_INVALID_CATALOG', 'a selectable path without content or prompt text is rejected');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.import_catalog_snapshot('base-ficticia',
        pg_temp.fixture_with('52', pg_temp.fixture_node('52') || '{"editorial_code":"5.1"}')) $q$,
  '22023', 'TRILHA_INVALID_CATALOG', 'a structure with 64 selectable paths is rejected');

select set_config('trilha.snapshot',
  public.import_catalog_snapshot('base-ficticia', (select paths from fixture_catalog))::text, true);

insert into tap(line) select extensions.is(
  public.import_catalog_snapshot('base-ficticia', (select paths from fixture_catalog)),
  current_setting('trilha.snapshot')::uuid, 'importing the same catalog again is idempotent');

reset role;

insert into tap(line) select extensions.is(
  (select count(*)::int from public.creative_paths where snapshot_id = current_setting('trilha.snapshot')::uuid),
  67, 'the snapshot holds exactly 67 nodes');

insert into tap(line) select extensions.is(
  (select count(*)::int from public.creative_paths
    where snapshot_id = current_setting('trilha.snapshot')::uuid and selectable),
  65, 'exactly 65 nodes are selectable');

insert into tap(line) select extensions.results_eq(
  $q$ select editorial_code, source_page_id, content, prompt_text from public.creative_paths
      where snapshot_id = current_setting('trilha.snapshot')::uuid and not selectable order by path_number $q$,
  $q$ values ('9', 'pagina-ficticia-9', '', null::text), ('23', 'pagina-ficticia-23', '', null::text) $q$,
  'the two group headers import with empty text and are not selectable');

insert into tap(line) select extensions.results_eq(
  $q$ select editorial_code from public.creative_paths
      where snapshot_id = current_setting('trilha.snapshot')::uuid order by path_number limit 6 $q$,
  $q$ values ('1.2'), ('1.3'), ('1.4'), ('1.5'), ('1.6'), ('2') $q$,
  '1.2-1.6 import without a parent node or 1.1, before 2');

insert into tap(line) select extensions.results_eq(
  $q$ select editorial_code, path_number from public.creative_paths
      where snapshot_id = current_setting('trilha.snapshot')::uuid and editorial_code in ('9', '9.1', '9.6', '10', '23.5', '52')
      order by path_number $q$,
  $q$ values ('9', 13), ('9.1', 14), ('9.6', 19), ('10', 20), ('23.5', 38), ('52', 67) $q$,
  'decimal codes are kept verbatim and ordered after their header');

insert into tap(line) select extensions.is(
  (select count(*)::int from public.catalog_snapshots where is_current), 1, 'exactly one snapshot is current');

insert into tap(line) select extensions.throws_ok(
  $q$ update public.creative_paths set title = 'reescrito' where editorial_code = '1.2' $q$,
  '42501', null, 'catalog paths cannot be edited, even by a privileged role');

-- A's job with one briefing revision.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into public.jobs (title) values ('Campanha fictícia A');
reset role;
select set_config('trilha.job_a', (select id::text from public.jobs where title = 'Campanha fictícia A'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select public.save_briefing_revision(current_setting('trilha.job_a')::uuid, 'Briefing fictício para testes.');

-- ---------------------------------------------------------------------------
-- 3. Random draw and selections (user A)
-- ---------------------------------------------------------------------------

select set_config('trilha.draw', (public.draw_random_path(current_setting('trilha.job_a')::uuid)).id::text, true);
select set_config('trilha.draw_path',
  (select creative_path_id::text from public.path_draws where id = current_setting('trilha.draw')::uuid), true);

insert into tap(line) select extensions.ok(
  exists (select 1 from public.creative_paths p
          where p.id = current_setting('trilha.draw_path')::uuid
            and p.snapshot_id = current_setting('trilha.snapshot')::uuid),
  'a random draw comes from the current catalog');

insert into tap(line) select extensions.is(
  (select count(*)::int from generate_series(1, 300) g
     cross join lateral public.draw_random_path(current_setting('trilha.job_a')::uuid) d
     join public.creative_paths p on p.id = d.creative_path_id
   where not p.selectable),
  0, 'random draws never return a group header (300 draws)');

insert into tap(line) select extensions.is(
  (select count(*)::int from public.path_selections), 0, 'a draw alone does not create a selection');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.select_path(current_setting('trilha.job_a')::uuid, 'random',
        (select id from public.creative_paths where id <> current_setting('trilha.draw_path')::uuid limit 1),
        null, current_setting('trilha.draw')::uuid) $q$,
  '22023', 'TRILHA_INVALID_SELECTION', 'a random selection must use the drawn path');

insert into tap(line) select extensions.is(
  (public.select_path(current_setting('trilha.job_a')::uuid, 'random',
     current_setting('trilha.draw_path')::uuid, null, current_setting('trilha.draw')::uuid)).origin,
  'random'::public.path_selection_origin, 'confirming a draw records origin random');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.select_path(current_setting('trilha.job_a')::uuid, 'random',
        current_setting('trilha.draw_path')::uuid, null, current_setting('trilha.draw')::uuid) $q$,
  '22023', 'TRILHA_INVALID_SELECTION', 'a draw can be confirmed only once');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.select_path(current_setting('trilha.job_a')::uuid, 'recommended',
        (select id from public.creative_paths where editorial_code = '1.6' and snapshot_id = current_setting('trilha.snapshot')::uuid),
        '00000000-0000-4000-8000-000000000999', null) $q$,
  '22023', 'TRILHA_INVALID_SELECTION', 'origin recommended needs a real recommendation');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.select_path(current_setting('trilha.job_a')::uuid, 'manual',
        (select id from public.creative_paths where editorial_code = '1.6' and snapshot_id = current_setting('trilha.snapshot')::uuid),
        null, current_setting('trilha.draw')::uuid) $q$,
  '22023', 'TRILHA_INVALID_SELECTION', 'origin manual cannot carry a draw');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.select_path(current_setting('trilha.job_a')::uuid, 'manual',
        (select id from public.creative_paths where editorial_code = '9' and snapshot_id = current_setting('trilha.snapshot')::uuid)) $q$,
  '22023', 'TRILHA_PATH_NOT_SELECTABLE', 'a group header cannot be applied, even by its id');

select set_config('trilha.sel_manual', (public.select_path(current_setting('trilha.job_a')::uuid, 'manual',
  (select id from public.creative_paths where editorial_code = '3' and snapshot_id = current_setting('trilha.snapshot')::uuid))).id::text, true);

insert into tap(line) select extensions.is(
  (select origin from public.path_selections where id = current_setting('trilha.sel_manual')::uuid),
  'manual'::public.path_selection_origin, 'a manual selection records origin manual');

-- B cannot act on A's job.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

insert into tap(line) select extensions.throws_ok(
  $q$ select public.draw_random_path(current_setting('trilha.job_a')::uuid) $q$,
  'P0002', 'TRILHA_JOB_NOT_FOUND', 'B cannot draw on A''s job');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.select_path(current_setting('trilha.job_a')::uuid, 'manual',
        (select id from public.creative_paths where editorial_code = '1.2' and snapshot_id = current_setting('trilha.snapshot')::uuid)) $q$,
  'P0002', 'TRILHA_JOB_NOT_FOUND', 'B cannot select a path on A''s job');

-- ---------------------------------------------------------------------------
-- 4. Analysis lifecycle (service_role on behalf of A)
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '', true);
set local role service_role;

insert into tap(line) select extensions.throws_ok(
  $q$ select * from public.begin_generation('00000000-0000-4000-8000-00000000000b',
        current_setting('trilha.job_a')::uuid, 'analysis', 'modelo-teste', 'v1') $q$,
  'P0002', 'TRILHA_JOB_NOT_FOUND', 'the backend cannot start a request for a user who does not own the job');

select set_config('trilha.req_analysis', (select request_id::text from public.begin_generation(
  '00000000-0000-4000-8000-00000000000a', current_setting('trilha.job_a')::uuid, 'analysis', 'modelo-teste', 'v1')), true);

insert into tap(line) select extensions.results_eq(
  $q$ select request_id, status, created from public.begin_generation('00000000-0000-4000-8000-00000000000a',
        current_setting('trilha.job_a')::uuid, 'analysis', 'modelo-teste', 'v1') $q$,
  $q$ values (current_setting('trilha.req_analysis')::uuid, 'pending'::public.generation_status, false) $q$,
  'the same analysis payload returns the same request');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.complete_analysis('00000000-0000-4000-8000-00000000000a', current_setting('trilha.req_analysis')::uuid, 'modelo-servido',
        '{"resumo":"x"}', '[{"path_code":"99","reasoning":"fora do catálogo"}]') $q$,
  '22023', 'TRILHA_INVALID_AI_OUTPUT', 'a recommendation outside the catalog is rejected');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.complete_analysis('00000000-0000-4000-8000-00000000000a', current_setting('trilha.req_analysis')::uuid, 'modelo-servido',
        '{"resumo":"x"}', '[{"path_code":"23","reasoning":"cabeçalho de grupo"}]') $q$,
  '22023', 'TRILHA_INVALID_AI_OUTPUT', 'a group header cannot be recommended');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.complete_analysis('00000000-0000-4000-8000-00000000000a', current_setting('trilha.req_analysis')::uuid, 'modelo-servido',
        '{"resumo":"x"}', '[{"path_code":"3","reasoning":"a"},{"path_code":"3","reasoning":"b"}]') $q$,
  '22023', 'TRILHA_INVALID_AI_OUTPUT', 'duplicate recommended paths are rejected');

select set_config('trilha.analysis', public.complete_analysis('00000000-0000-4000-8000-00000000000a',
  current_setting('trilha.req_analysis')::uuid, 'modelo-servido', '{"resumo":"Análise fictícia."}',
  '[{"path_code":"3","reasoning":"Motivo fictício 1."},{"path_code":"9.3","reasoning":"Motivo fictício 2."},{"path_code":"12","reasoning":"Motivo fictício 3."}]')::text, true);

insert into tap(line) select extensions.throws_ok(
  $q$ select public.complete_analysis('00000000-0000-4000-8000-00000000000a', current_setting('trilha.req_analysis')::uuid, 'modelo-servido',
        '{"resumo":"x"}', '[{"path_code":"1.2","reasoning":"a"}]') $q$,
  '22023', 'TRILHA_REQUEST_NOT_PENDING', 'a completed request cannot be completed again');

reset role;
insert into tap(line) select extensions.results_eq(
  $q$ select r.rank, p.editorial_code from public.path_recommendations r join public.creative_paths p on p.id = r.creative_path_id
      where r.analysis_id = current_setting('trilha.analysis')::uuid order by r.rank $q$,
  $q$ values (1, '3'), (2, '9.3'), (3, '12') $q$,
  'recommendations keep their order and point at catalog paths');

insert into tap(line) select extensions.is(
  (select status from public.generation_requests where id = current_setting('trilha.req_analysis')::uuid),
  'succeeded'::public.generation_status, 'the analysis request succeeded');

-- A selects the second recommendation.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into tap(line) select extensions.throws_ok(
  $q$ select public.select_path(current_setting('trilha.job_a')::uuid, 'recommended',
        (select id from public.creative_paths where editorial_code = '1.5' and snapshot_id = current_setting('trilha.snapshot')::uuid),
        (select id from public.path_recommendations where rank = 2)) $q$,
  '22023', 'TRILHA_INVALID_SELECTION', 'a recommended selection must use the recommended path');

select set_config('trilha.sel_rec', (public.select_path(current_setting('trilha.job_a')::uuid, 'recommended',
  (select creative_path_id from public.path_recommendations where rank = 2),
  (select id from public.path_recommendations where rank = 2))).id::text, true);

insert into tap(line) select extensions.is(
  (select origin from public.path_selections where id = current_setting('trilha.sel_rec')::uuid),
  'recommended'::public.path_selection_origin, 'selecting a recommendation records origin recommended');

insert into tap(line) select extensions.throws_ok(
  $q$ insert into public.path_selections (job_id, origin, creative_path_id, briefing_revision_id, selected_by)
      select current_setting('trilha.job_a')::uuid, 'manual', id,
             (select id from public.briefing_revisions limit 1), '00000000-0000-4000-8000-00000000000a'
      from public.creative_paths limit 1 $q$,
  '42501', null, 'clients cannot insert selections directly');

-- ---------------------------------------------------------------------------
-- 5. Concept generation: active selection, failure, retry, idempotency
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '', true);
set local role service_role;

insert into tap(line) select extensions.throws_ok(
  $q$ select * from public.begin_generation('00000000-0000-4000-8000-00000000000a', current_setting('trilha.job_a')::uuid,
        'concepts', 'modelo-teste', 'v1', current_setting('trilha.sel_manual')::uuid) $q$,
  '22023', 'TRILHA_SELECTION_NOT_ACTIVE', 'concepts can only be generated from the active selection');

select set_config('trilha.req_c1', (select request_id::text from public.begin_generation(
  '00000000-0000-4000-8000-00000000000a', current_setting('trilha.job_a')::uuid, 'concepts', 'modelo-teste', 'v1',
  current_setting('trilha.sel_rec')::uuid)), true);

select public.fail_generation('00000000-0000-4000-8000-00000000000a', current_setting('trilha.req_c1')::uuid, 'AI_TIMEOUT');

insert into tap(line) select extensions.results_eq(
  $q$ select request_id, status, created from public.begin_generation('00000000-0000-4000-8000-00000000000a',
        current_setting('trilha.job_a')::uuid, 'concepts', 'modelo-teste', 'v1', current_setting('trilha.sel_rec')::uuid) $q$,
  $q$ values (current_setting('trilha.req_c1')::uuid, 'failed'::public.generation_status, false) $q$,
  'repeating a failed payload returns the failed request instead of calling the AI again');

select set_config('trilha.req_c2', (select request_id::text from public.begin_generation(
  '00000000-0000-4000-8000-00000000000a', current_setting('trilha.job_a')::uuid, 'concepts', 'modelo-teste', 'v1',
  current_setting('trilha.sel_rec')::uuid, current_setting('trilha.req_c1')::uuid)), true);

insert into tap(line) select extensions.isnt(
  current_setting('trilha.req_c2'), current_setting('trilha.req_c1'), 'a retry is a new request');

insert into tap(line) select extensions.results_eq(
  $q$ select request_id, created from public.begin_generation('00000000-0000-4000-8000-00000000000a',
        current_setting('trilha.job_a')::uuid, 'concepts', 'modelo-teste', 'v1', current_setting('trilha.sel_rec')::uuid,
        current_setting('trilha.req_c1')::uuid) $q$,
  $q$ values (current_setting('trilha.req_c2')::uuid, false) $q$,
  'a repeated retry of the same failure is deduplicated');

insert into tap(line) select extensions.is(
  public.complete_concepts('00000000-0000-4000-8000-00000000000a', current_setting('trilha.req_c2')::uuid, 'modelo-servido',
    '[{"title":"Conceito fictício 1","line":"Linha 1.","body":"Corpo 1."},
      {"title":"Conceito fictício 2","line":"Linha 2.","body":"Corpo 2."},
      {"title":"Conceito fictício 3","line":"Linha 3.","body":"Corpo 3."}]'),
  3, 'three concepts are stored for the retry');

insert into tap(line) select extensions.throws_ok(
  $q$ select * from public.begin_generation('00000000-0000-4000-8000-00000000000a', current_setting('trilha.job_a')::uuid,
        'concepts', 'modelo-teste', 'v1', current_setting('trilha.sel_rec')::uuid, current_setting('trilha.req_c2')::uuid) $q$,
  '22023', 'TRILHA_INVALID_RETRY', 'a succeeded request cannot be retried');

reset role;

insert into tap(line) select extensions.is(
  (select count(*)::int from public.concepts where job_id = current_setting('trilha.job_a')::uuid), 3,
  'no duplicated concepts after failure and retry');

insert into tap(line) select extensions.is(
  (select count(*)::int from public.concepts c
   join public.path_selections s on s.id = c.selection_id
   join public.generation_requests r on r.id = c.generation_request_id
   where c.job_id = current_setting('trilha.job_a')::uuid
     and s.id = current_setting('trilha.sel_rec')::uuid and s.origin = 'recommended'
     and c.creative_path_id = s.creative_path_id
     and c.briefing_revision_id = s.briefing_revision_id
     and r.model = 'modelo-teste' and r.served_model = 'modelo-servido' and r.prompt_version = 'v1'), 3,
  'each concept traces to its selection, path, briefing revision, requested and served model and prompt version');

insert into tap(line) select extensions.ok(
  (select payload ?& array['job_id', 'selection_id', 'briefing_revision_id', 'retry_of']
          and payload ->> 'retry_of' = current_setting('trilha.req_c1')
   from public.generation_requests where id = current_setting('trilha.req_c2')::uuid),
  'the canonical payload holds job, selection, briefing revision and retry_of');

-- ---------------------------------------------------------------------------
-- 6. Editing, finalists and presentation
-- ---------------------------------------------------------------------------

select set_config('trilha.concept1', (select id::text from public.concepts where seq = 1), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into tap(line) select extensions.is(
  (public.update_concept(current_setting('trilha.concept1')::uuid, 'Título editado', 'Linha editada.', 'Corpo editado.')).ai_title,
  'Conceito fictício 1', 'editing a concept keeps the AI original');

insert into tap(line) select extensions.throws_ok(
  $q$ update public.concepts set ai_title = 'x' $q$, '42501', null, 'clients cannot update concepts directly');

reset role;
select set_config('request.jwt.claims', '', true);
set local role service_role;

insert into tap(line) select extensions.throws_ok(
  $q$ select * from public.begin_generation('00000000-0000-4000-8000-00000000000a', current_setting('trilha.job_a')::uuid,
        'presentation', 'modelo-teste', 'v1') $q$,
  '22023', 'TRILHA_NO_FINALISTS', 'a presentation needs at least one finalist');

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into tap(line) select extensions.is(
  (public.set_concept_finalist(current_setting('trilha.concept1')::uuid, true)).is_finalist, true,
  'the owner marks a finalist');

-- B cannot see or change A's creative work.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

insert into tap(line) select extensions.throws_ok(
  $q$ select public.set_concept_finalist(current_setting('trilha.concept1')::uuid, false) $q$,
  'P0002', 'TRILHA_CONCEPT_NOT_FOUND', 'B cannot change A''s finalists');

insert into tap(line) select extensions.is(
  (select (select count(*) from public.generation_requests) + (select count(*) from public.briefing_analyses)
        + (select count(*) from public.path_recommendations) + (select count(*) from public.path_draws)
        + (select count(*) from public.path_selections) + (select count(*) from public.concepts)
        + (select count(*) from public.presentations))::int,
  0, 'B sees none of A''s analyses, draws, selections, requests, concepts or presentations');

reset role;
select set_config('request.jwt.claims', '', true);
set local role service_role;

select set_config('trilha.req_p', (select request_id::text from public.begin_generation(
  '00000000-0000-4000-8000-00000000000a', current_setting('trilha.job_a')::uuid, 'presentation', 'modelo-teste', 'v1')), true);
select set_config('trilha.presentation', public.complete_presentation('00000000-0000-4000-8000-00000000000a',
  current_setting('trilha.req_p')::uuid, 'modelo-servido', '{"title":"Apresentação fictícia","slides":[]}')::text, true);

reset role;
insert into tap(line) select extensions.is(
  (select concept_ids from public.presentations where id = current_setting('trilha.presentation')::uuid),
  array[current_setting('trilha.concept1')::uuid], 'the presentation is built from the finalists');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into tap(line) select extensions.is(
  (public.update_presentation(current_setting('trilha.presentation')::uuid,
     jsonb_build_object('title', 'Editada', 'slides',
       jsonb_build_array(jsonb_build_object('concept_id', current_setting('trilha.concept1'), 'heading', 'H', 'text', 'T'))))
  ).ai_content ->> 'title',
  'Apresentação fictícia', 'editing a presentation keeps the AI original');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.update_presentation(current_setting('trilha.presentation')::uuid,
        '{"title":"x","slides":[{"concept_id":"00000000-0000-4000-8000-000000000999","heading":"h","text":"t"}]}') $q$,
  '22023', 'TRILHA_INVALID_CONTENT', 'a presentation can only reference its own finalists');

-- ---------------------------------------------------------------------------
-- 7. Anonymous access and immutability
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;

insert into tap(line) select extensions.throws_ok(
  $q$ select count(*) from public.creative_paths $q$, '42501', null, 'anon cannot read the catalog');

reset role;

insert into tap(line) select extensions.throws_ok(
  $q$ update public.path_selections set origin = 'manual' $q$,
  '42501', null, 'selections cannot be rewritten, even by a privileged role');

insert into tap(line) select extensions.throws_ok(
  $q$ update public.generation_requests set status = 'pending', completed_at = null, error_code = null
      where id = current_setting('trilha.req_c1')::uuid $q$,
  '42501', null, 'a finished request cannot go back to pending');

-- Defense in depth: even a selection that points at a group header (only
-- possible by writing the table directly) cannot start concept generation.
insert into public.path_selections (job_id, origin, creative_path_id, briefing_revision_id, selected_by)
select current_setting('trilha.job_a')::uuid, 'manual', p.id,
       (select id from public.briefing_revisions where job_id = current_setting('trilha.job_a')::uuid order by revision_number desc limit 1),
       '00000000-0000-4000-8000-00000000000a'
from public.creative_paths p
where p.editorial_code = '23' and p.snapshot_id = current_setting('trilha.snapshot')::uuid;
select set_config('trilha.sel_header',
  (select id::text from public.path_selections order by choice_order desc limit 1), true);

set local role service_role;
insert into tap(line) select extensions.throws_ok(
  $q$ select * from public.begin_generation('00000000-0000-4000-8000-00000000000a', current_setting('trilha.job_a')::uuid,
        'concepts', 'modelo-teste', 'v1',
        current_setting('trilha.sel_header')::uuid) $q$,
  '22023', 'TRILHA_PATH_NOT_SELECTABLE', 'concepts cannot be generated from a group header');
reset role;

-- ---------------------------------------------------------------------------
-- Result
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from tap where line like 'not ok%') then
    raise exception 'pgTAP failures: %',
      (select string_agg(line, ' | ' order by n) from tap where line like 'not ok%' or line like '#%');
  end if;
end;
$$;

insert into tap(line) select * from extensions.finish(true);

select string_agg(line, E'\n' order by n) as tap_output from tap;

rollback;
