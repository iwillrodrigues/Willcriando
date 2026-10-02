-- Read-only. Hosted migration history as "version|name", oldest first.
begin transaction read only;
set local statement_timeout = '30s';

select version || '|' || coalesce(name, '')
from supabase_migrations.schema_migrations
order by version;

rollback;
