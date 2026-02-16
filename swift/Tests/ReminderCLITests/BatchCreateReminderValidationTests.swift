import XCTest
@testable import ReminderCLI

final class BatchCreateReminderValidationTests: XCTestCase {
    func testDecodeBatchRemindersValidJSON() throws {
        let json = """
        [
          {
            "title": "Buy groceries",
            "priority": 5
          },
          {
            "title": "Pay bill",
            "list": "Finance",
            "due": "2026-02-21 17:00"
          }
        ]
        """

        let reminders = try decodeBatchReminders(json)
        XCTAssertEqual(reminders.count, 2)
        XCTAssertEqual(reminders.first?.title, "Buy groceries")
        XCTAssertEqual(reminders.last?.list, "Finance")
    }

    func testDecodeBatchRemindersInvalidJSONThrows() {
        XCTAssertThrowsError(try decodeBatchReminders("{invalid")) { error in
            guard let cliError = error as? CLIError else {
                XCTFail("Expected CLIError")
                return
            }
            XCTAssertEqual(cliError.errorDescription, "Invalid JSON format for reminders array")
        }
    }

    func testDecodeBatchRemindersEmptyArrayThrows() {
        XCTAssertThrowsError(try decodeBatchReminders("[]")) { error in
            guard let cliError = error as? CLIError else {
                XCTFail("Expected CLIError")
                return
            }
            XCTAssertEqual(cliError.errorDescription, "Reminders array cannot be empty")
        }
    }

    func testDecodeBatchRemindersWithRecurrenceAndLocation() throws {
        let json = """
        [
          {
            "title": "Recurring location reminder",
            "recurrence": {
              "frequency": "monthly",
              "daysOfTheMonth": [1, 15]
            },
            "location": {
              "name": "Office",
              "latitude": 47.6062,
              "longitude": -122.3321,
              "radius": 120,
              "proximity": "arrive"
            }
          }
        ]
        """

        let reminders = try decodeBatchReminders(json)
        XCTAssertEqual(reminders.count, 1)
        XCTAssertEqual(reminders[0].recurrence?.frequency, "monthly")
        XCTAssertEqual(reminders[0].location?.name, "Office")
        XCTAssertEqual(reminders[0].location?.proximity, "arrive")
    }

    func testBatchReminderDueDateComponentsParsesValidDate() {
        let components = batchReminderDueDateComponents("2026-02-21 17:00")
        XCTAssertEqual(components?.year, 2026)
        XCTAssertEqual(components?.month, 2)
        XCTAssertEqual(components?.day, 21)
        XCTAssertEqual(components?.hour, 17)
        XCTAssertEqual(components?.minute, 0)
    }

    func testBatchReminderDueDateComponentsReturnsNilForInvalidDate() {
        XCTAssertNil(batchReminderDueDateComponents("bad-date"))
        XCTAssertNil(batchReminderDueDateComponents(nil))
    }
}
