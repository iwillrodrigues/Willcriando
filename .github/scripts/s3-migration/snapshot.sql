-- Read-only. Row count and content fingerprint of every table the S3 migration
-- must preserve, as "table|rows|md5". Fingerprints hash the rows in id order
-- and are compared before and after; no row content is printed.
-- concepts excludes dismissed_at, the column S3 adds (null on every existing row).
begin transaction read only;
set local statement_timeout = '60s';

select name || '|' || n || '|' || fp from (
  select 'jobs' as name, count(*) as n, md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) as fp from public.jobs x
  union all select 'briefing_revisions', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.briefing_revisions x
  union all select 'briefing_analyses', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.briefing_analyses x
  union all select 'generation_requests', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.generation_requests x
  union all select 'path_recommendations', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.path_recommendations x
  union all select 'path_draws', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.path_draws x
  union all select 'path_selections', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.path_selections x
  union all select 'concepts', count(*), md5(coalesce(string_agg((to_jsonb(x) - 'dismissed_at')::text, '|' order by x.id), '')) from public.concepts x
  union all select 'concepts_finalists', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id), '')) from public.concepts x where x.is_finalist
  union all select 'presentations', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.presentations x
  union all select 'catalog_snapshots', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.catalog_snapshots x
  union all select 'creative_paths', count(*), md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.creative_paths x
  union all select 'auth_users', count(*), md5(coalesce(string_agg(x.id::text, '|' order by x.id), '')) from auth.users x
) t;

rollback;
