import XCTest
@testable import CalendarCLI

final class DateParsingTests: XCTestCase {

    // MARK: - ISO 8601 with timezone offsets (the bug fix)

    func testISO8601WithNegativeOffset() {
        // "2026-03-15T13:30:00-07:00" should parse to 20:30 UTC
        let date = parseDate("2026-03-15T13:30:00-07:00")
        XCTAssertNotNil(date, "Should parse ISO 8601 with negative offset")

        let isoFmt = ISO8601DateFormatter()
        let result = isoFmt.string(from: date!)
        XCTAssertEqual(result, "2026-03-15T20:30:00Z")
    }

    func testISO8601WithPositiveOffset() {
        // "2026-03-15T13:30:00+05:30" should parse to 08:00 UTC
        let date = parseDate("2026-03-15T13:30:00+05:30")
        XCTAssertNotNil(date, "Should parse ISO 8601 with positive offset")

        let isoFmt = ISO8601DateFormatter()
        let result = isoFmt.string(from: date!)
        XCTAssertEqual(result, "2026-03-15T08:00:00Z")
    }

    func testISO8601WithZSuffix() {
        let date = parseDate("2026-03-15T20:30:00Z")
        XCTAssertNotNil(date, "Should parse ISO 8601 with Z suffix")

        let isoFmt = ISO8601DateFormatter()
        let result = isoFmt.string(from: date!)
        XCTAssertEqual(result, "2026-03-15T20:30:00Z")
    }

    func testISO8601WithFractionalSeconds() {
        let date = parseDate("2026-03-15T20:30:00.123Z")
        XCTAssertNotNil(date, "Should parse ISO 8601 with fractional seconds")

        let isoFmt = ISO8601DateFormatter()
        let result = isoFmt.string(from: date!)
        XCTAssertEqual(result, "2026-03-15T20:30:00Z")
    }

    func testISO8601WithZeroOffset() {
        let date = parseDate("2026-03-15T20:30:00+00:00")
        XCTAssertNotNil(date, "Should parse ISO 8601 with +00:00 offset")

        let isoFmt = ISO8601DateFormatter()
        let result = isoFmt.string(from: date!)
        XCTAssertEqual(result, "2026-03-15T20:30:00Z")
    }

    // MARK: - Existing formats still work

    func testLocalISO8601WithoutOffset() {
        let date = parseDate("2026-03-15T13:30:00")
        XCTAssertNotNil(date, "Should parse local ISO 8601 without offset")
    }

    func testDateTimeWithSpace() {
        let date = parseDate("2026-03-15 13:30")
        XCTAssertNotNil(date, "Should parse yyyy-MM-dd HH:mm")
    }

    func testDateTimeWithAMPM() {
        let date = parseDate("2026-03-15 1:30 PM")
        XCTAssertNotNil(date, "Should parse yyyy-MM-dd h:mm a")
    }

    func testDateOnly() {
        let date = parseDate("2026-03-15")
        XCTAssertNotNil(date, "Should parse yyyy-MM-dd")
    }

    func testUSDateFormat() {
        let date = parseDate("03/15/2026 13:30")
        XCTAssertNotNil(date, "Should parse MM/dd/yyyy HH:mm")
    }

    func testRelativeToday() {
        let date = parseDate("today")
        XCTAssertNotNil(date)
        let startOfToday = Calendar.current.startOfDay(for: Date())
        XCTAssertEqual(date, startOfToday)
    }

    func testRelativeTomorrow() {
        let date = parseDate("tomorrow")
        XCTAssertNotNil(date)
    }

    // MARK: - Precision: offset dates should NOT lose time component

    func testOffsetDatePreservesExactTime() {
        // This was the core bug: "T21:00:00-07:00" was falling through to
        // NSDataDetector which returned noon instead of 04:00 UTC next day
        let date = parseDate("2026-03-15T21:00:00-07:00")
        XCTAssertNotNil(date)

        let isoFmt = ISO8601DateFormatter()
        let result = isoFmt.string(from: date!)
        XCTAssertEqual(result, "2026-03-16T04:00:00Z",
            "9 PM PDT should be 4 AM UTC next day")
    }

    // MARK: - formatDate presets (APPLE_PIM_DATE_FORMAT)

    private func clearDateEnv() {
        unsetenv("APPLE_PIM_DATE_FORMAT")
    }

    func testFormatDateDefaultUTC() {
        clearDateEnv()
        let date = ISO8601DateFormatter().date(from: "2026-03-20T14:00:00Z")!
        XCTAssertEqual(formatDate(date), "2026-03-20T14:00:00Z")
    }

    func testFormatDateLocal() {
        clearDateEnv()
        setenv("APPLE_PIM_DATE_FORMAT", "local", 1)
        defer { clearDateEnv() }

        let date = ISO8601DateFormatter().date(from: "2026-03-20T14:00:00Z")!
        let result = formatDate(date)
        // Must contain T separator, must NOT end with Z, must have offset like +/-HH:MM
        XCTAssertTrue(result.contains("T"), "Local format should contain T separator")
        XCTAssertFalse(result.hasSuffix("Z"), "Local format should not end with Z")
        XCTAssertTrue(result.contains("+") || result.contains("-"),
            "Local format should include timezone offset")
    }

    func testFormatDateDayUTC() {
        clearDateEnv()
        setenv("APPLE_PIM_DATE_FORMAT", "day-utc", 1)
        defer { clearDateEnv() }

        let date = ISO8601DateFormatter().date(from: "2026-03-20T14:00:00Z")!
        XCTAssertEqual(formatDate(date), "Friday, 2026-03-20T14:00:00Z")
    }

    func testFormatDateDayLocal() {
        clearDateEnv()
        setenv("APPLE_PIM_DATE_FORMAT", "day-local", 1)
        defer { clearDateEnv() }

        let date = ISO8601DateFormatter().date(from: "2026-03-20T14:00:00Z")!
        let result = formatDate(date)
        XCTAssertTrue(result.hasPrefix("Friday,"), "day-local should start with day name")
        XCTAssertFalse(result.hasSuffix("Z"), "day-local should not end with Z")
        XCTAssertTrue(result.contains("+") || result.contains("-"),
            "day-local should include timezone offset")
    }

    func testFormatDateUnknownPreset() {
        clearDateEnv()
        setenv("APPLE_PIM_DATE_FORMAT", "bogus", 1)
        defer { clearDateEnv() }

        let date = ISO8601DateFormatter().date(from: "2026-03-20T14:00:00Z")!
        XCTAssertEqual(formatDate(date), "2026-03-20T14:00:00Z",
            "Unknown preset should fall back to UTC")
    }

}
