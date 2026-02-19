# Apple PIM Plugin

Claude Code plugin that exposes macOS PIM (Personal Information Management) data — calendars, reminders, contacts, and Mail.app — via MCP tools. Built as a thin Node.js MCP server that delegates to native Swift CLIs using EventKit, Contacts framework, and JXA.

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

## Architecture

The MCP server is a thin pass-through that maps tool schemas to CLI arguments. All access control, filtering, and default resolution is handled by the Swift CLIs via the shared `PIMConfig` library:

```
Claude Code ←stdio→ mcp-server/server.js ←spawn→ swift/Sources/*CLI (EventKit / Contacts / JXA)
                                                        ↑
                                                   PIMConfig library
                                              (~/.config/apple-pim/)
```

Each Swift CLI is a standalone binary that reads from macOS frameworks, validates access via PIMConfig, and writes JSON to stdout.

## Repo Layout

| Path | Purpose |
|------|---------|
| `swift/Sources/PIMConfig` | Shared config library (filtering, profiles, validation) |
| `swift/Sources/CalendarCLI` | EventKit calendar CLI |
| `swift/Sources/ReminderCLI` | EventKit reminders CLI |
| `swift/Sources/ContactsCLI` | Contacts framework CLI |
| `swift/Sources/MailCLI` | Mail.app JXA-based CLI |
| `mcp-server/server.js` | MCP tool schema and CLI argument mapping layer |
| `mcp-server/dist/server.js` | Bundled server artifact (rebuild after source changes) |
| `.github/workflows/tests.yml` | CI checks for Node and Swift test jobs |

## Configuration (PIMConfig)

- Config lives at `~/.config/apple-pim/config.json` (base) with optional profiles at `~/.config/apple-pim/profiles/{name}.json`.
- **`APPLE_PIM_CONFIG_DIR`** env var overrides the config root directory. When set, all config paths (base config, profiles) resolve relative to this directory instead of `~/.config/apple-pim/`. Useful for workspace-isolated agent configs. See [`docs/multi-agent-setup.md`](docs/multi-agent-setup.md) for the full pattern.
- All four CLIs share the `PIMConfig` library for allowlist/blocklist filtering, domain enable/disable, and defaults.
- Profile selection: `--profile` flag > `APPLE_PIM_PROFILE` env var > base config only.
- **Fail-closed profiles:** If a profile is explicitly requested (via `--profile` or `APPLE_PIM_PROFILE`) but the file doesn't exist, the CLI exits with an error instead of falling back to the base config.
- Profile overrides replace entire domain sections (not field-by-field merge).
- The MCP server passes `APPLE_PIM_CONFIG_DIR` and `APPLE_PIM_PROFILE` from its own environment to the Swift CLIs via process inheritance. Set these in plugin.json `env` or the outer shell.
- The MCP server does NOT do any config filtering — it passes `--profile` to CLIs when set.

## Testing Notes

- Keep pure parsing/argument mapping logic extractable and unit tested.
- PIMConfig tests (`swift/Tests/PIMConfigTests/`) cover filtering logic, config round-trips, profile merging, and security validation.
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
## Claude Code GitHub Actions

This repo uses Claude Code GitHub Actions for PR automation:

- **`claude-code-review.yml`** - Auto-reviews PRs when marked "Ready for review" (draft → ready triggers review)
- **`claude.yml`** - Responds to `@claude` mentions in PR/issue comments for manual reviews

**Workflow:** Open PRs as draft → push commits → mark "Ready for review" to trigger auto-review. Use `@claude` in comments for follow-up reviews.
