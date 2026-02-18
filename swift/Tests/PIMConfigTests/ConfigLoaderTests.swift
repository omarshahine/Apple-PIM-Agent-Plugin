import Foundation
import Testing
@testable import PIMConfig

@Suite("ConfigLoader")
struct ConfigLoaderTests {

    // MARK: - Base config loading

    @Test("Default config when no file exists")
    func testDefaultConfigWhenNoFile() {
        // ConfigLoader.loadBaseConfig() returns all-access defaults when file is missing
        // We test the default PIMConfiguration struct directly
        let config = PIMConfiguration()
        #expect(config.calendars.enabled == true)
        #expect(config.calendars.mode == .all)
        #expect(config.calendars.items.isEmpty)
        #expect(config.reminders.enabled == true)
        #expect(config.reminders.mode == .all)
        #expect(config.contacts.enabled == true)
        #expect(config.mail.enabled == true)
        #expect(config.defaultCalendar == nil)
        #expect(config.defaultReminderList == nil)
    }

    // MARK: - JSON round-trip

    @Test("Config encodes and decodes correctly")
    func testConfigRoundTrip() throws {
        let config = PIMConfiguration(
            calendars: DomainFilterConfig(enabled: true, mode: .allowlist, items: ["Personal", "Family"]),
            reminders: DomainFilterConfig(enabled: true, mode: .blocklist, items: ["Spam"]),
            contacts: DomainFilterConfig(enabled: false),
            mail: DomainConfig(enabled: true),
            defaultCalendar: "Personal",
            defaultReminderList: "Reminders"
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(config)
        let decoded = try JSONDecoder().decode(PIMConfiguration.self, from: data)

        #expect(decoded == config)
    }

    @Test("Config uses snake_case JSON keys")
    func testSnakeCaseKeys() throws {
        let config = PIMConfiguration(
            defaultCalendar: "Work",
            defaultReminderList: "Tasks"
        )

        let data = try JSONEncoder().encode(config)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        #expect(json["default_calendar"] as? String == "Work")
        #expect(json["default_reminder_list"] as? String == "Tasks")
        // Verify camelCase keys are NOT present
        #expect(json["defaultCalendar"] == nil)
        #expect(json["defaultReminderList"] == nil)
    }

    // MARK: - Profile merging

    @Test("Profile override replaces entire domain section")
    func testProfileMergeReplacesEntireDomain() {
        let base = PIMConfiguration(
            calendars: DomainFilterConfig(enabled: true, mode: .allowlist, items: ["A", "B", "C"]),
            reminders: DomainFilterConfig(enabled: true, mode: .allowlist, items: ["X", "Y"]),
            defaultCalendar: "A",
            defaultReminderList: "X"
        )

        let profile = PIMProfileOverride(
            calendars: DomainFilterConfig(enabled: true, mode: .allowlist, items: ["B"]),
            defaultCalendar: "B"
        )

        let merged = ConfigLoader.merge(base: base, profile: profile)

        // Calendars fully replaced by profile
        #expect(merged.calendars.items == ["B"])
        #expect(merged.defaultCalendar == "B")

        // Reminders inherited from base (not in profile)
        #expect(merged.reminders.items == ["X", "Y"])
        #expect(merged.defaultReminderList == "X")
    }

    @Test("Nil profile returns base unchanged")
    func testNilProfileReturnsBase() {
        let base = PIMConfiguration(
            calendars: DomainFilterConfig(enabled: true, mode: .allowlist, items: ["Personal"]),
            defaultCalendar: "Personal"
        )

        let merged = ConfigLoader.merge(base: base, profile: nil)
        #expect(merged == base)
    }

    @Test("Profile with no overrides returns base unchanged")
    func testEmptyProfileReturnsBase() {
        let base = PIMConfiguration(
            calendars: DomainFilterConfig(enabled: true, mode: .allowlist, items: ["Personal"]),
            defaultCalendar: "Personal"
        )

        let profile = PIMProfileOverride()
        let merged = ConfigLoader.merge(base: base, profile: profile)
        #expect(merged == base)
    }

    @Test("Profile can disable a domain")
    func testProfileDisablesDomain() {
        let base = PIMConfiguration(
            mail: DomainConfig(enabled: true)
        )

        let profile = PIMProfileOverride(
            mail: DomainConfig(enabled: false)
        )

        let merged = ConfigLoader.merge(base: base, profile: profile)
        #expect(merged.mail.enabled == false)
    }

    // MARK: - Profile JSON round-trip

    @Test("Profile encodes and decodes correctly")
    func testProfileRoundTrip() throws {
        let profile = PIMProfileOverride(
            calendars: DomainFilterConfig(enabled: true, mode: .allowlist, items: ["Family"]),
            defaultCalendar: "Family"
        )

        let data = try JSONEncoder().encode(profile)
        let decoded = try JSONDecoder().decode(PIMProfileOverride.self, from: data)
        #expect(decoded == profile)
    }

    @Test("Profile with only some fields omits others in JSON")
    func testProfilePartialEncoding() throws {
        let profile = PIMProfileOverride(
            calendars: DomainFilterConfig(enabled: true, mode: .allowlist, items: ["Family"])
        )

        let data = try JSONEncoder().encode(profile)
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]

        // calendars should be present
        #expect(json["calendars"] != nil)
        // reminders should NOT be present (nil in profile)
        #expect(json["reminders"] == nil)
    }
}
