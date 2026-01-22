---
description: Manage macOS reminders - list, search, create, complete, update, delete
argument-hint: "[lists|items|search|create|complete|update|delete] [options]"
allowed-tools:
  - mcp__apple-pim__reminder_lists
  - mcp__apple-pim__reminder_items
  - mcp__apple-pim__reminder_search
  - mcp__apple-pim__reminder_create
  - mcp__apple-pim__reminder_complete
  - mcp__apple-pim__reminder_update
  - mcp__apple-pim__reminder_delete
---

# Reminder Management

Manage reminders using the Apple EventKit framework.

## Available Operations

When the user runs this command, determine which operation they need and use the appropriate MCP tool:

### List Reminder Lists
Use `reminder_lists` to show all available reminder lists with their IDs.

### List Reminders
Use `reminder_items` to list reminders:
- Optional: `list` (filter by list), `completed` (include completed), `limit`
- Default: shows incomplete reminders from all lists

### Search Reminders
Use `reminder_search` to find reminders by title or notes:
- Required: `query` (search term)
- Optional: `list`, `completed`, `limit`

### Create Reminder
Use `reminder_create` to create a new reminder:
- Required: `title`
- Optional: `list`, `due` (date/time), `notes`, `priority` (0=none, 1=high, 5=medium, 9=low), `alarm`

### Complete Reminder
Use `reminder_complete` to mark a reminder as done:
- Required: `id` (reminder ID)
- Optional: `undo` (mark as incomplete)

### Update Reminder
Use `reminder_update` to modify an existing reminder:
- Required: `id` (reminder ID)
- Optional: `title`, `due`, `notes`, `priority`

### Delete Reminder
Use `reminder_delete` to remove a reminder:
- Required: `id` (reminder ID)

## Priority Levels

- 0 = None (default)
- 1 = High (! in Reminders app)
- 5 = Medium (!!)
- 9 = Low (!!!)

## Examples

**List reminder lists:**
```
/apple-pim:reminders lists
```

**List reminders:**
```
/apple-pim:reminders items
/apple-pim:reminders items --list "Shopping"
/apple-pim:reminders items --completed
```

**Search reminders:**
```
/apple-pim:reminders search "groceries"
```

**Create a reminder:**
```
/apple-pim:reminders create "Buy milk"
/apple-pim:reminders create "Call dentist" --due "tomorrow 9am" --list "Personal"
/apple-pim:reminders create "Submit report" --due "Friday 5pm" --priority 1
```

**Complete a reminder:**
```
/apple-pim:reminders complete --id <reminder_id>
/apple-pim:reminders complete --id <reminder_id> --undo
```

**Update a reminder:**
```
/apple-pim:reminders update --id <reminder_id> --due "next Monday"
```

**Delete a reminder:**
```
/apple-pim:reminders delete --id <reminder_id>
```

## Parsing User Intent

When a user provides natural language, map to the appropriate operation:
- "What do I need to do?" → `reminder_items`
- "Show my shopping list" → `reminder_items` with list="Shopping"
- "Remind me to call mom" → `reminder_create` with title "Call mom"
- "Remind me to buy flowers tomorrow" → `reminder_create` with title and due date
- "Mark the milk reminder as done" → First `reminder_search` for "milk", then `reminder_complete`
- "I finished the report" → Infer reminder, then `reminder_complete`
