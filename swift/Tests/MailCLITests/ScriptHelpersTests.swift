import XCTest
@testable import MailCLI

final class ScriptHelpersTests: XCTestCase {
    func testEscapeForJXAEscapesQuotesBackslashesAndControlChars() {
        let raw = "a\\b'c\"d\ne\rf\tg"
        let escaped = escapeForJXA(raw)
        XCTAssertEqual(escaped, "a\\\\b\\'c\\\"d\\ne\\rf\\tg")
    }

    func testFindMessageJXAUsesNullHintsWhenNotProvided() {
        let script = findMessageJXA(targetId: "<id>", mailbox: nil, account: nil)
        XCTAssertTrue(script.contains("const mboxHint = null;"))
        XCTAssertTrue(script.contains("const acctHint = null;"))
    }

    func testFindMessageJXAInjectsEscapedHints() {
        let script = findMessageJXA(
            targetId: "<id'\"\\\\>",
            mailbox: "Inbox 'Primary'",
            account: "Personal \"Account\""
        )
        XCTAssertTrue(script.contains("const targetId = '<id\\'\\\"\\\\\\\\>';"))
        XCTAssertTrue(script.contains("const mboxHint = 'Inbox \\'Primary\\'';"))
        XCTAssertTrue(script.contains("const acctHint = 'Personal \\\"Account\\\"';"))
    }

    func testBatchFindMessageJXAUsesNullHintsWhenNotProvided() {
        let script = batchFindMessageJXA(mailbox: nil, account: nil)
        XCTAssertTrue(script.contains("const mboxHint = null;"))
        XCTAssertTrue(script.contains("const acctHint = null;"))
        XCTAssertTrue(script.contains("function findMsg(targetId)"))
    }
}
