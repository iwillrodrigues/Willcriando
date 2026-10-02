#!/usr/bin/env bash
# Steps of the s3-migration workflow. Each subcommand fails closed: any
# mismatch prints an ::error annotation and exits non-zero.
#
#   run.sh source      exact source commit, clean checkout, migration path and SHA256
#   run.sh target      SUPABASE_DB_URL points at project anhaonrifwakoekksopv (prints nothing from it)
#   run.sh preflight   read-only: history, schema state, catalog, CLI list and dry run, record snapshot
#   run.sh apply       supabase db push, exactly once, no retry
#   run.sh classify    read-only: applied, not applied or uncertain
#   run.sh validate    read-only: S3 schema checks and record preservation
#   run.sh tests       S1, S2 and S3 pgTAP files, each one transaction that rolls back
#
# SUPABASE_DB_URL is read from the environment only and never printed. Work
# files go to $RUNNER_TEMP/s3-migration; result lines for the job summary go
# to report.md there.
set -euo pipefail

SOURCE_COMMIT=476377b3ed19c168ea95326ac2e1c64d79df094c
MIGRATION=supabase/migrations/20261002120000_s3_dismissal_versions_deletion.sql
MIGRATION_SHA256=135152c4d48849b61a134c379cd8b785fd05281951180c314a5a00c7e84b40e5
S3_VERSION=20261002120000
S3_NAME=s3_dismissal_versions_deletion
PROJECT_REF=anhaonrifwakoekksopv
EXPECTED_CREATIVE_PATHS=67
# Objects counted by state.sql.
S3_OBJECTS=10
PRIOR_HISTORY='20260930180114|enable_pgtap
20260930190456|s1_jobs_and_briefing_revisions
20260930224938|s2_catalog_and_creative_flow
20261001181854|catalog_editorial_nodes'
MIGRATION_FILES='20260930180114_enable_pgtap.sql
20260930190456_s1_jobs_and_briefing_revisions.sql
20260930224938_s2_catalog_and_creative_flow.sql
20261001181854_catalog_editorial_nodes.sql
20261002120000_s3_dismissal_versions_deletion.sql'

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="${RUNNER_TEMP:?}/s3-migration"
mkdir -p "$work"
report="$work/report.md"

fail() {
  echo "::error title=S3 migration ($step)::$1"
  echo "- **$step: FAILED.** $1" >>"$report"
  exit 1
}
note() {
  echo "$1"
  echo "- $1" >>"$report"
}
# Read-only SQL files open "begin transaction read only" and end with rollback.
psql_file() {
  PGCONNECT_TIMEOUT=15 timeout "${2:-120}" psql "${SUPABASE_DB_URL:?}" -X -q -At -v ON_ERROR_STOP=1 -f "$1"
}
history() { psql_file "$here/history.sql"; }
s3_state() { psql_file "$here/state.sql"; }
snapshot() { psql_file "$here/snapshot.sql" >"$work/snapshot-$1.txt"; }
supabase_cli() {
  timeout "$1" supabase "${@:2}" --db-url "${SUPABASE_DB_URL:?}" --output-format json --agent no
}

step="${1:?subcommand}"
case "$step" in
source)
  [ "$(git rev-parse HEAD)" = "${EXPECTED_HEAD:?}" ] || fail "checked out HEAD is not the dispatched commit."
  git cat-file -e "$SOURCE_COMMIT^{commit}" 2>/dev/null || fail "source commit $SOURCE_COMMIT is not in the checkout."
  git merge-base --is-ancestor "$SOURCE_COMMIT" HEAD || fail "HEAD does not descend from $SOURCE_COMMIT."
  [ "$(git rev-parse HEAD:supabase)" = "$(git rev-parse "$SOURCE_COMMIT:supabase")" ] ||
    fail "supabase/ differs from $SOURCE_COMMIT (migrations or tests changed)."
  [ -z "$(git status --porcelain --untracked-files=all)" ] || fail "the checkout is not clean."
  [ "$(ls -1 supabase/migrations)" = "$MIGRATION_FILES" ] || fail "supabase/migrations does not hold exactly the 5 expected files."
  [ -f "$MIGRATION" ] && [ ! -L "$MIGRATION" ] || fail "$MIGRATION is missing or not a regular file."
  actual=$(sha256sum "$MIGRATION" | cut -d' ' -f1)
  [ "$actual" = "$MIGRATION_SHA256" ] || fail "$MIGRATION SHA256 is $actual, expected $MIGRATION_SHA256."
  note "Source: HEAD \`$(git rev-parse HEAD)\` descends from \`$SOURCE_COMMIT\`; \`supabase/\` identical to it; clean checkout; migration SHA256 \`$actual\`."
  ;;

