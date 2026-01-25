#!/bin/bash
# Apple PIM Plugin Setup Script
# Run this after installing the plugin to build Swift CLIs and install MCP dependencies

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "📦 Building Swift CLI tools..."
cd "$SCRIPT_DIR/swift"
swift build -c release

echo ""
echo "📦 Installing MCP server dependencies..."
cd "$SCRIPT_DIR/mcp-server"
npm install

echo ""
echo "✅ Setup complete!"
echo ""
echo "The plugin is now ready to use. Restart Claude Code to load the MCP server."
echo ""
echo "Test commands:"
echo "  /apple-pim:calendars list"
echo "  /apple-pim:reminders lists"
echo "  /apple-pim:contacts search \"John\""
echo ""
echo "Optional: Configure which calendars/lists are accessible:"
echo "  /apple-pim:configure"
echo ""
echo "Or manually create data/config.local.md in this plugin folder."
echo "See README.md for configuration options."
