---
description: Manage macOS calendar events - list, search, create, update, delete
argument-hint: "[list|events|search|create|update|delete] [options]"
allowed-tools:
  - mcp__apple-pim__calendar_list
  - mcp__apple-pim__calendar_events
  - mcp__apple-pim__calendar_search
  - mcp__apple-pim__calendar_create
  - mcp__apple-pim__calendar_update
  - mcp__apple-pim__calendar_delete
---

# Calendar Management

Manage calendar events using the Apple EventKit framework.

## Available Operations

When the user runs this command, determine which operation they need and use the appropriate MCP tool:

### List Calendars
Use `calendar_list` to show all available calendars with their IDs and names.

### List Events
Use `calendar_events` to list events within a date range:
- Default: today through next 7 days
- Parameters: `calendar` (filter by calendar), `from` (start date), `to` (end date), `limit`

### Search Events
Use `calendar_search` to find events by title, notes, or location:
- Required: `query` (search term)
- Optional: `calendar`, `from`, `to`, `limit`

### Create Event
Use `calendar_create` to create a new event:
- Required: `title`, `start` (date/time)
- Optional: `end` OR `duration` (minutes), `calendar`, `location`, `notes`, `allDay`, `alarm` (minutes before)

### Update Event
Use `calendar_update` to modify an existing event:
- Required: `id` (event ID from list/search)
- Optional: `title`, `start`, `end`, `location`, `notes`

### Delete Event
Use `calendar_delete` to remove an event:
- Required: `id` (event ID)

## Date Formats

Accept flexible date formats:
- ISO: `2024-01-15T14:30:00`
- Date/time: `2024-01-15 14:30`
- Date only: `2024-01-15`
- Natural language: `today`, `tomorrow`, `next week`

## Examples

**List calendars:**
```
/apple-pim:calendars list
```

**List upcoming events:**
```
/apple-pim:calendars events
/apple-pim:calendars events --from tomorrow --to "next week"
```

**Search for events:**
```
/apple-pim:calendars search "team meeting"
/apple-pim:calendars search standup --calendar Work
```

**Create an event:**
```
/apple-pim:calendars create "Lunch with John" --start "tomorrow 12pm" --duration 60
/apple-pim:calendars create "All Hands" --start "2024-01-20 10:00" --end "2024-01-20 11:00" --calendar Work --location "Conference Room A"
```

**Update an event:**
```
/apple-pim:calendars update --id <event_id> --title "Updated Title"
```

**Delete an event:**
```
/apple-pim:calendars delete --id <event_id>
```

## Parsing User Intent

When a user provides natural language, map to the appropriate operation:
- "Show my calendar" → `calendar_events` with default date range
- "What meetings do I have tomorrow?" → `calendar_events` with from/to set to tomorrow
- "Find the dentist appointment" → `calendar_search` with query "dentist"
- "Schedule a meeting with Sarah" → `calendar_create` (may need to ask for details)
- "Cancel my 3pm meeting" → First `calendar_search`, then `calendar_delete`