target)
  [ -n "${SUPABASE_DB_URL//[[:space:]]/}" ] || fail "repository secret SUPABASE_DB_URL is not set."
  # Accepts the session pooler (user postgres.<ref>, *.pooler.supabase.com:5432) or
  # the direct host (user postgres, db.<ref>.supabase.co:5432), database postgres.
  # Masks the password and prints only pass/fail.
  PROJECT_REF="$PROJECT_REF" python3 - <<'PY' || fail "SUPABASE_DB_URL is not a session-mode (port 5432) connection string for project $PROJECT_REF."
import os, sys
from urllib.parse import urlsplit, parse_qs, unquote
ref = os.environ["PROJECT_REF"]
raw = os.environ["SUPABASE_DB_URL"].strip()
try:
    u = urlsplit(raw)
except ValueError:
    sys.exit(1)
pw = u.password or ""
for value in {pw, unquote(pw)}:
    if value:
        print(f"::add-mask::{value}")
try:
    port = u.port
except ValueError:
    sys.exit(1)
host = (u.hostname or "").lower()
user = unquote(u.username or "")
query = parse_qs(u.query, keep_blank_values=True)
pooler = host.endswith(".pooler.supabase.com") and user == f"postgres.{ref}"
direct = host == f"db.{ref}.supabase.co" and user == "postgres"
ok = (u.scheme in ("postgresql", "postgres") and (pooler or direct) and port == 5432 and bool(pw)
      and u.path == "/postgres" and not u.fragment
      and set(query) <= {"sslmode"} and query.get("sslmode", ["require"]) in (["require"], ["verify-full"]))
sys.exit(0 if ok else 1)
PY
  note "Target: SUPABASE_DB_URL is a session-mode connection for project \`$PROJECT_REF\` (value not printed)."
  ;;

preflight)
  command -v psql >/dev/null || fail "psql is not installed on the runner."
  [ "$(supabase --version)" = "${SUPABASE_CLI_VERSION:?}" ] || fail "Supabase CLI is not version $SUPABASE_CLI_VERSION."

  before=$(history) || fail "could not read the hosted migration history."
  printf '%s\n' "$before" >"$work/history-before.txt"
  [ "$before" = "$PRIOR_HISTORY" ] ||
    fail "hosted history is not exactly the 4 expected migrations: $(printf '%s' "$before" | cut -d'|' -f1 | paste -sd ' ' -)."
  note "Hosted history before: $(printf '%s' "$before" | paste -sd ' ' - | sed 's/|/ /g')."

  state=$(s3_state) || fail "could not read the schema state."
  [ "$state" = "0" ] || fail "$state of $S3_OBJECTS S3 objects already exist; the database is not in the pre-S3 state."
  note "Schema: none of the $S3_OBJECTS S3 objects exist."

  snapshot before || fail "could not record the pre-migration snapshot."
  paths=$(awk -F'|' '$1 == "creative_paths" {print $2}' "$work/snapshot-before.txt")
  [ "$paths" = "$EXPECTED_CREATIVE_PATHS" ] ||
    fail "expected $EXPECTED_CREATIVE_PATHS creative paths, found ${paths:-none}; this is not the expected development database."
  [ "$(wc -l <"$work/snapshot-before.txt")" -eq 13 ] || fail "the snapshot does not cover the 13 expected tables."
  note "Records before: $(cut -d'|' -f1,2 "$work/snapshot-before.txt" | sed 's/|/=/' | paste -sd ' ' -)."

  supabase_cli 120 migration list >"$work/list.json" 2>"$work/list.err" ||
    fail "supabase migration list failed (exit $?)."
  pending=$(jq -r '[.migrations[] | select(.remote == "") | .local] | join(" ")' "$work/list.json")
  remote=$(jq -r '[.migrations[] | select(.remote != "") | .remote] | join(" ")' "$work/list.json")
  mismatch=$(jq -r '[.migrations[] | select(.remote != "" and .local != .remote)] | length' "$work/list.json")
  [ "$pending" = "$S3_VERSION" ] || fail "CLI pending migrations are '${pending}', expected only $S3_VERSION."
  [ "$remote" = "$(printf '%s' "$PRIOR_HISTORY" | cut -d'|' -f1 | paste -sd ' ' -)" ] && [ "$mismatch" = "0" ] ||
    fail "CLI remote history does not match the 4 local prior migrations."
  note "CLI migration list: 4 applied, pending only \`$S3_VERSION\`."

  supabase_cli 120 db push --dry-run >"$work/dry-run.json" 2>"$work/dry-run.err" ||
    fail "supabase db push --dry-run failed (exit $?)."
  jq -e --arg f "$(basename "$MIGRATION")" \
    '.dryRun == true and .migrations == [$f] and (.seeds // []) == [] and (.roles // []) == []' \
    "$work/dry-run.json" >/dev/null || fail "the dry run would not push exactly $(basename "$MIGRATION")."
  note "Dry run: would push only \`$(basename "$MIGRATION")\`, no seeds, no roles."
  ;;

