import Foundation
import Testing
@testable import PIMConfig

@Suite("ConfigWriter")
struct ConfigWriterTests {

    /// Create a temporary directory for test configs.
    private func makeTempDir() throws -> URL {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("PIMConfigTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        return tmp
    }

    @Test("Write and read back base config")
    func testWriteAndReadConfig() throws {
        let tmpDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tmpDir) }

        let configPath = tmpDir.appendingPathComponent("config.json")

        let config = PIMConfiguration(
            calendars: DomainFilterConfig(enabled: true, mode: .allowlist, items: ["Personal", "✈️ Travel"]),
            reminders: DomainFilterConfig(enabled: true, mode: .blocklist, items: ["Spam"]),
            contacts: DomainFilterConfig(enabled: false),
            mail: DomainConfig(enabled: true),
            defaultCalendar: "Personal",
            defaultReminderList: "Reminders"
        )

        // Write
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(config)
        try data.write(to: configPath)

        // Read back
        let readData = try Data(contentsOf: configPath)
        let decoded = try JSONDecoder().decode(PIMConfiguration.self, from: readData)

        #expect(decoded == config)
        #expect(decoded.calendars.items.count == 2)
        #expect(decoded.calendars.items.contains("✈️ Travel"))
    }

    @Test("Write and read back profile")
    func testWriteAndReadProfile() throws {
        let tmpDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tmpDir) }

        let profilePath = tmpDir.appendingPathComponent("test-profile.json")

        let profile = PIMProfileOverride(
            calendars: DomainFilterConfig(enabled: true, mode: .allowlist, items: ["Family"]),
            defaultCalendar: "Family"
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(profile)
        try data.write(to: profilePath)

        let readData = try Data(contentsOf: profilePath)
        let decoded = try JSONDecoder().decode(PIMProfileOverride.self, from: readData)

        #expect(decoded == profile)
        #expect(decoded.calendars?.items == ["Family"])
        #expect(decoded.reminders == nil) // Not specified in profile
    }

    @Test("Written JSON is human-readable with sorted keys")
    func testPrettyPrintedOutput() throws {
        let tmpDir = try makeTempDir()
        defer { try? FileManager.default.removeItem(at: tmpDir) }

        let configPath = tmpDir.appendingPathComponent("config.json")

        let config = PIMConfiguration(
            calendars: DomainFilterConfig(enabled: true, mode: .allowlist, items: ["Personal"]),
            defaultCalendar: "Personal"
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(config)
        try data.write(to: configPath)

        let content = try String(contentsOf: configPath, encoding: .utf8)

        // Should contain newlines (pretty-printed)
        #expect(content.contains("\n"))
        // Should have sorted keys: "calendars" comes before "default_calendar"
        let calendarsIndex = content.range(of: "\"calendars\"")!.lowerBound
        let defaultIndex = content.range(of: "\"default_calendar\"")!.lowerBound
        #expect(calendarsIndex < defaultIndex)
    }
}
