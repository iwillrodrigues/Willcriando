-- S3 database tests: concept dismissal, presentation versions and job deletion.
--
-- Runs as one transaction and rolls back, so no fixture survives. Fixtures are
-- fictional: users A and B, the same 67-node test catalog shape as the S2
-- tests, and job graphs built only through the application functions.
--
-- Same single-payload format as the S1 and S2 tests: output goes to
-- pg_temp.tap, any "not ok" raises, and finish(true) raises on a plan mismatch.

begin;

create temporary table tap (n serial, line text) on commit drop;
grant all on table tap to public;
grant usage on sequence tap_n_seq to public;

select extensions.plan(66);

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-8000-00000000000a', 'usuario.a@exemplo.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'usuario.b@exemplo.test', 'authenticated', 'authenticated');

-- Test catalog: 1.2-1.6, 2-52, 9.1-9.6, 23.1-23.5; 9 and 23 are group headers.
set local role service_role;
select set_config('trilha.snapshot', public.import_catalog_snapshot('base-ficticia', (
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
           'content', case when code in ('9', '23') then '' else 'Explicação fictícia ' || code || '.' end,
           'prompt_text', case when code in ('9', '23') then '' else 'Prompt fictício ' || code || '.' end))
  from codes))::text, true);
reset role;

-- A complete job graph, built through the application functions on behalf of
-- p_user: two briefing revisions, an analysis with recommendations, a draw
-- confirmed as a selection, a recommended (active) selection, a failed
-- concept request and its retry with 3 concepts, one finalist, a
-- presentation and one saved version.
create function pg_temp.build_graph(p_user uuid, p_title text) returns uuid language plpgsql as $$
declare
  v_job uuid;
  v_req uuid;
  v_retry uuid;
  v_analysis uuid;
  v_draw public.path_draws;
  v_rec public.path_recommendations;
  v_sel uuid;
  v_concept uuid;
  v_pres uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  insert into public.jobs (owner_id, title) values (p_user, p_title) returning id into v_job;
  perform public.save_briefing_revision(v_job, 'Briefing fictício, revisão 1.');
  perform public.save_briefing_revision(v_job, 'Briefing fictício, revisão 2.');

  select request_id into v_req from public.begin_generation(p_user, v_job, 'analysis', 'modelo-teste', 'v1');
  v_analysis := public.complete_analysis(p_user, v_req, 'modelo-servido', '{"resumo":"Análise fictícia."}',
    '[{"path_code":"3","reasoning":"Motivo fictício 1."},{"path_code":"9.3","reasoning":"Motivo fictício 2."}]');

  v_draw := public.draw_random_path(v_job);
  perform public.select_path(v_job, 'random', v_draw.creative_path_id, null, v_draw.id);

  select * into v_rec from public.path_recommendations where analysis_id = v_analysis and rank = 1;
  v_sel := (public.select_path(v_job, 'recommended', v_rec.creative_path_id, v_rec.id)).id;

  select request_id into v_req from public.begin_generation(p_user, v_job, 'concepts', 'modelo-teste', 'v1', v_sel);
  perform public.fail_generation(p_user, v_req, 'AI_TIMEOUT');
  select request_id into v_retry from public.begin_generation(p_user, v_job, 'concepts', 'modelo-teste', 'v1', v_sel, v_req);
  perform public.complete_concepts(p_user, v_retry, 'modelo-servido',
    '[{"title":"Conceito fictício 1","line":"Linha 1.","body":"Corpo 1."},
      {"title":"Conceito fictício 2","line":"Linha 2.","body":"Corpo 2."},
      {"title":"Conceito fictício 3","line":"Linha 3.","body":"Corpo 3."}]');

  select id into v_concept from public.concepts where generation_request_id = v_retry and seq = 1;
  perform public.set_concept_finalist(v_concept, true);

  select request_id into v_req from public.begin_generation(p_user, v_job, 'presentation', 'modelo-teste', 'v1');
  v_pres := public.complete_presentation(p_user, v_req, 'modelo-servido', jsonb_build_object(
    'title', 'Apresentação fictícia', 'intro', 'Abertura fictícia.',
    'slides', jsonb_build_array(jsonb_build_object('concept_id', v_concept, 'heading', 'Slide fictício', 'text', 'Texto fictício.')),
    'closing', 'Fechamento fictício.'));
  perform public.save_presentation_version(v_pres, (select content from public.presentations where id = v_pres));

  perform set_config('request.jwt.claims', '', true);
  return v_job;
