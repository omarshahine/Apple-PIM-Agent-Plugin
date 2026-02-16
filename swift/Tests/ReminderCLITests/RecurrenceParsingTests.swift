import EventKit
import XCTest
@testable import ReminderCLI

final class RecurrenceParsingTests: XCTestCase {
    func testParsesDailyFrequency() {
        let rule = parseRecurrenceRule("{\"frequency\":\"daily\"}")
        XCTAssertEqual(rule?.frequency, .daily)
        XCTAssertEqual(rule?.interval, 1)
    }

    func testParsesWeeklyDays() {
        let rule = parseRecurrenceRule("""
        {"frequency":"weekly","daysOfTheWeek":["monday","wed","fri"]}
        """)
        XCTAssertEqual(rule?.frequency, .weekly)
        XCTAssertEqual(rule?.daysOfTheWeek?.map(\.dayOfTheWeek), [.monday, .wednesday, .friday])
    }

    func testParsesMonthlyDaysOfMonth() {
        let rule = parseRecurrenceRule("""
        {"frequency":"monthly","daysOfTheMonth":[1,15]}
        """)
        XCTAssertEqual(rule?.frequency, .monthly)
        XCTAssertEqual(rule?.daysOfTheMonth?.map(\.intValue), [1, 15])
    }

    func testParsesYearlyInterval() {
        let rule = parseRecurrenceRule("""
        {"frequency":"yearly","interval":2}
        """)
        XCTAssertEqual(rule?.frequency, .yearly)
        XCTAssertEqual(rule?.interval, 2)
    }

    func testParsesOccurrenceCountEnd() {
        let rule = parseRecurrenceRule("""
        {"frequency":"weekly","occurrenceCount":10}
        """)
        XCTAssertEqual(rule?.recurrenceEnd?.occurrenceCount, 10)
    }

    func testParsesEndDate() {
        let rule = parseRecurrenceRule("""
        {"frequency":"weekly","endDate":"2026-12-31"}
        """)
        XCTAssertNotNil(rule?.recurrenceEnd?.endDate)
    }

    func testInvalidJSONReturnsNil() {
        XCTAssertNil(parseRecurrenceRule("{invalid"))
    }

    func testMissingFrequencyReturnsNil() {
        XCTAssertNil(parseRecurrenceRule("{\"interval\":2}"))
    }

    func testNoneFrequencyReturnsNil() {
        XCTAssertNil(parseRecurrenceRule("{\"frequency\":\"none\"}"))
    }

    func testDayStringMappings() {
        XCTAssertEqual(dayStringToEKDay("monday")?.dayOfTheWeek, .monday)
        XCTAssertEqual(dayStringToEKDay("TUE")?.dayOfTheWeek, .tuesday)
        XCTAssertEqual(dayStringToEKDay("fri")?.dayOfTheWeek, .friday)
        XCTAssertNil(dayStringToEKDay("funday"))
    }
}
