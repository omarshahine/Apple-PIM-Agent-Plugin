import ArgumentParser
import CoreLocation
import EventKit
import Foundation

@main
struct ReminderCLI: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "reminder-cli",
        abstract: "Manage macOS Reminders using EventKit",
        subcommands: [
            AuthStatus.self,
            ListLists.self,
            ListReminders.self,
            GetReminder.self,
            SearchReminders.self,
            CreateReminder.self,
            CompleteReminder.self,
            UpdateReminder.self,
            DeleteReminder.self,
            BatchCreateReminder.self,
            BatchCompleteReminder.self,
            BatchDeleteReminder.self,
        ]
    )
}

// MARK: - Auth Status (no prompts)

struct AuthStatus: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "auth-status",
        abstract: "Check reminder authorization status without triggering prompts"
    )

    func run() throws {
        let status: String
        if #available(macOS 14.0, *) {
            switch EKEventStore.authorizationStatus(for: .reminder) {
            case .fullAccess: status = "authorized"
            case .writeOnly: status = "writeOnly"
            case .denied: status = "denied"
            case .restricted: status = "restricted"
            case .notDetermined: status = "notDetermined"
            @unknown default: status = "unknown"
            }
        } else {
            switch EKEventStore.authorizationStatus(for: .reminder) {
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

func requestReminderAccess() async throws {
    if #available(macOS 14.0, *) {
        let granted = try await eventStore.requestFullAccessToReminders()
        guard granted else {
            throw CLIError.accessDenied("Reminders access denied. Grant access in System Settings > Privacy & Security > Reminders")
        }
    } else {
        let granted = try await eventStore.requestAccess(to: .reminder)
        guard granted else {
            throw CLIError.accessDenied("Reminders access denied. Grant access in System Settings > Privacy & Security > Reminders")
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

    let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.date.rawValue)
    if let match = detector?.firstMatch(in: string, range: NSRange(string.startIndex..., in: string)),
       let date = match.date {
        return date
    }

    return nil
}

func listToDict(_ list: EKCalendar) -> [String: Any] {
    return [
        "id": list.calendarIdentifier,
        "title": list.title,
        "color": list.cgColor?.components?.map { Int($0 * 255) } ?? [],
        "allowsModifications": list.allowsContentModifications,
        "source": list.source?.title ?? "Unknown"
    ]
}

func reminderToDict(_ reminder: EKReminder) -> [String: Any] {
    var dict: [String: Any] = [
        "id": reminder.calendarItemIdentifier,
        "title": reminder.title ?? "",
        "isCompleted": reminder.isCompleted,
        "list": reminder.calendar?.title ?? "",
        "listId": reminder.calendar?.calendarIdentifier ?? "",
        "priority": reminder.priority
    ]

    if let completionDate = reminder.completionDate {
        dict["completionDate"] = ISO8601DateFormatter().string(from: completionDate)
    }
    if let dueDate = reminder.dueDateComponents {
        dict["dueDate"] = dateComponentsToString(dueDate)
    }
    if let startDate = reminder.startDateComponents {
        dict["startDate"] = dateComponentsToString(startDate)
    }
    if let notes = reminder.notes, !notes.isEmpty {
        dict["notes"] = notes
    }
    if let url = reminder.url {
        dict["url"] = url.absoluteString
    }
    if reminder.hasRecurrenceRules, let rules = reminder.recurrenceRules {
        dict["recurrence"] = rules.map { ruleToDict($0) }
    }
    if reminder.hasAlarms, let alarms = reminder.alarms {
        dict["alarms"] = alarms.map { alarmToDict($0) }
    }

    return dict
}

func dateComponentsToString(_ components: DateComponents) -> String {
    var parts: [String] = []
    if let year = components.year { parts.append(String(format: "%04d", year)) }
    if let month = components.month { parts.append(String(format: "%02d", month)) }
    if let day = components.day { parts.append(String(format: "%02d", day)) }

    var dateStr = parts.joined(separator: "-")

    if let hour = components.hour, let minute = components.minute {
        dateStr += String(format: " %02d:%02d", hour, minute)
    }

    return dateStr
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
    var dict: [String: Any] = [
        "relativeOffset": alarm.relativeOffset
    ]

    if let location = alarm.structuredLocation {
        var locDict: [String: Any] = [:]
        if let title = location.title {
            locDict["name"] = title
        }
        if let geoLocation = location.geoLocation {
            locDict["latitude"] = geoLocation.coordinate.latitude
            locDict["longitude"] = geoLocation.coordinate.longitude
        }
        locDict["radius"] = location.radius
        switch alarm.proximity {
        case .enter:
            locDict["proximity"] = "arrive"
        case .leave:
            locDict["proximity"] = "depart"
        case .none:
            locDict["proximity"] = "none"
        @unknown default:
            locDict["proximity"] = "unknown"
        }
        dict["location"] = locDict
    }

    return dict
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

// MARK: - Location Helpers

struct LocationJSON: Codable {
    let name: String?
    let latitude: Double
    let longitude: Double
    let radius: Double?
    let proximity: String  // "arrive" or "depart"
}

func parseLocationAlarm(_ json: String) -> EKAlarm? {
    guard let data = json.data(using: .utf8),
          let location = try? JSONDecoder().decode(LocationJSON.self, from: data) else {
        return nil
    }

    let structuredLocation = EKStructuredLocation(title: location.name ?? "Location")
    structuredLocation.geoLocation = CLLocation(latitude: location.latitude, longitude: location.longitude)
    structuredLocation.radius = location.radius ?? 100.0

    let alarm = EKAlarm()
    alarm.structuredLocation = structuredLocation
    alarm.proximity = location.proximity.lowercased() == "depart" ? .leave : .enter

    return alarm
}

// MARK: - Commands

struct ListLists: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "lists",
        abstract: "List all reminder lists"
    )

    func run() async throws {
        try await requestReminderAccess()

        let lists = eventStore.calendars(for: .reminder)
        let result = lists.map { listToDict($0) }

        outputJSON([
            "success": true,
            "lists": result
        ])
    }
}

struct ListReminders: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "items",
        abstract: "List reminders from a list"
    )

    @Option(name: .long, help: "Reminder list name or ID")
    var list: String?

    @Flag(name: .long, help: "Include completed reminders")
    var completed: Bool = false

    @Option(name: .long, help: "Filter: overdue, today, tomorrow, week, upcoming, completed, all")
    var filter: String?

    @Option(name: .long, help: "Maximum number of reminders")
    var limit: Int = 100

    func run() async throws {
        try await requestReminderAccess()

        var calendars: [EKCalendar]?
        if let listFilter = list {
            let allLists = eventStore.calendars(for: .reminder)
            calendars = allLists.filter {
                $0.calendarIdentifier == listFilter || $0.title.lowercased() == listFilter.lowercased()
            }
            if calendars?.isEmpty == true {
                throw CLIError.notFound("Reminder list not found: \(listFilter)")
            }
        }

        let predicate = eventStore.predicateForReminders(in: calendars)

        let reminders = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[EKReminder], Error>) in
            eventStore.fetchReminders(matching: predicate) { reminders in
                continuation.resume(returning: reminders ?? [])
            }
        }

        // Determine include-completed based on filter or flag (case-insensitive)
        let filterLower = filter?.lowercased()
        let includeCompleted = completed || filterLower == "completed" || filterLower == "all"

        let calendar = Calendar.current
        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)
        let startOfTomorrow = calendar.date(byAdding: .day, value: 1, to: startOfToday)!
        let endOfTomorrow = calendar.date(byAdding: .day, value: 2, to: startOfToday)!
        // Use Calendar's locale-aware week interval (respects firstWeekday setting)
        let weekInterval = calendar.dateInterval(of: .weekOfYear, for: startOfToday)
        let startOfWeek = weekInterval?.start ?? startOfToday
        let endOfWeek = weekInterval?.end ?? calendar.date(byAdding: .day, value: 7, to: startOfToday)!

        let filtered: [[String: Any]] = reminders
            .filter { reminder in
                // First apply completion filter
                if !includeCompleted && reminder.isCompleted { return false }

                // Then apply date filter if specified
                guard let filterType = filterLower else { return true }

                let dueDate: Date? = {
                    guard let components = reminder.dueDateComponents else { return nil }
                    return calendar.date(from: components)
                }()

                switch filterType {
                case "overdue":
                    guard let due = dueDate else { return false }
                    return due < startOfToday && !reminder.isCompleted
                case "today":
                    // Today includes overdue + due today
                    guard let due = dueDate else { return false }
                    return due < startOfTomorrow && !reminder.isCompleted
                case "tomorrow":
                    guard let due = dueDate else { return false }
                    return due >= startOfTomorrow && due < endOfTomorrow
                case "week":
                    // Full calendar week (locale-aware boundaries)
                    guard let due = dueDate else { return false }
                    return due >= startOfWeek && due < endOfWeek
                case "upcoming":
                    guard dueDate != nil else { return false }
                    return !reminder.isCompleted
                case "completed":
                    return reminder.isCompleted
                case "all":
                    return true
                default:
                    return true
                }
            }
            .sorted { a, b in
                // Sort by due date (earliest first), undated last
                let dateA = a.dueDateComponents.flatMap { calendar.date(from: $0) }
                let dateB = b.dueDateComponents.flatMap { calendar.date(from: $0) }
                if dateA == nil && dateB == nil { return false }
                if dateA == nil { return false }
                if dateB == nil { return true }
                return dateA! < dateB!
            }
            .prefix(limit)
            .map { reminderToDict($0) }

        var result: [String: Any] = [
            "success": true,
            "reminders": Array(filtered),
            "count": filtered.count
        ]
        if let f = filter {
            result["filter"] = f
        }

        outputJSON(result)
    }
}

