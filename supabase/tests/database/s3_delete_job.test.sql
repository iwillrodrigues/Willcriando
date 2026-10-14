-- S3 database tests: deleting a whole job.
--
-- Runs as one transaction and rolls back, so no fixture survives. Fixtures are
-- fictional: users A and B are created inside the transaction. Needs a current
-- catalog snapshot with at least two selectable paths (the job rows reference
-- real paths; the catalog itself is never written).
--
-- Same output convention as S1 and S2: TAP lines go to pg_temp.tap, a DO block
-- raises on any "not ok", and the run ends with one SELECT of the full output.

begin;

create temporary table tap (n serial, line text) on commit drop;
grant all on table tap to public;
grant usage on sequence tap_n_seq to public;

select extensions.plan(22);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres role): job J of A with a full flow, job K of B.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-8000-00000000000a', 'usuario.a@exemplo.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'usuario.b@exemplo.test', 'authenticated', 'authenticated');

create temporary table fx on commit drop as
select
  (select s.id from public.catalog_snapshots s where s.is_current) as snapshot,
  (select p.id from public.creative_paths p join public.catalog_snapshots s on s.id = p.snapshot_id and s.is_current
   where p.selectable order by p.path_number limit 1) as path1,
  (select p.id from public.creative_paths p join public.catalog_snapshots s on s.id = p.snapshot_id and s.is_current
   where p.selectable order by p.path_number offset 1 limit 1) as path2;

insert into public.jobs (id, owner_id, title) values
  ('11111111-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Job fictício A'),
  ('22222222-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000b', 'Job fictício B');

insert into public.briefing_revisions (id, job_id, revision_number, content, created_by) values
  ('11111111-0000-4000-8000-0000000000a1', '11111111-0000-4000-8000-000000000001', 1, 'Briefing fictício 1.', '00000000-0000-4000-8000-00000000000a'),
  ('11111111-0000-4000-8000-0000000000a2', '11111111-0000-4000-8000-000000000001', 2, 'Briefing fictício 2.', '00000000-0000-4000-8000-00000000000a'),
  ('22222222-0000-4000-8000-0000000000b1', '22222222-0000-4000-8000-000000000002', 1, 'Briefing de B.', '00000000-0000-4000-8000-00000000000b');

-- Analysis request, analysis and recommendation.
insert into public.generation_requests
  (id, job_id, kind, idempotency_key, payload, briefing_revision_id, catalog_snapshot_id, status, model, served_model,
   prompt_version, created_by, completed_at)
select '11111111-0000-4000-8000-0000000000c1', '11111111-0000-4000-8000-000000000001', 'analysis',
       md5('a1') || md5('a1x'), '{}', '11111111-0000-4000-8000-0000000000a2', fx.snapshot, 'succeeded', 'm', 'm',
       'v', '00000000-0000-4000-8000-00000000000a', now()
from fx;

insert into public.briefing_analyses (id, job_id, generation_request_id, briefing_revision_id, catalog_snapshot_id, output)
select '11111111-0000-4000-8000-0000000000d1', '11111111-0000-4000-8000-000000000001',
       '11111111-0000-4000-8000-0000000000c1', '11111111-0000-4000-8000-0000000000a2', fx.snapshot, '{}'
from fx;

insert into public.path_recommendations (id, job_id, analysis_id, creative_path_id, rank, reasoning)
select '11111111-0000-4000-8000-0000000000e1', '11111111-0000-4000-8000-000000000001',
       '11111111-0000-4000-8000-0000000000d1', fx.path1, 1, 'Motivo fictício.'
from fx;

-- A draw and two selections (recommended and random).
insert into public.path_draws (id, job_id, creative_path_id, drawn_by)
select '11111111-0000-4000-8000-0000000000f1', '11111111-0000-4000-8000-000000000001', fx.path2,
       '00000000-0000-4000-8000-00000000000a'
from fx;

insert into public.path_selections (id, job_id, origin, creative_path_id, recommendation_id, draw_id, briefing_revision_id, selected_by)
select '11111111-0000-4000-8000-000000000101', '11111111-0000-4000-8000-000000000001', 'recommended', fx.path1,
       '11111111-0000-4000-8000-0000000000e1', null, '11111111-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000000a'
