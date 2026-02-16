import Contacts
import XCTest
@testable import ContactsCLI

final class ParsingHelpersTests: XCTestCase {
    func testParseBirthdayWithYear() throws {
        let birthday = try parseBirthday("2000-05-10")
        XCTAssertEqual(birthday.year, 2000)
        XCTAssertEqual(birthday.month, 5)
        XCTAssertEqual(birthday.day, 10)
    }

    func testParseBirthdayWithoutYear() throws {
        let birthday = try parseBirthday("05-10")
        XCTAssertNil(birthday.year)
        XCTAssertEqual(birthday.month, 5)
        XCTAssertEqual(birthday.day, 10)
    }

    func testParseBirthdayInvalidFormatThrows() {
        XCTAssertThrowsError(try parseBirthday("2026")) { error in
            guard let cliError = error as? CLIError else {
                XCTFail("Expected CLIError")
                return
            }
            XCTAssertTrue(cliError.errorDescription?.contains("Invalid birthday format") == true)
        }
    }

    func testLabelConstantMapsKnownValues() {
        XCTAssertEqual(labelConstant("home"), CNLabelHome)
        XCTAssertEqual(labelConstant("mobile"), CNLabelPhoneNumberMobile)
        XCTAssertEqual(labelConstant("homepage"), CNLabelURLAddressHomePage)
    }

    func testRelationLabelConstantMapsKnownValues() {
        XCTAssertEqual(relationLabelConstant("assistant"), CNLabelContactRelationAssistant)
        XCTAssertEqual(relationLabelConstant("wife"), CNLabelContactRelationWife)
        XCTAssertEqual(relationLabelConstant("custom"), "custom")
    }

    func testParseJSONArrayInvalidThrows() {
        XCTAssertThrowsError(try parseJSONArray("{bad")) { error in
            guard let cliError = error as? CLIError else {
                XCTFail("Expected CLIError")
                return
            }
            XCTAssertTrue(cliError.errorDescription?.contains("Invalid JSON array") == true)
        }
    }

    func testParseEmailsParsesLabelsAndValues() throws {
        let emails = try parseEmails("""
        [
          { "label": "work", "value": "ada@example.com" }
        ]
        """)
        XCTAssertEqual(emails.count, 1)
        XCTAssertEqual(emails[0].value as String, "ada@example.com")
        XCTAssertEqual(emails[0].label, CNLabelWork)
    }

    func testParsePhonesParsesLabelsAndValues() throws {
        let phones = try parsePhones("""
        [
          { "label": "mobile", "value": "+1 206 555 0100" }
        ]
        """)
        XCTAssertEqual(phones.count, 1)
        XCTAssertEqual(phones[0].value.stringValue, "+1 206 555 0100")
        XCTAssertEqual(phones[0].label, CNLabelPhoneNumberMobile)
    }

    func testParseAddressesParsesPostalFields() throws {
        let addresses = try parseAddresses("""
        [
          {
            "label": "home",
            "street": "1 Main St",
            "city": "Seattle",
            "state": "WA",
            "postalCode": "98101",
            "country": "USA"
          }
        ]
        """)
        XCTAssertEqual(addresses.count, 1)
        XCTAssertEqual(addresses[0].label, CNLabelHome)
        XCTAssertEqual(addresses[0].value.city, "Seattle")
        XCTAssertEqual(addresses[0].value.street, "1 Main St")
    }

    func testIsMergeConflictDetectsNestedUnderlyingError() {
        let deepest = NSError(domain: "CoreData", code: 134092, userInfo: nil)
        let wrapped = NSError(domain: "Wrapper", code: 1, userInfo: [NSUnderlyingErrorKey: deepest])
        XCTAssertTrue(isMergeConflict(wrapped))
    }

    func testIsMergeConflictReturnsFalseForOtherErrors() {
        let error = NSError(domain: "Test", code: 42, userInfo: nil)
        XCTAssertFalse(isMergeConflict(error))
    }
}
