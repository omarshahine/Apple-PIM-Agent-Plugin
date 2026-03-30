#!/bin/bash
set -euo pipefail

# Publish apple-pim-cli to ClawHub
# Usage: ./publish-clawhub.sh [--changelog "description of changes"]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$SCRIPT_DIR/openclaw"
PKG_JSON="$PKG_DIR/package.json"

VERSION=$(node -p "require('$PKG_JSON').version")
COMMIT=$(git rev-parse HEAD)

# Parse --changelog argument or prompt
CHANGELOG=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --changelog)
      CHANGELOG="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 [--changelog \"description of changes\"]"
      exit 1
      ;;
  esac
done

if [[ -z "$CHANGELOG" ]]; then
  echo "Version: $VERSION"
  echo "Commit:  $COMMIT"
  echo ""
  read -rp "Changelog: " CHANGELOG
fi

if [[ -z "$CHANGELOG" ]]; then
  echo "Error: changelog is required"
  exit 1
fi

echo "Publishing apple-pim-cli v$VERSION to ClawHub..."
echo "  Commit: $COMMIT"
echo "  Changelog: $CHANGELOG"
echo ""

# Prepack: replace lib/ symlink with real copy for packaging
echo "Running prepack (copying lib/ into openclaw/)..."
cd "$PKG_DIR"
npm run prepack

# Publish
clawhub package publish "$PKG_DIR" \
  --family code-plugin \
  --name "apple-pim-cli" \
  --display-name "Apple PIM" \
  --version "$VERSION" \
  --changelog "$CHANGELOG" \
  --tags "latest" \
  --source-repo "omarshahine/Apple-PIM-Agent-Plugin" \
  --source-commit "$COMMIT" \
  --source-ref "main" \
  --source-path "openclaw"

PUBLISH_EXIT=$?

# Postpack: restore lib/ symlink regardless of publish result
echo "Running postpack (restoring lib/ symlink)..."
npm run postpack

if [[ $PUBLISH_EXIT -ne 0 ]]; then
  echo "Publish failed with exit code $PUBLISH_EXIT"
  exit $PUBLISH_EXIT
fi

echo ""
echo "Published apple-pim-cli v$VERSION to ClawHub."
echo "Verify: clawhub package inspect apple-pim-cli"