struct GetReminder: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "get",
        abstract: "Get a single reminder by ID"
    )

    @Option(name: .long, help: "Reminder ID")
    var id: String

    func run() async throws {
        try await requestReminderAccess()

        guard let reminder = eventStore.calendarItem(withIdentifier: id) as? EKReminder else {
            throw CLIError.notFound("Reminder not found: \(id)")
        }

        outputJSON([
            "success": true,
            "reminder": reminderToDict(reminder)
        ])
    }
}

struct SearchReminders: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "search",
        abstract: "Search reminders by title"
    )

    @Argument(help: "Search query")
    var query: String

    @Option(name: .long, help: "Reminder list name or ID")
    var list: String?

    @Flag(name: .long, help: "Include completed reminders")
    var completed: Bool = false

    @Option(name: .long, help: "Maximum results")
    var limit: Int = 50

    func run() async throws {
        try await requestReminderAccess()

        var calendars: [EKCalendar]?
        if let listFilter = list {
            let allLists = eventStore.calendars(for: .reminder)
            calendars = allLists.filter {
                $0.calendarIdentifier == listFilter || $0.title.lowercased() == listFilter.lowercased()
            }
        }

        let predicate = eventStore.predicateForReminders(in: calendars)

        let reminders = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[EKReminder], Error>) in
            eventStore.fetchReminders(matching: predicate) { reminders in
                continuation.resume(returning: reminders ?? [])
            }
        }

        let queryLower = query.lowercased()
        let filtered = reminders
            .filter { reminder in
                let title = reminder.title?.lowercased() ?? ""
                let notes = reminder.notes?.lowercased() ?? ""
                return title.contains(queryLower) || notes.contains(queryLower)
            }
            .filter { completed || !$0.isCompleted }
            .prefix(limit)
            .map { reminderToDict($0) }

        outputJSON([
            "success": true,
            "query": query,
            "reminders": Array(filtered),
            "count": filtered.count
        ])
    }
}

