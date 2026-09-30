-- S2: creative-path catalog and the rest of the creative flow.
--
-- Flow: briefing revision → AI analysis (+ path recommendations) → path
-- selection (recommended | manual | random) → concept generation → finalists
-- → presentation.
--
-- Access model
--   Clients (`authenticated`) only SELECT, through RLS limited to their own jobs.
--   Every write goes through a SECURITY DEFINER function with an empty
--   search_path and explicit ownership checks:
--     authenticated: draw_random_path, select_path, update_concept,
--                    set_concept_finalist, update_presentation
--     service_role:  import_catalog_snapshot, begin_generation,
--                    complete_analysis, complete_concepts,
--                    complete_presentation, fail_generation
--   AI output is written only by the backend (service_role functions), so a
--   client can never store text that the product would label as AI output.
--   Direct DML on these tables is revoked from every API role, service_role
--   included: RLS is not what protects privileged writes, the functions are.
--
-- Human control
--   A recommendation or a random draw never becomes a selection by itself:
--   select_path is the explicit user action, and it records the origin.
--   The active selection of a job is its most recent selection.
--
-- Provenance
--   concept → generation_request (payload, model, prompt_version, briefing
--   revision, selection) → path_selection (origin) → creative_path →
--   catalog_snapshot. Rows that record facts are immutable.
--
-- Idempotency
--   begin_generation builds the canonical payload itself (job, kind, briefing
--   revision, selection, catalog snapshot, finalist ids, retry_of, model,
--   prompt version) and uses sha256(payload) as a unique key. The same payload
--   returns the same request. Results and the `succeeded` status are written
--   in one transaction, so a request never has partial or duplicated results.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.path_selection_origin as enum ('recommended', 'manual', 'random');
create type public.generation_kind as enum ('analysis', 'concepts', 'presentation');
create type public.generation_status as enum ('pending', 'succeeded', 'failed');

-- Lets child tables prove that a revision belongs to the same job.
alter table public.briefing_revisions
  add constraint briefing_revisions_id_job_key unique (id, job_id);

-- ---------------------------------------------------------------------------
-- Catalog (global, read-only for clients)
-- ---------------------------------------------------------------------------

create table public.catalog_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  -- Private source metadata: not granted to clients.
  source_database_id text not null,
  content_hash text not null,
  path_count integer not null,
  is_current boolean not null default false,
  imported_at timestamptz not null default now(),
  constraint catalog_snapshots_source check (source = 'notion'),
  constraint catalog_snapshots_hash_format check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint catalog_snapshots_count check (path_count = 63),
  constraint catalog_snapshots_hash_key unique (content_hash)
);

comment on table public.catalog_snapshots is
  'One validated import of the 63-path editorial catalog. Exactly one snapshot is current.';

create unique index catalog_snapshots_one_current on public.catalog_snapshots (is_current) where is_current;

create table public.creative_paths (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.catalog_snapshots (id) on delete restrict,
  -- Private source metadata: not granted to clients.
  source_page_id text not null,
  source_last_edited_at timestamptz,
  path_number integer not null,
  title text not null,
  section text,
  content text not null default '',
  prompt_text text,
  content_hash text not null,
  constraint creative_paths_number_range check (path_number between 1 and 63),
  constraint creative_paths_title_present check (char_length(btrim(title)) > 0),
  constraint creative_paths_source_present check (char_length(btrim(source_page_id)) > 0),
  constraint creative_paths_hash_format check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint creative_paths_snapshot_number_key unique (snapshot_id, path_number),
  constraint creative_paths_snapshot_source_key unique (snapshot_id, source_page_id),
  constraint creative_paths_id_snapshot_key unique (id, snapshot_id)
);

comment on table public.creative_paths is
  'Editorial creative path, copied verbatim from the source catalog. Never edited in place.';

-- ---------------------------------------------------------------------------
-- Generation requests (one per AI call attempt)
-- ---------------------------------------------------------------------------

create table public.generation_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete restrict,
  kind public.generation_kind not null,
  idempotency_key text not null,
  payload jsonb not null,
  briefing_revision_id uuid not null,
  catalog_snapshot_id uuid references public.catalog_snapshots (id) on delete restrict,
  selection_id uuid,
  retry_of uuid,
  status public.generation_status not null default 'pending',
  error_code text,
  model text not null,
  -- The model that actually answered (a refusal fallback can differ from model).
  served_model text,
  prompt_version text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint generation_requests_key_format check (idempotency_key ~ '^[0-9a-f]{64}$'),
  constraint generation_requests_key_unique unique (idempotency_key),
  constraint generation_requests_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint generation_requests_selection_kind check ((kind = 'concepts') = (selection_id is not null)),
  constraint generation_requests_snapshot_kind check ((kind = 'analysis') = (catalog_snapshot_id is not null)),
  constraint generation_requests_completion check ((status = 'pending') = (completed_at is null)),
  constraint generation_requests_error check ((status = 'failed') = (error_code is not null)),
  constraint generation_requests_model_present check (char_length(model) > 0 and char_length(prompt_version) > 0),
  constraint generation_requests_served_model check ((status = 'succeeded') = (served_model is not null)),
  constraint generation_requests_id_job_key unique (id, job_id),
  constraint generation_requests_revision_fk
    foreign key (briefing_revision_id, job_id) references public.briefing_revisions (id, job_id),
  constraint generation_requests_retry_fk
    foreign key (retry_of, job_id) references public.generation_requests (id, job_id)
);