end;
$$;

-- Row count per job-scoped table (every public table with a job_id column),
-- plus the job row itself.
create function pg_temp.graph_counts(p_job uuid) returns jsonb language plpgsql as $$
declare
  t text;
  n integer;
  v jsonb := '{}';
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'job_id' and tb.table_type = 'BASE TABLE'
    order by 1
  loop
    execute format('select count(*) from public.%I where job_id = $1', t) into n using p_job;
    v := v || jsonb_build_object(t, n);
  end loop;
  return v || jsonb_build_object('jobs', (select count(*) from public.jobs where id = p_job));
end;
$$;

create function pg_temp.catalog_counts() returns jsonb language sql as $$
  select jsonb_build_object('snapshots', (select count(*) from public.catalog_snapshots),
                            'paths', (select count(*) from public.creative_paths),
                            'users', (select count(*) from auth.users))
$$;

grant execute on function pg_temp.graph_counts(uuid) to public;

select set_config('trilha.job_a1', pg_temp.build_graph('00000000-0000-4000-8000-00000000000a', 'Job fictício A1')::text, true);
select set_config('trilha.job_a2', pg_temp.build_graph('00000000-0000-4000-8000-00000000000a', 'Job fictício A2')::text, true);
select set_config('trilha.job_b1', pg_temp.build_graph('00000000-0000-4000-8000-00000000000b', 'Job fictício B1')::text, true);

select set_config('trilha.c1', (select c.id::text from public.concepts c join public.generation_requests r on r.id = c.generation_request_id
  where c.job_id = current_setting('trilha.job_a1')::uuid and r.retry_of is not null and c.seq = 1), true);
select set_config('trilha.c2', (select c.id::text from public.concepts c join public.generation_requests r on r.id = c.generation_request_id
  where c.job_id = current_setting('trilha.job_a1')::uuid and r.retry_of is not null and c.seq = 2), true);
select set_config('trilha.pres_a1', (select id::text from public.presentations where job_id = current_setting('trilha.job_a1')::uuid), true);

-- ---------------------------------------------------------------------------
-- 1. Structure, grants and function hardening
-- ---------------------------------------------------------------------------

insert into tap(line) select extensions.is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'every table in public has RLS enabled, presentation_versions included');

insert into tap(line) select extensions.is(
  has_table_privilege('anon', 'public.presentation_versions', 'select, insert, update, delete, truncate'), false,
  'anon has no privilege on presentation_versions');

insert into tap(line) select extensions.is(
  has_table_privilege('authenticated', 'public.presentation_versions', 'insert, update, delete, truncate')
  or has_table_privilege('service_role', 'public.presentation_versions', 'select, insert, update, delete, truncate'), false,
  'presentation_versions is written only through its function');

insert into tap(line) select extensions.is(
  has_table_privilege('authenticated', 'public.jobs', 'delete, truncate')
  or has_table_privilege('authenticated', 'public.concepts', 'insert, update, delete, truncate'), false,
  'clients still cannot delete jobs or write concepts directly');

insert into tap(line) select extensions.is(
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
   where has_schema_privilege(r, 'private', 'usage')
      or has_table_privilege(r, 'private.job_deletions', 'select, insert, update, delete')),
  0, 'no API role can reach the private deletion marker');

