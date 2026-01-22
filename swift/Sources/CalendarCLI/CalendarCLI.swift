import ArgumentParser
import EventKit
import Foundation

@main
struct CalendarCLI: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "calendar-cli",
        abstract: "Manage macOS Calendar events using EventKit",
        subcommands: [
            ListCalendars.self,
            ListEvents.self,
            GetEvent.self,
            SearchEvents.self,
            CreateEvent.self,
            UpdateEvent.self,
            DeleteEvent.self,
        ]
    )
}

// MARK: - Shared Utilities

let eventStore = EKEventStore()

func requestCalendarAccess() async throws {
    if #available(macOS 14.0, *) {
        let granted = try await eventStore.requestFullAccessToEvents()
        guard granted else {
            throw CLIError.accessDenied("Calendar access denied. Grant access in System Settings > Privacy & Security > Calendars")
        }
    } else {
        let granted = try await eventStore.requestAccess(to: .event)
        guard granted else {
            throw CLIError.accessDenied("Calendar access denied. Grant access in System Settings > Privacy & Security > Calendars")
        }
    }
}

enum CLIError: Error, LocalizedError {
    case accessDenied(String)
    case notFound(String)
    case invalidInput(String)

    var errorDescription: String? {
        switch self {
        case .accessDenied(let msg): return msg
        case .notFound(let msg): return msg
        case .invalidInput(let msg): return msg
        }
    }
}

func outputJSON(_ value: Any) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]),
       let string = String(data: data, encoding: .utf8) {
        print(string)
    }
}

func parseDate(_ string: String) -> Date? {
    let formatters: [DateFormatter] = {
        let formats = [
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd HH:mm",
            "yyyy-MM-dd",
            "MM/dd/yyyy HH:mm",
            "MM/dd/yyyy",
        ]
        return formats.map { format in
            let formatter = DateFormatter()
            formatter.dateFormat = format
            formatter.locale = Locale(identifier: "en_US_POSIX")
            return formatter
        }
    }()

    // Handle relative dates
    let lowercased = string.lowercased()
    let calendar = Calendar.current
    let now = Date()

    if lowercased == "today" {
        return calendar.startOfDay(for: now)
    } else if lowercased == "tomorrow" {
        return calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))
    } else if lowercased == "yesterday" {
        return calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: now))
    } else if lowercased.hasPrefix("next ") {
        let component = String(lowercased.dropFirst(5))
        switch component {
        case "week":
            return calendar.date(byAdding: .weekOfYear, value: 1, to: now)
        case "month":
            return calendar.date(byAdding: .month, value: 1, to: now)
        default:
            break
        }
    }

    for formatter in formatters {
        if let date = formatter.date(from: string) {
            return date
        }
    }

    // Try natural language
    let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue)
    if let match = detector?.firstMatch(in: string, range: NSRange(string.startIndex..., in: string)),
       let date = match.date {
        return date
    }

    return nil
}

func calendarToDict(_ calendar: EKCalendar) -> [String: Any] {
    return [
        "id": calendar.calendarIdentifier,
        "title": calendar.title,
        "type": calendarTypeString(calendar.type),
        "color": calendar.cgColor?.components?.map { Int($0 * 255) } ?? [],
        "allowsModifications": calendar.allowsContentModifications,
        "source": calendar.source?.title ?? "Unknown"
    ]
}

func calendarTypeString(_ type: EKCalendarType) -> String {
    switch type {
    case .local: return "local"
    case .calDAV: return "caldav"
    case .exchange: return "exchange"
    case .subscription: return "subscription"
    case .birthday: return "birthday"
    @unknown default: return "unknown"
    }
}

