import Foundation

/// Profile override — all fields optional.
/// Non-nil values replace the corresponding section in the base config.
/// Profiles live at `~/.config/apple-pim/profiles/{name}.json`.
public struct PIMProfileOverride: Codable, Equatable, Sendable {
    public var calendars: DomainFilterConfig?
    public var reminders: DomainFilterConfig?
    public var contacts: DomainFilterConfig?
    public var mail: DomainConfig?
    public var defaultCalendar: String?
    public var defaultReminderList: String?
    public var smtp: SMTPDefaults?

    public init(
        calendars: DomainFilterConfig? = nil,
        reminders: DomainFilterConfig? = nil,
        contacts: DomainFilterConfig? = nil,
        mail: DomainConfig? = nil,
        defaultCalendar: String? = nil,
        defaultReminderList: String? = nil,
        smtp: SMTPDefaults? = nil
    ) {
        self.calendars = calendars
        self.reminders = reminders
        self.contacts = contacts
        self.mail = mail
        self.defaultCalendar = defaultCalendar
        self.defaultReminderList = defaultReminderList
        self.smtp = smtp
    }

    enum CodingKeys: String, CodingKey {
        case calendars, reminders, contacts, mail, smtp
        case defaultCalendar = "default_calendar"
        case defaultReminderList = "default_reminder_list"
    }
}
