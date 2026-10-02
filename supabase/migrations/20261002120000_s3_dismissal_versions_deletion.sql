-- S3: reversible concept dismissal, immutable presentation versions and
-- permanent owner-only job deletion.
--
-- Forward-only. Changes to S1/S2 objects:
--   concepts.dismissed_at          new nullable column; existing rows stay active
--   concepts_before_update         also lets dismissed_at change
--   set_concept_finalist           refuses a dismissed concept (same signature)
--   presentations                  gains unique (id, job_id) for version FKs
--   delete triggers of job tables  re-pointed from private.forbid_mutation to a
--                                  guard that allows a delete only inside
--                                  delete_job for that job
--
-- Access model additions for `authenticated` (every write through a SECURITY
-- DEFINER function with an empty search_path and explicit ownership checks):
--   set_concept_dismissed(uuid, boolean)
--   save_presentation_version(uuid, jsonb)
--   delete_job(uuid)
--   presentation_versions           select, own jobs only (RLS)
-- `anon` and `service_role` get nothing new. Nothing in the catalog changes.
--
-- Existing presentations stay as editable drafts. No version is created for
-- them: a version is only ever the result of an explicit save by the owner.

-- ---------------------------------------------------------------------------
-- 1. Reversible concept dismissal
-- ---------------------------------------------------------------------------

alter table public.concepts
  add column dismissed_at timestamptz,
  -- A finalist is never dismissed, and a dismissed concept is never a finalist.
  add constraint concepts_finalist_not_dismissed check (not (is_finalist and dismissed_at is not null));

comment on column public.concepts.dismissed_at is
  'Set when the owner dismisses the concept; null means active. Content and provenance are kept.';

create or replace function private.concepts_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['title', 'line', 'body', 'edited_at', 'is_finalist', 'finalist_at', 'dismissed_at'])
     is distinct from (to_jsonb(old) - array['title', 'line', 'body', 'edited_at', 'is_finalist', 'finalist_at', 'dismissed_at']) then
    raise exception 'TRILHA_IMMUTABLE_COLUMN' using errcode = '42501',
      detail = 'Only the editable copy, the finalist mark and the dismissal of a concept can change.';
  end if;
  return new;
end;
$$;

revoke all on function private.concepts_before_update() from public, anon, authenticated, service_role;

-- Dismisses (true) or restores (false) a concept of the caller's job.
-- Repeating either call is a no-op: the first dismissal time is kept.
create function public.set_concept_dismissed(p_concept_id uuid, p_dismissed boolean)
returns public.concepts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.concepts;
begin
  select c.* into v_row
  from public.concepts c join public.jobs j on j.id = c.job_id
  where c.id = p_concept_id and j.owner_id = v_user
  for update of c;
  if v_user is null or p_dismissed is null or v_row.id is null then
    raise exception 'TRILHA_CONCEPT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_dismissed and v_row.is_finalist then
    raise exception 'TRILHA_CONCEPT_IS_FINALIST' using errcode = '22023';
  end if;

  update public.concepts
  set dismissed_at = case when p_dismissed then coalesce(dismissed_at, now()) end
  where id = p_concept_id
  returning * into v_row;
  return v_row;
end;
$$;

-- Unchanged from S2 except the dismissed check.
create or replace function public.set_concept_finalist(p_concept_id uuid, p_is_finalist boolean)
returns public.concepts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.concepts;
begin
  select c.* into v_row
  from public.concepts c join public.jobs j on j.id = c.job_id
  where c.id = p_concept_id and j.owner_id = v_user
  for update of c;
  if v_user is null or p_is_finalist is null or v_row.id is null then
    raise exception 'TRILHA_CONCEPT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_is_finalist and v_row.dismissed_at is not null then
    raise exception 'TRILHA_CONCEPT_DISMISSED' using errcode = '22023';
  end if;

  update public.concepts
  set is_finalist = p_is_finalist,
      finalist_at = case when p_is_finalist then coalesce(finalist_at, now()) end
  where id = p_concept_id
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Immutable presentation versions
-- ---------------------------------------------------------------------------

alter table public.presentations
  add constraint presentations_id_job_key unique (id, job_id);