func eventToDict(_ event: EKEvent) -> [String: Any] {
    var dict: [String: Any] = [
        "id": event.eventIdentifier ?? "",
        "title": event.title ?? "",
        "startDate": ISO8601DateFormatter().string(from: event.startDate),
        "endDate": ISO8601DateFormatter().string(from: event.endDate),
        "isAllDay": event.isAllDay,
        "calendar": event.calendar?.title ?? "",
        "calendarId": event.calendar?.calendarIdentifier ?? ""
    ]

    if let location = event.location, !location.isEmpty {
        dict["location"] = location
    }
    if let notes = event.notes, !notes.isEmpty {
        dict["notes"] = notes
    }
    if let url = event.url {
        dict["url"] = url.absoluteString
    }
    if event.hasRecurrenceRules, let rules = event.recurrenceRules {
        dict["recurrence"] = rules.map { ruleToDict($0) }
    }
    if event.hasAlarms, let alarms = event.alarms {
        dict["alarms"] = alarms.map { alarmToDict($0) }
    }
    if event.hasAttendees, let attendees = event.attendees {
        dict["attendees"] = attendees.map { attendeeToDict($0) }
    }

    return dict
}

func ruleToDict(_ rule: EKRecurrenceRule) -> [String: Any] {
    var dict: [String: Any] = [
        "frequency": frequencyString(rule.frequency),
        "interval": rule.interval
    ]
    if let end = rule.recurrenceEnd {
        if let endDate = end.endDate {
            dict["endDate"] = ISO8601DateFormatter().string(from: endDate)
        } else {
            dict["occurrenceCount"] = end.occurrenceCount
        }
    }
    return dict
}

func frequencyString(_ freq: EKRecurrenceFrequency) -> String {
    switch freq {
    case .daily: return "daily"
    case .weekly: return "weekly"
    case .monthly: return "monthly"
    case .yearly: return "yearly"
    @unknown default: return "unknown"
    }
}

func alarmToDict(_ alarm: EKAlarm) -> [String: Any] {
    return [
        "relativeOffset": alarm.relativeOffset
    ]
}

func attendeeToDict(_ attendee: EKParticipant) -> [String: Any] {
    return [
        "name": attendee.name ?? "",
        "email": attendee.url.absoluteString.replacingOccurrences(of: "mailto:", with: ""),
        "status": participantStatusString(attendee.participantStatus),
        "role": participantRoleString(attendee.participantRole)
    ]
}

func participantStatusString(_ status: EKParticipantStatus) -> String {
    switch status {
    case .unknown: return "unknown"
    case .pending: return "pending"
    case .accepted: return "accepted"
    case .declined: return "declined"
    case .tentative: return "tentative"
    case .delegated: return "delegated"
    case .completed: return "completed"
    case .inProcess: return "inProcess"
    @unknown default: return "unknown"
    }
}

func participantRoleString(_ role: EKParticipantRole) -> String {
    switch role {
    case .unknown: return "unknown"
    case .required: return "required"
    case .optional: return "optional"
    case .chair: return "chair"
    case .nonParticipant: return "nonParticipant"
    @unknown default: return "unknown"
    }
}

// MARK: - Commands

struct ListCalendars: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "list",
        abstract: "List all calendars"
    )

    func run() async throws {
        try await requestCalendarAccess()

        let calendars = eventStore.calendars(for: .event)
        let result = calendars.map { calendarToDict($0) }

        outputJSON([
            "success": true,
            "calendars": result
        ])
    }
}