insert into tap(line) select extensions.is(
  (select count(*)::int from unnest(array[
     'public.set_concept_dismissed(uuid, boolean)'::regprocedure,
     'public.set_concept_finalist(uuid, boolean)'::regprocedure,
     'public.save_presentation_version(uuid, jsonb)'::regprocedure,
     'public.delete_job(uuid)'::regprocedure]) f
   join pg_proc p on p.oid = f
   where not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false)),
  0, 'the S3 functions are SECURITY DEFINER with an empty search_path');

insert into tap(line) select extensions.is(
  (select count(*)::int from unnest(array[
     'public.set_concept_dismissed(uuid, boolean)', 'public.set_concept_finalist(uuid, boolean)',
     'public.save_presentation_version(uuid, jsonb)', 'public.delete_job(uuid)']) f
   cross join unnest(array['anon', 'service_role']) r
   where has_function_privilege(r, f, 'execute')),
  0, 'anon and service_role cannot execute the S3 user functions');

insert into tap(line) select extensions.ok(
  has_function_privilege('authenticated', 'public.set_concept_dismissed(uuid, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.save_presentation_version(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.delete_job(uuid)', 'execute'),
  'authenticated can execute the S3 user functions');

insert into tap(line) select extensions.ok(
  (select a.attnotnull = false and d.adbin is null
   from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.concepts'::regclass and a.attname = 'dismissed_at'),
  'concepts.dismissed_at is nullable with no default, so existing concepts stay active');

insert into tap(line) select extensions.is(
  (select count(*)::int from public.concepts where dismissed_at is not null
    and job_id in (current_setting('trilha.job_a1')::uuid, current_setting('trilha.job_a2')::uuid, current_setting('trilha.job_b1')::uuid)), 0,
  'generated concepts start active');

-- ---------------------------------------------------------------------------
-- 2. Dismissal (user A)
-- ---------------------------------------------------------------------------

create temporary table c2_before on commit drop as
select to_jsonb(c) - 'dismissed_at' as row from public.concepts c where id = current_setting('trilha.c2')::uuid;
grant select on c2_before to public;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into tap(line) select extensions.ok(
  (public.set_concept_dismissed(current_setting('trilha.c2')::uuid, true)).dismissed_at is not null,
  'the owner dismisses a concept');

select set_config('trilha.c2_dismissed_at',
  (select dismissed_at::text from public.concepts where id = current_setting('trilha.c2')::uuid), true);

insert into tap(line) select extensions.is(
  (public.set_concept_dismissed(current_setting('trilha.c2')::uuid, true)).dismissed_at::text,
  current_setting('trilha.c2_dismissed_at'), 'dismissing again is a no-op that keeps the first dismissal time');

insert into tap(line) select extensions.throws_ok(
  $q$ update public.concepts set dismissed_at = null where id = current_setting('trilha.c2')::uuid $q$,
  '42501', null, 'clients cannot change the dismissal directly');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.set_concept_dismissed(current_setting('trilha.c1')::uuid, true) $q$,
  '22023', 'TRILHA_CONCEPT_IS_FINALIST', 'a current finalist cannot be dismissed');

insert into tap(line) select extensions.results_eq(
  $q$ select is_finalist, dismissed_at is null from public.concepts where id = current_setting('trilha.c1')::uuid $q$,
  $q$ values (true, true) $q$, 'the refused finalist is unchanged');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.set_concept_finalist(current_setting('trilha.c2')::uuid, true) $q$,
  '22023', 'TRILHA_CONCEPT_DISMISSED', 'a dismissed concept cannot become a finalist');

-- B cannot dismiss or restore A's concepts.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

insert into tap(line) select extensions.throws_ok(
  $q$ select public.set_concept_dismissed(current_setting('trilha.c2')::uuid, false) $q$,
  'P0002', 'TRILHA_CONCEPT_NOT_FOUND', 'B cannot restore A''s concept');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.set_concept_dismissed(current_setting('trilha.c1')::uuid, true) $q$,
  'P0002', 'TRILHA_CONCEPT_NOT_FOUND', 'B cannot dismiss A''s concept');

