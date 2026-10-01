-- Catalog of 67 editorial nodes: 65 selectable creative paths and 2 group
-- headers, identified by their visible editorial code ("9", "9.3").
--
-- Forward-only. Supersedes nothing applied; replaces S2's integer-numbered
-- catalog contract:
--   creative_paths.editorial_code  the code exactly as in the source (text)
--   creative_paths.selectable      false for a group header: a code that has
--                                  children ("9" when "9.1" exists)
--   creative_paths.path_number     kept as the internal order 1-67, derived
--                                  from the codes; never shown as a code
--   catalog_snapshots.path_count   67 nodes
-- import_catalog_snapshot derives order and selectability itself and requires
-- exactly 67 nodes, 65 of them selectable with text. A code's parent does not
-- have to exist ("1.2" without "1" or "1.1").
-- draw_random_path, select_path, begin_generation and complete_analysis are
-- replaced from their S2 definitions with one change each: group headers are
-- excluded, and recommendations reference editorial codes. Security definer,
-- empty search_path, ownership checks, idempotency and grants are unchanged;
-- grants are restated exactly as in S2.
--
-- Adding the NOT NULL columns, or the 67 check, fails and aborts this
-- migration if a catalog snapshot already exists: stored snapshots are never
-- rewritten.

alter table public.catalog_snapshots
  drop constraint catalog_snapshots_count,
  add constraint catalog_snapshots_count check (path_count = 67);

comment on table public.catalog_snapshots is
  'One validated import of the editorial catalog: 67 nodes, 65 selectable. Exactly one snapshot is current.';

alter table public.creative_paths
  add column editorial_code text not null,
  add column selectable boolean not null,
  drop constraint creative_paths_number_range,
  add constraint creative_paths_number_range check (path_number between 1 and 67),
  add constraint creative_paths_code_format check (editorial_code ~ '^[1-9][0-9]*(\.[1-9][0-9]*)?$'),
  add constraint creative_paths_selectable_text check (
    not selectable or char_length(btrim(content)) > 0 or char_length(btrim(coalesce(prompt_text, ''))) > 0
  ),
  add constraint creative_paths_snapshot_code_key unique (snapshot_id, editorial_code);

comment on column public.creative_paths.editorial_code is 'Visible code from the source catalog, verbatim ("9.3").';
comment on column public.creative_paths.selectable is 'False for a group header, which is shown but never applied.';
comment on column public.creative_paths.path_number is 'Internal order 1-67 derived from editorial_code. Not a visible code.';

grant select (editorial_code, selectable) on public.creative_paths to authenticated;

-- Nodes of a validated payload with their derived order and selectability.
-- Order: by the integer parts of the code, a parent before its children.
-- A node is a group header when another node's code starts with its code and
-- a dot ("9" when "9.1" exists). Codes have at most one dot.
create function private.catalog_nodes(p_paths jsonb)
returns table (node jsonb, code text, ordinal integer, selectable boolean)
language sql
immutable
set search_path = ''
as $$
  with n as (
    select e as node,
           e ->> 'editorial_code' as code,
           split_part(e ->> 'editorial_code', '.', 1)::integer as major,
           nullif(split_part(e ->> 'editorial_code', '.', 2), '')::integer as minor
    from jsonb_array_elements(p_paths) e
  )
  select n.node,
         n.code,
         (row_number() over (order by n.major, n.minor nulls first))::integer,
         not (n.minor is null and exists (select 1 from n c where c.major = n.major and c.minor is not null))
  from n;
$$;