struct ListEvents: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "events",
        abstract: "List events within a date range"
    )

    @Option(name: .long, help: "Calendar name or ID to filter by")
    var calendar: String?

    @Option(name: .long, help: "Start date (default: today)")
    var from: String = "today"

    @Option(name: .long, help: "End date (default: 7 days from now)")
    var to: String?

    @Option(name: .long, help: "Maximum number of events to return")
    var limit: Int = 100

    func run() async throws {
        try await requestCalendarAccess()

        guard let startDate = parseDate(from) else {
            throw CLIError.invalidInput("Invalid start date: \(from)")
        }

        let endDate: Date
        if let toStr = to {
            guard let parsed = parseDate(toStr) else {
                throw CLIError.invalidInput("Invalid end date: \(toStr)")
            }
            endDate = parsed
        } else {
            endDate = Calendar.current.date(byAdding: .day, value: 7, to: startDate) ?? startDate
        }

        var calendars: [EKCalendar]?
        if let calendarFilter = calendar {
            let allCalendars = eventStore.calendars(for: .event)
            calendars = allCalendars.filter {
                $0.calendarIdentifier == calendarFilter || $0.title.lowercased() == calendarFilter.lowercased()
            }
            if calendars?.isEmpty == true {
                throw CLIError.notFound("Calendar not found: \(calendarFilter)")
            }
        }

        let predicate = eventStore.predicateForEvents(withStart: startDate, end: endDate, calendars: calendars)
        let events = eventStore.events(matching: predicate)
            .prefix(limit)
            .map { eventToDict($0) }

        outputJSON([
            "success": true,
            "events": Array(events),
            "count": events.count,
            "dateRange": [
                "from": ISO8601DateFormatter().string(from: startDate),
                "to": ISO8601DateFormatter().string(from: endDate)
            ]
        ])
    }
}

struct GetEvent: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "get",
        abstract: "Get a single event by ID"
    )

    @Option(name: .long, help: "Event ID")
    var id: String

    func run() async throws {
        try await requestCalendarAccess()

        guard let event = eventStore.event(withIdentifier: id) else {
            throw CLIError.notFound("Event not found: \(id)")
        }

        outputJSON([
            "success": true,
            "event": eventToDict(event)
        ])
    }
}

struct SearchEvents: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "search",
        abstract: "Search events by title"
    )

    @Argument(help: "Search query")
    var query: String

    @Option(name: .long, help: "Calendar name or ID to search in")
    var calendar: String?

    @Option(name: .long, help: "Start date for search range (default: 30 days ago)")
    var from: String?

    @Option(name: .long, help: "End date for search range (default: 1 year from now)")
    var to: String?

    @Option(name: .long, help: "Maximum results")
    var limit: Int = 50

    func run() async throws {
        try await requestCalendarAccess()

        let startDate = from.flatMap { parseDate($0) } ?? Calendar.current.date(byAdding: .day, value: -30, to: Date())!
        let endDate = to.flatMap { parseDate($0) } ?? Calendar.current.date(byAdding: .year, value: 1, to: Date())!

        var calendars: [EKCalendar]?
        if let calendarFilter = calendar {
            let allCalendars = eventStore.calendars(for: .event)
            calendars = allCalendars.filter {
                $0.calendarIdentifier == calendarFilter || $0.title.lowercased() == calendarFilter.lowercased()
            }
        }

        let predicate = eventStore.predicateForEvents(withStart: startDate, end: endDate, calendars: calendars)
        let events = eventStore.events(matching: predicate)
            .filter { event in
                let title = event.title?.lowercased() ?? ""
                let notes = event.notes?.lowercased() ?? ""
                let location = event.location?.lowercased() ?? ""
                let queryLower = query.lowercased()
                return title.contains(queryLower) || notes.contains(queryLower) || location.contains(queryLower)
            }
            .prefix(limit)
            .map { eventToDict($0) }

        outputJSON([
            "success": true,
            "query": query,
            "events": Array(events),
            "count": events.count
        ])
    }
}