struct CreateReminder: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "create",
        abstract: "Create a new reminder"
    )

    @Option(name: .long, help: "Reminder title")
    var title: String

    @Option(name: .long, help: "Reminder list name or ID")
    var list: String?

    @Option(name: .long, help: "Due date/time")
    var due: String?

    @Option(name: .long, help: "Notes")
    var notes: String?

    @Option(name: .long, help: "Priority (0=none, 1=high, 5=medium, 9=low)")
    var priority: Int = 0

    @Option(name: .long, help: "URL associated with the reminder")
    var url: String?

    @Option(name: .long, help: "Alarm minutes before due (can specify multiple)")
    var alarm: [Int] = []

    @Option(name: .long, help: "Recurrence rule as JSON (e.g., '{\"frequency\":\"monthly\",\"interval\":1}')")
    var recurrence: String?

    @Option(name: .long, help: "Location-based alarm as JSON (e.g., '{\"name\":\"Home\",\"latitude\":37.33,\"longitude\":-122.03,\"radius\":100,\"proximity\":\"arrive\"}')")
    var location: String?

    func run() async throws {
        try await requestReminderAccess()

        let reminder = EKReminder(eventStore: eventStore)
        reminder.title = title

        if let listName = list {
            let lists = eventStore.calendars(for: .reminder)
            guard let cal = lists.first(where: { $0.calendarIdentifier == listName || $0.title.lowercased() == listName.lowercased() }) else {
                throw CLIError.notFound("Reminder list not found: \(listName)")
            }
            reminder.calendar = cal
        } else {
            reminder.calendar = eventStore.defaultCalendarForNewReminders()
        }

        if let dueStr = due, let dueDate = parseDate(dueStr) {
            reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
        }

        if let n = notes {
            reminder.notes = n
        }

        reminder.priority = priority

        if let urlStr = url, let reminderUrl = URL(string: urlStr) {
            reminder.url = reminderUrl
        }

        for minutes in alarm {
            let alarm = EKAlarm(relativeOffset: TimeInterval(-minutes * 60))
            reminder.addAlarm(alarm)
        }

        // Add location-based alarm if specified
        if let locationJSON = location, let locationAlarm = parseLocationAlarm(locationJSON) {
            reminder.addAlarm(locationAlarm)
        }

        // Add recurrence rule if specified
        if let recurrenceJSON = recurrence, let rule = parseRecurrenceRule(recurrenceJSON) {
            reminder.addRecurrenceRule(rule)
        }

        try eventStore.save(reminder, commit: true)

        outputJSON([
            "success": true,
            "message": "Reminder created successfully",
            "reminder": reminderToDict(reminder)
        ])
    }
}