from fx
union all
select '11111111-0000-4000-8000-000000000102', '11111111-0000-4000-8000-000000000001', 'random', fx.path2,
       null, '11111111-0000-4000-8000-0000000000f1', '11111111-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000000a'
from fx;

-- Concept generation (a failed attempt and its retry), concepts, presentation.
insert into public.generation_requests
  (id, job_id, kind, idempotency_key, payload, briefing_revision_id, selection_id, retry_of, status, error_code, model,
   served_model, prompt_version, created_by, completed_at)
values
  ('11111111-0000-4000-8000-0000000000c2', '11111111-0000-4000-8000-000000000001', 'concepts', md5('c2') || md5('c2x'), '{}',
   '11111111-0000-4000-8000-0000000000a2', '11111111-0000-4000-8000-000000000101', null, 'failed', 'AI_ERROR', 'm',
   null, 'v', '00000000-0000-4000-8000-00000000000a', now()),
  ('11111111-0000-4000-8000-0000000000c3', '11111111-0000-4000-8000-000000000001', 'concepts', md5('c3') || md5('c3x'), '{}',
   '11111111-0000-4000-8000-0000000000a2', '11111111-0000-4000-8000-000000000101', '11111111-0000-4000-8000-0000000000c2',
   'succeeded', null, 'm', 'm', 'v', '00000000-0000-4000-8000-00000000000a', now()),
  ('11111111-0000-4000-8000-0000000000c4', '11111111-0000-4000-8000-000000000001', 'presentation', md5('c4') || md5('c4x'), '{}',
   '11111111-0000-4000-8000-0000000000a2', null, null, 'succeeded', null, 'm', 'm', 'v',
   '00000000-0000-4000-8000-00000000000a', now());

insert into public.concepts
  (id, job_id, generation_request_id, selection_id, creative_path_id, briefing_revision_id, seq,
   ai_title, ai_line, ai_body, title, line, body, is_finalist, finalist_at)
select '11111111-0000-4000-8000-000000000201', '11111111-0000-4000-8000-000000000001', '11111111-0000-4000-8000-0000000000c3',
       '11111111-0000-4000-8000-000000000101', fx.path1, '11111111-0000-4000-8000-0000000000a2', 1,
       't', 'l', 'b', 't', 'l', 'b', true, now()
from fx;

insert into public.presentations (id, job_id, generation_request_id, concept_ids, ai_content, content)
values ('11111111-0000-4000-8000-000000000301', '11111111-0000-4000-8000-000000000001',
        '11111111-0000-4000-8000-0000000000c4', array['11111111-0000-4000-8000-000000000201']::uuid[], '{}', '{}');

-- ---------------------------------------------------------------------------
-- 1. Structure and privileges
-- ---------------------------------------------------------------------------

insert into tap(line) select extensions.has_function('public', 'delete_job', array['uuid'], 'delete_job exists');
insert into tap(line) select extensions.is(
  has_function_privilege('anon', 'public.delete_job(uuid)', 'execute'), false, 'anon cannot call delete_job');
insert into tap(line) select extensions.is(
  has_function_privilege('authenticated', 'public.delete_job(uuid)', 'execute'), true, 'authenticated can call delete_job');
insert into tap(line) select extensions.is(
  has_table_privilege('authenticated', 'public.jobs', 'delete'), false, 'authenticated still cannot delete jobs directly');
insert into tap(line) select extensions.is(
  (select count(*)::int from fx where snapshot is not null and path1 is not null and path2 is not null), 1,
  'fixture found a current catalog with two selectable paths');

-- ---------------------------------------------------------------------------
-- 2. Rows still cannot be deleted one by one, even by a privileged role
-- ---------------------------------------------------------------------------

insert into tap(line) select extensions.throws_ok(
  $q$ delete from public.concepts where job_id = '11111111-0000-4000-8000-000000000001' $q$,
  '42501', 'TRILHA_IMMUTABLE_ROW', 'a concept cannot be deleted on its own');
