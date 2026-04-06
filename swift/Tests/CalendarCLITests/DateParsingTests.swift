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

    // MARK: - isDateOnly detection

    func testIsDateOnlyRelativeNames() {
        XCTAssertTrue(isDateOnly("today"))
        XCTAssertTrue(isDateOnly("Tomorrow"))
        XCTAssertTrue(isDateOnly("yesterday"))
    }

    func testIsDateOnlyISODate() {
        XCTAssertTrue(isDateOnly("2026-03-15"))
        XCTAssertTrue(isDateOnly("2026-12-01"))
    }

    func testIsDateOnlyUSDate() {
        XCTAssertTrue(isDateOnly("03/15/2026"))
    }

    func testIsDateOnlyFalseForDateTimes() {
        XCTAssertFalse(isDateOnly("2026-03-15T13:30:00"))
        XCTAssertFalse(isDateOnly("2026-03-15T13:30:00-07:00"))
        XCTAssertFalse(isDateOnly("2026-03-15 13:30"))
        XCTAssertFalse(isDateOnly("03/15/2026 13:30"))
        XCTAssertFalse(isDateOnly("next week"))
    }

    // MARK: - adjustToEndOfDay

    func testAdjustToEndOfDayForDateOnlyString() {
        let date = parseDate("2026-03-15")!
        let adjusted = adjustToEndOfDay(date, originalString: "2026-03-15")
        let comps = Calendar.current.dateComponents([.hour, .minute, .second], from: adjusted)
        XCTAssertEqual(comps.hour, 23)
        XCTAssertEqual(comps.minute, 59)
        XCTAssertEqual(comps.second, 59)
    }

    func testAdjustToEndOfDayForToday() {
        let date = parseDate("today")!
        let adjusted = adjustToEndOfDay(date, originalString: "today")
        let comps = Calendar.current.dateComponents([.hour, .minute, .second], from: adjusted)
        XCTAssertEqual(comps.hour, 23)
        XCTAssertEqual(comps.minute, 59)
        XCTAssertEqual(comps.second, 59)
    }

    func testAdjustToEndOfDayNoOpForDateTime() {
        let date = parseDate("2026-03-15T13:30:00")!
        let adjusted = adjustToEndOfDay(date, originalString: "2026-03-15T13:30:00")
        XCTAssertEqual(date, adjusted, "Should not adjust when time is explicit")
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
}