revoke all on function private.catalog_nodes(jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catalog import (service_role)
-- ---------------------------------------------------------------------------
-- p_paths: array of 67 objects with source_page_id, editorial_code, title,
-- section, content, prompt_text, source_last_edited_at. Order (path_number)
-- and selectable are derived here. An identical catalog returns the existing
-- snapshot (idempotent).

create or replace function public.import_catalog_snapshot(p_source_database_id text, p_paths jsonb)
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

  if v_count <> 67
     or (select count(distinct e ->> 'source_page_id') from jsonb_array_elements(p_paths) e) <> 67
     or (select count(distinct e ->> 'editorial_code') from jsonb_array_elements(p_paths) e) <> 67
     or exists (
       select 1 from jsonb_array_elements(p_paths) e
       where coalesce(btrim(e ->> 'source_page_id'), '') = ''
          or coalesce(btrim(e ->> 'title'), '') = ''
          or coalesce(e ->> 'editorial_code', '') !~ '^[1-9][0-9]*(\.[1-9][0-9]*)?$'
     ) then
    raise exception 'TRILHA_INVALID_CATALOG' using errcode = '22023',
      detail = 'Expected 67 nodes with unique source ids, unique editorial codes and a title.';
  end if;

  if (select count(*) from private.catalog_nodes(p_paths) where selectable) <> 65
     or exists (
       select 1 from private.catalog_nodes(p_paths)
       where selectable
         and char_length(btrim(coalesce(node ->> 'content', ''))) = 0
         and char_length(btrim(coalesce(node ->> 'prompt_text', ''))) = 0
     ) then
    raise exception 'TRILHA_INVALID_CATALOG' using errcode = '22023',
      detail = 'Expected 65 selectable paths, each with content or prompt text.';
  end if;

  -- jsonb normalizes key order, so this hash is canonical for the content.
  select encode(sha256(convert_to(jsonb_agg(node order by ordinal)::text, 'UTF8')), 'hex')
  into v_hash
  from private.catalog_nodes(p_paths);

  select s.id into v_snapshot from public.catalog_snapshots s where s.content_hash = v_hash;

  if v_snapshot is null then
    insert into public.catalog_snapshots (source, source_database_id, content_hash, path_count)
    values ('notion', p_source_database_id, v_hash, 67)
    returning id into v_snapshot;

    insert into public.creative_paths
      (snapshot_id, source_page_id, source_last_edited_at, path_number, editorial_code, selectable,
       title, section, content, prompt_text, content_hash)
    select v_snapshot,
           node ->> 'source_page_id',
           nullif(node ->> 'source_last_edited_at', '')::timestamptz,
           ordinal,
           code,
           selectable,
           node ->> 'title',
           nullif(node ->> 'section', ''),
           coalesce(node ->> 'content', ''),
           nullif(node ->> 'prompt_text', ''),
           encode(sha256(convert_to(node::text, 'UTF8')), 'hex')
    from private.catalog_nodes(p_paths);
  end if;

  update public.catalog_snapshots set is_current = false where is_current and id <> v_snapshot;
  update public.catalog_snapshots set is_current = true where id = v_snapshot and not is_current;

  return v_snapshot;
end;
$$;

-- ---------------------------------------------------------------------------
-- Selectable paths only
-- ---------------------------------------------------------------------------

create or replace function public.draw_random_path(p_job_id uuid)
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
  where p.snapshot_id = v_snapshot and p.selectable
  order by random()
  limit 1
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.select_path(
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

  -- Group headers organise the catalog; they are never applied.
  if not exists (select 1 from public.creative_paths p where p.id = p_creative_path_id and p.selectable) then
    raise exception 'TRILHA_PATH_NOT_SELECTABLE' using errcode = '22023';
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

create or replace function public.begin_generation(
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
    if not exists (
      select 1 from public.path_selections s join public.creative_paths p on p.id = s.creative_path_id
      where s.id = p_selection_id and p.selectable
    ) then
      raise exception 'TRILHA_PATH_NOT_SELECTABLE' using errcode = '22023';
    end if;
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

create or replace function public.complete_analysis(
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
   and p.selectable
   and p.editorial_code = (e ->> 'path_code')
  where char_length(btrim(coalesce(e ->> 'reasoning', ''))) between 1 and 2000;

  if v_count not between 1 and 5 or v_matched <> v_count then
    raise exception 'TRILHA_INVALID_AI_OUTPUT' using errcode = '22023',
      detail = 'Recommendations must reference 1 to 5 distinct selectable paths of the catalog snapshot.';
  end if;

  insert into public.briefing_analyses (job_id, generation_request_id, briefing_revision_id, catalog_snapshot_id, output)
  values (v_req.job_id, v_req.id, v_req.briefing_revision_id, v_req.catalog_snapshot_id, p_output)
  returning id into v_analysis;

  insert into public.path_recommendations (job_id, analysis_id, creative_path_id, rank, reasoning)
  select v_req.job_id, v_analysis, p.id, e.ordinality::integer, btrim(e.value ->> 'reasoning')
  from jsonb_array_elements(p_recommendations) with ordinality e
  join public.creative_paths p
    on p.snapshot_id = v_req.catalog_snapshot_id and p.selectable and p.editorial_code = (e.value ->> 'path_code');

  update public.generation_requests
  set status = 'succeeded', served_model = btrim(p_served_model), completed_at = now()
  where id = v_req.id;
  return v_analysis;
end;
$$;

revoke all on function public.import_catalog_snapshot(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.draw_random_path(uuid) from public, anon, authenticated, service_role;
revoke all on function public.select_path(uuid, public.path_selection_origin, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.begin_generation(uuid, uuid, public.generation_kind, text, text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_analysis(uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated, service_role;

grant execute on function public.draw_random_path(uuid) to authenticated;
grant execute on function public.select_path(uuid, public.path_selection_origin, uuid, uuid, uuid) to authenticated;
grant execute on function public.import_catalog_snapshot(text, jsonb) to service_role;
grant execute on function public.begin_generation(uuid, uuid, public.generation_kind, text, text, uuid, uuid) to service_role;
grant execute on function public.complete_analysis(uuid, uuid, text, jsonb, jsonb) to service_role;