insert into tap(line) select extensions.throws_ok(
  $q$ delete from public.briefing_revisions where job_id = '11111111-0000-4000-8000-000000000001' $q$,
  '42501', 'TRILHA_IMMUTABLE_ROW', 'a briefing revision cannot be deleted on its own');
insert into tap(line) select extensions.throws_ok(
  $q$ update public.briefing_revisions set content = 'x' where job_id = '11111111-0000-4000-8000-000000000001' $q$,
  '42501', 'TRILHA_IMMUTABLE_ROW', 'a briefing revision still cannot be updated');
select set_config('trilha.deleting_job', '22222222-0000-4000-8000-000000000002', true);
insert into tap(line) select extensions.throws_ok(
  $q$ delete from public.concepts where job_id = '11111111-0000-4000-8000-000000000001' $q$,
  '42501', 'TRILHA_IMMUTABLE_ROW', 'the setting for another job does not open this job''s rows');
select set_config('trilha.deleting_job', '', true);

-- ---------------------------------------------------------------------------
-- 3. Only the owner can delete, and the whole job goes
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

insert into tap(line) select extensions.throws_ok(
  $q$ select public.delete_job('11111111-0000-4000-8000-000000000001') $q$,
  'P0002', 'TRILHA_JOB_NOT_FOUND', 'another user cannot delete the job');
insert into tap(line) select extensions.throws_ok(
  $q$ select public.delete_job('99999999-0000-4000-8000-000000000009') $q$,
  'P0002', 'TRILHA_JOB_NOT_FOUND', 'a missing job gives the same error');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

insert into tap(line) select extensions.lives_ok(
  $q$ select public.delete_job('11111111-0000-4000-8000-000000000001') $q$, 'the owner deletes the job');
insert into tap(line) select extensions.is(
  coalesce(current_setting('trilha.deleting_job', true), ''), '', 'the deletion setting is cleared afterwards');

reset role;
select set_config('request.jwt.claims', '', true);

insert into tap(line) select extensions.is(
  (select count(*)::int from public.jobs where id = '11111111-0000-4000-8000-000000000001'), 0, 'job is gone');
insert into tap(line) select extensions.is(
  (select count(*)::int from public.briefing_revisions where job_id = '11111111-0000-4000-8000-000000000001'), 0, 'revisions are gone');
insert into tap(line) select extensions.is(
  (select count(*)::int from public.generation_requests where job_id = '11111111-0000-4000-8000-000000000001'), 0,
  'generation requests are gone, retries included');
insert into tap(line) select extensions.is(
  (select count(*)::int from public.briefing_analyses where job_id = '11111111-0000-4000-8000-000000000001')
  + (select count(*)::int from public.path_recommendations where job_id = '11111111-0000-4000-8000-000000000001'),
  0, 'analyses and recommendations are gone');
insert into tap(line) select extensions.is(
  (select count(*)::int from public.path_draws where job_id = '11111111-0000-4000-8000-000000000001')
  + (select count(*)::int from public.path_selections where job_id = '11111111-0000-4000-8000-000000000001'),
  0, 'draws and selections are gone');
insert into tap(line) select extensions.is(
  (select count(*)::int from public.concepts where job_id = '11111111-0000-4000-8000-000000000001')
  + (select count(*)::int from public.presentations where job_id = '11111111-0000-4000-8000-000000000001'),
  0, 'concepts and presentations are gone');
insert into tap(line) select extensions.is(
  (select count(*)::int from public.briefing_revisions where job_id = '22222222-0000-4000-8000-000000000002'), 1,
  'the other user''s job is untouched');
insert into tap(line) select extensions.is(
  (select count(*)::int from public.creative_paths p join fx on p.id in (fx.path1, fx.path2)), 2,
  'the catalog paths the job used are untouched');

-- ---------------------------------------------------------------------------
-- 4. The catalog stays immutable
-- ---------------------------------------------------------------------------

select set_config('trilha.deleting_job', '11111111-0000-4000-8000-000000000001', true);
insert into tap(line) select extensions.throws_ok(
  $q$ delete from public.creative_paths where id = (select path1 from fx) $q$,
  '42501', 'TRILHA_IMMUTABLE_ROW', 'a catalog path cannot be deleted, even with the setting');

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
