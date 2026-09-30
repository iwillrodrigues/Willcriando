-- S1: jobs and immutable briefing revisions.
--
-- Scope: account-owned jobs, raw briefing text saved as append-only revisions,
-- owner-only access through RLS, and one narrow function to save a revision.
-- No catalog, analysis, path selection, generation, finalist or presentation
-- objects belong here.
--
-- Access model for the `authenticated` role:
--   jobs                select, insert (title), update (title)   own rows only (RLS)
--   briefing_revisions  select                                   own jobs only (RLS)
--   save_briefing_revision(uuid, text)                           execute
-- `anon` gets nothing. Revisions are never written directly by clients: the
-- only write path is save_briefing_revision, which checks ownership itself.

-- ---------------------------------------------------------------------------
-- Private helpers (schema not exposed through the Data API)
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.jobs_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.owner_id is distinct from old.owner_id
     or new.created_at is distinct from old.created_at then
    raise exception 'TRILHA_IMMUTABLE_COLUMN'
      using errcode = '42501',
            detail = 'jobs.id, jobs.owner_id and jobs.created_at cannot change.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'TRILHA_IMMUTABLE_ROW'
    using errcode = '42501',
          detail = format('%I.%I rows cannot be updated, deleted or truncated.', tg_table_schema, tg_table_name);
end;
$$;

revoke all on function private.jobs_before_update() from public, anon, authenticated;
revoke all on function private.forbid_mutation() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_title_normalized check (
    title = btrim(title)
    and char_length(title) between 1 and 200
  )
);

comment on table public.jobs is 'A creative job owned by exactly one user. Unit of isolation.';

-- Job list: own jobs, most recently touched first.
create index jobs_owner_updated_idx on public.jobs (owner_id, updated_at desc);

create trigger jobs_before_update
  before update on public.jobs
  for each row execute function private.jobs_before_update();

alter table public.jobs enable row level security;

revoke all on table public.jobs from public, anon, authenticated;
grant select on table public.jobs to authenticated;
grant insert (title) on table public.jobs to authenticated;
grant update (title) on table public.jobs to authenticated;

create policy jobs_select_own on public.jobs
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy jobs_insert_own on public.jobs
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy jobs_update_own on public.jobs
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- briefing_revisions
-- ---------------------------------------------------------------------------

create table public.briefing_revisions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete restrict,
  revision_number integer not null,
  content text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint briefing_revisions_number_positive check (revision_number >= 1),
  constraint briefing_revisions_content_present check (
    char_length(btrim(content)) > 0
    and char_length(content) <= 100000
  ),
  -- Also serves "latest revision of a job" (order by revision_number desc).
  constraint briefing_revisions_job_number_key unique (job_id, revision_number)
);

comment on table public.briefing_revisions is
  'Append-only raw briefing text. The current revision is the highest revision_number of a job.';

create trigger briefing_revisions_immutable
  before update or delete on public.briefing_revisions
  for each row execute function private.forbid_mutation();

create trigger briefing_revisions_no_truncate
  before truncate on public.briefing_revisions
  for each statement execute function private.forbid_mutation();

alter table public.briefing_revisions enable row level security;

revoke all on table public.briefing_revisions from public, anon, authenticated;
grant select on table public.briefing_revisions to authenticated;

create policy briefing_revisions_select_own on public.briefing_revisions
  for select to authenticated
  using (
    exists (
      select 1
      from public.jobs j
      where j.id = briefing_revisions.job_id
        and j.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- save_briefing_revision: the only write path for revisions
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because clients hold no INSERT privilege on
-- briefing_revisions. RLS therefore does not protect this function: every
-- check below is explicit. A job that does not exist and a job owned by
-- someone else produce the same error, so existence is never revealed.

create function public.save_briefing_revision(p_job_id uuid, p_content text)
returns public.briefing_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_next integer;
  v_row public.briefing_revisions;
begin
  if v_user is null then
    raise exception 'TRILHA_UNAUTHENTICATED' using errcode = '42501';
  end if;

  if p_content is null
     or char_length(btrim(p_content)) = 0
     or char_length(p_content) > 100000 then
    raise exception 'TRILHA_INVALID_CONTENT' using errcode = '22023';
  end if;

  -- Lock the owner's job row: concurrent saves on one job run one at a time.
  perform 1
  from public.jobs j
  where j.id = p_job_id
    and j.owner_id = v_user
  for update;

  if not found then
    raise exception 'TRILHA_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(max(r.revision_number), 0) + 1
  into v_next
  from public.briefing_revisions r
  where r.job_id = p_job_id;

  insert into public.briefing_revisions (job_id, revision_number, content, created_by)
  values (p_job_id, v_next, p_content, v_user)
  returning * into v_row;

  update public.jobs
  set updated_at = now()
  where id = p_job_id;

  return v_row;
end;
$$;

comment on function public.save_briefing_revision(uuid, text) is
  'Appends a briefing revision to a job owned by the caller and returns it.';

revoke all on function public.save_briefing_revision(uuid, text) from public, anon, authenticated;
grant execute on function public.save_briefing_revision(uuid, text) to authenticated;