comment on table public.generation_requests is
  'One AI call attempt with its canonical payload. Retries are new rows pointing at the failed one.';

-- A failed request is retried at most once; the retry has its own id to retry.
create unique index generation_requests_retry_once on public.generation_requests (retry_of) where retry_of is not null;
create index generation_requests_job_idx on public.generation_requests (job_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- Analysis and recommendations (AI output)
-- ---------------------------------------------------------------------------

create table public.briefing_analyses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete restrict,
  generation_request_id uuid not null,
  briefing_revision_id uuid not null,
  catalog_snapshot_id uuid not null references public.catalog_snapshots (id) on delete restrict,
  output jsonb not null,
  created_at timestamptz not null default now(),
  constraint briefing_analyses_output_object check (jsonb_typeof(output) = 'object'),
  constraint briefing_analyses_request_key unique (generation_request_id),
  constraint briefing_analyses_id_job_key unique (id, job_id),
  constraint briefing_analyses_request_fk
    foreign key (generation_request_id, job_id) references public.generation_requests (id, job_id),
  constraint briefing_analyses_revision_fk
    foreign key (briefing_revision_id, job_id) references public.briefing_revisions (id, job_id)
);

create index briefing_analyses_job_idx on public.briefing_analyses (job_id, created_at desc);

create table public.path_recommendations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  analysis_id uuid not null,
  creative_path_id uuid not null references public.creative_paths (id) on delete restrict,
  rank integer not null,
  reasoning text not null,
  created_at timestamptz not null default now(),
  constraint path_recommendations_rank check (rank between 1 and 5),
  constraint path_recommendations_reasoning check (char_length(btrim(reasoning)) between 1 and 2000),
  constraint path_recommendations_analysis_rank_key unique (analysis_id, rank),
  constraint path_recommendations_analysis_path_key unique (analysis_id, creative_path_id),
  constraint path_recommendations_id_job_path_key unique (id, job_id, creative_path_id),
  constraint path_recommendations_analysis_fk
    foreign key (analysis_id, job_id) references public.briefing_analyses (id, job_id)
);

-- ---------------------------------------------------------------------------
-- Random draws and selections (user decisions)
-- ---------------------------------------------------------------------------

create table public.path_draws (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete restrict,
  creative_path_id uuid not null references public.creative_paths (id) on delete restrict,
  drawn_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint path_draws_id_job_path_key unique (id, job_id, creative_path_id)
);

comment on table public.path_draws is
  'A path drawn at random by the database. It is only a proposal until the user selects it.';

create table public.path_selections (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete restrict,
  origin public.path_selection_origin not null,
  creative_path_id uuid not null references public.creative_paths (id) on delete restrict,
  recommendation_id uuid,
  draw_id uuid,
  briefing_revision_id uuid not null,
  selected_by uuid not null references auth.users (id) on delete restrict,
  -- Monotonic order of choices; created_at can tie inside one transaction.
  choice_order bigint generated always as identity,
  created_at timestamptz not null default now(),
  constraint path_selections_origin_refs check (
    (origin = 'recommended' and recommendation_id is not null and draw_id is null)
    or (origin = 'random' and draw_id is not null and recommendation_id is null)
    or (origin = 'manual' and recommendation_id is null and draw_id is null)
  ),
  -- A draw is confirmed at most once.
  constraint path_selections_draw_key unique (draw_id),
  constraint path_selections_id_job_key unique (id, job_id),
  constraint path_selections_revision_fk
    foreign key (briefing_revision_id, job_id) references public.briefing_revisions (id, job_id),
  constraint path_selections_recommendation_fk
    foreign key (recommendation_id, job_id, creative_path_id)
    references public.path_recommendations (id, job_id, creative_path_id),
  constraint path_selections_draw_fk
    foreign key (draw_id, job_id, creative_path_id)
    references public.path_draws (id, job_id, creative_path_id)
);

comment on table public.path_selections is
  'An explicit user choice of a catalog path. The newest selection (highest choice_order) of a job is the active one.';

create index path_selections_job_idx on public.path_selections (job_id, choice_order desc);

alter table public.generation_requests
  add constraint generation_requests_selection_fk
  foreign key (selection_id, job_id) references public.path_selections (id, job_id);

-- ---------------------------------------------------------------------------
-- Concepts (AI output + editable user copy) and presentations
-- ---------------------------------------------------------------------------

