# Apple PIM Plugin

## Quick Commands

```bash
# Initial setup
./setup.sh

# Swift CLIs
cd swift
swift build -c release
swift test

# MCP server
cd mcp-server
npm install
npm test
npm run build
```

## Repo Layout

- `swift/Sources/CalendarCLI`: EventKit calendar CLI
- `swift/Sources/ReminderCLI`: EventKit reminders CLI
- `swift/Sources/ContactsCLI`: Contacts framework CLI
- `swift/Sources/MailCLI`: Mail.app JXA-based CLI
- `mcp-server/server.js`: MCP tool schema and CLI argument mapping layer
- `mcp-server/dist/server.js`: Bundled server artifact built from `server.js`
- `.github/workflows/tests.yml`: CI checks for Node and Swift test jobs

## Testing Notes

- Keep pure parsing/argument mapping logic extractable and unit tested.
- Prefer unit tests for logic seams (`swift/Tests/*`, `mcp-server/test/*`) over tests that require macOS permissions.
- Full EventKit/Contacts/Mail integration paths can require local TCC permissions and Mail.app running.

## CI And PR Workflow

- Required checks on `main`:
  - `MCP Server (Node)`
  - `Swift CLI`
- Auto-merge is enabled at the repo level; use it on PRs so merges wait for required checks.
- This repo ignores lockfiles; CI uses `npm install` (not `npm ci`) in `mcp-server`.

## Code Hygiene

- No hardcoded user paths (`/Users/[name]/`) - use `~/` or `${HOME}`
- No personal email addresses in tracked files (allowed: `@example.com`, `@anthropic.com`, `@noreply`)
- No API keys or secrets in code - use environment variables
- No phone numbers or PII in examples - use generic placeholders

## Gotchas

- `mcp-server/dist/server.js` is generated; rebuild it after MCP server source changes.
- Mail features depend on Mail.app being open and Automation permissions being granted.
