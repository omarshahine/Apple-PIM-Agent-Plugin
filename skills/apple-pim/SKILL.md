---
name: apple-pim
description: |
  Native macOS personal information management for calendars, reminders, contacts, and local Mail.app. Use when the user wants to schedule meetings, create events, check their calendar, create or complete reminders, look up contacts, find someone's phone number or email, manage tasks and to-do lists, triage local Mail.app messages, or troubleshoot EventKit, Contacts, or Mail.app permissions on macOS.
license: MIT
compatibility: |
  macOS only. Requires TCC permissions for Calendars, Reminders, and Contacts via Privacy & Security settings. Mail features require Mail.app running with Automation permission granted.
metadata:
  author: Omar Shahine
  version: 2.3.0
  mcp-server: apple-pim
---

# Apple PIM (EventKit, Contacts & Mail)

## Overview

Apple provides frameworks and scripting interfaces for personal information management:
- **EventKit**: Calendars and Reminders
- **Contacts**: Address book management
- **Mail.app**: Local email via JXA (JavaScript for Automation)

EventKit and Contacts require explicit user permission via privacy prompts. Mail.app requires Automation permission and must be running.

For detailed API property tables and code examples, see:
- `references/eventkit-api.md` — EKEvent, EKReminder, EKCalendar, recurrence rules, alarms
- `references/contacts-api.md` — CNContact, labeled values, groups
- `references/mail-jxa.md` — JXA message properties, batch fetching, Mail.app vs Fastmail scope

## Authorization & Permissions

### Permission Model

Each PIM domain requires separate macOS authorization:

| Domain | Framework | Permission Section |
|--------|-----------|-------------------|
| Calendars | EventKit | Privacy & Security > Calendars |
| Reminders | EventKit | Privacy & Security > Reminders |
| Contacts | Contacts | Privacy & Security > Contacts |
| Mail | Automation (JXA) | Privacy & Security > Automation |

### Authorization States

| State | Meaning | Action |
|-------|---------|--------|
| `notDetermined` | Never requested | Run `pim_authorize` to trigger prompt |
| `authorized` | Full access granted | Ready to use |
| `denied` | User refused access | Must enable in System Settings manually |
| `restricted` | System policy (MDM, parental) | Cannot override |
| `writeOnly` | Limited write access (macOS 17+) | Upgrade to Full Access in Settings |

### SSH Sessions

Permissions must be granted on the Mac where the CLI runs. SSH does not inherit GUI-level permission dialogs. Grant permissions locally first.

## Best Practices

### Calendar Management
1. **Use default calendar for new events** when user doesn't specify
2. **Preserve recurrence rules** when updating recurring events
3. **Handle `.thisEvent` vs `.futureEvents`** span for recurring event edits (see EKSpan below)
4. **Check `allowsContentModifications`** before attempting writes
5. **Use `calendar_batch_create`** when creating multiple events for efficiency

### EKSpan for Recurring Events

EventKit uses `EKSpan` to control which occurrences are affected by save/delete operations:

| Span | Effect | When to Use |
|------|--------|-------------|
| `.thisEvent` | Affects only the single occurrence | Default for delete and update. Use when cancelling one meeting. |
| `.futureEvents` | Affects this and all future occurrences | Use when ending a series or changing the pattern going forward. |

- **Delete**: Default is `.thisEvent`. Pass `--future-events` to use `.futureEvents`.
- **Update**: Default is `.thisEvent`. Pass `--future-events` to apply changes to all future occurrences.
- **Remove recurrence**: Pass `recurrence: { frequency: "none" }` with `--future-events` to convert a recurring event into a single event.

### Recurrence Output

When reading events/reminders, the `recurrence` array includes:
- `frequency`: daily, weekly, monthly, yearly
- `interval`: repeat every N periods
- `daysOfTheWeek`: which days (e.g., `["monday", "wednesday", "friday"]`)
- `daysOfTheMonth`: which days of month (e.g., `[1, 15]`)
- `endDate` or `occurrenceCount`: when the series ends

### Reminder Management
1. **Default to incomplete reminders** when listing
2. **Use filters for focused views**: `overdue` for urgent items, `today` for daily planning, `week` for weekly review
3. **Set completionDate** when marking complete
4. **Respect priority levels** (1=high is flagged in UI)
5. **Use dueDateComponents** not absolute dates for better handling
6. **Use batch operations** (`reminder_batch_complete`, `reminder_batch_delete`) when acting on multiple items

### Contact Management
1. **Use unified contacts** for consistent view across accounts
2. **Preserve existing data** when updating (only modify changed fields)
3. **Handle labeled values carefully** - don't lose non-primary entries
4. **Request minimum necessary keys** for performance

### Mail Management
1. **Mail.app must be running** for all operations
2. **Use batch operations** (`mail_batch_update`, `mail_batch_delete`) for inbox triage
3. **Use filters** (unread, flagged) for efficient message listing
4. **Message IDs are RFC 2822** - stable across mailbox moves
5. **Use mailbox/account hints** when available for faster lookups

### Error Handling
1. **Check authorization first** with `pim_status` when encountering errors
2. **Use `pim_authorize`** to request access for `notDetermined` domains
3. **Guide users to System Settings** for `denied` domains
4. **Validate dates** before creating events/reminders
5. **Check for conflicts** when scheduling
6. **Provide clear feedback** on operation success/failure

## Common Patterns

### Date Parsing
Support flexible input:
- ISO 8601: `2024-01-15T14:30:00`
- Natural language: "tomorrow at 3pm"
- Relative: "in 2 hours", "next Tuesday"

### Time Zone Handling
- EventKit stores dates in UTC
- Display in local time zone
- Be explicit about time zones in user output

### Searching
- Name search: `CNContact.predicateForContacts(matchingName:)`
- ID lookup: `CNContact.predicateForContacts(withIdentifiers:)`
- Date range: `eventStore.predicateForEvents(withStart:end:calendars:)`

## Troubleshooting

### Permission Issues
- Use `pim_status` to check all domains at once
- Use `pim_authorize` to trigger permission prompts
- Check System Settings > Privacy & Security
- Terminal/app must be granted access
- Restart app after granting permission

### Missing Data
- Ensure keys are requested when fetching contacts
- Check calendar source/account sync status
- Verify iCloud sync is working

### Performance
- Limit date ranges for event queries
- Use predicates to filter server-side
- Fetch only needed contact keys
- Use batch operations for multi-item actions
