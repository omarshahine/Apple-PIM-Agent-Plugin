import XCTest
@testable import PIMConfig

final class OutputFormatTests: XCTestCase {
    func testOutputFormatRawValues() {
        XCTAssertEqual(OutputFormat.json.rawValue, "json")
        XCTAssertEqual(OutputFormat.text.rawValue, "text")
    }

    func testOutputFormatCaseIterable() {
        XCTAssertEqual(OutputFormat.allCases, [.json, .text])
    }

    func testOutputContextExplicitJSON() {
        let ctx = OutputContext(explicit: .json)
        XCTAssertTrue(ctx.isJSON)
        XCTAssertFalse(ctx.isText)
        XCTAssertEqual(ctx.format, .json)
    }

    func testOutputContextExplicitText() {
        let ctx = OutputContext(explicit: .text)
        XCTAssertTrue(ctx.isText)
        XCTAssertFalse(ctx.isJSON)
        XCTAssertEqual(ctx.format, .text)
    }

    func testOutputContextAutoDetectsNonTTY() {
        // In a test runner, stdout is not a TTY, so auto-detect should pick JSON
        let ctx = OutputContext(explicit: nil)
        XCTAssertTrue(ctx.isJSON)
    }

    func testOutputFormatFromArgument() {
        // ExpressibleByArgument should parse from string
        XCTAssertEqual(OutputFormat(rawValue: "json"), .json)
        XCTAssertEqual(OutputFormat(rawValue: "text"), .text)
        XCTAssertNil(OutputFormat(rawValue: "xml"))
    }
}