create table public.presentation_versions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete restrict,
  presentation_id uuid not null,
  version_number integer not null,
  -- The structured content exactly as saved.
  content jsonb not null,
  -- The finalists the slides pointed at, as they read when saved: {id, title, line}.
  concepts jsonb not null,
  -- The complete presentation text, rendered once from content when saved.
  full_text text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint presentation_versions_number_positive check (version_number >= 1),
  constraint presentation_versions_content_object check (jsonb_typeof(content) = 'object'),
  constraint presentation_versions_content_size check (octet_length(content::text) <= 60000),
  constraint presentation_versions_concepts_array check (jsonb_typeof(concepts) = 'array'),
  constraint presentation_versions_text_present check (char_length(btrim(full_text)) > 0),
  -- Also serves "versions of a job, newest first".
  constraint presentation_versions_job_number_key unique (job_id, version_number),
  constraint presentation_versions_presentation_fk
    foreign key (presentation_id, job_id) references public.presentations (id, job_id)
);

comment on table public.presentation_versions is
  'Append-only saved versions of a job''s presentation. Each row is a complete snapshot; nothing reads current job data to show it.';

create index presentation_versions_presentation_idx on public.presentation_versions (presentation_id);

-- The complete text of a presentation content object. Deterministic: the same
-- content always renders the same text.
create function private.presentation_full_text(p_content jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(
    E'\n\n',
    btrim(p_content ->> 'title'),
    btrim(p_content ->> 'intro'),
    (select string_agg(s.ordinality || '. ' || btrim(s.value ->> 'heading') || E'\n' || btrim(s.value ->> 'text'),
                       E'\n\n' order by s.ordinality)
     from jsonb_array_elements(p_content -> 'slides') with ordinality s),
    btrim(p_content ->> 'closing')
  );
$$;

revoke all on function private.presentation_full_text(jsonb) from public, anon, authenticated, service_role;

-- Saves the content the owner is looking at as a new immutable version. The
-- draft is updated to the same content first, so draft and version match.
-- Every call appends a version; nothing is deduplicated or overwritten.
create function public.save_presentation_version(p_presentation_id uuid, p_content jsonb)
returns public.presentation_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_pres public.presentations;
  v_next integer;
  v_concepts jsonb;
  v_row public.presentation_versions;
begin
  select p.* into v_pres
  from public.presentations p join public.jobs j on j.id = p.job_id
  where p.id = p_presentation_id and j.owner_id = v_user;
  if v_user is null or v_pres.id is null then
    raise exception 'TRILHA_PRESENTATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Serializes version numbering of the job.
  perform private.lock_own_job(v_user, v_pres.job_id);

  if jsonb_typeof(p_content) is distinct from 'object'
     or octet_length(p_content::text) > 60000
     or jsonb_typeof(p_content -> 'title') is distinct from 'string'
     or jsonb_typeof(p_content -> 'intro') is distinct from 'string'
     or jsonb_typeof(p_content -> 'closing') is distinct from 'string'
     or char_length(btrim(p_content ->> 'title')) not between 1 and 200
     or char_length(btrim(p_content ->> 'intro')) not between 1 and 2000
     or char_length(btrim(p_content ->> 'closing')) not between 1 and 2000
     or jsonb_typeof(p_content -> 'slides') is distinct from 'array'
     or jsonb_array_length(p_content -> 'slides') not between 1 and 10
     or exists (
       select 1
       from jsonb_array_elements(p_content -> 'slides') s
       where jsonb_typeof(s) is distinct from 'object'
          or jsonb_typeof(s -> 'heading') is distinct from 'string'
          or jsonb_typeof(s -> 'text') is distinct from 'string'
          or char_length(btrim(s ->> 'heading')) not between 1 and 200
          or char_length(btrim(s ->> 'text')) not between 1 and 3000
          or coalesce(s ->> 'concept_id', '') not in (select unnest(v_pres.concept_ids)::text)
     ) then
    raise exception 'TRILHA_INVALID_CONTENT' using errcode = '22023';
  end if;

  if v_pres.content is distinct from p_content then
    update public.presentations set content = p_content, edited_at = now() where id = v_pres.id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'line', c.line) order by s.ordinality), '[]'::jsonb)
  into v_concepts
  from jsonb_array_elements(p_content -> 'slides') with ordinality s
  join public.concepts c on c.id::text = s.value ->> 'concept_id' and c.job_id = v_pres.job_id;

  select coalesce(max(v.version_number), 0) + 1 into v_next
  from public.presentation_versions v where v.job_id = v_pres.job_id;

  insert into public.presentation_versions
    (job_id, presentation_id, version_number, content, concepts, full_text, created_by)
  values
    (v_pres.job_id, v_pres.id, v_next, p_content, v_concepts, private.presentation_full_text(p_content), v_user)
  returning * into v_row;

  update public.jobs set updated_at = now() where id = v_pres.job_id;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Permanent job deletion
