---
description: Configure, authorize, or check status of Apple PIM access
argument-hint: "[--authorize [domain] | --status | --setup]"
allowed-tools:
  - mcp__plugin_apple-pim_apple-pim__calendar_list
  - mcp__plugin_apple-pim_apple-pim__reminder_lists
  - mcp__plugin_apple-pim_apple-pim__contact_list
  - Write
  - Read
  - Glob
  - AskUserQuestion
---

# Configure Apple PIM Access

Configure, authorize, or check status of Apple PIM plugin access.

## Usage

```
/apple-pim:configure                    # Full interactive configuration
/apple-pim:configure --authorize        # Trigger macOS permission prompts for all domains
/apple-pim:configure --authorize reminders  # Authorize reminders only
/apple-pim:configure --authorize calendars  # Authorize calendars only
/apple-pim:configure --authorize contacts   # Authorize contacts only
/apple-pim:configure --status           # Show current config and permission status
/apple-pim:configure --setup            # Quick first-time setup (authorize + configure)
```

## Route by Flag

Check the arguments passed to this command and route accordingly:

```
IF --authorize:
  → Go to "Authorize Mode"
IF --status:
  → Go to "Status Mode"
IF --setup:
  → Go to "Setup Mode"
ELSE (no flags or just --configure):
  → Go to "Configure Mode" (full interactive)
```

---

## Authorize Mode (`--authorize [domain]`)

Trigger macOS permission prompts by calling MCP tools that invoke the underlying Swift CLIs.
Each CLI call automatically requests EventKit/Contacts access from macOS.

**How it works:** The Swift CLIs (calendar-cli, reminder-cli, contacts-cli) call
`requestFullAccessToEvents()` / `requestFullAccessToReminders()` / `requestAccess(for: .contacts)`
on first invocation. macOS then shows the system permission dialog.

### If a specific domain is given:

```
--authorize calendars  → Call calendar_list only
--authorize reminders  → Call reminder_lists only
--authorize contacts   → Call contact_list only
```

### If no domain specified (`--authorize` alone):

Call ALL THREE in parallel:
1. `mcp__plugin_apple-pim_apple-pim__calendar_list`
2. `mcp__plugin_apple-pim_apple-pim__reminder_lists`
3. `mcp__plugin_apple-pim_apple-pim__contact_list`

### Report results:

For each domain, report success or failure:

```
Apple PIM Authorization
-----------------------
Calendars:  [granted] Found X calendars
Reminders:  [granted] Found X lists
Contacts:   [denied]  Grant access in System Settings > Privacy & Security > Contacts

If any domain was denied, the terminal app running Claude Code needs
permission in System Settings > Privacy & Security > [Domain].
```

**Note:** Mail.app uses JXA (JavaScript for Automation), not EventKit. It doesn't have
a separate authorization prompt — it uses macOS Automation permissions which are
triggered automatically when the mail-cli runs osascript.

---

## Status Mode (`--status`)

Show current configuration and live permission status.

1. **Find and read config** (see "Finding the Plugin Path" below)
2. **Test each enabled domain** by calling its list MCP tool
3. **Report:**

```
Apple PIM Status
----------------
Config: ~/.claude/plugins/cache/.../data/config.local.md

DOMAIN       ENABLED  PERMISSION  MODE        ITEMS
Calendars    yes      granted     allowlist   12 allowed of 18
Reminders    yes      granted     allowlist   4 allowed of 8
Contacts     yes      granted     all         -
Mail         no       -           -           -

Defaults:
  Calendar:      Personal
  Reminder List: Reminders
```

If a domain is enabled but permission is denied, highlight it:
```
Reminders    yes      DENIED      allowlist   Fix: System Settings > Privacy & Security > Reminders
```

---

## Setup Mode (`--setup`)

Quick first-time setup that combines authorize + configure:

1. **Authorize all domains** (same as `--authorize`)
2. **For each authorized domain**, immediately proceed to configuration:
   - Ask which items to allow (same as Configure Mode steps 3-4)
3. **Write config file**
4. **Show status summary**

This is the recommended flow for new installs.

---

## Configure Mode (default — full interactive)

### Finding the Plugin Path

First, locate the plugin directory by searching for the plugin.json file:
```
Glob: ~/.claude/plugins/**/apple-pim/**/plugin.json
```

The config file goes in the `data/` folder next to where `plugin.json` is found.
For example, if plugin.json is at `~/.claude/plugins/cache/marketplace/apple-pim/2.1.0/.claude-plugin/plugin.json`,
the config file goes at `~/.claude/plugins/cache/marketplace/apple-pim/2.1.0/.claude-plugin/data/config.local.md`.

### Process

1. **Find plugin path** using Glob to locate plugin.json
2. **Read existing config** from `<plugin_path>/data/config.local.md` if it exists
3. **Ask which domains to enable** (Calendars, Reminders, Contacts, Mail) — multi-select
4. **For enabled domains with filtering** (Calendars, Reminders):
   - List available items using MCP tools
   - Ask user which to allow
5. **Set defaults** for new events/reminders
6. **Write config file** to `<plugin_path>/data/config.local.md`
7. **Confirm changes** are effective immediately (no restart needed)

### Configuration File Format

Write the config file in this exact format:

```yaml
---
calendars:
  enabled: true
  mode: allowlist  # allowlist | blocklist | all
  items:
    - "Calendar Name 1"
    - "Calendar Name 2"
reminders:
  enabled: true
  mode: allowlist
  items:
    - "List Name 1"
    - "List Name 2"
contacts:
  enabled: true
  mode: all
mail:
  enabled: true
default_calendar: "Calendar Name"
default_reminder_list: "List Name"
---

# Apple PIM Configuration

This file controls which domains and items Claude Code can access.

## Domains

Each domain (calendars, reminders, contacts, mail) can be enabled or disabled.
Set `enabled: false` to completely hide all tools for that domain.

## Filter Modes (Calendars, Reminders, Contacts)

- **allowlist**: Only the listed items are accessible
- **blocklist**: All items EXCEPT the listed ones are accessible
- **all**: All items are accessible (default)

## Defaults

The `default_calendar` and `default_reminder_list` settings specify where new
events and reminders are created when no specific calendar/list is specified.

## Changes

Edit this file to modify access. Changes take effect immediately.
```

### Interactive Workflow

1. First, read existing config if it exists
2. **Ask domain enable/disable first** using AskUserQuestion with multi-select:
   - Present all 4 domains: Calendars, Reminders, Contacts, Mail
   - Default to all enabled (or preserve existing settings)
   - This is important for users who have Fastmail MCP and want to disable mail here
3. For enabled domains that support filtering (calendars, reminders):
   - Call `calendar_list` and/or `reminder_lists` to get available options
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
4. **Verify before writing:** Double-check that user was asked about every calendar and reminder list
5. Write the configuration file with `enabled` flags for all 4 domains
6. Display a summary (changes take effect immediately)

### Important: Preventing Missed Items

Before presenting options to the user, explicitly list out:
- Total number of calendars found: X
- Total number of reminder lists found: Y
- Questions needed for calendars: ceil(X/4)
- Questions needed for reminders: ceil(Y/4)

Then verify your questions cover all items. Missing items means the user can't configure them!
