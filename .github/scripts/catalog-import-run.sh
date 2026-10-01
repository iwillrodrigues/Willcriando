#!/usr/bin/env bash
# Runs scripts/import-catalog.ts once and checks its output, for the
# catalog-import workflow.
#
#   catalog-import-run.sh dry-run <label>   read-only Notion validation
#   catalog-import-run.sh apply   <label>   validation, then the import RPC
#
# The full importer output stays in $RUNNER_TEMP and is never printed: the job
# log gets only the importer's summary lines (no inventory rows), counts and
# pass/fail. Writes to $RUNNER_TEMP/catalog/<label>.{mapping,snapshot} for the
# idempotency comparison and to $GITHUB_OUTPUT.
set -euo pipefail

mode="$1"
label="$2"
dir="${RUNNER_TEMP:?}/catalog"
mkdir -p "$dir"
log="$dir/$label.log"

args=()
[ "$mode" = "apply" ] && args+=(--apply)

status=0
node scripts/import-catalog.ts "${args[@]}" >"$log" 2>&1 || status=$?

# Summary lines only: inventory rows (" | ") and Node warnings are dropped.
grep -v -e ' | ' -e '^(node:' -e 'trace-warnings' -e 'MODULE_TYPELESS' -e 'Reparsing as ES module' -e 'add "type": "module"' "$log" || true
# Invalid rows by editorial code only, so a blocker is diagnosable without page content.
awk -F' [|] ' '/ [|] INVALID: /{sub(/^ +/, "", $1); print "INVALID node " $1 ": " $NF}' "$log"

if [ "$status" -ne 0 ]; then
  echo "::error title=Catalog $label::The importer exited with status $status."
  exit "$status"
fi

# Inventory rows: "  code | title | section | source page id | status".
rows="$dir/$label.rows"
awk -F' [|] ' '/^  [1-9][0-9.]* [|] / && NF >= 5 {sub(/^ +/, "", $1); print $1 "\t" $(NF-1) "\t" $NF}' "$log" >"$rows"

total=$(wc -l <"$rows")
paths=$(awk -F'\t' '$3 == "path"' "$rows" | wc -l)
headers=$(awk -F'\t' '$3 == "group header"' "$rows" | wc -l)
invalid=$(awk -F'\t' '$3 ~ /^INVALID/' "$rows" | wc -l)
codes=$(cut -f1 "$rows" | sort -u | wc -l)
ids=$(cut -f2 "$rows" | sort -u | wc -l)
header_list=$(awk -F'\t' '$3 == "group header" {print $1 " " $2}' "$rows" | sort | paste -sd ';' -)

fail=()
[ "$total" -eq 67 ] || fail+=("expected 67 nodes, found $total")
[ "$paths" -eq 65 ] || fail+=("expected 65 selectable paths, found $paths")
[ "$headers" -eq 2 ] || fail+=("expected 2 group headers, found $headers")
[ "$invalid" -eq 0 ] || fail+=("$invalid invalid nodes")
[ "$codes" -eq 67 ] || fail+=("expected 67 unique editorial codes, found $codes")
[ "$ids" -eq 67 ] || fail+=("expected 67 unique source ids, found $ids")
[ "$header_list" = "23 29812b02-3ff1-4f18-90c3-40f3d70beca4;9 12dc2afa-0506-4a17-bc8d-80f8d081ccec" ] ||
  fail+=("group headers are not 9 (12dc2afa-...) and 23 (29812b02-...)")
grep -q '^  count: 67,$' "$log" || fail+=("validated catalog count is not 67")
grep -q '^  selectable: 65,$' "$log" || fail+=("validated selectable count is not 65")

# Code -> source id -> kind, sorted: identical across runs when mappings are stable.
mapping=$(sort "$rows" | sha256sum | cut -d' ' -f1)
echo "$mapping" >"$dir/$label.mapping"

snapshot=""
if [ "$mode" = "apply" ]; then
  snapshot=$(sed -n 's/^Imported\. Current catalog snapshot: \([0-9a-f-]\{36\}\)$/\1/p' "$log")
  [ -n "$snapshot" ] || fail+=("the import did not report a catalog snapshot id")
  echo "$snapshot" >"$dir/$label.snapshot"
fi

echo "Checked $label: nodes=$total paths=$paths headers=$headers unique_codes=$codes unique_ids=$ids mapping=$mapping${snapshot:+ snapshot=$snapshot}"
{
  echo "nodes=$total"
  echo "paths=$paths"
  echo "headers=$headers"
  echo "unique_codes=$codes"
  echo "unique_ids=$ids"
  echo "mapping=$mapping"
  echo "snapshot=$snapshot"
} >>"${GITHUB_OUTPUT:-/dev/null}"

if [ "${#fail[@]}" -gt 0 ]; then
  for f in "${fail[@]}"; do echo "::error title=Catalog $label::$f"; done
  exit 1
fi
