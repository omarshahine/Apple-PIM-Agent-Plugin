import Foundation

/// Root configuration for the Apple PIM plugin.
/// Loaded from `~/.config/apple-pim/config.json`.
public struct PIMConfiguration: Codable, Equatable, Sendable {
    public var calendars: DomainFilterConfig
    public var reminders: DomainFilterConfig
    public var contacts: DomainFilterConfig
    public var mail: DomainConfig
    public var defaultCalendar: String?
    public var defaultReminderList: String?
    public var smtp: SMTPDefaults?

    public init(
        calendars: DomainFilterConfig = DomainFilterConfig(),
        reminders: DomainFilterConfig = DomainFilterConfig(),
        contacts: DomainFilterConfig = DomainFilterConfig(),
        mail: DomainConfig = DomainConfig(),
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

/// Non-secret SMTP connection defaults.
/// The password lives in `SecretsStore` under the key at `secretKey` (default `smtp.icloud.password`).
public struct SMTPDefaults: Codable, Equatable, Sendable {
    public var host: String?
    public var port: Int?
    public var username: String?
    public var secretKey: String?

    public init(host: String? = nil, port: Int? = nil, username: String? = nil, secretKey: String? = nil) {
        self.host = host
        self.port = port
        self.username = username
        self.secretKey = secretKey
    }

    enum CodingKeys: String, CodingKey {
        case host, port, username
        case secretKey = "secret_key"
    }
}

/// Configuration for a domain that supports item-level filtering (calendars, reminders, contacts).
public struct DomainFilterConfig: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var mode: FilterMode
    public var items: [String]

    public init(enabled: Bool = true, mode: FilterMode = .all, items: [String] = []) {
        self.enabled = enabled
        self.mode = mode
        self.items = items
    }
}

/// Configuration for a domain with only an enabled flag (mail).
public struct DomainConfig: Codable, Equatable, Sendable {
    public var enabled: Bool

    public init(enabled: Bool = true) {
        self.enabled = enabled
    }
}

/// Filter mode for a domain's item list.
public enum FilterMode: String, Codable, Equatable, Sendable {
    case all
    case allowlist
    case blocklist
}
