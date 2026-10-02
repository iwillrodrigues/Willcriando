#!/usr/bin/env bash
# Steps of the s3-migration workflow. Each subcommand fails closed: any
# mismatch prints an ::error annotation and exits non-zero.
#
#   run.sh source      exact source commit, clean checkout, migration path and SHA256
#   run.sh target      SUPABASE_DB_URL is the approved session pooler of anhaonrifwakoekksopv (check_db_url.py)
#   run.sh telemetry   CLI telemetry disabled and verified
#   run.sh preflight   read-only: history, schema state, catalog, CLI list and dry run, record snapshot
#   run.sh apply       supabase db push, exactly once, no retry
#   run.sh classify    read-only: applied, not applied or uncertain; waits, bounded, for
#                      any session that may still be running the push
#   run.sh validate    read-only: S3 schema checks and record preservation
#   run.sh tests       S1, S2 and S3 pgTAP files, each one transaction that rolls back
#
# SUPABASE_DB_URL is read from the environment only and never printed. Work
# files go to $RUNNER_TEMP/s3-migration; result lines for the job summary go
# to report.md there.
#
# Timing defaults are the workflow's values. PUSH_TIMEOUT_SECONDS,
# CLASSIFY_BUDGET_SECONDS, CLASSIFY_INTERVAL_SECONDS and
# CLASSIFY_STABLE_OBSERVATIONS may only tighten them within fixed bounds; they
# exist for local rehearsal and are not set by the workflow.
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

step="${1:?subcommand}"
# The job log: annotations go here even from redirected calls and subshells.
exec 3>&1

fail() {
  echo "::error title=S3 migration ($step)::$1" >&3
  echo "- **$step: FAILED.** $1" >>"$report"
  exit 1
}
# Integer setting from the environment, default when unset, within [min, max].
bounded() {
  local value="${!1:-$2}"
  [[ "$value" =~ ^[0-9]+$ ]] && [ "$value" -ge "$3" ] && [ "$value" -le "$4" ] ||
    fail "$1 must be an integer between $3 and $4."
  echo "$value"
}
# libpq and pgx read these as defaults or overrides; none may be set.
pg_env_guard() {
  local name
  for name in PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE PGSERVICE PGSERVICEFILE \
    PGOPTIONS PGSYSCONFDIR PGTARGETSESSIONATTRS PGREQUIREAUTH PGSSLNEGOTIATION PGLOADBALANCEHOSTS PGAPPNAME; do
    [ -z "${!name:-}" ] || fail "environment variable $name is set; it could redirect the connection."
  done
  [ "${PGSSLMODE:-require}" = "require" ] || fail "PGSSLMODE must be require."
}
telemetry_guard() {
  [ "${SUPABASE_TELEMETRY_DISABLED:-}" = "1" ] && [ "${DO_NOT_TRACK:-}" = "1" ] && [ -z "${SUPABASE_HOME:-}" ] ||
    fail "SUPABASE_TELEMETRY_DISABLED=1 and DO_NOT_TRACK=1 must be set and SUPABASE_HOME unset."
  jq -e '.enabled == false' "$HOME/.supabase/telemetry.json" >/dev/null 2>&1 ||
    fail "CLI telemetry is not recorded as disabled in $HOME/.supabase/telemetry.json."
}
note() {
  echo "$1"
  echo "- $1" >>"$report"
}
# Read-only SQL files open "begin transaction read only" and end with rollback.
psql_file() {
  pg_env_guard
  PGCONNECT_TIMEOUT=15 timeout --kill-after=10 "${2:-120}" psql "${SUPABASE_DB_URL:?}" -X -q -At -v ON_ERROR_STOP=1 -f "$1"
}
history() { psql_file "$here/history.sql"; }
s3_state() { psql_file "$here/state.sql"; }
sessions() { psql_file "$here/sessions.sql" 60; }
snapshot() { psql_file "$here/snapshot.sql" >"$work/snapshot-$1.txt"; }
supabase_cli() {
  pg_env_guard
  telemetry_guard
  timeout --kill-after=15 "$1" supabase "${@:2}" --db-url "${SUPABASE_DB_URL:?}" --output-format json --agent no
}

