-- S1 database tests: jobs and briefing revisions.
--
-- Runs as one transaction and rolls back, so no fixture survives.
-- Fixtures are fictional: two users (A, B) created inside the transaction.
--
-- Output is collected in pg_temp.tap so the whole run can be submitted as a
-- single SQL payload to a runner that shows only one result set (the hosted
-- Supabase connector). Failures cannot be hidden: the DO block near the end
-- raises an exception listing every "not ok" line, and finish(true) raises if
-- the number of tests does not match the plan.

begin;

create temporary table tap (n serial, line text) on commit drop;
grant all on table tap to public;
grant usage on sequence tap_n_seq to public;

select extensions.plan(41);

-- ---------------------------------------------------------------------------
-- Fixtures (postgres role)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-4000-8000-00000000000a', 'usuario.a@exemplo.test', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'usuario.b@exemplo.test', 'authenticated', 'authenticated');


-- ---------------------------------------------------------------------------
-- 1. Structure
-- ---------------------------------------------------------------------------

insert into tap(line) select extensions.has_table('public', 'jobs', 'jobs exists');
insert into tap(line) select extensions.has_table('public', 'briefing_revisions', 'briefing_revisions exists');
insert into tap(line) select extensions.col_type_is('public', 'jobs', 'id', 'uuid', 'jobs.id is uuid');
insert into tap(line) select extensions.col_type_is('public', 'jobs', 'created_at', 'timestamp with time zone', 'jobs.created_at is timestamptz');
insert into tap(line) select extensions.col_type_is('public', 'briefing_revisions', 'id', 'uuid', 'briefing_revisions.id is uuid');
insert into tap(line) select extensions.col_is_unique('public', 'briefing_revisions', array['job_id', 'revision_number'], 'revision number is unique per job');
insert into tap(line) select extensions.has_function('public', 'save_briefing_revision', array['uuid', 'text'], 'save_briefing_revision exists');
insert into tap(line) select extensions.is(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.jobs'::regclass), true, 'RLS enabled on jobs');
insert into tap(line) select extensions.is(
  (select c.relrowsecurity from pg_class c where c.oid = 'public.briefing_revisions'::regclass), true, 'RLS enabled on briefing_revisions');
insert into tap(line) select extensions.is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'every table in public has RLS enabled');

-- ---------------------------------------------------------------------------
-- 2. Privileges
-- ---------------------------------------------------------------------------

insert into tap(line) select extensions.is(
  has_table_privilege('anon', 'public.jobs', 'select, insert, update, delete'), false, 'anon has no privilege on jobs');
insert into tap(line) select extensions.is(
  has_table_privilege('anon', 'public.briefing_revisions', 'select, insert, update, delete'), false, 'anon has no privilege on briefing_revisions');
insert into tap(line) select extensions.is(
  has_table_privilege('authenticated', 'public.briefing_revisions', 'insert, update, delete, truncate'), false,
  'authenticated cannot write briefing_revisions directly');
insert into tap(line) select extensions.is(
  has_table_privilege('authenticated', 'public.jobs', 'delete, truncate'), false, 'authenticated cannot delete jobs');
insert into tap(line) select extensions.is(
  has_column_privilege('authenticated', 'public.jobs', 'owner_id', 'update'), false, 'authenticated cannot update jobs.owner_id');
insert into tap(line) select extensions.is(
  has_function_privilege('anon', 'public.save_briefing_revision(uuid, text)', 'execute'), false, 'anon cannot execute save_briefing_revision');
insert into tap(line) select extensions.is(
  has_function_privilege('authenticated', 'public.save_briefing_revision(uuid, text)', 'execute'), true, 'authenticated can execute save_briefing_revision');
insert into tap(line) select extensions.is(
  (select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
   where p.oid = 'public.save_briefing_revision(uuid, text)'::regprocedure),
  true, 'save_briefing_revision is security definer with an empty search_path');

-- ---------------------------------------------------------------------------
-- 3. Owner operations (user A)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into tap(line) select extensions.lives_ok(
  $q$ insert into public.jobs (title) values ('Campanha fictícia A') $q$,
  'owner creates a job with a title only');

reset role;
insert into tap(line) select extensions.is(
  (select owner_id from public.jobs where title = 'Campanha fictícia A'),
  '00000000-0000-4000-8000-00000000000a'::uuid, 'owner_id comes from auth.uid()');