create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  generation_request_id uuid not null,
  selection_id uuid not null,
  creative_path_id uuid not null references public.creative_paths (id) on delete restrict,
  briefing_revision_id uuid not null,
  seq integer not null,
  ai_title text not null,
  ai_line text not null,
  ai_body text not null,
  title text not null,
  line text not null,
  body text not null,
  edited_at timestamptz,
  is_finalist boolean not null default false,
  finalist_at timestamptz,
  created_at timestamptz not null default now(),
  constraint concepts_seq check (seq between 1 and 10),
  constraint concepts_text_limits check (
    char_length(btrim(title)) between 1 and 200
    and char_length(btrim(line)) between 1 and 400
    and char_length(btrim(body)) between 1 and 6000
  ),
  constraint concepts_finalist_time check (is_finalist = (finalist_at is not null)),
  constraint concepts_request_seq_key unique (generation_request_id, seq),
  constraint concepts_id_job_key unique (id, job_id),
  constraint concepts_request_fk
    foreign key (generation_request_id, job_id) references public.generation_requests (id, job_id),
  constraint concepts_selection_fk
    foreign key (selection_id, job_id) references public.path_selections (id, job_id),
  constraint concepts_revision_fk
    foreign key (briefing_revision_id, job_id) references public.briefing_revisions (id, job_id)
);

comment on column public.concepts.ai_title is 'As generated. Never changes; title holds the editable copy.';

create index concepts_job_idx on public.concepts (job_id, created_at, seq);

create table public.presentations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  generation_request_id uuid not null,
  concept_ids uuid[] not null,
  ai_content jsonb not null,
  content jsonb not null,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  constraint presentations_concepts_present check (cardinality(concept_ids) between 1 and 10),
  constraint presentations_ai_object check (jsonb_typeof(ai_content) = 'object'),
  constraint presentations_content_object check (jsonb_typeof(content) = 'object'),
  constraint presentations_content_size check (octet_length(content::text) <= 60000),
  constraint presentations_request_key unique (generation_request_id),
  constraint presentations_request_fk
    foreign key (generation_request_id, job_id) references public.generation_requests (id, job_id)
);

create index presentations_job_idx on public.presentations (job_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Immutability triggers
-- ---------------------------------------------------------------------------

create function private.catalog_snapshots_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'is_current') is distinct from (to_jsonb(old) - 'is_current') then
    raise exception 'TRILHA_IMMUTABLE_ROW' using errcode = '42501',
      detail = 'Only catalog_snapshots.is_current can change.';
  end if;
  return new;
end;
$$;

create function private.generation_requests_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending'
     or new.status = 'pending'
     or (to_jsonb(new) - array['status', 'error_code', 'completed_at', 'served_model'])
        is distinct from (to_jsonb(old) - array['status', 'error_code', 'completed_at', 'served_model']) then
    raise exception 'TRILHA_IMMUTABLE_ROW' using errcode = '42501',
      detail = 'A generation request only moves once, from pending to succeeded or failed.';
  end if;
  return new;
end;
$$;

create function private.concepts_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['title', 'line', 'body', 'edited_at', 'is_finalist', 'finalist_at'])
     is distinct from (to_jsonb(old) - array['title', 'line', 'body', 'edited_at', 'is_finalist', 'finalist_at']) then
    raise exception 'TRILHA_IMMUTABLE_COLUMN' using errcode = '42501',
      detail = 'Only the editable copy and the finalist mark of a concept can change.';
  end if;
  return new;
end;
$$;

create function private.presentations_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['content', 'edited_at'])
     is distinct from (to_jsonb(old) - array['content', 'edited_at']) then
    raise exception 'TRILHA_IMMUTABLE_COLUMN' using errcode = '42501',
      detail = 'Only the editable content of a presentation can change.';
  end if;
  return new;
end;
$$;

revoke all on function private.catalog_snapshots_before_update() from public, anon, authenticated;
revoke all on function private.generation_requests_before_update() from public, anon, authenticated;
revoke all on function private.concepts_before_update() from public, anon, authenticated;
revoke all on function private.presentations_before_update() from public, anon, authenticated;

create trigger catalog_snapshots_before_update before update on public.catalog_snapshots
  for each row execute function private.catalog_snapshots_before_update();
create trigger catalog_snapshots_no_delete before delete on public.catalog_snapshots
  for each row execute function private.forbid_mutation();
create trigger creative_paths_immutable before update or delete on public.creative_paths
  for each row execute function private.forbid_mutation();
create trigger generation_requests_before_update before update on public.generation_requests
  for each row execute function private.generation_requests_before_update();
create trigger generation_requests_no_delete before delete on public.generation_requests
  for each row execute function private.forbid_mutation();
create trigger briefing_analyses_immutable before update or delete on public.briefing_analyses
  for each row execute function private.forbid_mutation();
create trigger path_recommendations_immutable before update or delete on public.path_recommendations
  for each row execute function private.forbid_mutation();
create trigger path_draws_immutable before update or delete on public.path_draws
  for each row execute function private.forbid_mutation();
create trigger path_selections_immutable before update or delete on public.path_selections
  for each row execute function private.forbid_mutation();
create trigger concepts_before_update before update on public.concepts
  for each row execute function private.concepts_before_update();
create trigger concepts_no_delete before delete on public.concepts
  for each row execute function private.forbid_mutation();
create trigger presentations_before_update before update on public.presentations
  for each row execute function private.presentations_before_update();
create trigger presentations_no_delete before delete on public.presentations
  for each row execute function private.forbid_mutation();

do $$
declare
  t text;
