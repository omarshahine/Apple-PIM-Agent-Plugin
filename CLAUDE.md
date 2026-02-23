# Apple PIM Plugin

macOS PIM (Personal Information Management) tools for Calendar, Reminders, Contacts, and Mail.app. Works with Claude Code (via MCP) and OpenClaw (via native tool registration). Both adapters share a common `lib/` layer that delegates to native Swift CLIs using EventKit, Contacts framework, and JXA.

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

Handler logic, schemas, and sanitization live in `lib/` (shared). The MCP server and OpenClaw plugin are thin adapters. All access control, filtering, and default resolution is handled by the Swift CLIs via the shared `PIMConfig` library:

```
Claude Code  <--MCP-->  mcp-server/server.js  ---+
                                                  +--> lib/ (handlers, schemas, sanitize)
OpenClaw  <--tools-->  openclaw/src/index.ts  ---+           |
                                                        Swift CLIs (EventKit / Contacts / JXA)
                                                             |
                                                        PIMConfig (~/.config/apple-pim/)
```

Each Swift CLI is a standalone binary that reads from macOS frameworks, validates access via PIMConfig, and writes JSON to stdout.

## Repo Layout

| Path | Purpose |
|------|---------|
| `lib/` | Shared handler logic, schemas, sanitize (used by both MCP and OpenClaw) |
| `lib/handlers/` | Domain handlers: calendar, reminder, contact, mail, apple-pim |
| `swift/Sources/PIMConfig` | Shared config library (filtering, profiles, validation) |
| `swift/Sources/CalendarCLI` | EventKit calendar CLI |
| `swift/Sources/ReminderCLI` | EventKit reminders CLI |
| `swift/Sources/ContactsCLI` | Contacts framework CLI |
| `swift/Sources/MailCLI` | Mail.app JXA-based CLI |
| `mcp-server/server.js` | MCP adapter (imports lib/, thin pass-through) |
| `mcp-server/dist/server.js` | Bundled server artifact (rebuild after source changes) |
| `openclaw/` | OpenClaw plugin package (NPM: apple-pim-cli) |
| `openclaw/src/index.ts` | OpenClaw tool registration with per-call isolation |
| `.github/workflows/tests.yml` | CI checks for Node and Swift test jobs |

## Configuration (PIMConfig)

- Config lives at `~/.config/apple-pim/config.json` (base) with optional profiles at `~/.config/apple-pim/profiles/{name}.json`.
- All four CLIs share the `PIMConfig` library for allowlist/blocklist filtering, domain enable/disable, and defaults.
- Profile selection: `--profile` flag > `APPLE_PIM_PROFILE` env var > base config only.
- **Fail-closed profiles:** If a profile is explicitly requested (via `--profile` or `APPLE_PIM_PROFILE`) but the file doesn't exist, the CLI exits with an error instead of falling back to the base config.
- Profile overrides replace entire domain sections (not field-by-field merge).
- The MCP server does NOT do any config filtering — it passes `--profile` to CLIs when set.
- **OpenClaw plugin** (`openclaw/`): Registers tools that spawn CLIs directly (no MCP). Supports per-call `configDir`/`profile` parameters for multi-agent workspace isolation. See [`docs/multi-agent-setup.md`](docs/multi-agent-setup.md).
- **Direct CLI usage:** `APPLE_PIM_CONFIG_DIR` overrides the config root directory; `APPLE_PIM_PROFILE` selects a profile.

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

## NPM Publishing (OpenClaw Plugin)

The OpenClaw plugin is published as `apple-pim-cli` on NPM.

```bash
cd openclaw
npm publish
# Requires NPM login (npm login) and browser 2FA confirmation
```

- `prepack` script copies `lib/` from symlink into a real directory; `postpack` restores the symlink
- `publishConfig.access: "public"` ensures public access by default
- Bump version in `openclaw/package.json` before publishing
- OpenClaw normalizes scoped names to unscoped ids for `plugins.entries.*` config keys
- Community plugin listing: PR to `openclaw/openclaw` repo, `docs/plugins/community.md`

## Gotchas

- `mcp-server/dist/server.js` is generated; rebuild it after editing `lib/` or `mcp-server/` source files.
- OpenClaw loads TypeScript directly — no build step needed after editing `openclaw/` or `lib/`.
- Mail features depend on Mail.app being open and Automation permissions being granted.
- `lib/` has shared deps (`mailparser`, `turndown`) installed at the repo root `package.json`. Run `npm install` at root after cloning.
## Claude Code GitHub Actions

This repo uses Claude Code GitHub Actions for PR automation:

- **`claude.yml`** - Responds to `@claude` mentions in PR/issue comments

Auto code review is handled by **Greptile**, not Claude Code. Use `@greptile review` in a PR comment to trigger a re-review after pushing fixes.
