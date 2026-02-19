---
description: Configure which domains, calendars, and reminder lists the plugin can access
allowed-tools:
  - mcp__apple-pim__pim_status
  - mcp__apple-pim__pim_authorize
  - mcp__apple-pim__pim_config_show
  - mcp__apple-pim__pim_config_init
  - Write
  - Read
  - AskUserQuestion
---

# Configure Apple PIM Access

Help the user configure which domains, calendars, and reminder lists the apple-pim plugin can access.

**Tip:** If you encounter permission errors during configuration, use `/apple-pim:authorize` to check and request macOS permissions first.

## Configuration Location

The config file is at `~/.config/apple-pim/config.json` (JSON format).
The Swift CLIs read this file directly via the `PIMConfig` library.
**Do NOT write to any plugin cache directory or use YAML/markdown format.**

## Process

1. **Check permissions** with `pim_config_show` to see current config and `pim_status` for macOS access
   - If any domain shows `notDetermined`, run `pim_authorize` to trigger prompts
   - If any domain shows `denied`, warn the user and guide to System Settings
2. **Discover available items** with `pim_config_init` — this lists ALL calendars and reminder lists from macOS
3. **Read existing config** from `~/.config/apple-pim/config.json` if it exists
4. **Ask which domains to enable** (Calendars, Reminders, Contacts, Mail) — multi-select
5. **For enabled domains with filtering** (Calendars, Reminders):
   - Use the discovery data from `pim_config_init` (do NOT call `calendar_list` — that returns filtered results)
   - Ask user which to allow
6. **Set defaults** for new events/reminders
7. **Write config file** as JSON to `~/.config/apple-pim/config.json`
8. **Confirm changes** are effective immediately (no restart needed)

## Configuration File Format

Write the config file as JSON to `~/.config/apple-pim/config.json`:

```json
{
  "calendars": {
    "enabled": true,
    "mode": "allowlist",
    "items": ["Calendar Name 1", "Calendar Name 2"]
  },
  "reminders": {
    "enabled": true,
    "mode": "allowlist",
    "items": ["List Name 1", "List Name 2"]
  },
  "contacts": {
    "enabled": true,
    "mode": "all",
    "items": []
  },
  "mail": {
    "enabled": true
  },
  "default_calendar": "Calendar Name",
  "default_reminder_list": "List Name"
}
```

### Field Reference

- **mode**: `"all"` (no filtering), `"allowlist"` (only listed items), `"blocklist"` (all except listed)
- **items**: Array of calendar/list names to allow or block (only used when mode is allowlist or blocklist)
- **enabled**: `true`/`false` to enable/disable an entire domain
- **default_calendar**: Name of the calendar for new events when none specified
- **default_reminder_list**: Name of the list for new reminders when none specified

## Workflow

1. Call `pim_config_show` and `pim_config_init` in parallel to get current config AND available items
2. Read `~/.config/apple-pim/config.json` if it exists (for preserving user choices)
3. **Ask domain enable/disable first** using AskUserQuestion with multi-select:
   - Present all 4 domains: Calendars, Reminders, Contacts, Mail
   - Default to all enabled (or preserve existing settings)
   - This is important for users who have Fastmail MCP and want to disable mail here
4. For enabled domains that support filtering (calendars, reminders):
   - Use the `pim_config_init` results (these show ALL items, unfiltered)
   - **Plan the questions carefully:**
     - AskUserQuestion allows max 4 options per question
     - Calculate how many questions needed: `ceil(item_count / 4)`
     - **CRITICAL: Create a checklist of ALL items and verify each one is assigned to a question**
     - Group logically (e.g., personal calendars, subscriptions, work-related)
   - Ask the user:
     - First ask: "All items" vs "Select specific" to simplify if user wants everything
     - If selecting specific: present ALL calendars across multiple questions (multi-select)
     - Present ALL reminder lists across multiple questions (multi-select)
     - Which calendar should be the default for new events?
     - Which list should be the default for new reminders?
5. **Verify before writing:** Double-check that user was asked about every calendar and reminder list
6. Write JSON to `~/.config/apple-pim/config.json` using the Write tool
7. Display a summary (changes take effect immediately — CLIs read config on every invocation)

## Important: Use pim_config_init, NOT calendar_list

- `pim_config_init` returns ALL calendars and reminder lists from macOS (unfiltered) — use this for discovery
- `calendar_list` returns only calendars allowed by the CURRENT config — do NOT use this for configuration
- Using `calendar_list` would miss calendars the user previously blocked, making them impossible to re-enable

## Important: Preventing Missed Items

Before presenting options to the user, explicitly list out:
- Total number of calendars found: X
- Total number of reminder lists found: Y
- Questions needed for calendars: ceil(X/4)
- Questions needed for reminders: ceil(Y/4)

Then verify your questions cover all items. Missing items means the user can't configure them!