begin
  foreach t in array array['catalog_snapshots', 'creative_paths', 'generation_requests', 'briefing_analyses',
                           'path_recommendations', 'path_draws', 'path_selections', 'concepts', 'presentations']
  loop
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.forbid_mutation()',
                   t || '_no_truncate', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.catalog_snapshots enable row level security;
alter table public.creative_paths enable row level security;
alter table public.generation_requests enable row level security;
alter table public.briefing_analyses enable row level security;
alter table public.path_recommendations enable row level security;
alter table public.path_draws enable row level security;
alter table public.path_selections enable row level security;
alter table public.concepts enable row level security;
alter table public.presentations enable row level security;

revoke all on table public.catalog_snapshots from public, anon, authenticated, service_role;
revoke all on table public.creative_paths from public, anon, authenticated, service_role;
revoke all on table public.generation_requests from public, anon, authenticated, service_role;
revoke all on table public.briefing_analyses from public, anon, authenticated, service_role;
revoke all on table public.path_recommendations from public, anon, authenticated, service_role;
revoke all on table public.path_draws from public, anon, authenticated, service_role;
revoke all on table public.path_selections from public, anon, authenticated, service_role;
revoke all on table public.concepts from public, anon, authenticated, service_role;
revoke all on table public.presentations from public, anon, authenticated, service_role;

-- Catalog: every signed-in user reads the editorial content, never the source ids.
grant select (id, path_count, is_current, imported_at) on public.catalog_snapshots to authenticated;
grant select (id, snapshot_id, path_number, title, section, content, prompt_text) on public.creative_paths to authenticated;

create policy catalog_snapshots_read on public.catalog_snapshots
  for select to authenticated using (true);
create policy creative_paths_read on public.creative_paths
  for select to authenticated using (true);

-- Job-scoped tables: the owner reads rows of their own jobs.
grant select (id, job_id, kind, briefing_revision_id, catalog_snapshot_id, selection_id, retry_of,
              status, error_code, model, served_model, prompt_version, created_at, completed_at)
  on public.generation_requests to authenticated;
grant select on public.briefing_analyses to authenticated;
grant select on public.path_recommendations to authenticated;
grant select on public.path_draws to authenticated;
grant select on public.path_selections to authenticated;
grant select on public.concepts to authenticated;
grant select on public.presentations to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['generation_requests', 'briefing_analyses', 'path_recommendations', 'path_draws',
                           'path_selections', 'concepts', 'presentations']
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         exists (select 1 from public.jobs j where j.id = %I.job_id and j.owner_id = (select auth.uid())))',
      t || '_select_own', t, t);
  end loop;
end;
$$;

-- The migration role keeps this schema clean by default: new tables and
-- functions start with no API privileges.
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared private helpers
-- ---------------------------------------------------------------------------