reset role;
select set_config('request.jwt.claims', '', true);

insert into tap(line) select extensions.throws_ok(
  $q$ select public.set_concept_dismissed(current_setting('trilha.c1')::uuid, true) $q$,
  'P0002', 'TRILHA_CONCEPT_NOT_FOUND', 'an unauthenticated call is rejected');

set local role service_role;
insert into tap(line) select extensions.throws_ok(
  $q$ select public.set_concept_dismissed(current_setting('trilha.c1')::uuid, true) $q$,
  '42501', null, 'the backend role cannot dismiss concepts');
reset role;

insert into tap(line) select extensions.ok(
  (select dismissed_at is not null and to_jsonb(c) - 'dismissed_at' = (select row from c2_before)
   from public.concepts c where id = current_setting('trilha.c2')::uuid),
  'dismissal keeps content, source path, AI provenance, round and timestamps');

insert into tap(line) select extensions.throws_ok(
  $q$ update public.concepts set is_finalist = true, finalist_at = now() where id = current_setting('trilha.c2')::uuid $q$,
  '23514', null, 'the table itself refuses a dismissed finalist, even for a privileged role');

-- A later generation round leaves the dismissal alone.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select set_config('trilha.sel_new', (public.select_path(current_setting('trilha.job_a1')::uuid, 'manual',
  (select id from public.creative_paths where editorial_code = '7' and snapshot_id = current_setting('trilha.snapshot')::uuid))).id::text, true);
select set_config('request.jwt.claims', '', true);
select set_config('trilha.req_new', (select request_id::text from public.begin_generation('00000000-0000-4000-8000-00000000000a',
  current_setting('trilha.job_a1')::uuid, 'concepts', 'modelo-teste', 'v1', current_setting('trilha.sel_new')::uuid)), true);
select public.complete_concepts('00000000-0000-4000-8000-00000000000a', current_setting('trilha.req_new')::uuid, 'modelo-servido',
  '[{"title":"Rodada 2","line":"Linha.","body":"Corpo."}]');

insert into tap(line) select extensions.results_eq(
  $q$ select (select dismissed_at::text from public.concepts where id = current_setting('trilha.c2')::uuid),
             (select count(*)::int from public.concepts
               where generation_request_id = current_setting('trilha.req_new')::uuid and dismissed_at is null) $q$,
  $q$ values (current_setting('trilha.c2_dismissed_at'), 1) $q$,
  'a new generation round keeps earlier dismissals and adds active concepts');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into tap(line) select extensions.ok(
  (public.set_concept_dismissed(current_setting('trilha.c2')::uuid, false)).dismissed_at is null,
  'the owner restores the concept');

insert into tap(line) select extensions.ok(
  (public.set_concept_dismissed(current_setting('trilha.c2')::uuid, false)).dismissed_at is null,
  'restoring again is a no-op');

insert into tap(line) select extensions.is(
  (select to_jsonb(c) - 'dismissed_at' from public.concepts c where id = current_setting('trilha.c2')::uuid),
  (select row from c2_before), 'the restored concept is exactly the original');

insert into tap(line) select extensions.is(
  (public.set_concept_finalist(current_setting('trilha.c2')::uuid, true)).is_finalist, true,
  'a restored concept can become a finalist again');
select public.set_concept_finalist(current_setting('trilha.c2')::uuid, false);

-- ---------------------------------------------------------------------------
-- 3. Presentation versions (user A)
-- ---------------------------------------------------------------------------

insert into tap(line) select extensions.results_eq(
  $q$ select version_number, full_text from public.presentation_versions
      where job_id = current_setting('trilha.job_a1')::uuid order by version_number $q$,
  $q$ values (1, E'Apresentação fictícia\n\nAbertura fictícia.\n\n1. Slide fictício\nTexto fictício.\n\nFechamento fictício.') $q$,
  'a saved version stores the complete presentation text');

