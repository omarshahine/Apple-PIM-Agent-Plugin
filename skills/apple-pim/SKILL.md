---
description: |
  Provides knowledge about Apple's EventKit, Contacts, and Mail.app scripting for managing calendars, reminders, contacts, and local mail on macOS. Use this skill when discussing EventKit APIs, calendar data models, reminder structures, contact fields, Mail.app JXA scripting, authorization/permissions, or best practices for personal information management.
---

# Apple PIM (EventKit, Contacts & Mail)

## Overview

Apple provides frameworks and scripting interfaces for personal information management:
- **EventKit**: Calendars and Reminders
- **Contacts**: Address book management
- **Mail.app**: Local email via JXA (JavaScript for Automation)

EventKit and Contacts require explicit user permission via privacy prompts. Mail.app requires Automation permission and must be running.

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

### macOS 14+ (Sonoma)

EventKit requires full access:
```swift
try await eventStore.requestFullAccessToEvents()
try await eventStore.requestFullAccessToReminders()
```

### Earlier macOS Versions

```swift
try await eventStore.requestAccess(to: .event)
try await eventStore.requestAccess(to: .reminder)
```

### Contacts

```swift
let status = CNContactStore.authorizationStatus(for: .contacts)
try await contactStore.requestAccess(for: .contacts)
```

### SSH Sessions

Permissions must be granted on the Mac where the CLI runs. SSH does not inherit GUI-level permission dialogs. Grant permissions locally first.

## EventKit Framework

### Calendar Events

Events are represented by `EKEvent` with these key properties:

| Property | Type | Description |
|----------|------|-------------|
| `eventIdentifier` | String | Unique stable identifier |
| `title` | String | Event title |
| `startDate` | Date | Start date/time |
| `endDate` | Date | End date/time |
| `isAllDay` | Bool | All-day event flag |
| `location` | String? | Location text |
| `notes` | String? | Notes/description |
| `calendar` | EKCalendar | Parent calendar |
| `url` | URL? | Associated URL |
| `recurrenceRules` | [EKRecurrenceRule]? | Repeat rules |
| `alarms` | [EKAlarm]? | Reminders/alerts |
| `attendees` | [EKParticipant]? | Invitees (read-only) |

### Reminders

Reminders are represented by `EKReminder`:

| Property | Type | Description |
|----------|------|-------------|
| `calendarItemIdentifier` | String | Unique identifier |
| `title` | String | Reminder title |
| `isCompleted` | Bool | Completion status |
| `completionDate` | Date? | When marked complete |
| `dueDateComponents` | DateComponents? | Due date |
| `startDateComponents` | DateComponents? | Start date |
| `priority` | Int | 0=none, 1=high, 5=medium, 9=low |
| `notes` | String? | Notes text |
| `url` | URL? | Associated URL |
| `calendar` | EKCalendar | Parent reminder list |
| `alarms` | [EKAlarm]? | Time-based and location-based alarms |

### Reminder Filtering

The MCP server supports date-based filtering at the server level:

| Filter | Behavior |
|--------|----------|
| `overdue` | Incomplete reminders with due date before today |
| `today` | Due today + overdue (incomplete with due <= end of today) |
| `tomorrow` | Due date falls on tomorrow |
| `week` | Due date falls within current calendar week |
| `upcoming` | All incomplete reminders with any due date |
| `completed` | Finished reminders |
| `all` | Everything |

Results are sorted by due date (earliest first), with undated items last.

### Calendars and Lists

`EKCalendar` represents both calendars (for events) and reminder lists:

| Property | Type | Description |
|----------|------|-------------|
| `calendarIdentifier` | String | Unique identifier |
| `title` | String | Display name |
| `type` | EKCalendarType | local, caldav, exchange, etc. |
| `source` | EKSource | Account (iCloud, Exchange, etc.) |
| `allowsContentModifications` | Bool | Read-only check |
| `cgColor` | CGColor? | Calendar color |

### Recurrence Rules

`EKRecurrenceRule` defines repeating patterns:

```swift
// Daily for 10 occurrences
let rule = EKRecurrenceRule(
    recurrenceWith: .daily,
    interval: 1,
    end: EKRecurrenceEnd(occurrenceCount: 10)
)

// Weekly on Mon/Wed/Fri
let rule = EKRecurrenceRule(
    recurrenceWith: .weekly,
    interval: 1,
    daysOfTheWeek: [.monday, .wednesday, .friday],
    daysOfTheMonth: nil,
    monthsOfTheYear: nil,
    weeksOfTheYear: nil,
    daysOfTheYear: nil,
    setPositions: nil,
    end: nil
)
```

### Alarms

`EKAlarm` provides notifications:

```swift
// 15 minutes before
let alarm = EKAlarm(relativeOffset: -15 * 60)

// At specific time
let alarm = EKAlarm(absoluteDate: alertDate)
```