-- Locks and returns the owner's job, or raises the same error for a job that
-- does not exist and a job owned by someone else.
create function private.lock_own_job(p_user uuid, p_job_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_user is null then
    raise exception 'TRILHA_UNAUTHENTICATED' using errcode = '42501';
  end if;
  perform 1 from public.jobs j where j.id = p_job_id and j.owner_id = p_user for update;
  if not found then
    raise exception 'TRILHA_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

create function private.latest_revision_id(p_job_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select r.id from public.briefing_revisions r
  where r.job_id = p_job_id
  order by r.revision_number desc
  limit 1;
$$;

create function private.active_selection_id(p_job_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select s.id from public.path_selections s
  where s.job_id = p_job_id
  order by s.choice_order desc
  limit 1;
$$;

create function private.current_snapshot_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select s.id from public.catalog_snapshots s where s.is_current;
$$;

revoke all on function private.lock_own_job(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.latest_revision_id(uuid) from public, anon, authenticated, service_role;
revoke all on function private.active_selection_id(uuid) from public, anon, authenticated, service_role;
revoke all on function private.current_snapshot_id() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catalog import (service_role)
-- ---------------------------------------------------------------------------
-- p_paths: array of 63 objects with source_page_id, path_number, title,
-- section, content, prompt_text, source_last_edited_at. Validated again here;
-- an identical catalog returns the existing snapshot (idempotent).

create function public.import_catalog_snapshot(p_source_database_id text, p_paths jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_snapshot uuid;
  v_count integer;
begin
  if p_source_database_id is null or char_length(btrim(p_source_database_id)) = 0 then
    raise exception 'TRILHA_INVALID_CATALOG' using errcode = '22023', detail = 'Missing source database id.';
  end if;
  if jsonb_typeof(p_paths) is distinct from 'array' then
    raise exception 'TRILHA_INVALID_CATALOG' using errcode = '22023', detail = 'Paths must be an array.';
  end if;

  select count(*) into v_count from jsonb_array_elements(p_paths) e;

  if v_count <> 63
     or (select count(distinct e ->> 'source_page_id') from jsonb_array_elements(p_paths) e) <> 63
     or (select count(distinct e ->> 'path_number') from jsonb_array_elements(p_paths) e) <> 63
     or exists (
       select 1 from jsonb_array_elements(p_paths) e
       where coalesce(btrim(e ->> 'source_page_id'), '') = ''
          or coalesce(btrim(e ->> 'title'), '') = ''
          or (e ->> 'path_number') !~ '^[0-9]+$'
          or (e ->> 'path_number')::integer not between 1 and 63
     ) then
    raise exception 'TRILHA_INVALID_CATALOG' using errcode = '22023',
      detail = 'Expected 63 paths with unique source ids, unique numbers 1-63 and a title.';
  end if;

  -- jsonb normalizes key order, so this hash is canonical for the content.
  select encode(sha256(convert_to(jsonb_agg(e order by (e ->> 'path_number')::integer)::text, 'UTF8')), 'hex')
  into v_hash
  from jsonb_array_elements(p_paths) e;

  select s.id into v_snapshot from public.catalog_snapshots s where s.content_hash = v_hash;

  if v_snapshot is null then
    insert into public.catalog_snapshots (source, source_database_id, content_hash, path_count)
    values ('notion', p_source_database_id, v_hash, 63)
    returning id into v_snapshot;

    insert into public.creative_paths
      (snapshot_id, source_page_id, source_last_edited_at, path_number, title, section, content, prompt_text, content_hash)
    select v_snapshot,
           e ->> 'source_page_id',
           nullif(e ->> 'source_last_edited_at', '')::timestamptz,
           (e ->> 'path_number')::integer,
           e ->> 'title',
           nullif(e ->> 'section', ''),
           coalesce(e ->> 'content', ''),
           nullif(e ->> 'prompt_text', ''),
           encode(sha256(convert_to(e::text, 'UTF8')), 'hex')
    from jsonb_array_elements(p_paths) e;
  end if;

  update public.catalog_snapshots set is_current = false where is_current and id <> v_snapshot;
  update public.catalog_snapshots set is_current = true where id = v_snapshot and not is_current;

  return v_snapshot;
end;
$$;

-- ---------------------------------------------------------------------------
-- User decisions (authenticated)
-- ---------------------------------------------------------------------------

-- Draws one path of the current catalog. The draw is a proposal only.
create function public.draw_random_path(p_job_id uuid)
returns public.path_draws
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_snapshot uuid;
  v_row public.path_draws;
begin
  perform private.lock_own_job(v_user, p_job_id);
  v_snapshot := private.current_snapshot_id();
  if v_snapshot is null then
    raise exception 'TRILHA_CATALOG_EMPTY' using errcode = 'P0002';
  end if;

  insert into public.path_draws (job_id, creative_path_id, drawn_by)
  select p_job_id, p.id, v_user
  from public.creative_paths p
  where p.snapshot_id = v_snapshot
  order by random()
  limit 1
  returning * into v_row;

  return v_row;
end;
$$;

-- The explicit human choice. Origin must match the evidence:
--   recommended → a recommendation of this job, from an analysis of the
--                 current briefing revision, for this exact path;
--   random      → an unconfirmed draw of this job for this exact path;
--   manual      → no reference.
create function public.select_path(
  p_job_id uuid,
  p_origin public.path_selection_origin,
  p_creative_path_id uuid,
  p_recommendation_id uuid default null,
  p_draw_id uuid default null
)
returns public.path_selections
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_revision uuid;
  v_row public.path_selections;
begin
  perform private.lock_own_job(v_user, p_job_id);

  v_revision := private.latest_revision_id(p_job_id);
  if v_revision is null then
    raise exception 'TRILHA_NO_BRIEFING' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.creative_paths p
    where p.id = p_creative_path_id and p.snapshot_id = private.current_snapshot_id()
  ) then
    raise exception 'TRILHA_PATH_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_origin = 'recommended' then
    if p_draw_id is not null or not exists (
      select 1
      from public.path_recommendations r
      join public.briefing_analyses a on a.id = r.analysis_id
      where r.id = p_recommendation_id
        and r.job_id = p_job_id
        and r.creative_path_id = p_creative_path_id
        and a.briefing_revision_id = v_revision
    ) then
      raise exception 'TRILHA_INVALID_SELECTION' using errcode = '22023';
    end if;
  elsif p_origin = 'random' then
    if p_recommendation_id is not null or not exists (
      select 1 from public.path_draws d
      where d.id = p_draw_id and d.job_id = p_job_id and d.creative_path_id = p_creative_path_id
        and not exists (select 1 from public.path_selections s where s.draw_id = d.id)
    ) then
      raise exception 'TRILHA_INVALID_SELECTION' using errcode = '22023';
    end if;
  elsif p_recommendation_id is not null or p_draw_id is not null then
    raise exception 'TRILHA_INVALID_SELECTION' using errcode = '22023';
  end if;

  insert into public.path_selections
    (job_id, origin, creative_path_id, recommendation_id, draw_id, briefing_revision_id, selected_by)
  values (p_job_id, p_origin, p_creative_path_id, p_recommendation_id, p_draw_id, v_revision, v_user)
  returning * into v_row;

  update public.jobs set updated_at = now() where id = p_job_id;
  return v_row;
end;
$$;

create function public.update_concept(p_concept_id uuid, p_title text, p_line text, p_body text)
returns public.concepts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_job uuid;
  v_row public.concepts;
begin
  select c.job_id into v_job
  from public.concepts c join public.jobs j on j.id = c.job_id
  where c.id = p_concept_id and j.owner_id = v_user;
  if v_user is null or v_job is null then
    raise exception 'TRILHA_CONCEPT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_title is null or char_length(btrim(p_title)) not between 1 and 200
     or p_line is null or char_length(btrim(p_line)) not between 1 and 400
     or p_body is null or char_length(btrim(p_body)) not between 1 and 6000 then
    raise exception 'TRILHA_INVALID_CONTENT' using errcode = '22023';
  end if;

  update public.concepts
  set title = btrim(p_title), line = btrim(p_line), body = btrim(p_body), edited_at = now()
  where id = p_concept_id
  returning * into v_row;
  return v_row;
end;
$$;

create function public.set_concept_finalist(p_concept_id uuid, p_is_finalist boolean)
returns public.concepts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.concepts;
begin
  if v_user is null or p_is_finalist is null or not exists (
    select 1 from public.concepts c join public.jobs j on j.id = c.job_id
    where c.id = p_concept_id and j.owner_id = v_user
  ) then
    raise exception 'TRILHA_CONCEPT_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.concepts
  set is_finalist = p_is_finalist,
      finalist_at = case when p_is_finalist then coalesce(finalist_at, now()) end
  where id = p_concept_id
  returning * into v_row;
  return v_row;
end;
$$;

create function public.update_presentation(p_presentation_id uuid, p_content jsonb)
returns public.presentations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.presentations;
begin
  if v_user is null or not exists (
    select 1 from public.presentations p join public.jobs j on j.id = p.job_id
    where p.id = p_presentation_id and j.owner_id = v_user
  ) then
    raise exception 'TRILHA_PRESENTATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_content) is distinct from 'object'
     or octet_length(p_content::text) > 60000
     or jsonb_typeof(p_content -> 'slides') is distinct from 'array'
     or exists (
       select 1
       from jsonb_array_elements(p_content -> 'slides') s
       where coalesce(s ->> 'concept_id', '') not in (
         select unnest(p.concept_ids)::text from public.presentations p where p.id = p_presentation_id)
     ) then
    raise exception 'TRILHA_INVALID_CONTENT' using errcode = '22023';
  end if;

  update public.presentations set content = p_content, edited_at = now()
  where id = p_presentation_id
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- AI generation lifecycle (service_role only)
-- ---------------------------------------------------------------------------
-- p_user_id is the user the backend authenticated. Every function re-checks
-- that the job belongs to that user and that every reference belongs to the
-- job; none of them relies on RLS.

create function public.begin_generation(
  p_user_id uuid,
  p_job_id uuid,
  p_kind public.generation_kind,
  p_model text,
  p_prompt_version text,
  p_selection_id uuid default null,
  p_retry_of uuid default null
)
returns table (request_id uuid, status public.generation_status, created boolean, payload jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_revision uuid;
  v_snapshot uuid;
  v_finalists jsonb;
  v_payload jsonb;
  v_key text;
  v_existing public.generation_requests;
  v_retry public.generation_requests;
  v_new uuid;
begin
  perform private.lock_own_job(p_user_id, p_job_id);

  if p_model is null or char_length(btrim(p_model)) = 0
     or p_prompt_version is null or char_length(btrim(p_prompt_version)) = 0 then
    raise exception 'TRILHA_INVALID_REQUEST' using errcode = '22023';
  end if;

  if p_kind = 'concepts' then
    -- Revalidated on every attempt, retries included: only the active
    -- selection can be used, and it carries its own briefing revision.
    if p_selection_id is null or p_selection_id is distinct from private.active_selection_id(p_job_id) then
      raise exception 'TRILHA_SELECTION_NOT_ACTIVE' using errcode = '22023';
    end if;
    select s.briefing_revision_id into v_revision from public.path_selections s where s.id = p_selection_id;
  else
    if p_selection_id is not null then
      raise exception 'TRILHA_INVALID_REQUEST' using errcode = '22023';
    end if;
    v_revision := private.latest_revision_id(p_job_id);
    if v_revision is null then
      raise exception 'TRILHA_NO_BRIEFING' using errcode = 'P0002';
    end if;
  end if;

  if p_kind = 'analysis' then
    v_snapshot := private.current_snapshot_id();
    if v_snapshot is null then
      raise exception 'TRILHA_CATALOG_EMPTY' using errcode = 'P0002';
    end if;
  end if;

  if p_kind = 'presentation' then
    select coalesce(jsonb_agg(c.id order by c.id), '[]'::jsonb) into v_finalists
    from public.concepts c where c.job_id = p_job_id and c.is_finalist;
    if jsonb_array_length(v_finalists) = 0 then
      raise exception 'TRILHA_NO_FINALISTS' using errcode = '22023';
    end if;
  end if;

  if p_retry_of is not null then
    select * into v_retry from public.generation_requests r where r.id = p_retry_of and r.job_id = p_job_id;
    if v_retry.id is null
       or v_retry.status <> 'failed'
       or v_retry.kind <> p_kind
       or v_retry.selection_id is distinct from p_selection_id
       or v_retry.briefing_revision_id <> v_revision then
      raise exception 'TRILHA_INVALID_RETRY' using errcode = '22023';
    end if;
  end if;

  v_payload := jsonb_build_object(
    'job_id', p_job_id,
    'kind', p_kind,
    'briefing_revision_id', v_revision,
    'selection_id', p_selection_id,
    'catalog_snapshot_id', v_snapshot,
    'finalist_ids', v_finalists,
    'retry_of', p_retry_of,
    'model', p_model,
    'prompt_version', p_prompt_version
  );
  v_key := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

  insert into public.generation_requests
    (job_id, kind, idempotency_key, payload, briefing_revision_id, catalog_snapshot_id, selection_id,
     retry_of, model, prompt_version, created_by)
  values
    (p_job_id, p_kind, v_key, v_payload, v_revision, v_snapshot, p_selection_id,
     p_retry_of, p_model, p_prompt_version, p_user_id)
  on conflict (idempotency_key) do nothing
  returning id into v_new;

  if v_new is not null then
    return query select v_new, 'pending'::public.generation_status, true, v_payload;
    return;
  end if;

  select * into v_existing from public.generation_requests r where r.idempotency_key = v_key;

  -- A request left pending by a crashed worker becomes retryable.
  if v_existing.status = 'pending' and v_existing.created_at < now() - interval '10 minutes' then
    update public.generation_requests
    set status = 'failed', error_code = 'TRILHA_STALE', completed_at = now()
    where id = v_existing.id;
    v_existing.status := 'failed';
  end if;

  return query select v_existing.id, v_existing.status, false, v_existing.payload;
end;
$$;

-- Loads a pending request of the given kind that belongs to the user's job.
create function private.pending_request(p_user_id uuid, p_request_id uuid, p_kind public.generation_kind)
returns public.generation_requests
language plpgsql
set search_path = ''
as $$
declare
  v_row public.generation_requests;
begin
  if p_user_id is null then
    raise exception 'TRILHA_UNAUTHENTICATED' using errcode = '42501';
  end if;
  select r.* into v_row
  from public.generation_requests r join public.jobs j on j.id = r.job_id
  where r.id = p_request_id and j.owner_id = p_user_id and r.kind = p_kind
  for update of r;
  if v_row.id is null then
    raise exception 'TRILHA_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'TRILHA_REQUEST_NOT_PENDING' using errcode = '22023';
  end if;
  return v_row;
end;
$$;

revoke all on function private.pending_request(uuid, uuid, public.generation_kind) from public, anon, authenticated, service_role;

-- p_output: the validated analysis object. p_recommendations: array of
-- {path_number, reasoning}; numbers must exist in the request's snapshot.
create function public.complete_analysis(
  p_user_id uuid, p_request_id uuid, p_served_model text, p_output jsonb, p_recommendations jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.generation_requests;
  v_analysis uuid;
  v_count integer;
  v_matched integer;
begin
  v_req := private.pending_request(p_user_id, p_request_id, 'analysis');
  if p_served_model is null or char_length(btrim(p_served_model)) = 0 then
    raise exception 'TRILHA_INVALID_REQUEST' using errcode = '22023';
  end if;

  if jsonb_typeof(p_output) is distinct from 'object' or jsonb_typeof(p_recommendations) is distinct from 'array' then
    raise exception 'TRILHA_INVALID_AI_OUTPUT' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_recommendations);

  select count(distinct p.id) into v_matched
  from jsonb_array_elements(p_recommendations) e
  join public.creative_paths p
    on p.snapshot_id = v_req.catalog_snapshot_id
   and (e ->> 'path_number') ~ '^[0-9]+$'
   and p.path_number = (e ->> 'path_number')::integer
  where char_length(btrim(coalesce(e ->> 'reasoning', ''))) between 1 and 2000;

  if v_count not between 1 and 5 or v_matched <> v_count then
    raise exception 'TRILHA_INVALID_AI_OUTPUT' using errcode = '22023',
      detail = 'Recommendations must reference 1 to 5 distinct paths of the catalog snapshot.';
  end if;

  insert into public.briefing_analyses (job_id, generation_request_id, briefing_revision_id, catalog_snapshot_id, output)
  values (v_req.job_id, v_req.id, v_req.briefing_revision_id, v_req.catalog_snapshot_id, p_output)
  returning id into v_analysis;

  insert into public.path_recommendations (job_id, analysis_id, creative_path_id, rank, reasoning)
  select v_req.job_id, v_analysis, p.id, e.ordinality::integer, btrim(e.value ->> 'reasoning')
  from jsonb_array_elements(p_recommendations) with ordinality e
  join public.creative_paths p
    on p.snapshot_id = v_req.catalog_snapshot_id and p.path_number = (e.value ->> 'path_number')::integer;

  update public.generation_requests
  set status = 'succeeded', served_model = btrim(p_served_model), completed_at = now()
  where id = v_req.id;
  return v_analysis;
end;
$$;

-- p_concepts: array of 1-10 {title, line, body}.
create function public.complete_concepts(p_user_id uuid, p_request_id uuid, p_served_model text, p_concepts jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.generation_requests;
  v_path uuid;
  v_count integer;
begin
  v_req := private.pending_request(p_user_id, p_request_id, 'concepts');
  if p_served_model is null or char_length(btrim(p_served_model)) = 0 then
    raise exception 'TRILHA_INVALID_REQUEST' using errcode = '22023';
  end if;

  if jsonb_typeof(p_concepts) is distinct from 'array' then
    raise exception 'TRILHA_INVALID_AI_OUTPUT' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_concepts);
  if v_count not between 1 and 10 or exists (
    select 1 from jsonb_array_elements(p_concepts) e
    where char_length(btrim(coalesce(e ->> 'title', ''))) not between 1 and 200
       or char_length(btrim(coalesce(e ->> 'line', ''))) not between 1 and 400
       or char_length(btrim(coalesce(e ->> 'body', ''))) not between 1 and 6000
  ) then
    raise exception 'TRILHA_INVALID_AI_OUTPUT' using errcode = '22023';
  end if;

  select s.creative_path_id into v_path from public.path_selections s where s.id = v_req.selection_id;

  insert into public.concepts
    (job_id, generation_request_id, selection_id, creative_path_id, briefing_revision_id, seq,
     ai_title, ai_line, ai_body, title, line, body)
  select v_req.job_id, v_req.id, v_req.selection_id, v_path, v_req.briefing_revision_id, e.ordinality::integer,
         btrim(e.value ->> 'title'), btrim(e.value ->> 'line'), btrim(e.value ->> 'body'),
         btrim(e.value ->> 'title'), btrim(e.value ->> 'line'), btrim(e.value ->> 'body')
  from jsonb_array_elements(p_concepts) with ordinality e;

  update public.generation_requests
  set status = 'succeeded', served_model = btrim(p_served_model), completed_at = now()
  where id = v_req.id;
  return v_count;
end;
$$;

create function public.complete_presentation(p_user_id uuid, p_request_id uuid, p_served_model text, p_content jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.generation_requests;
  v_ids uuid[];
  v_id uuid;
begin
  v_req := private.pending_request(p_user_id, p_request_id, 'presentation');
  if p_served_model is null or char_length(btrim(p_served_model)) = 0 then
    raise exception 'TRILHA_INVALID_REQUEST' using errcode = '22023';
  end if;

  if jsonb_typeof(p_content) is distinct from 'object' or octet_length(p_content::text) > 60000 then
    raise exception 'TRILHA_INVALID_AI_OUTPUT' using errcode = '22023';
  end if;

  -- The finalists recorded in the payload when the request was created.
  select array_agg(x::uuid order by x) into v_ids
  from jsonb_array_elements_text(v_req.payload -> 'finalist_ids') x;

  insert into public.presentations (job_id, generation_request_id, concept_ids, ai_content, content)
  values (v_req.job_id, v_req.id, v_ids, p_content, p_content)
  returning id into v_id;

  update public.generation_requests
  set status = 'succeeded', served_model = btrim(p_served_model), completed_at = now()
  where id = v_req.id;
  return v_id;
end;
$$;

create function public.fail_generation(p_user_id uuid, p_request_id uuid, p_error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.generation_requests;
begin
  select r.* into v_req
  from public.generation_requests r join public.jobs j on j.id = r.job_id
  where r.id = p_request_id and j.owner_id = p_user_id
  for update of r;
  if p_user_id is null or v_req.id is null then
    raise exception 'TRILHA_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_req.status <> 'pending' then
    return;
  end if;
  if p_error_code is null or p_error_code !~ '^[A-Z0-9_]{1,64}$' then
    raise exception 'TRILHA_INVALID_REQUEST' using errcode = '22023';
  end if;
  update public.generation_requests
  set status = 'failed', error_code = p_error_code, completed_at = now()
  where id = v_req.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.import_catalog_snapshot(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.draw_random_path(uuid) from public, anon, authenticated, service_role;
revoke all on function public.select_path(uuid, public.path_selection_origin, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.update_concept(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.set_concept_finalist(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.update_presentation(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.begin_generation(uuid, uuid, public.generation_kind, text, text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_analysis(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.complete_concepts(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.complete_presentation(uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.fail_generation(uuid, uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.draw_random_path(uuid) to authenticated;
grant execute on function public.select_path(uuid, public.path_selection_origin, uuid, uuid, uuid) to authenticated;
grant execute on function public.update_concept(uuid, text, text, text) to authenticated;
grant execute on function public.set_concept_finalist(uuid, boolean) to authenticated;
grant execute on function public.update_presentation(uuid, jsonb) to authenticated;

grant execute on function public.import_catalog_snapshot(text, jsonb) to service_role;
grant execute on function public.begin_generation(uuid, uuid, public.generation_kind, text, text, uuid, uuid) to service_role;
grant execute on function public.complete_analysis(uuid, uuid, text, jsonb, jsonb) to service_role;
grant execute on function public.complete_concepts(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.complete_presentation(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.fail_generation(uuid, uuid, text) to service_role;

grant usage on type public.path_selection_origin to authenticated, service_role;
grant usage on type public.generation_kind to service_role;
