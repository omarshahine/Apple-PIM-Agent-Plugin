# Apple PIM Plugin for Claude Code

[![GitHub](https://img.shields.io/github/v/release/omarshahine/Apple-PIM-Agent-Plugin)](https://github.com/omarshahine/Apple-PIM-Agent-Plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/omarshahine/Apple-PIM-Agent-Plugin/blob/main/LICENSE)

**GitHub**: [github.com/omarshahine/Apple-PIM-Agent-Plugin](https://github.com/omarshahine/Apple-PIM-Agent-Plugin)

Native macOS integration for Calendar, Reminders, Contacts, and Mail using EventKit, Contacts, and JXA frameworks. Built as a [Claude Code plugin](https://code.claude.com/docs/en/plugins.md).

## Features

- **Calendar Management**: List calendars, create/read/update/delete events, search by date/title
- **Reminder Management**: List reminder lists, create/complete/update/delete reminders, search
- **Contact Management**: List groups, create/read/update/delete contacts, search by name/email/phone, birthday support (with or without year)
- **Mail Integration**: List accounts/mailboxes, read/search/move/delete messages, update flags (via Apple Mail.app + JXA)
- **Recurrence Rules**: Create recurring events and reminders (daily, weekly, monthly, yearly)
- **Batch Operations**: Create multiple events or reminders in a single efficient transaction
- **Per-Domain Control**: Enable or disable entire domains (calendars, reminders, contacts, mail) independently
- **Proactive Agent**: The `pim-assistant` agent triggers automatically when you mention scheduling, reminders, contacts, or email

## Prerequisites

- macOS 13.0 or later
- Swift 5.9 or later (comes with Xcode 15+)
- Node.js 18+ (for MCP server)
- **Mail.app** must be running for mail commands (it is not launched automatically)

## Installation

### Option 1: Standalone Installation

Install directly from this repository:

```bash
# Add this repo as a marketplace
claude plugin marketplace add omarshahine/Apple-PIM-Agent-Plugin

# Install the plugin
claude plugin install apple-pim@apple-pim

# Run the setup script to build Swift CLIs and install dependencies
~/.claude/plugins/cache/apple-pim/apple-pim/*/setup.sh

# Restart Claude Code to load the MCP server
```

### Option 2: Via omarshahine-agent-plugins Marketplace

If you already have the omarshahine-agent-plugins marketplace:

```bash
# Install the plugin
claude plugin install apple-pim@omarshahine-agent-plugins

# Run the setup script
~/.claude/plugins/cache/omarshahine-agent-plugins/apple-pim/*/setup.sh

# Restart Claude Code to load the MCP server
```

### Post-Installation

**Grant permissions**: On first use, macOS will prompt for Calendar, Reminders, and Contacts access. Grant these permissions in System Settings > Privacy & Security.

**Mail.app Automation**: For mail features, you also need to grant Automation permission:
- System Settings > Privacy & Security > Automation
- Allow Terminal (or your IDE) to control **Mail.app**

### Development Installation

```bash
# Clone the repo
git clone https://github.com/omarshahine/Apple-PIM-Agent-Plugin.git
cd Apple-PIM-Agent-Plugin

# Run setup
./setup.sh

# Test with Claude Code
claude --plugin-dir .
```

### Global CLI Installation

Make the CLIs available system-wide so you can run `calendar-cli`, `reminder-cli`, etc. from anywhere:

```bash
# Build and install symlinks to ~/.local/bin
./setup.sh --install

# Add to your shell profile (if not already there)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Verify
calendar-cli list
reminder-cli lists
contacts-cli groups
mail-cli accounts
```

The install creates symlinks, so rebuilding (`swift build -c release`) automatically updates the global commands — no need to reinstall.

## Configuration

You can optionally restrict which domains and items the plugin can access. This is useful for:
- Privacy — hide calendars you don't need Claude to see
- Reducing noise — only show relevant reminder lists
- Avoiding conflicts — disable mail here if you use Fastmail MCP for email
- Multi-agent setups — give each agent a profile with different access

### Interactive Setup

Run the configure command to interactively set up access:

```
/apple-pim:configure
```

This will:
1. Ask which domains to enable (Calendars, Reminders, Contacts, Mail)
2. For enabled domains, list available calendars and reminder lists
3. Let you select which ones to allow
4. Set default calendars for new events/reminders
5. Write the config file

### CLI Config Commands

Each CLI has built-in config commands:

```bash
# Show current effective configuration
./calendar-cli config show
./reminder-cli config show

# Initialize config from available calendars/lists
./calendar-cli config init
./reminder-cli config init
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

### Profiles

Profiles let you give different agents different access to your PIM data. Each profile overrides specific domain sections from the base config — fields not in the profile are inherited from the base.

**Profile selection** (in priority order):
1. `--profile work` CLI flag (on the subcommand)
2. `APPLE_PIM_PROFILE=work` environment variable
3. No profile — base config only

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

This profile restricts calendar access to just "Work", disables mail entirely, and inherits reminders and contacts settings from the base config.

### Multi-Agent / Multi-Workspace Setup

When running multiple agents (e.g., via [OpenClaw](https://github.com/AnttiHamalaworkclaw), Claude Code teams, or separate workspace sessions), each agent can have its own profile with isolated access to your PIM data. This prevents a travel-planning agent from seeing your work calendar, or a work agent from accessing personal reminders.

#### Step 1: Create the base config

The base config defines the superset of access. All profiles inherit from it.

```bash
# Auto-discover your calendars and reminder lists
calendar-cli config init
```

Then create `~/.config/apple-pim/config.json` with everything enabled:

```json
{
  "calendars": {
    "enabled": true,
    "mode": "all",
    "items": []
  },
  "reminders": {
    "enabled": true,
    "mode": "all",
    "items": []
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

#### Step 2: Create profiles for each agent

```
~/.config/apple-pim/profiles/
├── personal.json     # Personal assistant agent
├── travel.json       # Travel planning agent
├── work.json         # Work/productivity agent
└── family.json       # Family coordination agent
```

**`personal.json`** — Full personal access, no work calendar:
```json
{
  "calendars": {
    "enabled": true,
    "mode": "blocklist",
    "items": ["Work", "9th Grade Calendar"]
  },
  "default_calendar": "Personal"
}
```

**`travel.json`** — Only travel-related calendars and reminders:
```json
{
  "calendars": {
    "enabled": true,
    "mode": "allowlist",
    "items": ["Travel", "Flighty", "NetJets Itinerary"]
  },
  "reminders": {
    "enabled": true,
    "mode": "allowlist",
    "items": ["Travel"]
  },
  "mail": {
    "enabled": false
  },
  "contacts": {
    "enabled": false
  },
  "default_calendar": "Travel",
  "default_reminder_list": "Travel"
}
```

**`work.json`** — Work calendar only, no personal data:
```json
{
  "calendars": {
    "enabled": true,
    "mode": "allowlist",
    "items": ["Work"]
  },
  "reminders": {
    "enabled": true,
    "mode": "allowlist",
    "items": ["Work"]
  },
  "contacts": {
    "enabled": true,
    "mode": "all",
    "items": []
  },
  "mail": {
    "enabled": false
  },
  "default_calendar": "Work",
  "default_reminder_list": "Work"
}
```

#### Step 3: Assign profiles to agents

**Option A: Environment variable** (recommended for multi-agent orchestration)

Set `APPLE_PIM_PROFILE` in each agent's environment. The MCP server and CLIs will pick it up automatically.

```bash
# In your orchestrator / workspace config
APPLE_PIM_PROFILE=travel   # for the travel agent workspace
APPLE_PIM_PROFILE=work     # for the work agent workspace
APPLE_PIM_PROFILE=personal # for the personal assistant workspace
```

For OpenClaw or similar multi-workspace tools, set this in each workspace's environment variables or `.env` file.

**Option B: CLI flag** (for direct CLI usage or testing)

```bash
# Each command specifies its profile
calendar-cli list --profile travel
reminder-cli items --profile work
calendar-cli config show --profile personal
```

**Option C: Project-level CLAUDE.md** (for Claude Code workspaces)

Add to the workspace's `CLAUDE.md`:

```markdown
## PIM Configuration

When using Apple PIM tools, always pass `--profile travel` to CLI commands.
This workspace should only access travel-related calendars and reminders.
```

#### Step 4: Verify isolation

Confirm each profile sees only its allowed data:

```bash
# Personal sees everything except Work
calendar-cli list --profile personal | jq '.calendars[].title'

# Travel sees only travel calendars
calendar-cli list --profile travel | jq '.calendars[].title'

# Work sees only Work calendar
calendar-cli list --profile work | jq '.calendars[].title'
```

#### How profile inheritance works

Profiles use **whole-section replacement**, not field-level merge:

| Base config | Profile | Result |
|-------------|---------|--------|
| `calendars: {mode: "all"}` | `calendars: {mode: "allowlist", items: ["Work"]}` | Profile's calendars config used entirely |
| `reminders: {mode: "allowlist", items: ["A", "B"]}` | *(not specified)* | Base's reminders config inherited |
| `default_calendar: "Personal"` | `default_calendar: "Work"` | Profile's default used |
| `mail: {enabled: true}` | `mail: {enabled: false}` | Mail disabled for this profile |

This means if a profile specifies `calendars`, it replaces the *entire* calendars section (mode + items), not just individual fields within it.

### Domain Enable/Disable

Set `enabled: false` on any domain to disable it. When disabled, CLI commands for that domain return an access denied error.

### Filter Modes

- **allowlist**: Only listed calendars/lists are accessible
- **blocklist**: All EXCEPT listed items are accessible
- **all**: No filtering (default if no config file exists)

Calendar and reminder list names are matched with emoji-stripping — a config item `"Personal"` matches a calendar named `"Personal"` in the system.

### Notes

- Config is read fresh on each CLI invocation — changes take effect immediately
- No config file = all domains enabled, all items accessible (backwards compatible)
- Write operations to blocked calendars/lists fail with a descriptive error message
- Profile names are validated — path traversal attempts are rejected

## Usage

### Commands

#### `/apple-pim:calendars`

Manage calendar events.

```
/apple-pim:calendars list                    # List all calendars
/apple-pim:calendars events                  # Events for next 7 days
/apple-pim:calendars events --from today --to "next week"
/apple-pim:calendars search "team meeting"
/apple-pim:calendars create --title "Lunch" --start "tomorrow 12pm" --duration 60
```

#### `/apple-pim:reminders`

Manage reminders.

```
/apple-pim:reminders lists                   # List all reminder lists
/apple-pim:reminders items                   # Show incomplete reminders
/apple-pim:reminders items --list "Personal" --completed
/apple-pim:reminders create --title "Buy groceries" --due "tomorrow 5pm"
/apple-pim:reminders complete --id <id>
```

#### `/apple-pim:contacts`

Manage contacts.

```
/apple-pim:contacts groups                   # List contact groups
/apple-pim:contacts search "John"
/apple-pim:contacts get --id <id>
/apple-pim:contacts create --name "Jane Doe" --email "jane@example.com" --birthday "1990-03-15"
```

#### `/apple-pim:mail`

Manage Apple Mail.app messages. Requires Mail.app to be running.

```
/apple-pim:mail accounts                     # List mail accounts
/apple-pim:mail mailboxes                    # List mailboxes with counts
/apple-pim:mail messages --mailbox INBOX     # List recent messages
/apple-pim:mail messages --filter unread     # Unread messages only
/apple-pim:mail search "invoice"             # Search by subject/sender/content
/apple-pim:mail get --id <message-id>        # Read full message
/apple-pim:mail get --id <message-id> --format markdown  # Convert HTML-heavy emails to markdown
/apple-pim:mail move --id <id> --to-mailbox Archive
```

### Natural Language (via Agent)

The `pim-assistant` agent triggers proactively for natural language requests:

- "What's on my calendar tomorrow?"
- "Schedule a meeting with the team for next Tuesday at 2pm"
- "Remind me to call the dentist tomorrow"
- "What's John's email address?"
- "Mark the grocery shopping reminder as done"
- "Check my inbox for unread messages"
- "Search my email for the shipping confirmation"

## MCP Tools

The plugin exposes 38 MCP tools:

| Category | Tools | Count |
|----------|-------|-------|
| **Calendar** | `calendar_list`, `calendar_events`, `calendar_get`, `calendar_search`, `calendar_create`, `calendar_update`, `calendar_delete`, `calendar_batch_create` | 8 |
| **Reminders** | `reminder_lists`, `reminder_items`, `reminder_get`, `reminder_search`, `reminder_create`, `reminder_complete`, `reminder_update`, `reminder_delete`, `reminder_batch_create`, `reminder_batch_complete`, `reminder_batch_delete` | 11 |
| **Contacts** | `contact_groups`, `contact_list`, `contact_search`, `contact_get`, `contact_create`, `contact_update`, `contact_delete` (birthday support in create/update/get) | 7 |
| **Mail** | `mail_accounts`, `mail_mailboxes`, `mail_messages`, `mail_get`, `mail_search`, `mail_update`, `mail_move`, `mail_delete`, `mail_batch_update`, `mail_batch_delete` | 10 |
| **PIM** | `pim_status`, `pim_authorize` | 2 |

### Recurrence Rules

Create recurring events and reminders with the `recurrence` parameter:

```json
{
  "frequency": "weekly",
  "interval": 1,
  "daysOfTheWeek": ["monday", "wednesday", "friday"],
  "endDate": "2025-12-31"
}
```

**Supported frequencies**: `daily`, `weekly`, `monthly`, `yearly`

**End conditions** (optional):
- `endDate`: Stop repeating after this date (ISO format)
- `occurrenceCount`: Stop after N occurrences

**Weekly patterns**: Use `daysOfTheWeek` array (e.g., `["monday", "wednesday"]`)

**Monthly patterns**: Use `daysOfTheMonth` array (e.g., `[1, 15]` for 1st and 15th)

### Batch Operations

Create multiple events or reminders efficiently with `calendar_batch_create` and `reminder_batch_create`:

```json
{
  "events": [
    {"title": "Standup", "start": "2025-01-27 09:00"},
    {"title": "Team Sync", "start": "2025-01-27 14:00"},
    {"title": "Review", "start": "2025-01-27 16:00"}
  ]
}
```

Batch operations commit all changes in a single transaction, improving performance for bulk operations.

## Architecture

The MCP server is a thin pass-through — it defines tool schemas and maps MCP tool calls to CLI arguments. All access control, filtering, and default resolution is handled by the Swift CLIs via the shared `PIMConfig` library.

```
apple-pim/
├── swift/                    # Native Swift CLI tools
│   ├── Sources/
│   │   ├── PIMConfig/        # Shared config library (filtering, profiles, validation)
│   │   ├── CalendarCLI/      # EventKit calendar operations
│   │   ├── ReminderCLI/      # EventKit reminder operations
│   │   ├── ContactsCLI/      # Contacts framework operations
│   │   └── MailCLI/          # Mail.app via JXA (osascript)
│   ├── Tests/
│   │   ├── PIMConfigTests/   # Config filtering, profile merging, security tests
│   │   ├── CalendarCLITests/ # Event parsing, recurrence, batch validation
│   │   ├── ReminderCLITests/ # Reminder parsing, recurrence
│   │   ├── ContactsCLITests/ # Contact parsing helpers
│   │   └── MailCLITests/     # JXA script generation
│   └── Package.swift
├── mcp-server/               # Node.js MCP server wrapper
│   ├── server.js             # Tool schemas + CLI argument mapping
│   ├── tool-args.js          # Argument builder functions
│   └── package.json
├── commands/                 # Slash commands
├── agents/                   # pim-assistant agent
├── skills/                   # EventKit knowledge
└── setup.sh                  # Build script
```

## Troubleshooting

### Permission Denied

If you get permission errors, check System Settings > Privacy & Security:
- **Calendars**: Ensure Terminal/Claude Code has access
- **Reminders**: Ensure Terminal/Claude Code has access
- **Contacts**: Ensure Terminal/Claude Code has access

You may need to restart Claude Code after granting permissions.

### Mail.app Issues

- **Mail.app must be running** — the plugin does not launch it automatically. Open Mail.app before using mail commands.
- **Automation permission** — System Settings > Privacy & Security > Automation: allow Terminal (or your IDE) to control Mail.app.
- **30-second timeout** — JXA scripts have a 30-second timeout. Large mailbox operations may time out; use `--limit` to reduce result count.
- **Message IDs** — Mail tools use RFC 2822 `messageId` (stable across moves), not Mail.app internal IDs. Pass `--mailbox` and `--account` hints from prior search results to speed up lookups.

### MCP Server Not Connecting

1. Ensure you ran `./setup.sh` to install npm dependencies
2. Check `/mcp` in Claude Code to see server status
3. Restart Claude Code after installing the plugin

### CLI Not Found

Ensure you've built the Swift package by running setup.sh, or manually:
```bash
cd ~/.claude/plugins/cache/apple-pim/apple-pim/*/swift
swift build -c release
```

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

# Calendar
./calendar-cli list
./calendar-cli events --from today --to tomorrow
./calendar-cli search "meeting"

# Create a weekly recurring event
./calendar-cli create --title "Team Standup" --start "2025-01-27 09:00" \
  --recurrence '{"frequency":"weekly","daysOfTheWeek":["monday","wednesday","friday"]}'

# Batch create multiple events
./calendar-cli batch-create --json '[
  {"title":"Task 1","start":"2025-01-27 10:00"},
  {"title":"Task 2","start":"2025-01-27 11:00"}
]'

# Reminders
./reminder-cli lists
./reminder-cli items --list "Personal"
./reminder-cli create --title "Test" --due "tomorrow"

# Create a monthly recurring reminder
./reminder-cli create --title "Pay Rent" --due "2025-02-01" \
  --recurrence '{"frequency":"monthly","interval":1}'

# Batch create multiple reminders
./reminder-cli batch-create --json '[
  {"title":"Buy groceries"},
  {"title":"Call mom","priority":1}
]'

# Contacts
./contacts-cli search "John"
./contacts-cli groups
./contacts-cli create --name "Jane Doe" --email "jane@example.com" --birthday "1990-03-15"
./contacts-cli create --name "Baby Doe" --birthday "03-15"  # birthday without year

# Mail (requires Mail.app to be running)
./mail-cli accounts
./mail-cli mailboxes
./mail-cli messages --mailbox INBOX --limit 10
./mail-cli messages --filter unread
./mail-cli search "invoice" --field subject
./mail-cli get --id "<message-id>"
```

### Using Profiles

```bash
# Use a named profile (flag goes on the subcommand)
calendar-cli list --profile work
calendar-cli events --profile travel --from today --to tomorrow
reminder-cli items --profile personal

# Or set via environment variable
export APPLE_PIM_PROFILE=work
calendar-cli events --from today --to tomorrow

# View effective config for a profile
calendar-cli config show --profile travel
```

### Rebuilding After Changes

```bash
# Swift CLIs
cd swift && swift build -c release

# MCP server bundle (after editing server.js or tool-args.js)
cd mcp-server && npm run build
```

## License

MIT
