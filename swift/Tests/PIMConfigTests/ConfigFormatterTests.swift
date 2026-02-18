import Foundation
import Testing
@testable import PIMConfig

@Suite("ConfigFormatter")
struct ConfigFormatterTests {

    // MARK: - formatConfigShow

    @Test("Config show header")
    func testConfigShowHeader() {
        let config = PIMConfiguration()
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: nil
        )
        #expect(output.contains("Apple PIM Configuration"))
        #expect(output.contains("======================="))
    }

    @Test("Config show paths")
    func testConfigShowPaths() {
        let config = PIMConfiguration()
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: nil
        )
        #expect(output.contains("Config path:    /tmp/config.json"))
        #expect(output.contains("Profiles dir:   /tmp/profiles"))
    }

    @Test("Config show no active profile")
    func testConfigShowNoActiveProfile() {
        let config = PIMConfiguration()
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: nil
        )
        #expect(output.contains("Active profile: (none)"))
    }

    @Test("Config show with active profile")
    func testConfigShowWithActiveProfile() {
        let config = PIMConfiguration()
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: "work"
        )
        #expect(output.contains("Active profile: work"))
    }

    @Test("Config show all domains enabled")
    func testConfigShowAllDomainsEnabled() {
        let config = PIMConfiguration()
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: nil
        )
        #expect(output.contains("Calendars:"))
        #expect(output.contains("Reminders:"))
        #expect(output.contains("Contacts:"))
        #expect(output.contains("Mail:"))
        // All should show enabled
        let lines = output.components(separatedBy: "\n")
        let calLine = lines.first { $0.hasPrefix("Calendars:") }
        #expect(calLine?.contains("enabled") ?? false)
    }

    @Test("Config show disabled domain")
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
        #expect(mailLine?.contains("disabled") ?? false)
    }

    @Test("Config show allowlist with items")
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
        #expect(output.contains("mode: allowlist"))
        #expect(output.contains("items: Personal, Family"))
    }

    @Test("Config show defaults")
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
        #expect(output.contains("Default calendar:      Personal"))
        #expect(output.contains("Default reminder list: Reminders"))
    }

    @Test("Config show no defaults")
    func testConfigShowNoDefaults() {
        let config = PIMConfiguration()
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            activeProfile: nil
        )
        #expect(!output.contains("Default calendar:"))
        #expect(!output.contains("Default reminder list:"))
    }

    @Test("Config show tilde contraction")
    func testConfigShowTildeContraction() {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let config = PIMConfiguration()
        let output = ConfigFormatter.formatConfigShow(
            config: config,
            configPath: home + "/.config/apple-pim/config.json",
            profilesDir: home + "/.config/apple-pim/profiles",
            activeProfile: nil
        )
        #expect(output.contains("~/.config/apple-pim/config.json"))
        #expect(output.contains("~/.config/apple-pim/profiles"))
        #expect(!output.contains(home))
    }

    // MARK: - formatConfigInit

    @Test("Config init with calendars and reminders")
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
        #expect(output.contains("Available Calendars"))
        #expect(output.contains("-------------------"))
        #expect(output.contains("Personal"))
        #expect(output.contains("caldav, iCloud"))
        #expect(output.contains("Work"))
        #expect(output.contains("exchange, Exchange"))
        #expect(output.contains("Available Reminder Lists"))
        #expect(output.contains("Reminders"))
        #expect(output.contains("Shopping"))
    }

    @Test("Config init reminders only")
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
        #expect(!output.contains("Available Calendars"))
        #expect(output.contains("Available Reminder Lists"))
    }

    @Test("Config init defaults")
    func testConfigInitDefaults() {
        let output = ConfigFormatter.formatConfigInit(
            configPath: "/tmp/config.json",
            profilesDir: "/tmp/profiles",
            reminderLists: [["title": "Reminders", "source": "iCloud"]],
            defaultCalendar: "Personal",
            defaultReminderList: "Reminders"
        )
        #expect(output.contains("Defaults:"))
        #expect(output.contains("Calendar:       Personal"))
        #expect(output.contains("Reminder list:  Reminders"))
    }

    @Test("Config init paths at end")
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
        #expect(configLine != nil)
        #expect(profilesLine != nil)
    }
}
