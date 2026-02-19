# Apple PIM CLI Tools

[![GitHub](https://img.shields.io/github/v/release/omarshahine/Apple-PIM-Agent-Plugin)](https://github.com/omarshahine/Apple-PIM-Agent-Plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/omarshahine/Apple-PIM-Agent-Plugin/blob/main/LICENSE)

**GitHub**: [github.com/omarshahine/Apple-PIM-Agent-Plugin](https://github.com/omarshahine/Apple-PIM-Agent-Plugin)

Native macOS integration for Calendar, Reminders, Contacts, and Mail using EventKit, Contacts, and JXA frameworks. Works with **Claude Code** (via MCP) and **OpenClaw** (via native tool registration).

## Features

- **Calendar Management**: List calendars, create/read/update/delete events, search by date/title
- **Reminder Management**: List reminder lists, create/complete/update/delete reminders, search
- **Contact Management**: List groups, create/read/update/delete contacts, search by name/email/phone, birthday support (with or without year)
- **Mail Integration**: List accounts/mailboxes, read/search/move/delete messages, update flags (via Apple Mail.app + JXA)
- **Recurrence Rules**: Create recurring events and reminders (daily, weekly, monthly, yearly)
- **Batch Operations**: Create multiple events or reminders in a single efficient transaction
- **Per-Domain Control**: Enable or disable entire domains (calendars, reminders, contacts, mail) independently
- **Multi-Agent Isolation**: Per-call config/profile overrides for workspace isolation
- **Works with Claude Code and OpenClaw**: Same Swift CLIs, different integration layers

## Prerequisites

- macOS 13.0 or later
- Swift 5.9 or later (comes with Xcode 15+)
- Node.js 18+ (for MCP server or OpenClaw plugin)
- **Mail.app** must be running for mail commands (it is not launched automatically)

## Installation

### Swift CLI Tools (Required for both platforms)

```bash
# Build the Swift CLIs
./setup.sh

# Optional: install to PATH for system-wide access
./setup.sh --install

# Add to your shell profile (if not already there)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

The `--install` flag creates symlinks in `~/.local/bin/`, so rebuilding (`swift build -c release`) automatically updates the global commands.

### Claude Code Plugin

```bash
# Option 1: Standalone from this repo
claude plugin marketplace add omarshahine/Apple-PIM-Agent-Plugin
claude plugin install apple-pim@apple-pim
~/.claude/plugins/cache/apple-pim/apple-pim/*/setup.sh

# Option 2: Via omarshahine-agent-plugins marketplace
claude plugin install apple-pim@omarshahine-agent-plugins
~/.claude/plugins/cache/omarshahine-agent-plugins/apple-pim/*/setup.sh

# Restart Claude Code to load the MCP server
```

The `pim-assistant` agent triggers automatically when you mention scheduling, reminders, contacts, or email.

### OpenClaw Plugin

```bash
# Prerequisites: Swift CLIs must be on PATH (run ./setup.sh --install)
openclaw plugins install apple-pim-cli

# Optional: configure binary location if not on PATH
# In your OpenClaw config:
# plugins.entries.apple-pim-cli.config.binDir = "/path/to/swift/.build/release"
```

### Post-Installation (both platforms)

**Grant permissions**: On first use, macOS will prompt for Calendar, Reminders, and Contacts access. Grant these permissions in System Settings > Privacy & Security.

**Mail.app Automation**: For mail features, you also need to grant Automation permission:
- System Settings > Privacy & Security > Automation
- Allow Terminal (or your IDE) to control **Mail.app**

### Development Installation

```bash
git clone https://github.com/omarshahine/Apple-PIM-Agent-Plugin.git
cd Apple-PIM-Agent-Plugin
./setup.sh

# Claude Code
claude --plugin-dir .

# OpenClaw (loads TypeScript directly, no build step)
openclaw plugins install -l ./openclaw
```

## Configuration

You can optionally restrict which domains and items the plugin can access. This is useful for:
- Privacy — hide calendars you don't need the agent to see
- Reducing noise — only show relevant reminder lists
- Avoiding conflicts — disable mail here if you use Fastmail MCP for email
- Multi-agent setups — give each agent a profile with different access

### Interactive Setup (Claude Code)

```
/apple-pim:configure
```

### CLI Config Commands

```bash
# Show current effective configuration
calendar-cli config show
reminder-cli config show

# Initialize config from available calendars/lists
calendar-cli config init
reminder-cli config init
```

### Manual Configuration

Config files are stored at `~/.config/apple-pim/`:

```
~/.config/apple-pim/
├── config.json              # Base configuration
└── profiles/
    ├── work.json            # Work agent profile
    └── personal.json        # Personal agent profile
```

**Base config** (`~/.config/apple-pim/config.json`):

```json
{
  "calendars": {
    "enabled": true,
    "mode": "allowlist",
    "items": ["Personal", "Work"]
  },
  "reminders": {
    "enabled": true,
    "mode": "allowlist",
    "items": ["Reminders", "Shopping"]
  },
  "contacts": {
    "enabled": true,
    "mode": "all",
    "items": []
  },
  "mail": {
    "enabled": true
  },
  "default_calendar": "Personal",
  "default_reminder_list": "Reminders"
}
```

### Configuration Options

| Option | Values | Description |
|--------|--------|-------------|
| `enabled` | `true`, `false` | Enable or disable an entire domain |
| `mode` | `allowlist`, `blocklist`, `all` | How to filter items (calendars/reminders/contacts) |
| `items` | List of names | Calendar/list names to allow or block (emoji prefixes are matched fuzzy) |
| `default_calendar` | Calendar name | Where new events are created when no calendar is specified |
| `default_reminder_list` | List name | Where new reminders are created when no list is specified |

### Filter Modes

- **allowlist**: Only listed calendars/lists are accessible
- **blocklist**: All EXCEPT listed items are accessible
- **all**: No filtering (default if no config file exists)

### Profiles

Profiles let you give different agents different access to your PIM data. Each profile overrides specific domain sections from the base config — fields not in the profile are inherited from the base.

**Profile selection** (in priority order):
1. `--profile work` CLI flag (on the subcommand)
2. `APPLE_PIM_PROFILE=work` environment variable
3. Tool parameter `profile: "work"` (OpenClaw only)
4. No profile — base config only

**Example profile** (`~/.config/apple-pim/profiles/work.json`):

```json
{
  "calendars": {
    "enabled": true,
    "mode": "allowlist",
    "items": ["Work"]
  },
  "mail": {
    "enabled": false
  },
  "default_calendar": "Work"
}
```

### Domain Enable/Disable

Set `enabled: false` on any domain to disable it. When disabled, CLI commands for that domain return an access denied error.

### Notes

- Config is read fresh on each CLI invocation — changes take effect immediately
- No config file = all domains enabled, all items accessible (backwards compatible)
- Write operations to blocked calendars/lists fail with a descriptive error message
- Profile names are validated — path traversal attempts are rejected

## Multi-Agent Setup

When running multiple agents, each can have its own profile or config directory for isolated PIM access. See [docs/multi-agent-setup.md](docs/multi-agent-setup.md) for the full guide.

**Quick start**: Create profiles in `~/.config/apple-pim/profiles/` and assign them per agent:

```bash
# Environment variable
APPLE_PIM_PROFILE=travel

# OpenClaw tool parameter (per-call isolation)
apple_pim_calendar({ action: "list", profile: "travel" })
apple_pim_calendar({ action: "list", configDir: "~/agents/travel/apple-pim" })
```

## Usage

### Claude Code Commands

```
/apple-pim:calendars list                    # List all calendars
/apple-pim:calendars events                  # Events for next 7 days
/apple-pim:calendars search "team meeting"
/apple-pim:reminders lists                   # List all reminder lists
/apple-pim:reminders items --filter overdue
/apple-pim:contacts search "John"
/apple-pim:mail messages --filter unread
```

Natural language works via the `pim-assistant` agent:
- "What's on my calendar tomorrow?"
- "Remind me to call the dentist"
- "What's John's email address?"

### OpenClaw Tools

| Tool | Example |
|------|---------|
| `apple_pim_calendar` | `apple_pim_calendar({ action: "events", nextDays: 7 })` |
| `apple_pim_reminder` | `apple_pim_reminder({ action: "items", filter: "today" })` |
| `apple_pim_contact` | `apple_pim_contact({ action: "search", query: "John" })` |
| `apple_pim_mail` | `apple_pim_mail({ action: "messages", filter: "unread" })` |
| `apple_pim_system` | `apple_pim_system({ action: "status" })` |

### Direct CLI

```bash
calendar-cli list
calendar-cli events --from today --to tomorrow
calendar-cli create --title "Lunch" --start "tomorrow 12pm" --duration 60
reminder-cli lists
reminder-cli items --list "Personal" --filter overdue
contacts-cli search "John"
mail-cli messages --mailbox INBOX --limit 10
```

## Tools Reference

5 domain-level tools, each with an `action` parameter:

| Tool | Actions | Domain |
|------|---------|--------|
| `calendar` / `apple_pim_calendar` | `list`, `events`, `get`, `search`, `create`, `update`, `delete`, `batch_create` | Calendar events via EventKit |
| `reminder` / `apple_pim_reminder` | `lists`, `items`, `get`, `search`, `create`, `complete`, `update`, `delete`, `batch_create`, `batch_complete`, `batch_delete` | Reminders via EventKit |
| `contact` / `apple_pim_contact` | `groups`, `list`, `search`, `get`, `create`, `update`, `delete` | Contacts framework |
| `mail` / `apple_pim_mail` | `accounts`, `mailboxes`, `messages`, `get`, `search`, `update`, `move`, `delete`, `batch_update`, `batch_delete` | Mail.app via JXA |
| `apple-pim` / `apple_pim_system` | `status`, `authorize`, `config_show`, `config_init` | Authorization & configuration |

### Recurrence Rules

```json
{
  "frequency": "weekly",
  "interval": 1,
  "daysOfTheWeek": ["monday", "wednesday", "friday"],
  "endDate": "2025-12-31"
}
```

**Supported frequencies**: `daily`, `weekly`, `monthly`, `yearly`

### Batch Operations

```json
{
  "events": [
    {"title": "Standup", "start": "2025-01-27 09:00"},
    {"title": "Team Sync", "start": "2025-01-27 14:00"}
  ]
}
```

## Architecture

The shared `lib/` layer contains all handler logic, schemas, and sanitization. Both the MCP server and OpenClaw plugin are thin adapters over this shared code.

```
Claude Code  <--MCP-->  mcp-server/server.js  ---+
                                                  |
OpenClaw  <--tools-->  openclaw/src/index.ts  ----+--> lib/ (shared handlers, schemas, sanitize)
                                                  |
Direct CLI  <--shell-->  --------------------------+--> Swift CLIs (EventKit / Contacts / JXA)
                                                            |
                                                       PIMConfig
                                                  (~/.config/apple-pim/)
```

### Directory Structure

```
apple-pim/
├── lib/                      # Shared handler logic (used by MCP + OpenClaw)
│   ├── cli-runner.js         # CLI spawn + binary discovery
│   ├── schemas.js            # Tool JSON Schemas
│   ├── sanitize.js           # Datamarking for prompt injection defense
│   ├── mail-format.js        # Email markdown formatting
│   ├── tool-args.js          # CLI argument builders
│   └── handlers/
│       ├── calendar.js       # handleCalendar()
│       ├── reminder.js       # handleReminder()
│       ├── contact.js        # handleContact()
│       ├── mail.js           # handleMail()
│       └── apple-pim.js      # handleApplePim()
├── swift/                    # Native Swift CLI tools
│   ├── Sources/
│   │   ├── PIMConfig/        # Shared config library
│   │   ├── CalendarCLI/      # EventKit calendar operations
│   │   ├── ReminderCLI/      # EventKit reminder operations
│   │   ├── ContactsCLI/      # Contacts framework operations
│   │   └── MailCLI/          # Mail.app via JXA
│   └── Tests/
├── mcp-server/               # Claude Code MCP adapter
│   ├── server.js             # MCP tool registration (imports lib/)
│   ├── build.mjs             # esbuild config
│   └── dist/server.js        # Bundled artifact
├── openclaw/                 # OpenClaw plugin package (NPM: apple-pim-cli)
│   ├── src/index.ts          # Tool registration with per-call isolation
│   ├── openclaw.plugin.json  # Plugin manifest + config schema
│   ├── lib -> ../lib         # Symlink to shared code
│   └── skills/apple-pim/     # OpenClaw skill knowledge
├── commands/                 # Claude Code slash commands
├── agents/                   # pim-assistant agent
├── skills/                   # Claude Code skill knowledge
├── docs/                     # Documentation
│   └── multi-agent-setup.md  # Multi-agent isolation guide
└── setup.sh                  # Build + install script
```

## Troubleshooting

### Permission Denied

Check System Settings > Privacy & Security:
- **Calendars**: Ensure Terminal/Claude Code has access
- **Reminders**: Ensure Terminal/Claude Code has access
- **Contacts**: Ensure Terminal/Claude Code has access

You may need to restart your app after granting permissions.

### Mail.app Issues

- **Mail.app must be running** — the plugin does not launch it automatically
- **Automation permission** — System Settings > Privacy & Security > Automation: allow Terminal to control Mail.app
- **30-second timeout** — JXA scripts have a 30-second timeout. Use `--limit` to reduce result count
- **Message IDs** — Mail tools use RFC 2822 `messageId` (stable across moves). Pass `--mailbox` and `--account` hints for faster lookups

### CLI Not Found

```bash
# Build and install to PATH
./setup.sh --install

# Verify
which calendar-cli
calendar-cli list
```

### MCP Server Not Connecting (Claude Code)

1. Ensure you ran `./setup.sh` to install npm dependencies
2. Check `/mcp` in Claude Code to see server status
3. Restart Claude Code after installing the plugin

### OpenClaw Tools Not Registering

1. Verify CLIs are on PATH: `which calendar-cli`
2. Check `openclaw plugins list` for the plugin
3. If not on PATH, set `binDir` in plugin config

### Date Parsing Issues

The CLI accepts various date formats:
- ISO: `2024-01-15T14:30:00`
- Date/time: `2024-01-15 14:30`
- Date only: `2024-01-15`
- Natural language: `today`, `tomorrow`, `next week`, `in 2 hours`

## Development

### Testing CLIs Directly

```bash
cd swift/.build/release

./calendar-cli list
./calendar-cli events --from today --to tomorrow
./reminder-cli lists
./reminder-cli items --list "Personal"
./contacts-cli search "John"
./mail-cli accounts
```

### Using Profiles

```bash
# CLI flag
calendar-cli list --profile work

# Environment variable
export APPLE_PIM_PROFILE=work
calendar-cli events --from today --to tomorrow

# View effective config
calendar-cli config show --profile travel
```

### Rebuilding After Changes

```bash
# Swift CLIs
cd swift && swift build -c release

# MCP server bundle (after editing lib/ or mcp-server/)
cd mcp-server && npm run build

# OpenClaw loads .ts directly — no rebuild needed
```

## License

MIT
