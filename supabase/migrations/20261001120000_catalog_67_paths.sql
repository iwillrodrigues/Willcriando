-- Official catalog size: 67 creative paths numbered 1-67 (was 63).
--
-- Forward-only. Changes only the catalog-size contract of S2:
--   catalog_snapshots_count       path_count = 63         -> 67
--   creative_paths_number_range   path_number 1..63       -> 1..67
--   import_catalog_snapshot       63 in validation/insert -> 67
-- Everything else in the function is unchanged: security definer, empty
-- search_path, validation, idempotency by content hash, single current
-- snapshot. Grants are restated exactly as in S2.
--
-- The count check fails, and this migration aborts, if a 63-path snapshot
-- already exists: a stored snapshot is never rewritten.

alter table public.catalog_snapshots
  drop constraint catalog_snapshots_count,
  add constraint catalog_snapshots_count check (path_count = 67);

alter table public.creative_paths
  drop constraint creative_paths_number_range,
  add constraint creative_paths_number_range check (path_number between 1 and 67);

comment on table public.catalog_snapshots is
  'One validated import of the 67-path editorial catalog. Exactly one snapshot is current.';

-- p_paths: array of 67 objects with source_page_id, path_number, title,
-- section, content, prompt_text, source_last_edited_at. Validated again here;
-- an identical catalog returns the existing snapshot (idempotent).

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
     or (select count(distinct e ->> 'path_number') from jsonb_array_elements(p_paths) e) <> 67
     or exists (
       select 1 from jsonb_array_elements(p_paths) e
       where coalesce(btrim(e ->> 'source_page_id'), '') = ''
          or coalesce(btrim(e ->> 'title'), '') = ''
          or (e ->> 'path_number') !~ '^[0-9]+$'
          or (e ->> 'path_number')::integer not between 1 and 67
     ) then
    raise exception 'TRILHA_INVALID_CATALOG' using errcode = '22023',
      detail = 'Expected 67 paths with unique source ids, unique numbers 1-67 and a title.';
  end if;

  -- jsonb normalizes key order, so this hash is canonical for the content.
  select encode(sha256(convert_to(jsonb_agg(e order by (e ->> 'path_number')::integer)::text, 'UTF8')), 'hex')
  into v_hash
  from jsonb_array_elements(p_paths) e;

  select s.id into v_snapshot from public.catalog_snapshots s where s.content_hash = v_hash;

  if v_snapshot is null then
    insert into public.catalog_snapshots (source, source_database_id, content_hash, path_count)
    values ('notion', p_source_database_id, v_hash, 67)
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

revoke all on function public.import_catalog_snapshot(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.import_catalog_snapshot(text, jsonb) to service_role;