apply)
  # One attempt. A failure or timeout is never retried; classify decides what happened.
  echo "attempted=true" >>"$GITHUB_OUTPUT"
  rc=0
  supabase_cli 600 db push --yes >"$work/push.json" 2>"$work/push.err" || rc=$?
  echo "exit_code=$rc" >>"$GITHUB_OUTPUT"
  cat "$work/push.err"
  note "supabase db push ran once and exited with status $rc."
  [ "$rc" -eq 0 ] || exit "$rc"
  ;;

classify)
  # Read-only. Never retries and never repairs.
  after=$(history) || fail "could not read the hosted migration history after the push. Result UNCERTAIN; nothing was retried."
  printf '%s\n' "$after" >"$work/history-after.txt"
  state=$(s3_state) || fail "could not read the schema state after the push. Result UNCERTAIN; nothing was retried."
  count=$(printf '%s\n' "$after" | grep -c "^$S3_VERSION|" || true)
  note "Hosted history after: $(printf '%s' "$after" | paste -sd ' ' - | sed 's/|/ /g'). S3 objects present: $state of $S3_OBJECTS."
  expected_after=$(printf '%s\n%s' "$PRIOR_HISTORY" "$S3_VERSION|$S3_NAME")
  if [ "${PUSH_EXIT_CODE:-}" = "0" ] && [ "$after" = "$expected_after" ] && [ "$state" = "$S3_OBJECTS" ]; then
    note "Result: APPLIED. \`$S3_VERSION $S3_NAME\` recorded exactly once; all $S3_OBJECTS S3 objects exist."
  elif [ "$after" = "$PRIOR_HISTORY" ] && [ "$state" = "0" ]; then
    fail "Result: NOT APPLIED (push exit ${PUSH_EXIT_CODE:-unknown}). History and schema are unchanged. Not retried."
  else
    fail "Result: UNCERTAIN (push exit ${PUSH_EXIT_CODE:-unknown}, S3 history rows $count, S3 objects $state of $S3_OBJECTS). Not retried, nothing repaired; inspect before any further action."
  fi
  ;;

validate)
  psql_file "$here/validate.sql" >"$work/validate.txt" || fail "the validation query failed."
  cat "$work/validate.txt"
  passed=$(grep -c '^PASS|' "$work/validate.txt" || true)
  total=$(wc -l <"$work/validate.txt")
  {
    echo "- Schema checks: $passed of $total passed."
    sed 's/^PASS|/  - PASS: /; s/^FAIL|/  - **FAIL**: /' "$work/validate.txt"
  } >>"$report"
  [ "$total" -eq 27 ] || fail "expected 27 schema checks, got $total."
  [ "$passed" -eq "$total" ] || fail "$((total - passed)) schema checks failed."

  snapshot after || fail "could not record the post-migration snapshot."
  diff -u "$work/snapshot-before.txt" "$work/snapshot-after.txt" >"$work/snapshot.diff" ||
    fail "existing records changed: $(grep -E '^[-+][a-z_]+\|' "$work/snapshot.diff" | cut -d'|' -f1,2 | paste -sd ' ' -)."
  note "Records after: identical to before (counts and content fingerprints, 13 tables)."
  ;;

tests)
  for suite in s1_jobs_and_briefing_revisions:41 s2_catalog_and_creative_flow:71 s3_dismissal_versions_deletion:66; do
    name=${suite%%:*}
    plan=${suite##*:}
    out="$work/$name.tap"
    rc=0
    # Each file is one transaction ending in rollback; a failing assertion raises,
    # psql stops and the disconnect rolls the transaction back.
    psql_file "supabase/tests/database/$name.test.sql" 300 >"$out" 2>&1 || rc=$?
    ok=$(grep -cE '^ok [0-9]+ ' "$out" || true)
    not_ok=$(grep -cE '^not ok ' "$out" || true)
    declared=$(sed -n 's/^1\.\.\([0-9][0-9]*\)$/\1/p' "$out" | head -1)
    note "$name: $ok/${declared:-?} passed, $not_ok failed, psql exit $rc."
    if [ "$rc" -ne 0 ] || [ "$declared" != "$plan" ] || [ "$ok" -ne "$plan" ] || [ "$not_ok" -ne 0 ]; then
      grep -E '^(not ok|# |psql:.*ERROR)' "$out" | head -20 || true
      fail "$name expected $plan/$plan."
    fi
  done
  snapshot tests || fail "could not record the post-test snapshot."
  diff -q "$work/snapshot-before.txt" "$work/snapshot-tests.txt" >/dev/null ||
    fail "records differ after the test suites; a test did not roll back."
  note "Records after the suites: identical to before (all fixtures rolled back)."
  ;;

*)
  echo "Unknown subcommand: $step" >&2
  exit 2
  ;;
esac
