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
}
