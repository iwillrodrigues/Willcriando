#!/usr/bin/env bash
# Steps of the s3-migration workflow. Each subcommand fails closed: any
# mismatch prints an ::error annotation and exits non-zero.
#
#   run.sh source      exact source commit, clean checkout, migration path and SHA256
#   run.sh install-cli pinned Supabase CLI archive: SHA-256, contents and both binaries
#                      verified before anything executes them
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

# Supabase CLI release v2.119.0, linux amd64. The archive digest equals the
# release's checksums.txt entry, and both binaries are byte-identical to npm's
# @supabase/cli-linux-x64@2.119.0. Pinned here, never fetched at run time.
CLI_VERSION=2.119.0
CLI_ARCHIVE_URL=https://github.com/supabase/cli/releases/download/v2.119.0/supabase_2.119.0_linux_amd64.tar.gz
CLI_ARCHIVE_SHA256=bf1c3ae93be98533eb8a3105dbf4564bd0b2d9dc24690d8a920f980ef975c1b4
CLI_BIN_SHA256=2d142ea645f9fe1436b3b728e5873056b5390eeb2fc838024ae3d2905f5afd94
CLI_GO_SHA256=dc350a51d4377d32837e6d76163039c8611fa6552cab568eb42f6f11d5fe2a02

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="${RUNNER_TEMP:?}/s3-migration"
mkdir -p "$work"
report="$work/report.md"
cli_dir="$work/cli"
# Only this verified path is executed; PATH is never searched for the CLI.
SUPABASE_BIN="$cli_dir/supabase"

step="${1:?subcommand}"
# The job log: annotations go here even from redirected calls and subshells.
exec 3>&1