# Database steps refuse redirecting PG* variables up front, in this shell, so
# a refusal stops the step at once instead of surfacing as failed reads.
case "$step" in
preflight | apply | classify | validate | tests) pg_env_guard ;;
esac

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
  # Masks password candidates first, then accepts exactly one raw form and
  # requires urllib and libpq to read it identically. Prints only a reason code.
  python3 "$here/check_db_url.py" ||
    fail "SUPABASE_DB_URL is not exactly the approved session-pooler connection string for $PROJECT_REF (see the reason code above)."
  note "Target: SUPABASE_DB_URL is the approved session pooler for \`$PROJECT_REF\` (port 5432, database postgres, sslmode=require); urllib and libpq agree (value not printed)."
  ;;

telemetry)
  [ "${SUPABASE_TELEMETRY_DISABLED:-}" = "1" ] && [ "${DO_NOT_TRACK:-}" = "1" ] && [ -z "${SUPABASE_HOME:-}" ] ||
    fail "SUPABASE_TELEMETRY_DISABLED=1 and DO_NOT_TRACK=1 must be set and SUPABASE_HOME unset."
  [ "$(supabase --version)" = "${SUPABASE_CLI_VERSION:?}" ] || fail "Supabase CLI is not version $SUPABASE_CLI_VERSION."
  out=$(timeout --kill-after=5 30 supabase telemetry disable) || fail "supabase telemetry disable failed."
  [ "$out" = "Telemetry is disabled." ] || fail "supabase telemetry disable did not confirm."
  out=$(timeout --kill-after=5 30 supabase telemetry status) || fail "supabase telemetry status failed."
  [ "$out" = "Telemetry is disabled." ] || fail "supabase telemetry status does not report disabled."
  telemetry_guard
  note "Telemetry: disabled by environment (SUPABASE_TELEMETRY_DISABLED, DO_NOT_TRACK) and in CLI settings; status verified."
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

  probe=$(sessions) || fail "could not read session visibility."
  if [ "$(cut -d'|' -f1,2,4 <<<"$probe")" = "t|t|0" ]; then
    note "Session visibility: full. A failed push can be classified as not applied once stable."
  else
    note "Session visibility: limited ($probe). A failed or interrupted push will be reported UNCERTAIN, never NOT APPLIED."
  fi

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
  # One attempt. A failure, timeout or kill is never retried; classify decides what happened.
  push_timeout=$(bounded PUSH_TIMEOUT_SECONDS 600 10 600)
  echo "attempted=true" >>"$GITHUB_OUTPUT"
  rc=0
  supabase_cli "$push_timeout" db push --yes >"$work/push.json" 2>"$work/push.err" || rc=$?
  echo "exit_code=$rc" >>"$GITHUB_OUTPUT"
  cat "$work/push.err"
  note "supabase db push ran once and exited with status $rc."
  [ "$rc" -eq 0 ] || exit "$rc"
  ;;

