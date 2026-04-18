#!/usr/bin/env bash
#
# Bump all five plugin version sources to the same value, then rebuild
# mcp-server/dist/server.js so the bundled artifact reflects the new version.
#
# Usage:
#   scripts/bump-version.sh X.Y.Z
#
# Sources rewritten (see scripts/check-versions.sh):
#   - .claude-plugin/plugin.json                 .version
#   - .claude-plugin/marketplace.json            .plugins[0].version
#   - mcp-server/package.json                    .version
#   - openclaw/package.json                      .version
#   - openclaw/openclaw.plugin.json              .version
#
# After the bump: commit, tag v<new>, push — publishing workflows read
# the version from the tag.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 X.Y.Z" >&2
  exit 2
fi

new="$1"
if ! [[ "$new" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: version must be semver X.Y.Z (got '$new')" >&2
  exit 2
fi

cd "$(dirname "$0")/.."

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (brew install jq)" >&2
  exit 2
fi

set_json_field() {
  local file="$1" jq_expr="$2" tmp
  tmp=$(mktemp)
  jq "$jq_expr" "$file" > "$tmp"
  mv "$tmp" "$file"
}

set_json_field .claude-plugin/plugin.json       ".version = \"$new\""
set_json_field .claude-plugin/marketplace.json  ".plugins[0].version = \"$new\""
set_json_field mcp-server/package.json          ".version = \"$new\""
set_json_field openclaw/package.json            ".version = \"$new\""
set_json_field openclaw/openclaw.plugin.json    ".version = \"$new\""

echo "Rebuilding mcp-server/dist/server.js..."
(cd mcp-server && npm run build --silent)

echo
./scripts/check-versions.sh
echo
echo "Next: git add -p && git commit -m \"chore: release v$new\" && git tag -a v$new -m \"...\" && git push --follow-tags"