struct CreateEvent: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "create",
        abstract: "Create a new calendar event"
    )

    @Option(name: .long, help: "Event title")
    var title: String

    @Option(name: .long, help: "Start date/time")
    var start: String

    @Option(name: .long, help: "End date/time (default: 1 hour after start)")
    var end: String?

    @Option(name: .long, help: "Duration in minutes (alternative to --end)")
    var duration: Int?

    @Option(name: .long, help: "Calendar name or ID (default: default calendar)")
    var calendar: String?

    @Option(name: .long, help: "Event location")
    var location: String?

    @Option(name: .long, help: "Event notes")
    var notes: String?

    @Option(name: .long, help: "URL associated with the event")
    var url: String?

    @Flag(name: .long, help: "All-day event")
    var allDay: Bool = false

    @Option(name: .long, help: "Alarm minutes before event (can specify multiple)")
    var alarm: [Int] = []

    func run() async throws {
        try await requestCalendarAccess()

        guard let startDate = parseDate(start) else {
            throw CLIError.invalidInput("Invalid start date: \(start)")
        }

        let endDate: Date
        if let endStr = end {
            guard let parsed = parseDate(endStr) else {
                throw CLIError.invalidInput("Invalid end date: \(endStr)")
            }
            endDate = parsed
        } else if let durationMinutes = duration {
            endDate = Calendar.current.date(byAdding: .minute, value: durationMinutes, to: startDate) ?? startDate
        } else {
            endDate = Calendar.current.date(byAdding: .hour, value: 1, to: startDate) ?? startDate
        }

        let event = EKEvent(eventStore: eventStore)
        event.title = title
        event.startDate = startDate
        event.endDate = endDate
        event.isAllDay = allDay

        if let calendarName = calendar {
            let calendars = eventStore.calendars(for: .event)
            guard let cal = calendars.first(where: { $0.calendarIdentifier == calendarName || $0.title.lowercased() == calendarName.lowercased() }) else {
                throw CLIError.notFound("Calendar not found: \(calendarName)")
            }
            event.calendar = cal
        } else {
            event.calendar = eventStore.defaultCalendarForNewEvents
        }

        if let loc = location {
            event.location = loc
        }
        if let n = notes {
            event.notes = n
        }
        if let urlStr = url, let eventUrl = URL(string: urlStr) {
            event.url = eventUrl
        }

        for minutes in alarm {
            let alarm = EKAlarm(relativeOffset: TimeInterval(-minutes * 60))
            event.addAlarm(alarm)
        }

        try eventStore.save(event, span: .thisEvent)

        outputJSON([
            "success": true,
            "message": "Event created successfully",
            "event": eventToDict(event)
        ])
    }
}

struct UpdateEvent: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "update",
        abstract: "Update an existing event"
    )

    @Option(name: .long, help: "Event ID to update")
    var id: String

    @Option(name: .long, help: "New title")
    var title: String?

    @Option(name: .long, help: "New start date/time")
    var start: String?

    @Option(name: .long, help: "New end date/time")
    var end: String?

    @Option(name: .long, help: "New location")
    var location: String?

    @Option(name: .long, help: "New notes")
    var notes: String?

    func run() async throws {
        try await requestCalendarAccess()

        guard let event = eventStore.event(withIdentifier: id) else {
            throw CLIError.notFound("Event not found: \(id)")
        }

        if let newTitle = title {
            event.title = newTitle
        }
        if let newStart = start {
            guard let date = parseDate(newStart) else {
                throw CLIError.invalidInput("Invalid start date: \(newStart)")
            }
            event.startDate = date
        }
        if let newEnd = end {
            guard let date = parseDate(newEnd) else {
                throw CLIError.invalidInput("Invalid end date: \(newEnd)")
            }
            event.endDate = date
        }
        if let newLocation = location {
            event.location = newLocation
        }
        if let newNotes = notes {
            event.notes = newNotes
        }

        try eventStore.save(event, span: .thisEvent)

        outputJSON([
            "success": true,
            "message": "Event updated successfully",
            "event": eventToDict(event)
        ])
    }
}

struct DeleteEvent: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "delete",
        abstract: "Delete an event"
    )

    @Option(name: .long, help: "Event ID to delete")
    var id: String

    func run() async throws {
        try await requestCalendarAccess()

        guard let event = eventStore.event(withIdentifier: id) else {
            throw CLIError.notFound("Event not found: \(id)")
        }

        let eventInfo = eventToDict(event)
        try eventStore.remove(event, span: .thisEvent)

        outputJSON([
            "success": true,
            "message": "Event deleted successfully",
            "deletedEvent": eventInfo
        ])
    }
}