### Location-Based Alarms

`EKAlarm` can trigger based on arriving at or departing from a geofenced location:

```swift
let location = EKStructuredLocation(title: "Home")
location.geoLocation = CLLocation(latitude: 37.33, longitude: -122.03)
location.radius = 100.0 // meters

let alarm = EKAlarm()
alarm.structuredLocation = location
alarm.proximity = .enter // .enter = arriving, .leave = departing

reminder.addAlarm(alarm)
```

This enables "Remind me when I arrive home" or "Remind me when I leave the office" style reminders.

## Contacts Framework

### CNContact Properties

Key contact fields:

| Property | Type | Description |
|----------|------|-------------|
| `identifier` | String | Unique identifier |
| `givenName` | String | First name |
| `familyName` | String | Last name |
| `middleName` | String | Middle name |
| `namePrefix` | String | Mr., Dr., etc. |
| `nameSuffix` | String | Jr., PhD, etc. |
| `nickname` | String | Nickname |
| `organizationName` | String | Company |
| `jobTitle` | String | Job title |
| `departmentName` | String | Department |
| `emailAddresses` | [CNLabeledValue<NSString>] | Email addresses |
| `phoneNumbers` | [CNLabeledValue<CNPhoneNumber>] | Phone numbers |
| `postalAddresses` | [CNLabeledValue<CNPostalAddress>] | Addresses |
| `urlAddresses` | [CNLabeledValue<NSString>] | URLs |
| `birthday` | DateComponents? | Birthday |
| `note` | String | Notes |
| `imageData` | Data? | Contact photo |
| `contactRelations` | [CNLabeledValue<CNContactRelation>] | Related people |
| `socialProfiles` | [CNLabeledValue<CNSocialProfile>] | Social accounts |

### Labeled Values

Multi-value properties use `CNLabeledValue<T>`:

```swift
// Standard labels
CNLabelHome, CNLabelWork, CNLabelOther
CNLabelPhoneNumberMain, CNLabelPhoneNumberMobile
CNLabelEmailiCloud
```

### Contact Groups

`CNGroup` represents contact groups:

| Property | Type | Description |
|----------|------|-------------|
| `identifier` | String | Unique identifier |
| `name` | String | Group name |

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

## Mail.app via JXA

### Why JXA?

Mail.app has no native Swift framework (unlike EventKit/Contacts). JXA (JavaScript for Automation) provides:
- Native JSON output via `JSON.stringify()`
- Full access to Mail.app's scripting dictionary
- Array-level property access for batch operations

The Swift CLI (`mail-cli`) wraps JXA via `Process` calling `osascript -l JavaScript`.

### Key Constraint

**Mail.app must be running.** Unlike EventKit/Contacts which work headlessly, Mail.app is a GUI application. The CLI checks `NSWorkspace.shared.runningApplications` upfront and returns a clear error.

### Message Properties

| Property | Type | Description |
|----------|------|-------------|
| `messageId` | String | RFC 2822 message ID (stable identifier) |
| `subject` | String | Message subject |
| `sender` | String | Sender address |
| `dateReceived` | Date | When received |
| `dateSent` | Date | When sent |
| `readStatus` | Bool | Read/unread |
| `flaggedStatus` | Bool | Flagged/unflagged |
| `junkMailStatus` | Bool | Junk/not junk |
| `content` | String | Plain text body |
| `mailbox` | Mailbox | Parent mailbox |

### Batch Property Fetching

JXA's scripting bridge supports array-level property access -- much faster than per-message iteration:

```javascript
// FAST: One IPC call per property, returns array
const subjects = mbox.messages.subject();
const senders = mbox.messages.sender();
const dates = mbox.messages.dateReceived();

// SLOW: N IPC calls (one per message)
for (const msg of mbox.messages()) {
    msg.subject(); // individual IPC call
}
```

### Message ID

Uses RFC 2822 `messageId` property as the stable identifier. This persists across mailbox moves, unlike internal Mail.app IDs. Use `.whose({messageId: targetId})` for lookups.

### Permissions

Mail.app requires Automation permission:
- System Settings > Privacy & Security > Automation
- The terminal/app must be allowed to control Mail.app
- First run triggers a system permission dialog

### Scope vs Fastmail MCP

| Capability | mail-cli (local) | Fastmail MCP (cloud) |
|------------|-----------------|---------------------|
| Read messages | Yes | Yes |
| Search | Local index | Server-side |
| Update flags | Yes | Yes |
| Move/delete | Yes | Yes |
| Send email | No | Yes |
| Compose drafts | No | Yes |
| Folder management | No | Yes |
| "On My Mac" mailboxes | Yes | No |
| Offline access | Yes | No |
| Batch flag updates | Yes | Yes |
| Batch delete | Yes | Yes |