create temporary table v1_before on commit drop as
select to_jsonb(v) as row from public.presentation_versions v
where job_id = current_setting('trilha.job_a1')::uuid and version_number = 1;
grant select on v1_before to public;

insert into tap(line) select extensions.is(
  (public.save_presentation_version(current_setting('trilha.pres_a1')::uuid,
     (select content from public.presentations where id = current_setting('trilha.pres_a1')::uuid))).version_number,
  2, 'saving the same draft again creates version 2');

insert into tap(line) select extensions.is(
  (public.save_presentation_version(current_setting('trilha.pres_a1')::uuid, jsonb_build_object(
     'title', 'Título revisto', 'intro', 'Abertura revista.',
     'slides', jsonb_build_array(jsonb_build_object('concept_id', current_setting('trilha.c1'), 'heading', 'Slide revisto', 'text', 'Texto revisto.')),
     'closing', 'Fechamento revisto.'))).full_text,
  E'Título revisto\n\nAbertura revista.\n\n1. Slide revisto\nTexto revisto.\n\nFechamento revisto.',
  'saving edited content creates version 3 with that content');

insert into tap(line) select extensions.is(
  (select content ->> 'title' from public.presentations where id = current_setting('trilha.pres_a1')::uuid),
  'Título revisto', 'the draft matches the content that was saved');

insert into tap(line) select extensions.results_eq(
  $q$ select version_number from public.presentation_versions
      where job_id = current_setting('trilha.job_a1')::uuid order by version_number desc $q$,
  $q$ values (3), (2), (1) $q$, 'versions are numbered per job and list newest first');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.save_presentation_version(current_setting('trilha.pres_a1')::uuid,
        '{"title":"x","intro":"y","closing":"z","slides":[{"concept_id":"00000000-0000-4000-8000-000000000999","heading":"h","text":"t"}]}') $q$,
  '22023', 'TRILHA_INVALID_CONTENT', 'a version can only reference the presentation''s own finalists');

insert into tap(line) select extensions.throws_ok(
  format($q$ select public.save_presentation_version(%L::uuid,
        '{"title":"  ","intro":"y","closing":"z","slides":[{"concept_id":"%s","heading":"h","text":"t"}]}') $q$,
        current_setting('trilha.pres_a1'), current_setting('trilha.c1')),
  '22023', 'TRILHA_INVALID_CONTENT', 'a version needs every part of the presentation');

insert into tap(line) select extensions.throws_ok(
  $q$ update public.presentation_versions set full_text = 'x' $q$,
  '42501', null, 'clients cannot change a version');

insert into tap(line) select extensions.throws_ok(
  $q$ delete from public.presentation_versions $q$,
  '42501', null, 'clients cannot delete a version');

-- Later changes to the job: concept copy, draft, briefing, finalists.
select public.update_concept(current_setting('trilha.c1')::uuid, 'Título trocado', 'Linha trocada.', 'Corpo trocado.');
select public.update_presentation(current_setting('trilha.pres_a1')::uuid, jsonb_build_object(
  'title', 'Rascunho novo', 'intro', 'i', 'closing', 'c',
  'slides', jsonb_build_array(jsonb_build_object('concept_id', current_setting('trilha.c1'), 'heading', 'h', 'text', 't'))));
select public.save_briefing_revision(current_setting('trilha.job_a1')::uuid, 'Briefing fictício, revisão 3.');
select public.set_concept_finalist(current_setting('trilha.c1')::uuid, false);

insert into tap(line) select extensions.is(
  (select to_jsonb(v) from public.presentation_versions v
   where job_id = current_setting('trilha.job_a1')::uuid and version_number = 1),
  (select row from v1_before), 'changes to current job data do not touch an older version');

