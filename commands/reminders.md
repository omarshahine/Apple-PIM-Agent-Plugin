---
description: Manage macOS reminders - list, search, create, complete, update, delete with filtering and batch operations
argument-hint: "[lists|items|search|create|complete|update|delete] [options]"
allowed-tools:
  - mcp__apple-pim__reminder_lists
  - mcp__apple-pim__reminder_items
  - mcp__apple-pim__reminder_search
  - mcp__apple-pim__reminder_create
  - mcp__apple-pim__reminder_complete
  - mcp__apple-pim__reminder_update
  - mcp__apple-pim__reminder_delete
  - mcp__apple-pim__reminder_batch_create
  - mcp__apple-pim__reminder_batch_complete
  - mcp__apple-pim__reminder_batch_delete
---

# Reminder Management

Manage reminders using the Apple EventKit framework.

## Available Operations

When the user runs this command, determine which operation they need and use the appropriate MCP tool:

### List Reminder Lists
Use `reminder_lists` to show all available reminder lists with their IDs.

### List Reminders
Use `reminder_items` to list reminders with optional filtering:
- Optional: `list` (filter by list), `limit`
- Optional: `filter` for date-based views:
  - `overdue` - Past due, incomplete reminders
  - `today` - Due today + overdue (most useful default)
  - `tomorrow` - Due tomorrow only
  - `week` - Due this calendar week
  - `upcoming` - All incomplete with due dates
  - `completed` - Finished reminders
  - `all` - Everything
- Default (no filter): shows incomplete reminders from all lists

### Search Reminders
Use `reminder_search` to find reminders by title or notes:
- Required: `query` (search term)
- Optional: `list`, `completed`, `limit`

### Create Reminder
Use `reminder_create` to create a new reminder:
- Required: `title`
- Optional: `list`, `due` (date/time), `notes`, `priority` (0=none, 1=high, 5=medium, 9=low), `url`, `alarm`, `location`, `recurrence`

### Complete Reminder
Use `reminder_complete` to mark a single reminder as done:
- Required: `id` (reminder ID)
- Optional: `undo` (mark as incomplete)

### Batch Complete
Use `reminder_batch_complete` to mark multiple reminders as done at once:
- Required: `ids` (array of reminder IDs)
- Optional: `undo` (mark as incomplete)

### Update Reminder
Use `reminder_update` to modify an existing reminder:
- Required: `id` (reminder ID)
- Optional: `title`, `due`, `notes`, `priority`, `url`, `location`, `recurrence`
- To clear a due date: set `due` to empty string
- To remove recurrence: set `recurrence.frequency` to `"none"`

### Delete Reminder
Use `reminder_delete` to remove a single reminder:
- Required: `id` (reminder ID)

### Batch Delete
Use `reminder_batch_delete` to remove multiple reminders at once:
- Required: `ids` (array of reminder IDs)

### Batch Create
Use `reminder_batch_create` to create multiple reminders in one operation:
- Required: `reminders` (array of reminder objects, each with at least `title`)

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

**List reminders with filters:**
```
/apple-pim:reminders items
/apple-pim:reminders items --list "Shopping"
/apple-pim:reminders items --filter overdue
/apple-pim:reminders items --filter today
/apple-pim:reminders items --filter week
/apple-pim:reminders items --filter completed
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
/apple-pim:reminders create "Buy groceries" --location {"name":"Home","latitude":37.33,"longitude":-122.03,"proximity":"arrive"}
/apple-pim:reminders create "Check docs" --url "https://example.com/docs"
```

**Complete a reminder:**
```
/apple-pim:reminders complete --id <reminder_id>
/apple-pim:reminders complete --id <reminder_id> --undo
```

**Batch complete multiple reminders:**
```
/apple-pim:reminders batch-complete --ids [<id1>, <id2>, <id3>]
```

**Update a reminder:**
```
/apple-pim:reminders update --id <reminder_id> --due "next Monday"
```

**Delete a reminder:**
```
/apple-pim:reminders delete --id <reminder_id>
```

**Batch delete multiple reminders:**
```
/apple-pim:reminders batch-delete --ids [<id1>, <id2>]
```

## Parsing User Intent

When a user provides natural language, map to the appropriate operation:
- "What do I need to do?" -> `reminder_items`
- "What's overdue?" -> `reminder_items` with filter "overdue"
- "What's due today?" -> `reminder_items` with filter "today"
- "What's coming up this week?" -> `reminder_items` with filter "week"
- "Show my shopping list" -> `reminder_items` with list="Shopping"
- "Show completed reminders" -> `reminder_items` with filter "completed"
- "Remind me to call mom" -> `reminder_create` with title "Call mom"
- "Remind me to buy flowers tomorrow" -> `reminder_create` with title and due date
- "Mark the milk reminder as done" -> First `reminder_search` for "milk", then `reminder_complete`
- "Mark all the groceries as done" -> Search, then `reminder_batch_complete` with all matching IDs
- "I finished the report" -> Infer reminder, then `reminder_complete`
- "Clear all completed reminders" -> `reminder_items` with filter "completed", then `reminder_batch_delete`
- "Remind me when I get home to take out the trash" -> `reminder_create` with title and location (proximity: "arrive")
- "Remind me when I leave the office to call mom" -> `reminder_create` with title and location (proximity: "depart")
