#!/usr/bin/env bash
#
# Verify that all five plugin version sources agree.
# Exits non-zero if any disagree; prints a table either way.
#
# Sources:
#   - .claude-plugin/plugin.json                 .version
#   - .claude-plugin/marketplace.json            .plugins[0].version
#   - mcp-server/package.json                    .version
#   - openclaw/package.json                      .version
#   - openclaw/openclaw.plugin.json              .version

set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (brew install jq / apt-get install jq)" >&2
  exit 2
fi

read -r v_plugin        < <(jq -r '.version'             .claude-plugin/plugin.json)
read -r v_marketplace   < <(jq -r '.plugins[0].version'  .claude-plugin/marketplace.json)
read -r v_mcp           < <(jq -r '.version'             mcp-server/package.json)
read -r v_openclaw_pkg  < <(jq -r '.version'             openclaw/package.json)
read -r v_openclaw_man  < <(jq -r '.version'             openclaw/openclaw.plugin.json)

printf "%-40s %s\n" "File" "Version"
printf "%-40s %s\n" "----" "-------"
printf "%-40s %s\n" ".claude-plugin/plugin.json"        "$v_plugin"
printf "%-40s %s\n" ".claude-plugin/marketplace.json"   "$v_marketplace"
printf "%-40s %s\n" "mcp-server/package.json"           "$v_mcp"
printf "%-40s %s\n" "openclaw/package.json"             "$v_openclaw_pkg"
printf "%-40s %s\n" "openclaw/openclaw.plugin.json"     "$v_openclaw_man"

all="$v_plugin $v_marketplace $v_mcp $v_openclaw_pkg $v_openclaw_man"
uniq=$(printf '%s\n' $all | sort -u | wc -l | tr -d ' ')

if [ "$uniq" != "1" ]; then
  echo
  echo "FAIL: version sources disagree." >&2
  echo "Run scripts/bump-version.sh <X.Y.Z> to align them." >&2
  exit 1
fi

echo
echo "OK: all version sources agree on $v_plugin"