insert into tap(line) select extensions.is(
  (select concepts -> 0 ->> 'title' from public.presentation_versions
   where job_id = current_setting('trilha.job_a1')::uuid and version_number = 1),
  'Conceito fictício 1', 'a version keeps the finalist titles as they read when saved');

reset role;
insert into tap(line) select extensions.throws_ok(
  $q$ update public.presentation_versions set full_text = 'x' $q$,
  '42501', null, 'versions are immutable even for a privileged role');

-- B cannot read or create A's versions.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

insert into tap(line) select extensions.is(
  (select count(*)::int from public.presentation_versions where job_id <> current_setting('trilha.job_b1')::uuid), 0,
  'B reads none of A''s versions');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.save_presentation_version(current_setting('trilha.pres_a1')::uuid,
        (select content from public.presentations where job_id = current_setting('trilha.job_b1')::uuid)) $q$,
  'P0002', 'TRILHA_PRESENTATION_NOT_FOUND', 'B cannot save a version of A''s presentation');

insert into tap(line) select extensions.is(
  (select count(*)::int from public.presentation_versions where job_id = current_setting('trilha.job_b1')::uuid), 1,
  'B reads its own version');

reset role;
select set_config('request.jwt.claims', '', true);

insert into tap(line) select extensions.is(
  (select count(*)::int from public.presentation_versions where job_id = current_setting('trilha.job_a1')::uuid), 3,
  'B''s attempt created no version for A');

-- ---------------------------------------------------------------------------
-- 4. Job deletion
-- ---------------------------------------------------------------------------

create temporary table before_delete on commit drop as
select pg_temp.graph_counts(current_setting('trilha.job_a1')::uuid) as a1,
       pg_temp.graph_counts(current_setting('trilha.job_a2')::uuid) as a2,
       pg_temp.graph_counts(current_setting('trilha.job_b1')::uuid) as b1,
       pg_temp.catalog_counts() as catalog;
grant select on before_delete to public;

insert into tap(line) select extensions.is(
  (select count(*)::int from before_delete, jsonb_each(a1) e where e.value::int = 0), 0,
  'the fixture job has rows in every job-scoped table');

insert into tap(line) select extensions.ok(
  (select a1 ? 'presentation_versions' and a1 ? 'briefing_revisions' and a1 ? 'concepts' and a1 ? 'path_draws' from before_delete),
  'the job-scoped table list includes S1, S2 and S3 tables');

-- Immutability still holds outside delete_job.
insert into tap(line) select extensions.throws_ok(
  $q$ delete from public.concepts where id = current_setting('trilha.c1')::uuid $q$,
  '42501', 'TRILHA_IMMUTABLE_ROW', 'concepts still cannot be deleted directly, even by a privileged role');

insert into tap(line) select extensions.throws_ok(
  $q$ delete from public.briefing_revisions where job_id = current_setting('trilha.job_a1')::uuid $q$,
  '42501', 'TRILHA_IMMUTABLE_ROW', 'briefing revisions still cannot be deleted directly');

insert into private.job_deletions (job_id, txid) values (current_setting('trilha.job_a1')::uuid, 1);
insert into tap(line) select extensions.throws_ok(
  $q$ delete from public.path_selections where job_id = current_setting('trilha.job_a1')::uuid $q$,
  '42501', 'TRILHA_IMMUTABLE_ROW', 'a deletion marker from another transaction does not unlock deletes');
delete from private.job_deletions;

-- Unauthorized deletion.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

insert into tap(line) select extensions.throws_ok(
  $q$ select public.delete_job(current_setting('trilha.job_a1')::uuid) $q$,
  'P0002', 'TRILHA_JOB_NOT_FOUND', 'B cannot delete A''s job');

insert into tap(line) select extensions.throws_ok(
  $q$ delete from public.jobs where id = current_setting('trilha.job_a1')::uuid $q$,
  '42501', null, 'clients cannot delete a job row directly');

