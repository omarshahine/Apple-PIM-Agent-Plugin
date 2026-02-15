import ArgumentParser
import EventKit
import Foundation

@main
struct CalendarCLI: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "calendar-cli",
        abstract: "Manage macOS Calendar events using EventKit",
        subcommands: [
            AuthStatus.self,
            ListCalendars.self,
            ListEvents.self,
            GetEvent.self,
            SearchEvents.self,
            CreateEvent.self,
            UpdateEvent.self,
            DeleteEvent.self,
            BatchCreateEvent.self,
        ]
    )
}

// MARK: - Auth Status (no prompts)

struct AuthStatus: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "auth-status",
        abstract: "Check calendar authorization status without triggering prompts"
    )

    func run() throws {
        let status: String
        if #available(macOS 14.0, *) {
            switch EKEventStore.authorizationStatus(for: .event) {
            case .fullAccess: status = "authorized"
            case .writeOnly: status = "writeOnly"
            case .denied: status = "denied"
            case .restricted: status = "restricted"
            case .notDetermined: status = "notDetermined"
            @unknown default: status = "unknown"
            }
        } else {
            switch EKEventStore.authorizationStatus(for: .event) {
            case .authorized: status = "authorized"
            case .denied: status = "denied"
            case .restricted: status = "restricted"
            case .notDetermined: status = "notDetermined"
            default: status = "unknown"
            }
        }
        let result: [String: Any] = ["authorization": status]
        let data = try JSONSerialization.data(withJSONObject: result)
        print(String(data: data, encoding: .utf8)!)
    }
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
    if let days = rule.daysOfTheWeek, !days.isEmpty {
        dict["daysOfTheWeek"] = days.map { weekdayString($0.dayOfTheWeek) }
    }
    if let days = rule.daysOfTheMonth, !days.isEmpty {
        dict["daysOfTheMonth"] = days.map { $0.intValue }
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

// MARK: - Recurrence Helpers

struct RecurrenceJSON: Codable {
    let frequency: String?
    let interval: Int?
    let endDate: String?
    let occurrenceCount: Int?
    let daysOfTheWeek: [String]?
    let daysOfTheMonth: [Int]?
}

func weekdayString(_ weekday: EKWeekday) -> String {
    switch weekday {
    case .sunday: return "sunday"
    case .monday: return "monday"
    case .tuesday: return "tuesday"
    case .wednesday: return "wednesday"
    case .thursday: return "thursday"
    case .friday: return "friday"
    case .saturday: return "saturday"
    @unknown default: return "unknown"
    }
}

func dayStringToEKDay(_ day: String) -> EKRecurrenceDayOfWeek? {
    switch day.lowercased() {
    case "sunday", "sun": return EKRecurrenceDayOfWeek(.sunday)
    case "monday", "mon": return EKRecurrenceDayOfWeek(.monday)
    case "tuesday", "tue": return EKRecurrenceDayOfWeek(.tuesday)
    case "wednesday", "wed": return EKRecurrenceDayOfWeek(.wednesday)
    case "thursday", "thu": return EKRecurrenceDayOfWeek(.thursday)
    case "friday", "fri": return EKRecurrenceDayOfWeek(.friday)
    case "saturday", "sat": return EKRecurrenceDayOfWeek(.saturday)
    default: return nil
    }
}

func parseRecurrenceRule(_ json: String) -> EKRecurrenceRule? {
    guard let data = json.data(using: .utf8),
          let recurrence = try? JSONDecoder().decode(RecurrenceJSON.self, from: data) else {
        return nil
    }

    // A nil or "none" frequency means remove recurrence — return nil
    guard let freqStr = recurrence.frequency?.lowercased(), freqStr != "none" else {
        return nil
    }

    // Parse frequency
    let frequency: EKRecurrenceFrequency
    switch freqStr {
    case "daily": frequency = .daily
    case "weekly": frequency = .weekly
    case "monthly": frequency = .monthly
    case "yearly": frequency = .yearly
    default: return nil
    }

    // Parse interval (default: 1)
    let interval = recurrence.interval ?? 1

    // Parse end condition
    var recurrenceEnd: EKRecurrenceEnd? = nil
    if let endDateStr = recurrence.endDate, let endDate = parseDate(endDateStr) {
        recurrenceEnd = EKRecurrenceEnd(end: endDate)
    } else if let count = recurrence.occurrenceCount {
        recurrenceEnd = EKRecurrenceEnd(occurrenceCount: count)
    }

    // Parse days of the week
    var daysOfTheWeek: [EKRecurrenceDayOfWeek]? = nil
    if let days = recurrence.daysOfTheWeek {
        daysOfTheWeek = days.compactMap { dayStringToEKDay($0) }
        if daysOfTheWeek?.isEmpty == true {
            daysOfTheWeek = nil
        }
    }

    // Parse days of the month
    var daysOfTheMonth: [NSNumber]? = nil
    if let days = recurrence.daysOfTheMonth {
        daysOfTheMonth = days.map { NSNumber(value: $0) }
        if daysOfTheMonth?.isEmpty == true {
            daysOfTheMonth = nil
        }
    }

    return EKRecurrenceRule(
        recurrenceWith: frequency,
        interval: interval,
        daysOfTheWeek: daysOfTheWeek,
        daysOfTheMonth: daysOfTheMonth,
        monthsOfTheYear: nil,
        weeksOfTheYear: nil,
        daysOfTheYear: nil,
        setPositions: nil,
        end: recurrenceEnd
    )
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

    @Option(name: .long, help: "Recurrence rule as JSON (e.g., '{\"frequency\":\"weekly\",\"interval\":1}')")
    var recurrence: String?

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

        // Add recurrence rule if specified
        if let recurrenceJSON = recurrence, let rule = parseRecurrenceRule(recurrenceJSON) {
            event.addRecurrenceRule(rule)
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

    @Option(name: .long, help: "New URL")
    var url: String?

    @Option(name: .long, help: "Recurrence rule as JSON (e.g., '{\"frequency\":\"weekly\",\"interval\":1}')")
    var recurrence: String?

    @Flag(name: .long, help: "Apply changes to all future events in a recurring series")
    var futureEvents: Bool = false

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
        if let urlStr = url, let eventUrl = URL(string: urlStr) {
            event.url = eventUrl
        }

        // Update recurrence rule if specified
        if let recurrenceJSON = recurrence {
            // Remove existing recurrence rules
            if let existingRules = event.recurrenceRules {
                for rule in existingRules {
                    event.removeRecurrenceRule(rule)
                }
            }
            // Add new recurrence rule
            if let rule = parseRecurrenceRule(recurrenceJSON) {
                event.addRecurrenceRule(rule)
            }
        }

        // Only use futureEvents span when explicitly requested by user
        let span: EKSpan = futureEvents ? .futureEvents : .thisEvent
        try eventStore.save(event, span: span)

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

    @Flag(name: .long, help: "Delete this and all future events in a recurring series")
    var futureEvents: Bool = false

    func run() async throws {
        try await requestCalendarAccess()

        guard let event = eventStore.event(withIdentifier: id) else {
            throw CLIError.notFound("Event not found: \(id)")
        }

        let eventInfo = eventToDict(event)
        let span: EKSpan = futureEvents ? .futureEvents : .thisEvent
        try eventStore.remove(event, span: span)

        outputJSON([
            "success": true,
            "message": futureEvents ? "Event and future occurrences deleted successfully" : "Event deleted successfully",
            "deletedEvent": eventInfo
        ])
    }
}

// MARK: - Batch Operations

struct BatchEventInput: Codable {
    let title: String
    let start: String
    let end: String?
    let duration: Int?
    let calendar: String?
    let location: String?
    let notes: String?
    let url: String?
    let allDay: Bool?
    let alarm: [Int]?
    let recurrence: RecurrenceJSON?
}

struct BatchCreateEvent: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "batch-create",
        abstract: "Create multiple calendar events in a single transaction"
    )

    @Option(name: .long, help: "JSON array of events to create")
    var json: String

    func run() async throws {
        try await requestCalendarAccess()

        guard let data = json.data(using: .utf8),
              let events = try? JSONDecoder().decode([BatchEventInput].self, from: data) else {
            throw CLIError.invalidInput("Invalid JSON format for events array")
        }

        if events.isEmpty {
            throw CLIError.invalidInput("Events array cannot be empty")
        }

        var createdEvents: [[String: Any]] = []
        var errors: [[String: Any]] = []

        for (index, eventInput) in events.enumerated() {
            do {
                guard let startDate = parseDate(eventInput.start) else {
                    throw CLIError.invalidInput("Invalid start date: \(eventInput.start)")
                }

                let endDate: Date
                if let endStr = eventInput.end {
                    guard let parsed = parseDate(endStr) else {
                        throw CLIError.invalidInput("Invalid end date: \(endStr)")
                    }
                    endDate = parsed
                } else if let durationMinutes = eventInput.duration {
                    endDate = Calendar.current.date(byAdding: .minute, value: durationMinutes, to: startDate) ?? startDate
                } else {
                    endDate = Calendar.current.date(byAdding: .hour, value: 1, to: startDate) ?? startDate
                }

                let event = EKEvent(eventStore: eventStore)
                event.title = eventInput.title
                event.startDate = startDate
                event.endDate = endDate
                event.isAllDay = eventInput.allDay ?? false

                if let calendarName = eventInput.calendar {
                    let calendars = eventStore.calendars(for: .event)
                    guard let cal = calendars.first(where: { $0.calendarIdentifier == calendarName || $0.title.lowercased() == calendarName.lowercased() }) else {
                        throw CLIError.notFound("Calendar not found: \(calendarName)")
                    }
                    event.calendar = cal
                } else {
                    event.calendar = eventStore.defaultCalendarForNewEvents
                }

                if let loc = eventInput.location {
                    event.location = loc
                }
                if let n = eventInput.notes {
                    event.notes = n
                }
                if let urlStr = eventInput.url, let eventUrl = URL(string: urlStr) {
                    event.url = eventUrl
                }

                if let alarms = eventInput.alarm {
                    for minutes in alarms {
                        let alarm = EKAlarm(relativeOffset: TimeInterval(-minutes * 60))
                        event.addAlarm(alarm)
                    }
                }

                // Add recurrence rule if specified
                if let recurrenceInput = eventInput.recurrence {
                    let recurrenceJSON = try JSONEncoder().encode(recurrenceInput)
                    if let recurrenceStr = String(data: recurrenceJSON, encoding: .utf8),
                       let rule = parseRecurrenceRule(recurrenceStr) {
                        event.addRecurrenceRule(rule)
                    }
                }

                // Save with commit: false to batch changes
                try eventStore.save(event, span: .thisEvent, commit: false)
                createdEvents.append(eventToDict(event))
            } catch {
                errors.append([
                    "index": index,
                    "title": eventInput.title,
                    "error": error.localizedDescription
                ])
            }
        }

        // Commit all changes at once
        if !createdEvents.isEmpty {
            try eventStore.commit()
        }

        outputJSON([
            "success": errors.isEmpty,
            "message": "Batch create completed",
            "created": createdEvents,
            "createdCount": createdEvents.count,
            "errors": errors,
            "errorCount": errors.count
        ])
    }
}
