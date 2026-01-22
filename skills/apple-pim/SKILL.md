---
description: |
  Provides knowledge about Apple's EventKit and Contacts frameworks for managing calendars, reminders, and contacts on macOS. Use this skill when discussing EventKit APIs, calendar data models, reminder structures, contact fields, or best practices for personal information management.
---

# Apple PIM (EventKit & Contacts)

## Overview

Apple provides two frameworks for personal information management:
- **EventKit**: Calendars and Reminders
- **Contacts**: Address book management

Both require explicit user permission via privacy prompts.

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
| `calendar` | EKCalendar | Parent reminder list |

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

## Permissions

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

## Best Practices

### Calendar Management
1. **Use default calendar for new events** when user doesn't specify
2. **Preserve recurrence rules** when updating recurring events
3. **Handle `.thisEvent` vs `.futureEvents`** span for recurring event edits
4. **Check `allowsContentModifications`** before attempting writes

### Reminder Management
1. **Default to incomplete reminders** when listing
2. **Set completionDate** when marking complete
3. **Respect priority levels** (1=high is flagged in UI)
4. **Use dueDateComponents** not absolute dates for better handling

### Contact Management
1. **Use unified contacts** for consistent view across accounts
2. **Preserve existing data** when updating (only modify changed fields)
3. **Handle labeled values carefully** - don't lose non-primary entries
4. **Request minimum necessary keys** for performance

### Error Handling
1. **Handle permission denial gracefully**
2. **Validate dates** before creating events/reminders
3. **Check for conflicts** when scheduling
4. **Provide clear feedback** on operation success/failure

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
