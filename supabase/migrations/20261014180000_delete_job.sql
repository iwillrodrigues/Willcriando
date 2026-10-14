-- Deleting a whole job.
--
-- Until now nothing in a job could be deleted: every job-owned table has a
-- trigger that refuses DELETE. The owner can now delete an entire job, and
-- only that way: one function removes the job and everything it owns in a
-- single transaction. Rows are never deleted one by one, and the catalog
-- (catalog_snapshots, creative_paths) stays immutable.
--
-- How the guard works: delete_job sets a transaction-local setting naming the
-- job, and the job tables' delete triggers let a row go only when its job_id
-- matches it. No role gains a DELETE privilege on any table, so the setting
-- alone opens nothing; it is honored only inside delete_job's own DELETEs.

-- ---------------------------------------------------------------------------
-- Delete guard for job-owned rows
-- ---------------------------------------------------------------------------

create function private.forbid_delete_outside_job_deletion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('trilha.deleting_job', true), '') = old.job_id::text then
    return old;
  end if;
  raise exception 'TRILHA_IMMUTABLE_ROW'
    using errcode = '42501',
          detail = format('%I.%I rows are deleted only with their whole job.', tg_table_schema, tg_table_name);
end;
$$;

revoke all on function private.forbid_delete_outside_job_deletion() from public, anon, authenticated, service_role;

-- Tables whose single trigger covered both update and delete: the same
-- trigger is redefined for update only, and delete moves to the guard.
-- "create or replace trigger" swaps each trigger in place, without a window
-- in which a table is unprotected.
create or replace trigger briefing_revisions_immutable before update on public.briefing_revisions
  for each row execute function private.forbid_mutation();
create or replace trigger briefing_revisions_no_delete before delete on public.briefing_revisions
  for each row execute function private.forbid_delete_outside_job_deletion();

create or replace trigger briefing_analyses_immutable before update on public.briefing_analyses
  for each row execute function private.forbid_mutation();
create or replace trigger briefing_analyses_no_delete before delete on public.briefing_analyses
  for each row execute function private.forbid_delete_outside_job_deletion();

create or replace trigger path_recommendations_immutable before update on public.path_recommendations
  for each row execute function private.forbid_mutation();
create or replace trigger path_recommendations_no_delete before delete on public.path_recommendations
  for each row execute function private.forbid_delete_outside_job_deletion();

create or replace trigger path_draws_immutable before update on public.path_draws
  for each row execute function private.forbid_mutation();
create or replace trigger path_draws_no_delete before delete on public.path_draws
  for each row execute function private.forbid_delete_outside_job_deletion();

create or replace trigger path_selections_immutable before update on public.path_selections
  for each row execute function private.forbid_mutation();
create or replace trigger path_selections_no_delete before delete on public.path_selections
  for each row execute function private.forbid_delete_outside_job_deletion();

-- Tables that already had a delete-only trigger.
create or replace trigger generation_requests_no_delete before delete on public.generation_requests
  for each row execute function private.forbid_delete_outside_job_deletion();

create or replace trigger concepts_no_delete before delete on public.concepts
  for each row execute function private.forbid_delete_outside_job_deletion();

create or replace trigger presentations_no_delete before delete on public.presentations
  for each row execute function private.forbid_delete_outside_job_deletion();

-- TRUNCATE stays forbidden everywhere (unchanged).

-- ---------------------------------------------------------------------------
-- delete_job
-- ---------------------------------------------------------------------------

create function public.delete_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  -- Same error for a missing job and someone else's job.
  perform private.lock_own_job(v_user, p_job_id);
  perform set_config('trilha.deleting_job', p_job_id::text, true);

  -- One statement: the job tables reference each other in a cycle
  -- (selection -> recommendation -> analysis -> request -> selection), and
  -- those foreign keys are checked at the end of the statement.
  with
    d_presentations as (delete from public.presentations where job_id = p_job_id),
    d_concepts as (delete from public.concepts where job_id = p_job_id),
    d_selections as (delete from public.path_selections where job_id = p_job_id),
    d_draws as (delete from public.path_draws where job_id = p_job_id),
    d_recommendations as (delete from public.path_recommendations where job_id = p_job_id),
    d_analyses as (delete from public.briefing_analyses where job_id = p_job_id)
  delete from public.generation_requests where job_id = p_job_id;

  delete from public.briefing_revisions where job_id = p_job_id;
  delete from public.jobs where id = p_job_id;

  perform set_config('trilha.deleting_job', '', true);
end;
$$;

revoke all on function public.delete_job(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_job(uuid) to authenticated;
