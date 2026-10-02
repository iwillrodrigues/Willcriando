-- Read-only. Whether any other session could still be running or waiting on
-- the migration, as "visible|own_query_seen|relevant|hidden":
--   visible         this role may read every session's query and wait state
--                   (superuser or member of pg_read_all_stats)
--   own_query_seen  this query's own text (it contains the probe marker) is
--                   visible in pg_stat_activity, a sanity check
--   relevant        other sessions that may belong to the push: any non-idle
--                   session of this login role, any session whose query names
--                   an S3 or history object, any session waiting on a lock, and
--                   any session holding a strong lock in public, private or
--                   supabase_migrations
--   hidden          sessions whose query text this role cannot read
-- The caller treats anything but "true|true|0|0" as "cannot rule it out".
begin transaction read only;
set local statement_timeout = '30s';

with me as (
  select pg_backend_pid() as pid, current_user as usr
),
others as (
  select a.*
  from pg_stat_activity a, me
  where a.pid <> me.pid and a.backend_type = 'client backend'
),
strong_lockers as (
  select distinct l.pid
  from pg_locks l
  join pg_class c on c.oid = l.relation
  join pg_namespace n on n.oid = c.relnamespace, me
  where l.pid <> me.pid
    and n.nspname in ('public', 'private', 'supabase_migrations')
    and (not l.granted or l.mode in ('ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'))
)
select concat_ws('|',
  coalesce((select rolsuper from pg_roles where rolname = current_user), false)
    or pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER'),
  exists (select 1 from pg_stat_activity a, me where a.pid = me.pid and a.query like '%s3-migration sessions probe%'),
  (select count(*) from others o, me
    where (o.usename = me.usr and o.state is distinct from 'idle')
       or (o.state is distinct from 'idle' and o.query ~* '(schema_migrations|presentation_versions|dismissed_at|job_deletions|set_concept_dismissed|save_presentation_version|delete_job|forbid_mutation_outside_job_deletion|presentation_full_text|presentations_id_job_key|concepts_finalist_not_dismissed|s3: reversible concept dismissal)')
       or o.wait_event_type = 'Lock'
       or o.pid in (select pid from strong_lockers)),
  -- Not limited to client backends: an unreadable row also hides its backend_type.
  (select count(*) from pg_stat_activity a, me where a.pid <> me.pid and a.query = '<insufficient privilege>')
);

rollback;
