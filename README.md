# Apple PIM Plugin for Claude Code

Native macOS integration for Calendar, Reminders, and Contacts using EventKit and Contacts frameworks.

## Features

- **Calendar Management**: List calendars, create/read/update/delete events, search by date/title
- **Reminder Management**: List reminder lists, create/complete/update/delete reminders, search
- **Contact Management**: List groups, create/read/update/delete contacts, search by name/email/phone
- **Recurrence Rules**: Create recurring events and reminders (daily, weekly, monthly, yearly)
- **Batch Operations**: Create multiple events or reminders in a single efficient transaction
- **Proactive Agent**: The `pim-assistant` agent triggers automatically when you mention scheduling, reminders, or contacts

## Prerequisites

- macOS 13.0 or later
- Swift 5.9 or later (comes with Xcode 15+)
- Node.js 18+ (for MCP server)

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

## Configuration

You can optionally restrict which calendars and reminder lists the plugin can access. This is useful for privacy or to reduce noise from calendars you don't need Claude to see.

### Interactive Setup

Run the configure command to interactively set up access:

```
/apple-pim:configure
```

This will:
1. List your available calendars and reminder lists
2. Let you select which ones to allow
3. Set default calendars for new events/reminders
4. Write the config file

### Manual Configuration

Create `~/.claude/apple-pim.local.md` with YAML frontmatter:

```yaml
---
calendars:
  mode: allowlist  # allowlist | blocklist | all
  items:
    - "Personal"
    - "Work"
reminders:
  mode: allowlist
  items:
    - "Reminders"
    - "Shopping"
contacts:
  mode: all
default_calendar: "Personal"
default_reminder_list: "Reminders"
---

# Apple PIM Configuration
```

### Configuration Options

| Option | Values | Description |
|--------|--------|-------------|
| `mode` | `allowlist`, `blocklist`, `all` | How to filter items |
| `items` | List of names | Calendar/list names to allow or block |
| `default_calendar` | Calendar name | Where new events are created |
| `default_reminder_list` | List name | Where new reminders are created |

### Modes

- **allowlist**: Only listed calendars/lists are accessible
- **blocklist**: All EXCEPT listed items are accessible
- **all**: No filtering (default if no config file exists)

### Notes

- Config is read when Claude Code starts - restart after changes
- No config file = all calendars/lists accessible (backwards compatible)
- Write operations to blocked calendars fail with a helpful error message

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
/apple-pim:contacts create --name "Jane Doe" --email "jane@example.com"
```

### Natural Language (via Agent)

The `pim-assistant` agent triggers proactively for natural language requests:

- "What's on my calendar tomorrow?"
- "Schedule a meeting with the team for next Tuesday at 2pm"
- "Remind me to call the dentist tomorrow"
- "What's John's email address?"
- "Mark the grocery shopping reminder as done"

## MCP Tools

The plugin exposes 24 MCP tools:

| Category | Tools |
|----------|-------|
| **Calendar** | `calendar_list`, `calendar_events`, `calendar_get`, `calendar_search`, `calendar_create`, `calendar_update`, `calendar_delete`, `calendar_batch_create` |
| **Reminders** | `reminder_lists`, `reminder_items`, `reminder_get`, `reminder_search`, `reminder_create`, `reminder_complete`, `reminder_update`, `reminder_delete`, `reminder_batch_create` |
| **Contacts** | `contact_groups`, `contact_list`, `contact_search`, `contact_get`, `contact_create`, `contact_update`, `contact_delete` |

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

```
apple-pim/
├── swift/                    # Native Swift CLI tools
│   ├── Sources/
│   │   ├── CalendarCLI/      # EventKit calendar operations
│   │   ├── ReminderCLI/      # EventKit reminder operations
│   │   └── ContactsCLI/      # Contacts framework operations
│   └── Package.swift
├── mcp-server/               # Node.js MCP server wrapper
│   ├── server.js             # Shells out to Swift CLIs
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
```

### Rebuilding After Changes

```bash
cd swift && swift build -c release
```

## License

MIT