struct CompleteReminder: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "complete",
        abstract: "Mark a reminder as complete"
    )

    @Option(name: .long, help: "Reminder ID to complete")
    var id: String

    @Flag(name: .long, help: "Mark as incomplete instead")
    var undo: Bool = false

    func run() async throws {
        try await requestReminderAccess()

        guard let reminder = eventStore.calendarItem(withIdentifier: id) as? EKReminder else {
            throw CLIError.notFound("Reminder not found: \(id)")
        }

        reminder.isCompleted = !undo
        if !undo {
            reminder.completionDate = Date()
        } else {
            reminder.completionDate = nil
        }

        try eventStore.save(reminder, commit: true)

        outputJSON([
            "success": true,
            "message": undo ? "Reminder marked as incomplete" : "Reminder marked as complete",
            "reminder": reminderToDict(reminder)
        ])
    }
}

struct UpdateReminder: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "update",
        abstract: "Update an existing reminder"
    )

    @Option(name: .long, help: "Reminder ID to update")
    var id: String

    @Option(name: .long, help: "New title")
    var title: String?

    @Option(name: .long, help: "New due date/time")
    var due: String?

    @Option(name: .long, help: "New notes")
    var notes: String?

    @Option(name: .long, help: "New priority")
    var priority: Int?

    @Option(name: .long, help: "Recurrence rule as JSON (e.g., '{\"frequency\":\"monthly\",\"interval\":1}')")
    var recurrence: String?

    @Option(name: .long, help: "New URL")
    var url: String?

    @Option(name: .long, help: "Location-based alarm as JSON (e.g., '{\"name\":\"Home\",\"latitude\":37.33,\"longitude\":-122.03,\"radius\":100,\"proximity\":\"arrive\"}')")
    var location: String?

    func run() async throws {
        try await requestReminderAccess()

        guard let reminder = eventStore.calendarItem(withIdentifier: id) as? EKReminder else {
            throw CLIError.notFound("Reminder not found: \(id)")
        }

        if let newTitle = title {
            reminder.title = newTitle
        }
        if let newDue = due {
            if let dueDate = parseDate(newDue) {
                reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
            }
        }
        if let newNotes = notes {
            reminder.notes = newNotes
        }
        if let newPriority = priority {
            reminder.priority = newPriority
        }
        if let newUrl = url {
            if newUrl.isEmpty {
                reminder.url = nil
            } else if let reminderUrl = URL(string: newUrl) {
                reminder.url = reminderUrl
            }
        }

        // Update recurrence rule if specified
        if let recurrenceJSON = recurrence {
            // Remove existing recurrence rules
            if let existingRules = reminder.recurrenceRules {
                for rule in existingRules {
                    reminder.removeRecurrenceRule(rule)
                }
            }
            // Add new recurrence rule
            if let rule = parseRecurrenceRule(recurrenceJSON) {
                reminder.addRecurrenceRule(rule)
            }
        }

        // Update location-based alarm if specified
        if let locationJSON = location {
            // Remove existing location-based alarms
            if let existingAlarms = reminder.alarms {
                for alarm in existingAlarms {
                    if alarm.structuredLocation != nil {
                        reminder.removeAlarm(alarm)
                    }
                }
            }
            // Add new location alarm (unless empty string to clear)
            if !locationJSON.isEmpty, let locationAlarm = parseLocationAlarm(locationJSON) {
                reminder.addAlarm(locationAlarm)
            }
        }

        try eventStore.save(reminder, commit: true)

        outputJSON([
            "success": true,
            "message": "Reminder updated successfully",
            "reminder": reminderToDict(reminder)
        ])
    }
}

