import XCTest
@testable import CalendarCLI

final class BatchCreateEventValidationTests: XCTestCase {
    func testDecodeBatchEventsValidJSON() throws {
        let json = """
        [
          {
            "title": "Standup",
            "start": "2026-02-20 09:00",
            "duration": 30
          },
          {
            "title": "Planning",
            "start": "2026-02-20 10:00",
            "calendar": "Work"
          }
        ]
        """

        let events = try decodeBatchEvents(json)
        XCTAssertEqual(events.count, 2)
        XCTAssertEqual(events.first?.title, "Standup")
        XCTAssertEqual(events.last?.calendar, "Work")
    }

    func testDecodeBatchEventsInvalidJSONThrows() {
        XCTAssertThrowsError(try decodeBatchEvents("{invalid")) { error in
            guard let cliError = error as? CLIError else {
                XCTFail("Expected CLIError")
                return
            }
            XCTAssertEqual(cliError.errorDescription, "Invalid JSON format for events array")
        }
    }

    func testDecodeBatchEventsEmptyArrayThrows() {
        XCTAssertThrowsError(try decodeBatchEvents("[]")) { error in
            guard let cliError = error as? CLIError else {
                XCTFail("Expected CLIError")
                return
            }
            XCTAssertEqual(cliError.errorDescription, "Events array cannot be empty")
        }
    }

    func testDecodeBatchEventsWithRecurrenceDecodes() throws {
        let json = """
        [
          {
            "title": "Recurring Standup",
            "start": "2026-02-20 09:00",
            "recurrence": {
              "frequency": "weekly",
              "daysOfTheWeek": ["monday", "wednesday"]
            }
          }
        ]
        """

        let events = try decodeBatchEvents(json)
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].recurrence?.frequency, "weekly")
        XCTAssertEqual(events[0].recurrence?.daysOfTheWeek ?? [], ["monday", "wednesday"])
    }

    func testResolveBatchEventDatesUsesDurationWhenEndMissing() throws {
        let input = BatchEventInput(
            title: "Standup",
            start: "2026-02-20 09:00",
            end: nil,
            duration: 45,
            calendar: nil,
            location: nil,
            notes: nil,
            url: nil,
            allDay: nil,
            alarm: nil,
            recurrence: nil
        )

        let dates = try resolveBatchEventDates(input)
        let delta = Int(dates.endDate.timeIntervalSince(dates.startDate) / 60)
        XCTAssertEqual(delta, 45)
    }

    func testResolveBatchEventDatesDefaultsToOneHour() throws {
        let input = BatchEventInput(
            title: "Planning",
            start: "2026-02-20 10:00",
            end: nil,
            duration: nil,
            calendar: nil,
            location: nil,
            notes: nil,
            url: nil,
            allDay: nil,
            alarm: nil,
            recurrence: nil
        )

        let dates = try resolveBatchEventDates(input)
        let delta = Int(dates.endDate.timeIntervalSince(dates.startDate) / 60)
        XCTAssertEqual(delta, 60)
    }

    func testResolveBatchEventDatesInvalidStartThrows() {
        let input = BatchEventInput(
            title: "Bad",
            start: "not-a-date",
            end: nil,
            duration: nil,
            calendar: nil,
            location: nil,
            notes: nil,
            url: nil,
            allDay: nil,
            alarm: nil,
            recurrence: nil
        )

        XCTAssertThrowsError(try resolveBatchEventDates(input)) { error in
            guard let cliError = error as? CLIError else {
                XCTFail("Expected CLIError")
                return
            }
            XCTAssertEqual(cliError.errorDescription, "Invalid start date: not-a-date")
        }
    }

    func testResolveBatchEventDatesInvalidEndThrows() {
        let input = BatchEventInput(
            title: "Bad end",
            start: "2026-02-20 10:00",
            end: "bad-end",
            duration: nil,
            calendar: nil,
            location: nil,
            notes: nil,
            url: nil,
            allDay: nil,
            alarm: nil,
            recurrence: nil
        )

        XCTAssertThrowsError(try resolveBatchEventDates(input)) { error in
            guard let cliError = error as? CLIError else {
                XCTFail("Expected CLIError")
                return
            }
            XCTAssertEqual(cliError.errorDescription, "Invalid end date: bad-end")
        }
    }
}
