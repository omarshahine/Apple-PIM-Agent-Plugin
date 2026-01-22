---
description: Configure which calendars and reminder lists the plugin can access
allowed-tools:
  - mcp__plugin_apple-pim_apple-pim__calendar_list
  - mcp__plugin_apple-pim_apple-pim__reminder_lists
  - Write
  - Read
  - AskUserQuestion
---

# Configure Apple PIM Access

Help the user configure which calendars and reminder lists the apple-pim plugin can access.

## Process

1. **List available calendars and reminder lists** using the MCP tools
2. **Read existing config** from `~/.claude/apple-pim.local.md` if it exists
3. **Ask user which to allow** using AskUserQuestion with multi-select options
4. **Write config file** to `~/.claude/apple-pim.local.md`
5. **Remind user to restart** Claude Code for changes to take effect

## Configuration File Format

Write the config file in this exact format:

```yaml
---
calendars:
  mode: allowlist  # allowlist | blocklist | all
  items:
    - "Calendar Name 1"
    - "Calendar Name 2"
reminders:
  mode: allowlist
  items:
    - "List Name 1"
    - "List Name 2"
contacts:
  mode: all
default_calendar: "Calendar Name"
default_reminder_list: "List Name"
---

# Apple PIM Configuration

This file controls which calendars and reminder lists Claude Code can access.

## Modes

- **allowlist**: Only the listed items are accessible
- **blocklist**: All items EXCEPT the listed ones are accessible
- **all**: All items are accessible (default)

## Defaults

The `default_calendar` and `default_reminder_list` settings specify where new
events and reminders are created when no specific calendar/list is specified.

## Changes

Edit this file to modify access. Restart Claude Code after changes.
```

## Workflow

1. First, call `calendar_list` and `reminder_lists` to get available options
2. Check if `~/.claude/apple-pim.local.md` exists and read current settings
3. **Plan the questions carefully:**
   - AskUserQuestion allows max 4 options per question
   - Calculate how many questions needed: `ceil(item_count / 4)`
   - **CRITICAL: Create a checklist of ALL items and verify each one is assigned to a question**
   - Group logically (e.g., personal calendars, subscriptions, work-related)
4. Ask the user:
   - First ask: "All items" vs "Select specific" to simplify if user wants everything
   - If selecting specific: present ALL calendars across multiple questions (multi-select)
   - Present ALL reminder lists across multiple questions (multi-select)
   - Which calendar should be the default for new events?
   - Which list should be the default for new reminders?
5. **Verify before writing:** Double-check that user was asked about every calendar and reminder list
6. Write the configuration file
7. Display a summary and remind user to restart Claude Code

## Important: Preventing Missed Items

Before presenting options to the user, explicitly list out:
- Total number of calendars found: X
- Total number of reminder lists found: Y
- Questions needed for calendars: ceil(X/4)
- Questions needed for reminders: ceil(Y/4)

Then verify your questions cover all items. Missing items means the user can't configure them!