struct DeleteReminder: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "delete",
        abstract: "Delete a reminder"
    )

    @Option(name: .long, help: "Reminder ID to delete")
    var id: String

    func run() async throws {
        try await requestReminderAccess()

        guard let reminder = eventStore.calendarItem(withIdentifier: id) as? EKReminder else {
            throw CLIError.notFound("Reminder not found: \(id)")
        }

        let reminderInfo = reminderToDict(reminder)
        try eventStore.remove(reminder, commit: true)

        outputJSON([
            "success": true,
            "message": "Reminder deleted successfully",
            "deletedReminder": reminderInfo
        ])
    }
}

// MARK: - Batch Operations

struct BatchReminderInput: Codable {
    let title: String
    let list: String?
    let due: String?
    let notes: String?
    let priority: Int?
    let url: String?
    let alarm: [Int]?
    let recurrence: RecurrenceJSON?
    let location: LocationJSON?
}

struct BatchCreateReminder: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "batch-create",
        abstract: "Create multiple reminders in a single transaction"
    )

    @Option(name: .long, help: "JSON array of reminders to create")
    var json: String

    func run() async throws {
        try await requestReminderAccess()

        guard let data = json.data(using: .utf8),
              let reminders = try? JSONDecoder().decode([BatchReminderInput].self, from: data) else {
            throw CLIError.invalidInput("Invalid JSON format for reminders array")
        }

        if reminders.isEmpty {
            throw CLIError.invalidInput("Reminders array cannot be empty")
        }

        var createdReminders: [[String: Any]] = []
        var errors: [[String: Any]] = []

        for (index, reminderInput) in reminders.enumerated() {
            do {
                let reminder = EKReminder(eventStore: eventStore)
                reminder.title = reminderInput.title

                if let listName = reminderInput.list {
                    let lists = eventStore.calendars(for: .reminder)
                    guard let cal = lists.first(where: { $0.calendarIdentifier == listName || $0.title.lowercased() == listName.lowercased() }) else {
                        throw CLIError.notFound("Reminder list not found: \(listName)")
                    }
                    reminder.calendar = cal
                } else {
                    reminder.calendar = eventStore.defaultCalendarForNewReminders()
                }

                if let dueStr = reminderInput.due, let dueDate = parseDate(dueStr) {
                    reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: dueDate)
                }

                if let n = reminderInput.notes {
                    reminder.notes = n
                }

                if let p = reminderInput.priority {
                    reminder.priority = p
                }

                if let urlStr = reminderInput.url, let reminderUrl = URL(string: urlStr) {
                    reminder.url = reminderUrl
                }

                if let alarms = reminderInput.alarm {
                    for minutes in alarms {
                        let alarm = EKAlarm(relativeOffset: TimeInterval(-minutes * 60))
                        reminder.addAlarm(alarm)
                    }
                }

                // Add location-based alarm if specified
                if let locationInput = reminderInput.location {
                    let locationData = try JSONEncoder().encode(locationInput)
                    if let locationStr = String(data: locationData, encoding: .utf8),
                       let locationAlarm = parseLocationAlarm(locationStr) {
                        reminder.addAlarm(locationAlarm)
                    }
                }

                // Add recurrence rule if specified
                if let recurrenceInput = reminderInput.recurrence {
                    let recurrenceJSON = try JSONEncoder().encode(recurrenceInput)
                    if let recurrenceStr = String(data: recurrenceJSON, encoding: .utf8),
                       let rule = parseRecurrenceRule(recurrenceStr) {
                        reminder.addRecurrenceRule(rule)
                    }
                }

                // Save with commit: false to batch changes
                try eventStore.save(reminder, commit: false)
                createdReminders.append(reminderToDict(reminder))
            } catch {
                errors.append([
                    "index": index,
                    "title": reminderInput.title,
                    "error": error.localizedDescription
                ])
            }
        }

        // Commit all changes at once
        if !createdReminders.isEmpty {
            try eventStore.commit()
        }

        outputJSON([
            "success": errors.isEmpty,
            "message": "Batch create completed",
            "created": createdReminders,
            "createdCount": createdReminders.count,
            "errors": errors,
            "errorCount": errors.count
        ])
    }
}

