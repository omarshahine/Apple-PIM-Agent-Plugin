import XCTest
@testable import MailCLI

/// Confinement tests for `validateDestDir` — the authoritative boundary that
/// keeps save-attachment writes out of arbitrary or sensitive locations.
final class DestDirValidationTests: XCTestCase {
    private var home: URL {
        FileManager.default.homeDirectoryForCurrentUser
    }

    func testAcceptsDirectoryUnderHome() throws {
        XCTAssertNoThrow(try validateDestDir(home.appendingPathComponent("Downloads/pim-test")))
    }

    func testAcceptsSystemTemp() throws {
        XCTAssertNoThrow(try validateDestDir(FileManager.default.temporaryDirectory.appendingPathComponent("pim")))
    }

    func testRejectsPathOutsideHomeAndTemp() {
        XCTAssertThrowsError(try validateDestDir(URL(fileURLWithPath: "/etc/cron.d"))) { error in
            XCTAssertTrue("\(error)".contains("home directory or system temp"))
        }
    }

    func testRejectsLaunchAgentsInsideHome() {
        XCTAssertThrowsError(try validateDestDir(home.appendingPathComponent("Library/LaunchAgents"))) { error in
            XCTAssertTrue("\(error)".contains("LaunchAgents"))
        }
    }

    func testRejectsCredentialStoresInsideHome() {
        XCTAssertThrowsError(try validateDestDir(home.appendingPathComponent(".ssh")))
        XCTAssertThrowsError(try validateDestDir(home.appendingPathComponent(".aws/cache")))
    }

    func testRejectsTraversalEscapingIntoProtectedDir() {
        // Lexically resolves to ~/.ssh — must still be rejected before any mkdir.
        XCTAssertThrowsError(try validateDestDir(home.appendingPathComponent("Downloads/../.ssh")))
    }

    func testRejectsApplePIMConfigDirectory() {
        XCTAssertThrowsError(try validateDestDir(home.appendingPathComponent(".config/apple-pim"))) { error in
            XCTAssertTrue("\(error)".contains("apple-pim config"))
        }
    }

    func testValidationDoesNotCreateRejectedDirectory() throws {
        // A rejected target must never leave a stray directory behind.
        let target = home.appendingPathComponent("Library/LaunchAgents/pim-should-not-exist")
        XCTAssertThrowsError(try validateDestDir(target))
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
    }
}