-- Remember A's job id for the cross-user checks (transaction-local setting).
select set_config('trilha.job_a', (select id::text from public.jobs where title = 'Campanha fictícia A'), true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

insert into tap(line) select extensions.throws_ok(
  $q$ insert into public.jobs (title, owner_id) values ('Job em nome de B', '00000000-0000-4000-8000-00000000000b') $q$,
  '42501', null, 'owner cannot create a job for another user');

insert into tap(line) select extensions.throws_ok(
  $q$ insert into public.jobs (title) values ('  título com espaços  ') $q$,
  '23514', null, 'job title must be trimmed');

insert into tap(line) select extensions.throws_ok(
  $q$ insert into public.jobs (title) values ('') $q$,
  '23514', null, 'job title cannot be empty');

insert into tap(line) select extensions.is(
  (select (public.save_briefing_revision(
     current_setting('trilha.job_a')::uuid, 'Briefing fictício, versão 1.')).revision_number),
  1, 'first save creates revision 1');

insert into tap(line) select extensions.is(
  (select (public.save_briefing_revision(
     current_setting('trilha.job_a')::uuid, 'Briefing fictício, versão 2.')).revision_number),
  2, 'second save creates revision 2');

insert into tap(line) select extensions.results_eq(
  $q$ select revision_number, content from public.briefing_revisions
      where job_id = current_setting('trilha.job_a')::uuid
      order by revision_number $q$,
  $q$ values (1, 'Briefing fictício, versão 1.'::text), (2, 'Briefing fictício, versão 2.'::text) $q$,
  'owner reads both revisions, history kept');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.save_briefing_revision(current_setting('trilha.job_a')::uuid, '   ') $q$,
  '22023', 'TRILHA_INVALID_CONTENT', 'blank briefing is rejected');

insert into tap(line) select extensions.throws_ok(
  $q$ update public.briefing_revisions set content = 'reescrito' where revision_number = 1 $q$,
  '42501', null, 'owner cannot update a revision');

insert into tap(line) select extensions.throws_ok(
  $q$ delete from public.briefing_revisions $q$,
  '42501', null, 'owner cannot delete revisions');

insert into tap(line) select extensions.throws_ok(
  $q$ insert into public.briefing_revisions (job_id, revision_number, content, created_by)
      values (current_setting('trilha.job_a')::uuid, 3, 'direto', '00000000-0000-4000-8000-00000000000a') $q$,
  '42501', null, 'owner cannot insert a revision directly');

insert into tap(line) select extensions.lives_ok(
  $q$ update public.jobs set title = 'Campanha fictícia A (renomeada)' where title = 'Campanha fictícia A' $q$,
  'owner renames own job');

-- ---------------------------------------------------------------------------
-- 4. Cross-user isolation (user B)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

insert into tap(line) select extensions.is(
  (select count(*)::int from public.jobs), 0, 'B sees no jobs of A');

insert into tap(line) select extensions.is(
  (select count(*)::int from public.briefing_revisions), 0, 'B sees no revisions of A');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.save_briefing_revision(current_setting('trilha.job_a')::uuid, 'intrusão') $q$,
  'P0002', 'TRILHA_JOB_NOT_FOUND', 'B cannot add a revision to A''s job');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.save_briefing_revision('00000000-0000-4000-8000-000000000999', 'inexistente') $q$,
  'P0002', 'TRILHA_JOB_NOT_FOUND', 'a missing job gives the same error as a foreign job');

-- B's update matches no visible row, so it changes nothing.
update public.jobs set title = 'Sequestrado por B' where id = current_setting('trilha.job_a')::uuid;

-- ---------------------------------------------------------------------------
-- 5. Anonymous access
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '', true);
set local role anon;

insert into tap(line) select extensions.throws_ok(
  $q$ select count(*) from public.jobs $q$, '42501', null, 'anon cannot read jobs');

insert into tap(line) select extensions.throws_ok(
  $q$ select public.save_briefing_revision(current_setting('trilha.job_a')::uuid, 'anônimo') $q$,
  '42501', null, 'anon cannot call save_briefing_revision');

-- ---------------------------------------------------------------------------
-- 6. Privileged checks (postgres)
-- ---------------------------------------------------------------------------

reset role;

insert into tap(line) select extensions.is(
  (select title from public.jobs where id = current_setting('trilha.job_a')::uuid),
  'Campanha fictícia A (renomeada)', 'B''s update left A''s job unchanged');

insert into tap(line) select extensions.throws_ok(
  $q$ update public.briefing_revisions set job_id = job_id $q$,
  '42501', null, 'revisions cannot be moved or rewritten even by a privileged role');

insert into tap(line) select extensions.throws_ok(
  $q$ insert into public.briefing_revisions (job_id, revision_number, content, created_by)
      select job_id, 1, 'duplicado', created_by from public.briefing_revisions where revision_number = 1 $q$,
  '23505', null, 'duplicate revision number is rejected');

insert into tap(line) select extensions.throws_ok(
  $q$ update public.jobs set owner_id = '00000000-0000-4000-8000-00000000000b' where owner_id = '00000000-0000-4000-8000-00000000000a' $q$,
  '42501', 'TRILHA_IMMUTABLE_COLUMN', 'job owner cannot change even for a privileged role');

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