struct BatchCompleteReminder: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "batch-complete",
        abstract: "Mark multiple reminders as complete in a single transaction"
    )

    @Option(name: .long, help: "JSON array of reminder IDs to complete")
    var json: String

    @Flag(name: .long, help: "Mark as incomplete instead")
    var undo: Bool = false

    func run() async throws {
        try await requestReminderAccess()

        guard let data = json.data(using: .utf8),
              let ids = try? JSONDecoder().decode([String].self, from: data) else {
            throw CLIError.invalidInput("Invalid JSON format. Expected an array of reminder ID strings.")
        }

        if ids.isEmpty {
            throw CLIError.invalidInput("IDs array cannot be empty")
        }

        var completed: [[String: Any]] = []
        var errors: [[String: Any]] = []

        for id in ids {
            guard let reminder = eventStore.calendarItem(withIdentifier: id) as? EKReminder else {
                errors.append([
                    "id": id,
                    "error": "Reminder not found: \(id)"
                ])
                continue
            }

            reminder.isCompleted = !undo
            if !undo {
                reminder.completionDate = Date()
            } else {
                reminder.completionDate = nil
            }

            do {
                try eventStore.save(reminder, commit: false)
                completed.append(reminderToDict(reminder))
            } catch {
                errors.append([
                    "id": id,
                    "error": error.localizedDescription
                ])
            }
        }

        // Commit all changes at once
        if !completed.isEmpty {
            try eventStore.commit()
        }

        outputJSON([
            "success": errors.isEmpty,
            "message": undo ? "Batch incomplete completed" : "Batch complete completed",
            "completed": completed,
            "completedCount": completed.count,
            "errors": errors,
            "errorCount": errors.count
        ])
    }
}

struct BatchDeleteReminder: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "batch-delete",
        abstract: "Delete multiple reminders in a single transaction"
    )

    @Option(name: .long, help: "JSON array of reminder IDs to delete")
    var json: String

    func run() async throws {
        try await requestReminderAccess()

        guard let data = json.data(using: .utf8),
              let ids = try? JSONDecoder().decode([String].self, from: data) else {
            throw CLIError.invalidInput("Invalid JSON format. Expected an array of reminder ID strings.")
        }

        if ids.isEmpty {
            throw CLIError.invalidInput("IDs array cannot be empty")
        }

        var deleted: [[String: Any]] = []
        var errors: [[String: Any]] = []

        for id in ids {
            guard let reminder = eventStore.calendarItem(withIdentifier: id) as? EKReminder else {
                errors.append([
                    "id": id,
                    "error": "Reminder not found: \(id)"
                ])
                continue
            }

            let info = reminderToDict(reminder)
            do {
                try eventStore.remove(reminder, commit: false)
                deleted.append(info)
            } catch {
                errors.append([
                    "id": id,
                    "error": error.localizedDescription
                ])
            }
        }

        // Commit all changes at once
        if !deleted.isEmpty {
            try eventStore.commit()
        }

        outputJSON([
            "success": errors.isEmpty,
            "message": "Batch delete completed",
            "deleted": deleted,
            "deletedCount": deleted.count,
            "errors": errors,
            "errorCount": errors.count
        ])
    }
}
