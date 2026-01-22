import ArgumentParser
import EventKit
import Foundation

@main
struct ReminderCLI: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "reminder-cli",
        abstract: "Manage macOS Reminders using EventKit",
        subcommands: [
            ListLists.self,
            ListReminders.self,
            GetReminder.self,
            SearchReminders.self,
            CreateReminder.self,
            CompleteReminder.self,
            UpdateReminder.self,
            DeleteReminder.self,
        ]
    )
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

        let filtered = reminders
            .filter { completed || !$0.isCompleted }
            .prefix(limit)
            .map { reminderToDict($0) }

        outputJSON([
            "success": true,
            "reminders": Array(filtered),
            "count": filtered.count
        ])
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
