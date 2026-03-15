import XCTest
@testable import ReminderCLI

final class DateParsingTests: XCTestCase {

    // MARK: - ISO 8601 with timezone offsets (the bug fix)

    func testISO8601WithNegativeOffset() {
        let date = parseDate("2026-03-15T13:30:00-07:00")
        XCTAssertNotNil(date, "Should parse ISO 8601 with negative offset")

        let isoFmt = ISO8601DateFormatter()
        let result = isoFmt.string(from: date!)
        XCTAssertEqual(result, "2026-03-15T20:30:00Z")
    }

    func testISO8601WithPositiveOffset() {
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

    func testDateOnly() {
        let date = parseDate("2026-03-15")
        XCTAssertNotNil(date, "Should parse yyyy-MM-dd")
    }

    // MARK: - Precision: offset dates should NOT lose time component

    func testOffsetDatePreservesExactTime() {
        let date = parseDate("2026-03-15T21:00:00-07:00")
        XCTAssertNotNil(date)

        let isoFmt = ISO8601DateFormatter()
        let result = isoFmt.string(from: date!)
        XCTAssertEqual(result, "2026-03-16T04:00:00Z",
            "9 PM PDT should be 4 AM UTC next day")
    }
}