reset role;
select set_config('request.jwt.claims', '', true);

insert into tap(line) select extensions.throws_ok(
  $q$ select public.delete_job(current_setting('trilha.job_a1')::uuid) $q$,
  '42501', 'TRILHA_UNAUTHENTICATED', 'an unauthenticated call deletes nothing');

set local role anon;
insert into tap(line) select extensions.throws_ok(
  $q$ select public.delete_job(current_setting('trilha.job_a1')::uuid) $q$,
  '42501', null, 'anon cannot call delete_job');
reset role;

insert into tap(line) select extensions.is(
  pg_temp.graph_counts(current_setting('trilha.job_a1')::uuid), (select a1 from before_delete),
  'rejected deletions left A''s job intact');

-- A failure in the last step rolls back every earlier delete.
create function pg_temp.fail_job_delete() returns trigger language plpgsql as $$
begin
  raise exception 'TEST_FORCED_FAILURE';
end;
$$;
create trigger test_fail_job_delete before delete on public.jobs for each row execute function pg_temp.fail_job_delete();

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
insert into tap(line) select extensions.throws_ok(
  $q$ select public.delete_job(current_setting('trilha.job_a1')::uuid) $q$,
  'P0001', 'TEST_FORCED_FAILURE', 'a deletion that fails at the last step raises');
reset role;

insert into tap(line) select extensions.is(
  pg_temp.graph_counts(current_setting('trilha.job_a1')::uuid), (select a1 from before_delete),
  'a failed deletion leaves the complete graph in place');

insert into tap(line) select extensions.is(
  (select count(*)::int from private.job_deletions), 0, 'a failed deletion leaves no marker behind');

drop trigger test_fail_job_delete on public.jobs;

-- The owner deletes A1.
set local role authenticated;
insert into tap(line) select extensions.is(
  public.delete_job(current_setting('trilha.job_a1')::uuid), current_setting('trilha.job_a1')::uuid,
  'the owner deletes the job');
reset role;

insert into tap(line) select extensions.is(
  (select count(*)::int from jsonb_each(pg_temp.graph_counts(current_setting('trilha.job_a1')::uuid)) e where e.value::int <> 0), 0,
  'no row of the deleted job remains in any job-scoped table');

insert into tap(line) select extensions.is(
  pg_temp.graph_counts(current_setting('trilha.job_a2')::uuid), (select a2 from before_delete),
  'the owner''s other job is untouched');

insert into tap(line) select extensions.is(
  pg_temp.graph_counts(current_setting('trilha.job_b1')::uuid), (select b1 from before_delete),
  'another owner''s job is untouched');

insert into tap(line) select extensions.is(
  pg_temp.catalog_counts(), (select catalog from before_delete),
  'catalog snapshots, editorial paths and users are untouched');

insert into tap(line) select extensions.is(
  (select count(*)::int from private.job_deletions), 0, 'a successful deletion leaves no marker behind');

set local role authenticated;

insert into tap(line) select extensions.throws_ok(
  $q$ select public.delete_job(current_setting('trilha.job_a1')::uuid) $q$,
  'P0002', 'TRILHA_JOB_NOT_FOUND', 'deleting the same job again fails safely');

insert into tap(line) select extensions.results_eq(
  $q$ select title from public.jobs order by title $q$,
  $q$ values ('Job fictício A2'::text) $q$, 'A''s job list now holds only the remaining job');

select public.delete_job(current_setting('trilha.job_a2')::uuid);

insert into tap(line) select extensions.is(
  (select count(*)::int from public.jobs), 0, 'after deleting the last job, A''s job list is empty');

reset role;

insert into tap(line) select extensions.is(
  pg_temp.graph_counts(current_setting('trilha.job_b1')::uuid), (select b1 from before_delete),
  'B''s job is still complete after A deleted every job');

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