classify)
  # Read-only, bounded, never retries, never terminates sessions, never repairs.
  #   APPLIED      push exit 0, history = prior four + S3 exactly once, all S3 objects.
  #   NOT APPLIED  only when every observation in a stable window shows the prior
  #                history, no S3 object and no session that could still be running
  #                the push, with full session visibility.
  #   UNCERTAIN    everything else, including an applied state after a non-zero or
  #                unknown exit, a partial state, insufficient visibility, read
  #                errors, or relevant sessions still present at the deadline.
  budget=$(bounded CLASSIFY_BUDGET_SECONDS 240 10 240)
  interval=$(bounded CLASSIFY_INTERVAL_SECONDS 10 1 10)
  needed=$(bounded CLASSIFY_STABLE_OBSERVATIONS 3 3 10)
  exit_code="${PUSH_EXIT_CODE:-}"
  [[ "$exit_code" =~ ^[0-9]+$ ]] || exit_code="unknown"
  expected_after=$(printf '%s\n%s' "$PRIOR_HISTORY" "$S3_VERSION|$S3_NAME")
  uncertain() {
    fail "Result: UNCERTAIN (push exit $exit_code). $1 Not retried, no session terminated, nothing repaired; inspect before any further action."
  }

  observe() {
    after=$(history) || { after="unreadable"; return 1; }
    state=$(s3_state) || { state="unreadable"; return 1; }
    probe=$(sessions) || { probe="unreadable"; return 1; }
  }

  if [ "$exit_code" = "0" ]; then
    observe || uncertain "Push exited 0 but history, schema or sessions could not be read."
    printf '%s\n' "$after" >"$work/history-after.txt"
    note "Hosted history after: $(printf '%s' "$after" | paste -sd ' ' - | sed 's/|/ /g'). S3 objects present: $state of $S3_OBJECTS."
    [ "$after" = "$expected_after" ] && [ "$state" = "$S3_OBJECTS" ] ||
      uncertain "Push exited 0 but history or schema does not show S3 applied exactly once."
    note "Result: APPLIED. \`$S3_VERSION $S3_NAME\` recorded exactly once; all $S3_OBJECTS S3 objects exist."
    exit 0
  fi

  after="unread"
  state="unread"
  probe="unread"
  deadline=$((SECONDS + budget))
  clean=0
  clean_since=0
  observations=0
  while :; do
    observations=$((observations + 1))
    if ! observe; then
      clean=0
      echo "Observation $observations: a read-only query failed."
    else
      echo "Observation $observations: S3 history rows $(printf '%s\n' "$after" | grep -c "^$S3_VERSION|" || true), S3 objects $state of $S3_OBJECTS, sessions visible|own|relevant|hidden = $probe."
      if [ "$after" = "$expected_after" ] && [ "$state" = "$S3_OBJECTS" ]; then
        printf '%s\n' "$after" >"$work/history-after.txt"
        uncertain "History and schema show S3 applied, but the push did not report success."
      elif [ "$after" != "$PRIOR_HISTORY" ] || [ "$state" != "0" ]; then
        printf '%s\n' "$after" >"$work/history-after.txt"
        uncertain "Partial or unexpected state: history $(printf '%s' "$after" | cut -d'|' -f1 | paste -sd ' ' -), S3 objects $state of $S3_OBJECTS."
      elif ! IFS='|' read -r visible own relevant hidden <<<"$probe" || [ "$visible" != "t" ] || [ "$own" != "t" ] ||
        ! [[ "$relevant" =~ ^[0-9]+$ ]] || [ "$hidden" != "0" ]; then
        uncertain "Session visibility is insufficient to rule out a running push (visible|own|relevant|hidden = $probe)."
      elif [ "$relevant" != "0" ]; then
        clean=0
      else
        [ "$clean" -eq 0 ] && clean_since=$SECONDS
        clean=$((clean + 1))
        if [ "$clean" -ge "$needed" ] && [ $((SECONDS - clean_since)) -ge $((interval * (needed - 1))) ]; then
          printf '%s\n' "$after" >"$work/history-after.txt"
          note "Hosted history after: $(printf '%s' "$after" | paste -sd ' ' - | sed 's/|/ /g'). S3 objects present: 0 of $S3_OBJECTS."
          fail "Result: NOT APPLIED (push exit $exit_code). History and schema unchanged and no session could still be running the push, across $clean observations over $((SECONDS - clean_since)) s. Not retried."
        fi
      fi
    fi
    [ $((SECONDS + interval)) -le "$deadline" ] ||
      uncertain "Could not establish a stable state within ${budget} s (last: history rows $(printf '%s\n' "$after" | grep -c "^$S3_VERSION|" || true) for S3, objects $state, sessions $probe)."
    sleep "$interval"
  done
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