# Workflow command escaping (GitHub runner protocol). Data escapes %, CR and LF;
# a property also escapes : and ,. % goes first, so the runner's un-escaping
# (%0D, %0A, then %25) gives back exactly the original text on one line.
command_data() {
  local v=$1
  v=${v//'%'/'%25'}
  v=${v//$'\r'/'%0D'}
  v=${v//$'\n'/'%0A'}
  printf '%s' "$v"
}
command_property() {
  local v
  v=$(command_data "$1")
  v=${v//':'/'%3A'}
  v=${v//','/'%2C'}
  printf '%s' "$v"
}
# Shows text this script does not control (psql, CLI and server messages, query
# results) in the job log with workflow commands suspended, so no part of it is
# parsed as a command: not ::cmd::, not ##[cmd] anywhere in a line, not a line
# split off at a bare CR. The resume token is random and printed only after the text.
show_untrusted() {
  local text token
  text=$(cat; printf .)
  text=${text%.}
  [ -n "$text" ] || return 0
  token=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
  [[ "$token" =~ ^[0-9a-f]{32}$ ]] || {
    echo "::error title=S3 migration::could not create a stop-commands token." >&3
    exit 1
  }
  {
    printf '::stop-commands::%s\n%s' "$token" "$text"
    [ "${text: -1}" = $'\n' ] || echo
    printf '::%s::\n' "$token"
  } >&3
}

fail() {
  echo "::error title=$(command_property "S3 migration ($step)")::$(command_data "$1")" >&3
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
  printf '%s\n' "$1" | show_untrusted
  echo "- $1" >>"$report"
}
# A system tool by absolute path. One that resolves anywhere but /usr/bin or /bin
# (a PATH entry added by an earlier step, an exported shell function) is refused.
system_tool() {
  local path
  path=$(command -v "$1") || fail "$1 is not available; cannot verify the Supabase CLI."
  [ "$path" = "/usr/bin/$1" ] || [ "$path" = "/bin/$1" ] || fail "$1 resolves to '$path', not /usr/bin or /bin; refusing it."
  printf '%s' "$path"
}
# Pins present and well formed, the workflow asks for the pinned version, and the
# tools that verify and launch the CLI are the system's own.
cli_pins() {
  local pin
  for pin in "$CLI_ARCHIVE_SHA256" "$CLI_BIN_SHA256" "$CLI_GO_SHA256"; do
    [[ "$pin" =~ ^[0-9a-f]{64}$ ]] || fail "a pinned Supabase CLI checksum is missing or malformed."
  done
  [ "${SUPABASE_CLI_VERSION:-}" = "$CLI_VERSION" ] ||
    fail "SUPABASE_CLI_VERSION is '${SUPABASE_CLI_VERSION:-}', but the pinned CLI is $CLI_VERSION."
  SHA256SUM=$(system_tool sha256sum) || exit 1
  TIMEOUT_BIN=$(system_tool timeout) || exit 1
  ENV_BIN=$(system_tool env) || exit 1
}
# Re-verifies both installed binaries before every execution of the CLI.
cli_guard() {
  local file pin actual
  cli_pins
  for file in supabase supabase-go; do
    pin=$CLI_BIN_SHA256
    [ "$file" = "supabase-go" ] && pin=$CLI_GO_SHA256
    [ -f "$cli_dir/$file" ] && [ ! -L "$cli_dir/$file" ] || fail "Supabase CLI $file is missing or not a regular file; run install-cli."
    actual=$("$SHA256SUM" "$cli_dir/$file") || fail "cannot hash Supabase CLI $file."
    actual=${actual%% *}
    [ "$actual" = "$pin" ] || fail "Supabase CLI $file SHA-256 is $actual, expected $pin."
  done
}
# Runs the verified CLI: fresh integrity check of both binaries, a hard time limit
# (SIGKILL to its process group GRACE s after LIMIT), and an environment built from
# nothing. No inherited variable (SUPABASE_GO_BINARY, LD_PRELOAD, BUN_OPTIONS, PG*,
# SUPABASE_*) reaches it, and the shim is told to use the verified sidecar. Its
# stderr is shown with workflow commands suspended. Usage: cli_run LIMIT GRACE ARGS...
cli_run() {
  local limit=$1 grace=$2 rc=0
  shift 2
  cli_guard
  "$TIMEOUT_BIN" --kill-after="$grace" "$limit" "$ENV_BIN" -i HOME="${HOME:?}" PATH=/usr/bin:/bin \
    SUPABASE_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 SUPABASE_GO_BINARY="$cli_dir/supabase-go" \
    "$SUPABASE_BIN" "$@" 2>"$work/cli.err" || rc=$?
  show_untrusted <"$work/cli.err"
  return "$rc"
}
# Read-only SQL files open "begin transaction read only" and end with rollback.
# Killed GRACE 10 s after the limit; psql's stderr is shown with commands suspended.
psql_file() {
  local rc=0
  pg_env_guard
  PGCONNECT_TIMEOUT=15 timeout --kill-after=10 "${2:-120}" psql "${SUPABASE_DB_URL:?}" -X -q -At -v ON_ERROR_STOP=1 -f "$1" \
    2>"$work/psql.err" || rc=$?
  show_untrusted <"$work/psql.err"
  return "$rc"
}
# Optional argument: client timeout in seconds. Each query file also sets its
# own statement_timeout: 30 s for history, state and sessions, 60 s for snapshot
# and validate. With the 15 s connect timeout, 45 s and 75 s cover a slow but
# healthy read.
history() { psql_file "$here/history.sql" "${1:-120}"; }
s3_state() { psql_file "$here/state.sql" "${1:-120}"; }
sessions() { psql_file "$here/sessions.sql" "${1:-60}"; }
snapshot() { psql_file "$here/snapshot.sql" "${2:-120}" >"$work/snapshot-$1.txt"; }
supabase_cli() {
  pg_env_guard
  telemetry_guard
  cli_run "$1" 15 "${@:2}" --db-url "${SUPABASE_DB_URL:?}" --output-format json --agent no
}
# tar, and the gzip it starts, run with a fixed environment: no TAR_OPTIONS, TAPE,
# GZIP, POSIXLY_CORRECT or PATH entry can add options, members or programs.
untar() {
  "$ENV_BIN" -i PATH=/usr/bin:/bin LC_ALL=C "$TAR_BIN" --force-local "$@"
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

install-cli)
  # No secret in this step. Downloads the pinned archive, checks its SHA-256 and
  # contents, extracts the two binaries and checks theirs. Nothing is executed.
  cli_pins
  CURL_BIN=$(system_tool curl) || exit 1
  TAR_BIN=$(system_tool tar) || exit 1
  system_tool gzip >/dev/null || exit 1
  command -v uname >/dev/null || fail "uname is not available; cannot install the Supabase CLI."
  [ "$(uname -s)/$(uname -m)" = "Linux/x86_64" ] || fail "the pinned Supabase CLI is for Linux x86_64 only."
  download="$work/cli-download"
  [ ! -e "$cli_dir" ] && [ ! -e "$download" ] || fail "$cli_dir or $download already exists; refusing to reuse unverified files."
  mkdir -p "$download" "$cli_dir"
  archive="$download/$(basename "$CLI_ARCHIVE_URL")"
  # -q (first) ignores every curl config file (.curlrc via HOME, CURL_HOME or
  # XDG_CONFIG_HOME). Proxy and CA variables still apply, so a runner proxy
  # works; they can change the route, never the bytes accepted below.
  "$ENV_BIN" -u SSLKEYLOGFILE "$CURL_BIN" -q --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --connect-timeout 20 --max-time 180 --output "$archive" "$CLI_ARCHIVE_URL" ||
    fail "downloading the Supabase CLI archive failed."
  actual=$("$SHA256SUM" "$archive") || fail "cannot hash the Supabase CLI archive."
  actual=${actual%% *}
  [ "$actual" = "$CLI_ARCHIVE_SHA256" ] || fail "Supabase CLI archive SHA-256 is $actual, expected $CLI_ARCHIVE_SHA256."
  # The pinned archive lists exactly these two members, in this order, both regular files.
  entries=$(untar -tzf "$archive") || fail "the Supabase CLI archive cannot be listed."
  [ "$entries" = $'supabase\nsupabase-go' ] || fail "the Supabase CLI archive does not hold exactly supabase and supabase-go."
  listing=$(untar -tvzf "$archive") || fail "the Supabase CLI archive cannot be listed."
  while IFS= read -r line; do
    [ "${line:0:1}" = "-" ] || fail "the Supabase CLI archive holds something other than regular files."
  done <<<"$listing"
  untar -xzf "$archive" -C "$cli_dir" --no-same-owner supabase supabase-go || fail "extracting the Supabase CLI archive failed."
  chmod 0555 "$cli_dir/supabase" "$cli_dir/supabase-go"
  cli_guard
  note "Supabase CLI $CLI_VERSION: archive SHA-256 \`$actual\` and both binaries match the pinned values; contents exactly supabase and supabase-go."
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
  # Three CLI calls, each verified first and capped at 30 s plus 5 s to SIGKILL.
  [ "$(cli_run 30 5 --version)" = "$CLI_VERSION" ] || fail "Supabase CLI is not version $CLI_VERSION."
  out=$(cli_run 30 5 telemetry disable) || fail "supabase telemetry disable failed."
  [ "$out" = "Telemetry is disabled." ] || fail "supabase telemetry disable did not confirm."
  out=$(cli_run 30 5 telemetry status) || fail "supabase telemetry status failed."
  [ "$out" = "Telemetry is disabled." ] || fail "supabase telemetry status does not report disabled."
  telemetry_guard
  note "Telemetry: disabled by environment (SUPABASE_TELEMETRY_DISABLED, DO_NOT_TRACK) and in CLI settings; status verified."
  ;;

preflight)
  # Every read is capped and any failure stops here. Worst case, each call running
  # to its cap and SIGKILL: version 30+5, history, state and sessions 45+10 each,
  # snapshot 75+10, migration list and dry run 90+15 each = 495 s, plus three
  # integrity guards and shell work (under 15 s): about 510 s, inside the step's 660 s.
  command -v psql >/dev/null || fail "psql is not installed on the runner."
  telemetry_guard
  [ "$(cli_run 30 5 --version)" = "$CLI_VERSION" ] || fail "Supabase CLI is not version $CLI_VERSION."

  before=$(history 45) || fail "could not read the hosted migration history."
  printf '%s\n' "$before" >"$work/history-before.txt"
  [ "$before" = "$PRIOR_HISTORY" ] ||
    fail "hosted history is not exactly the 4 expected migrations: $(printf '%s' "$before" | cut -d'|' -f1 | paste -sd ' ' -)."
  note "Hosted history before: $(printf '%s' "$before" | paste -sd ' ' - | sed 's/|/ /g')."

  state=$(s3_state 45) || fail "could not read the schema state."
  [ "$state" = "0" ] || fail "$state of $S3_OBJECTS S3 objects already exist; the database is not in the pre-S3 state."
  note "Schema: none of the $S3_OBJECTS S3 objects exist."

  probe=$(sessions 45) || fail "could not read session visibility."
  if [ "$(cut -d'|' -f1,2,4 <<<"$probe")" = "t|t|0" ]; then
    note "Session visibility: full. A failed push can be classified as not applied once stable."
  else
    note "Session visibility: limited ($probe). A failed or interrupted push will be reported UNCERTAIN, never NOT APPLIED."
  fi

  snapshot before 75 || fail "could not record the pre-migration snapshot."
  paths=$(awk -F'|' '$1 == "creative_paths" {print $2}' "$work/snapshot-before.txt")
  [ "$paths" = "$EXPECTED_CREATIVE_PATHS" ] ||
    fail "expected $EXPECTED_CREATIVE_PATHS creative paths, found ${paths:-none}; this is not the expected development database."
  [ "$(wc -l <"$work/snapshot-before.txt")" -eq 13 ] || fail "the snapshot does not cover the 13 expected tables."
  note "Records before: $(cut -d'|' -f1,2 "$work/snapshot-before.txt" | sed 's/|/=/' | paste -sd ' ' -)."

  supabase_cli 90 migration list >"$work/list.json" ||
    fail "supabase migration list failed (exit $?)."
  pending=$(jq -r '[.migrations[] | select(.remote == "") | .local] | join(" ")' "$work/list.json")
  remote=$(jq -r '[.migrations[] | select(.remote != "") | .remote] | join(" ")' "$work/list.json")
  mismatch=$(jq -r '[.migrations[] | select(.remote != "" and .local != .remote)] | length' "$work/list.json")
  [ "$pending" = "$S3_VERSION" ] || fail "CLI pending migrations are '${pending}', expected only $S3_VERSION."
  [ "$remote" = "$(printf '%s' "$PRIOR_HISTORY" | cut -d'|' -f1 | paste -sd ' ' -)" ] && [ "$mismatch" = "0" ] ||
    fail "CLI remote history does not match the 4 local prior migrations."
  note "CLI migration list: 4 applied, pending only \`$S3_VERSION\`."

  supabase_cli 90 db push --dry-run >"$work/dry-run.json" ||
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
  supabase_cli "$push_timeout" db push --yes >"$work/push.json" || rc=$?
  echo "exit_code=$rc" >>"$GITHUB_OUTPUT"
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

  # Each read is capped at 30 s (killed 10 s later at most), so one observation
  # takes at most 120 s and the loop ends within budget + 120 = 360 s, inside
  # the step's 420 s limit: the step always reaches its own verdict.
  observe() {
    after=$(history 30) || { after="unreadable"; return 1; }
    state=$(s3_state 30) || { state="unreadable"; return 1; }
    probe=$(sessions 30) || { probe="unreadable"; return 1; }
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
      printf 'Observation %s: S3 history rows %s, S3 objects %s of %s, sessions visible|own|relevant|hidden = %s.\n' \
        "$observations" "$(printf '%s\n' "$after" | grep -c "^$S3_VERSION|" || true)" "$state" "$S3_OBJECTS" "$probe" | show_untrusted
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
  # Two reads capped at 90 s each (killed 10 s later at most): 200 s, inside the
  # step's 240 s limit.
  psql_file "$here/validate.sql" 90 >"$work/validate.txt" || fail "the validation query failed."
  show_untrusted <"$work/validate.txt"
  passed=$(grep -c '^PASS|' "$work/validate.txt" || true)
  total=$(wc -l <"$work/validate.txt")
  {
    echo "- Schema checks: $passed of $total passed."
    sed 's/^PASS|/  - PASS: /; s/^FAIL|/  - **FAIL**: /' "$work/validate.txt"
  } >>"$report"
  [ "$total" -eq 27 ] || fail "expected 27 schema checks, got $total."
  [ "$passed" -eq "$total" ] || fail "$((total - passed)) schema checks failed."

  snapshot after 90 || fail "could not record the post-migration snapshot."
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
      { grep -E '^(not ok|# |psql:.*ERROR)' "$out" || true; } | head -20 | show_untrusted
      fail "$name expected $plan/$plan."
    fi
  done
  snapshot tests || fail "could not record the post-test snapshot."
  diff -q "$work/snapshot-before.txt" "$work/snapshot-tests.txt" >/dev/null ||
    fail "records differ after the test suites; a test did not roll back."
  note "Records after the suites: identical to before (all fixtures rolled back)."
  ;;

*)
  printf 'Unknown subcommand: %s\n' "$step" | show_untrusted
  exit 2
  ;;
esac
