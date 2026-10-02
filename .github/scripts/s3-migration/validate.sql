-- Read-only. Structural checks of the S3 migration, one "PASS|check" or
-- "FAIL|check" line each. Behaviour (dismissal, finalist protection, version
-- immutability, owner-only deletion) is covered by the S3 pgTAP suite.
begin transaction read only;
set local statement_timeout = '60s';
-- Definitions below print fully qualified names under this path.
set local search_path = pg_catalog;

with
trig(def) as (
  select pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
),
guarded(t) as (
  select unnest(array['briefing_revisions', 'briefing_analyses', 'path_recommendations', 'path_draws', 'path_selections',
                      'generation_requests', 'concepts', 'presentations', 'presentation_versions'])
),
split(t) as (
  select unnest(array['briefing_revisions', 'briefing_analyses', 'path_recommendations', 'path_draws', 'path_selections'])
),
fn(sig) as (
  select unnest(array['public.set_concept_dismissed(uuid, boolean)', 'public.set_concept_finalist(uuid, boolean)',
                      'public.save_presentation_version(uuid, jsonb)', 'public.delete_job(uuid)'])
),
pv_cols(col, typ) as (
  values ('id', 'uuid'), ('job_id', 'uuid'), ('presentation_id', 'uuid'), ('version_number', 'integer'),
         ('content', 'jsonb'), ('concepts', 'jsonb'), ('full_text', 'text'), ('created_by', 'uuid'),
         ('created_at', 'timestamp with time zone')
),
checks(name, ok) as (
  -- 1. Concept dismissal
  select 'concepts.dismissed_at is a nullable timestamptz', exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'concepts' and column_name = 'dismissed_at'
      and data_type = 'timestamp with time zone' and is_nullable = 'YES')
  union all select 'check concepts_finalist_not_dismissed', exists (
    select 1 from pg_constraint where conrelid = 'public.concepts'::regclass and conname = 'concepts_finalist_not_dismissed'
      and contype = 'c' and pg_get_constraintdef(oid) = 'CHECK ((NOT (is_finalist AND (dismissed_at IS NOT NULL))))')
  union all select 'concepts_before_update allows dismissed_at only',
    (select prosrc like '%''finalist_at'', ''dismissed_at''])%' from pg_proc where oid = 'private.concepts_before_update()'::regprocedure)
  union all select 'set_concept_finalist refuses a dismissed concept',
    (select prosrc like '%TRILHA_CONCEPT_DISMISSED%' from pg_proc where oid = 'public.set_concept_finalist(uuid, boolean)'::regprocedure)
  union all select 'set_concept_dismissed refuses a finalist',
    (select prosrc like '%TRILHA_CONCEPT_IS_FINALIST%' from pg_proc where oid = 'public.set_concept_dismissed(uuid, boolean)'::regprocedure)
  union all select 'every existing concept is still active (dismissed_at null)',
    not exists (select 1 from public.concepts where dismissed_at is not null)

  -- 2. Presentation versions
  union all select 'unique presentations_id_job_key (id, job_id)', exists (
    select 1 from pg_constraint where conrelid = 'public.presentations'::regclass and conname = 'presentations_id_job_key'
      and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (id, job_id)')
  union all select 'presentation_versions has the 9 expected not-null columns',
    (select count(*) = 9 from information_schema.columns
      where table_schema = 'public' and table_name = 'presentation_versions')
    and not exists (
      select 1 from pv_cols p left join information_schema.columns c
        on c.table_schema = 'public' and c.table_name = 'presentation_versions' and c.column_name = p.col
      where c.column_name is null or c.data_type <> p.typ or c.is_nullable <> 'NO')
  union all select 'presentation_versions has its 7 named constraints',
    (select count(*) = 7 from pg_constraint where conrelid = 'public.presentation_versions'::regclass and conname in (
      'presentation_versions_number_positive', 'presentation_versions_content_object', 'presentation_versions_content_size',
      'presentation_versions_concepts_array', 'presentation_versions_text_present', 'presentation_versions_job_number_key',
      'presentation_versions_presentation_fk'))
  union all select 'presentation_versions foreign keys: presentation (id, job_id), job and author, on delete restrict',
    (select count(*) = 3 from pg_constraint where conrelid = 'public.presentation_versions'::regclass and contype = 'f'
      and confdeltype in ('a', 'r')
      and confrelid in ('public.presentations'::regclass, 'public.jobs'::regclass, 'auth.users'::regclass))
    and exists (select 1 from pg_constraint where conname = 'presentation_versions_presentation_fk'
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (presentation_id, job_id) REFERENCES public.presentations(id, job_id)')
  union all select 'index presentation_versions_presentation_idx', exists (
    select 1 from pg_indexes where schemaname = 'public' and tablename = 'presentation_versions'
      and indexname = 'presentation_versions_presentation_idx')
  union all select 'private.presentation_full_text is immutable with an empty search_path', exists (
    select 1 from pg_proc where oid = 'private.presentation_full_text(jsonb)'::regprocedure
      and provolatile = 'i' and proconfig = array['search_path=""'])
  union all select 'no presentation version was created by the migration (no backfill)',
    not exists (select 1 from public.presentation_versions)

  -- 3. Job deletion
  union all select 'private.job_deletions exists and is empty',
    to_regclass('private.job_deletions') is not null and not exists (select 1 from private.job_deletions)
  union all select 'every job-owned table has <table>_no_delete -> forbid_mutation_outside_job_deletion',
    not exists (select 1 from guarded g where not exists (select 1 from trig where def = format(
      'CREATE TRIGGER %s_no_delete BEFORE DELETE ON public.%s FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation_outside_job_deletion()', g.t, g.t)))
  union all select 'split tables keep <table>_immutable as BEFORE UPDATE -> forbid_mutation',
    not exists (select 1 from split s where not exists (select 1 from trig where def = format(
      'CREATE TRIGGER %s_immutable BEFORE UPDATE ON public.%s FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation()', s.t, s.t)))
  union all select 'presentation_versions rejects update and truncate',
    exists (select 1 from trig where def = 'CREATE TRIGGER presentation_versions_immutable BEFORE UPDATE ON public.presentation_versions FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation()')
    and exists (select 1 from trig where def = 'CREATE TRIGGER presentation_versions_no_truncate BEFORE TRUNCATE ON public.presentation_versions FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_mutation()')
  union all select 'no job-owned delete trigger still points at plain forbid_mutation',
    not exists (select 1 from guarded g join trig on trig.def like format('CREATE TRIGGER %%_no_delete BEFORE DELETE ON public.%s %%', g.t)
      where trig.def like '%private.forbid_mutation()')
  union all select 'catalog tables keep their original delete protection', exists (
    select 1 from trig where def = 'CREATE TRIGGER catalog_snapshots_no_delete BEFORE DELETE ON public.catalog_snapshots FOR EACH ROW EXECUTE FUNCTION private.forbid_mutation()')

  -- RLS, grants and privileges
  union all select 'RLS enabled on presentation_versions',
    (select relrowsecurity from pg_class where oid = 'public.presentation_versions'::regclass)
  union all select 'policy presentation_versions_select_own: SELECT to authenticated, own jobs', exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'presentation_versions'
      and policyname = 'presentation_versions_select_own' and cmd = 'SELECT' and roles = array['authenticated']::name[]
      and qual like '%owner_id = ( SELECT auth.uid()%')
    and (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'presentation_versions')
  union all select 'authenticated may only SELECT presentation_versions',
    has_table_privilege('authenticated', 'public.presentation_versions', 'SELECT')
    and not has_table_privilege('authenticated', 'public.presentation_versions', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  union all select 'anon and service_role have no privilege on presentation_versions',
    not has_table_privilege('anon', 'public.presentation_versions', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    and not has_table_privilege('service_role', 'public.presentation_versions', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  union all select 'no API role can reach private.job_deletions',
    not has_table_privilege('anon', 'private.job_deletions', 'SELECT, INSERT, UPDATE, DELETE')
    and not has_table_privilege('authenticated', 'private.job_deletions', 'SELECT, INSERT, UPDATE, DELETE')
    and not has_table_privilege('service_role', 'private.job_deletions', 'SELECT, INSERT, UPDATE, DELETE')
  union all select 'the 4 S3 RPCs are SECURITY DEFINER with an empty search_path',
    not exists (select 1 from fn left join pg_proc p on p.oid = to_regprocedure(fn.sig)
      where p.oid is null or not p.prosecdef or p.proconfig is distinct from array['search_path=""'])
  union all select 'the 4 S3 RPCs are executable by authenticated only',
    not exists (select 1 from fn where not has_function_privilege('authenticated', fn.sig, 'EXECUTE')
      or has_function_privilege('anon', fn.sig, 'EXECUTE') or has_function_privilege('service_role', fn.sig, 'EXECUTE'))
  union all select 'private S3 helpers are not executable by any API role',
    not exists (select 1 from unnest(array['private.presentation_full_text(jsonb)', 'private.forbid_mutation_outside_job_deletion()',
                                           'private.concepts_before_update()']) s(sig)
      where has_function_privilege('anon', s.sig, 'EXECUTE') or has_function_privilege('authenticated', s.sig, 'EXECUTE')
         or has_function_privilege('service_role', s.sig, 'EXECUTE'))
)
select case when coalesce(ok, false) then 'PASS' else 'FAIL' end || '|' || name from checks;

rollback;
