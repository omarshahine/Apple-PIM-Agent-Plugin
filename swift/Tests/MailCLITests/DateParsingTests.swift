import XCTest
@testable import MailCLI

final class DateParsingTests: XCTestCase {
    func testDateOnlyFormat() {
        let result = parseISO8601ForJXA("2026-05-01")
        XCTAssertNotNil(result)
        XCTAssertTrue(result!.hasPrefix("2026-05-01"))
    }

    func testFullDatetimeWithZ() {
        let result = parseISO8601ForJXA("2026-05-01T12:00:00Z")
        XCTAssertNotNil(result)
        XCTAssertEqual(result, "2026-05-01T12:00:00Z")
    }

    func testFullDatetimeWithOffset() {
        let result = parseISO8601ForJXA("2026-05-01T12:00:00-07:00")
        XCTAssertNotNil(result)
        XCTAssertTrue(result!.contains("2026-05-01"))
    }

    func testInvalidStringReturnsNil() {
        XCTAssertNil(parseISO8601ForJXA("last week"))
    }

    func testEmptyStringReturnsNil() {
        XCTAssertNil(parseISO8601ForJXA(""))
    }

    func testWhitespaceOnlyReturnsNil() {
        XCTAssertNil(parseISO8601ForJXA("   "))
    }

    func testGarbageReturnsNil() {
        XCTAssertNil(parseISO8601ForJXA("not-a-date"))
    }

    func testFutureDateAccepted() {
        let result = parseISO8601ForJXA("2030-01-01")
        XCTAssertNotNil(result)
    }

    func testPartialDateReturnsNil() {
        XCTAssertNil(parseISO8601ForJXA("2026-05"))
    }
}