-- ---------------------------------------------------------------------------
-- Job-owned rows stay undeletable, with one exception: delete_job, for the
-- job it is deleting, in its own transaction. It records that in a private
-- table no API role can reach; the guard trigger checks it. The marker row is
-- removed before delete_job returns, and rolls back with it on failure.

create table private.job_deletions (
  job_id uuid primary key,
  txid bigint not null
);

revoke all on table private.job_deletions from public, anon, authenticated, service_role;

create function private.forbid_mutation_outside_job_deletion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and exists (
    select 1 from private.job_deletions d where d.job_id = old.job_id and d.txid = txid_current()
  ) then
    return old;
  end if;
  raise exception 'TRILHA_IMMUTABLE_ROW'
    using errcode = '42501',
          detail = format('%I.%I rows cannot be updated, deleted or truncated.', tg_table_schema, tg_table_name);
end;
$$;

revoke all on function private.forbid_mutation_outside_job_deletion() from public, anon, authenticated, service_role;

-- Combined update-or-delete triggers are split: updates stay forbidden.
drop trigger briefing_revisions_immutable on public.briefing_revisions;
drop trigger briefing_analyses_immutable on public.briefing_analyses;
drop trigger path_recommendations_immutable on public.path_recommendations;
drop trigger path_draws_immutable on public.path_draws;
drop trigger path_selections_immutable on public.path_selections;
drop trigger generation_requests_no_delete on public.generation_requests;
drop trigger concepts_no_delete on public.concepts;
drop trigger presentations_no_delete on public.presentations;

do $$
declare
  t text;
begin
  foreach t in array array['briefing_revisions', 'briefing_analyses', 'path_recommendations', 'path_draws', 'path_selections']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function private.forbid_mutation()',
                   t || '_immutable', t);
  end loop;
  foreach t in array array['briefing_revisions', 'briefing_analyses', 'path_recommendations', 'path_draws', 'path_selections',
                           'generation_requests', 'concepts', 'presentations', 'presentation_versions']
  loop
    execute format('create trigger %I before delete on public.%I for each row execute function private.forbid_mutation_outside_job_deletion()',
                   t || '_no_delete', t);
  end loop;
end;
$$;

create trigger presentation_versions_immutable before update on public.presentation_versions
  for each row execute function private.forbid_mutation();
create trigger presentation_versions_no_truncate before truncate on public.presentation_versions
  for each statement execute function private.forbid_mutation();

-- Deletes the caller's job and every row that belongs to it, in one
-- transaction: all of it or nothing. A job that does not exist (including one
-- already deleted) and a job owned by someone else raise the same error.
-- Catalog rows, other jobs and other users are never touched: every delete
-- below is filtered by this job's id.
create function public.delete_job(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  perform private.lock_own_job(v_user, p_job_id);

  -- Waits for any generation of this job that is completing right now, so no
  -- result lands between the deletes below.
  perform 1 from public.generation_requests r where r.job_id = p_job_id for update;

  insert into private.job_deletions (job_id, txid) values (p_job_id, txid_current());

  -- Children before parents. Requests are split by kind because selections,
  -- recommendations, analyses and requests reference each other in a cycle.
  delete from public.presentation_versions where job_id = p_job_id;
  delete from public.presentations where job_id = p_job_id;
  delete from public.concepts where job_id = p_job_id;
  delete from public.generation_requests where job_id = p_job_id and kind = 'concepts';
  delete from public.path_selections where job_id = p_job_id;
  delete from public.path_draws where job_id = p_job_id;
  delete from public.path_recommendations where job_id = p_job_id;
  delete from public.briefing_analyses where job_id = p_job_id;
  delete from public.generation_requests where job_id = p_job_id;
  delete from public.briefing_revisions where job_id = p_job_id;
  delete from public.jobs where id = p_job_id;

  delete from private.job_deletions where job_id = p_job_id;
  return p_job_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.presentation_versions enable row level security;

revoke all on table public.presentation_versions from public, anon, authenticated, service_role;
grant select on public.presentation_versions to authenticated;

create policy presentation_versions_select_own on public.presentation_versions
  for select to authenticated
  using (
    exists (select 1 from public.jobs j where j.id = presentation_versions.job_id and j.owner_id = (select auth.uid()))
  );

revoke all on function public.set_concept_dismissed(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.set_concept_finalist(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.save_presentation_version(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.delete_job(uuid) from public, anon, authenticated, service_role;

grant execute on function public.set_concept_dismissed(uuid, boolean) to authenticated;
grant execute on function public.set_concept_finalist(uuid, boolean) to authenticated;
grant execute on function public.save_presentation_version(uuid, jsonb) to authenticated;
grant execute on function public.delete_job(uuid) to authenticated;
