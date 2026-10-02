-- Read-only. How many of the 10 objects created by the S3 migration exist:
-- 0 means not applied, 10 means applied, anything else is a partial state.
begin transaction read only;
set local statement_timeout = '30s';

select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'concepts' and column_name = 'dismissed_at')
  + (to_regclass('public.presentation_versions') is not null)::int
  + (to_regclass('private.job_deletions') is not null)::int
  + (to_regprocedure('public.set_concept_dismissed(uuid, boolean)') is not null)::int
  + (to_regprocedure('public.save_presentation_version(uuid, jsonb)') is not null)::int
  + (to_regprocedure('public.delete_job(uuid)') is not null)::int
  + (to_regprocedure('private.presentation_full_text(jsonb)') is not null)::int
  + (to_regprocedure('private.forbid_mutation_outside_job_deletion()') is not null)::int
  + (select count(*) from pg_constraint
      where conname in ('concepts_finalist_not_dismissed', 'presentations_id_job_key')
        and conrelid in ('public.concepts'::regclass, 'public.presentations'::regclass));

rollback;
