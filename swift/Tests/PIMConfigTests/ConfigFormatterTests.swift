import XCTest
@testable import PIMConfig

final class ConfigFormatterTests: XCTestCase {

    // MARK: - formatConfigShow

    func testConfigShowHeader() {
        let config = PIMConfiguration()
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: nil
        )
        XCTAssertTrue(output.contains("Apple PIM Configuration"))
        XCTAssertTrue(output.contains("======================="))
    }

    func testConfigShowPaths() {
        let config = PIMConfiguration()
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: nil
        )
        XCTAssertTrue(output.contains("Config path:    /tmp/config.json"))
        XCTAssertTrue(output.contains("Profiles dir:   /tmp/profiles"))
    }

    func testConfigShowNoActiveProfile() {
        let config = PIMConfiguration()
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: nil
        )
        XCTAssertTrue(output.contains("Active profile: (none)"))
    }

    func testConfigShowWithActiveProfile() {
        let config = PIMConfiguration()
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: "work"
        )
        XCTAssertTrue(output.contains("Active profile: work"))
    }

    func testConfigShowAllDomainsEnabled() {
        let config = PIMConfiguration()
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: nil
        )
        XCTAssertTrue(output.contains("Calendars:"))
        XCTAssertTrue(output.contains("Reminders:"))
        XCTAssertTrue(output.contains("Contacts:"))
        XCTAssertTrue(output.contains("Mail:"))
        // All should show enabled
        let lines = output.components(separatedBy: "\n")
        let calLine = lines.first { $0.hasPrefix("Calendars:") }
        XCTAssertTrue(calLine?.contains("enabled") ?? false)
    }

    func testConfigShowDisabledDomain() {
        let config = PIMConfiguration(
            mail: DomainConfig(enabled: false)
        )
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: nil
        )
        let lines = output.components(separatedBy: "\n")
        let mailLine = lines.first { $0.hasPrefix("Mail:") }
        XCTAssertTrue(mailLine?.contains("disabled") ?? false)
    }

    func testConfigShowAllowlistWithItems() {
        let config = PIMConfiguration(
            calendars: DomainFilterConfig(enabled: true, mode: .allowlist, items: ["Personal", "Family"])
        )
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: nil
        )
        XCTAssertTrue(output.contains("mode: allowlist"))
        XCTAssertTrue(output.contains("items: Personal, Family"))
    }

    func testConfigShowDefaults() {
        let config = PIMConfiguration(
            defaultCalendar: "Personal",
            defaultReminderList: "Reminders"
        )
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: nil
        )
        XCTAssertTrue(output.contains("Default calendar:      Personal"))
        XCTAssertTrue(output.contains("Default reminder list: Reminders"))
    }

    func testConfigShowNoDefaults() {
        let config = PIMConfiguration()
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: nil
        )
        XCTAssertFalse(output.contains("Default calendar:"))
        XCTAssertFalse(output.contains("Default reminder list:"))
    }

    func testConfigShowTildeContraction() {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let config = PIMConfiguration()
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: home + "/.config/apple-pim/config.json",
            profilesDir: home + "/.config/apple-pim/profiles",
            activeProfile: nil
        )
        XCTAssertTrue(output.contains("~/.config/apple-pim/config.json"))
        XCTAssertTrue(output.contains("~/.config/apple-pim/profiles"))
        XCTAssertFalse(output.contains(home))
    }

    // MARK: - formatConfigInit

    func testConfigInitWithCalendarsAndReminders() {
        let calendars: [[String: Any]] = [
            ["title": "Personal", "type": "caldav", "source": "iCloud"],
            ["title": "Work", "type": "exchange", "source": "Exchange"]
        ]
        let reminders: [[String: Any]] = [
            ["title": "Reminders", "source": "iCloud"],
            ["title": "Shopping", "source": "iCloud"]
        ]
        let output = ConfigFormatter.formatConfigInit(
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            calendars: calendars,
            reminderLists: reminders,
            defaultCalendar: "Personal",
            defaultReminderList: "Reminders"
        )
        XCTAssertTrue(output.contains("Available Calendars"))
        XCTAssertTrue(output.contains("-------------------"))
        XCTAssertTrue(output.contains("Personal"))
        XCTAssertTrue(output.contains("caldav, iCloud"))
        XCTAssertTrue(output.contains("Work"))
        XCTAssertTrue(output.contains("exchange, Exchange"))
        XCTAssertTrue(output.contains("Available Reminder Lists"))
        XCTAssertTrue(output.contains("Reminders"))
        XCTAssertTrue(output.contains("Shopping"))
    }

    func testConfigInitRemindersOnly() {
        let reminders: [[String: Any]] = [
            ["title": "Reminders", "source": "iCloud"]
        ]
        let output = ConfigFormatter.formatConfigInit(
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            reminderLists: reminders,
            defaultReminderList: "Reminders"
        )
        XCTAssertFalse(output.contains("Available Calendars"))
        XCTAssertTrue(output.contains("Available Reminder Lists"))
    }

    func testConfigInitDefaults() {
        let output = ConfigFormatter.formatConfigInit(
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            reminderLists: [["title": "Reminders", "source": "iCloud"]],
            defaultCalendar: "Personal",
            defaultReminderList: "Reminders"
        )
        XCTAssertTrue(output.contains("Defaults:"))
        XCTAssertTrue(output.contains("Calendar:       Personal"))
        XCTAssertTrue(output.contains("Reminder list:  Reminders"))
    }

    func testConfigInitPathsAtEnd() {
        let output = ConfigFormatter.formatConfigInit(
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            reminderLists: [],
            defaultReminderList: ""
        )
        let lines = output.components(separatedBy: "\n")
        let configLine = lines.first { $0.hasPrefix("Config path:") }
        let profilesLine = lines.first { $0.hasPrefix("Profiles dir:") }
        XCTAssertNotNil(configLine)
        XCTAssertNotNil(profilesLine)
    }
}
