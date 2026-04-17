import Foundation
import Testing
@testable import PIMConfig

@Suite("SecretsStore", .serialized)
struct SecretsStoreTests {

    // Each test runs with isolated config + openclaw dirs and cleans up after itself.
    // Use `.serialized` because we mutate process environment variables and `chdir`-ish state.

    private struct Harness {
        let root: URL
        let configDir: URL
        let openclawPath: URL

        init() {
            let tmp = FileManager.default.temporaryDirectory
                .appendingPathComponent("apple-pim-secrets-test-\(UUID().uuidString)")
            try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
            self.root = tmp
            self.configDir = tmp.appendingPathComponent("config/apple-pim")
            self.openclawPath = tmp.appendingPathComponent("openclaw/secrets.json")
            setenv("APPLE_PIM_CONFIG_DIR", configDir.path, 1)
            setenv("OPENCLAW_SECRETS_PATH", openclawPath.path, 1)
            try? FileManager.default.createDirectory(at: configDir, withIntermediateDirectories: true)
            try? FileManager.default.createDirectory(
                at: openclawPath.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
        }

        func tearDown() {
            unsetenv("APPLE_PIM_CONFIG_DIR")
            unsetenv("OPENCLAW_SECRETS_PATH")
            try? FileManager.default.removeItem(at: root)
        }

        func writeOpenclawJSON(_ json: String) throws {
            try json.write(to: openclawPath, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes(
                [.posixPermissions: NSNumber(value: 0o600)],
                ofItemAtPath: openclawPath.path
            )
        }

        func writeStandaloneJSON(_ json: String) throws {
            let path = configDir.appendingPathComponent("secrets.json")
            try json.write(to: path, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes(
                [.posixPermissions: NSNumber(value: 0o600)],
                ofItemAtPath: path.path
            )
        }
    }

    // MARK: - Key validation

    @Test("Valid keys accepted")
    func testValidKeys() throws {
        for k in ["smtp.icloud.password", "a", "a.b", "a-b.c_d", "FOO.BAR"] {
            try SecretsStore.validateKey(k)
        }
    }

    @Test("Invalid keys rejected")
    func testInvalidKeys() {
        let cases = ["", ".foo", "foo.", "foo..bar", "foo/bar", "foo bar", "foo$bar", "foo~bar"]
        for k in cases {
            #expect(throws: SecretsError.self) { try SecretsStore.validateKey(k) }
        }
    }

    @Test("Env var name mapping")
    func testEnvVarName() {
        #expect(SecretsStore.envVarName(for: "smtp.icloud.password") == "SMTP_ICLOUD_PASSWORD")
        #expect(SecretsStore.envVarName(for: "a.b") == "A_B")
        #expect(SecretsStore.envVarName(for: "X") == "X")
    }

    // MARK: - Resolution order

    @Test("Env var wins over both files")
    func testEnvWins() throws {
        let h = Harness(); defer { h.tearDown() }
        try h.writeOpenclawJSON(#"{"smtp":{"icloud":{"password":"from-openclaw"}}}"#)
        try h.writeStandaloneJSON(#"{"smtp":{"icloud":{"password":"from-standalone"}}}"#)
        setenv("SMTP_ICLOUD_PASSWORD", "from-env", 1)
        defer { unsetenv("SMTP_ICLOUD_PASSWORD") }
        #expect(SecretsStore.resolve("smtp.icloud.password") == "from-env")
    }

    @Test("OpenClaw wins over standalone")
    func testOpenclawWinsOverStandalone() throws {
        let h = Harness(); defer { h.tearDown() }
        try h.writeOpenclawJSON(#"{"smtp":{"icloud":{"password":"from-openclaw"}}}"#)
        try h.writeStandaloneJSON(#"{"smtp":{"icloud":{"password":"from-standalone"}}}"#)
        #expect(SecretsStore.resolve("smtp.icloud.password") == "from-openclaw")
    }

    @Test("Standalone used when openclaw lacks the key")
    func testFallsThroughToStandalone() throws {
        let h = Harness(); defer { h.tearDown() }
        try h.writeOpenclawJSON(#"{"other":"value"}"#)
        try h.writeStandaloneJSON(#"{"smtp":{"icloud":{"password":"from-standalone"}}}"#)
        #expect(SecretsStore.resolve("smtp.icloud.password") == "from-standalone")
    }

    @Test("Nil when no store has the key")
    func testNilWhenMissing() throws {
        let h = Harness(); defer { h.tearDown() }
        #expect(SecretsStore.resolve("nope.nope") == nil)
    }

    // MARK: - Write + read round trip

    @Test("Auto writes to standalone when neither file exists")
    func testAutoWritesStandalone() throws {
        let h = Harness(); defer { h.tearDown() }
        let kind = try SecretsStore.write("smtp.icloud.password", value: "secret-1", to: .auto)
        #expect(kind == .standalone)
        #expect(try SecretsStore.read("smtp.icloud.password", from: .standalone) == "secret-1")
    }

    @Test("Auto prefers openclaw when that file exists")
    func testAutoPrefersOpenclaw() throws {
        let h = Harness(); defer { h.tearDown() }
        try h.writeOpenclawJSON(#"{}"#)
        let kind = try SecretsStore.write("smtp.icloud.password", value: "secret-2", to: .auto)
        #expect(kind == .openclaw)
        #expect(try SecretsStore.read("smtp.icloud.password", from: .openclaw) == "secret-2")
    }

    @Test("Auto follows the existing home of a key")
    func testAutoFollowsExistingKey() throws {
        let h = Harness(); defer { h.tearDown() }
        try h.writeOpenclawJSON(#"{"other":"value"}"#)
        try h.writeStandaloneJSON(#"{"smtp":{"icloud":{"password":"old"}}}"#)
        let kind = try SecretsStore.write("smtp.icloud.password", value: "new", to: .auto)
        #expect(kind == .standalone)
        #expect(try SecretsStore.read("smtp.icloud.password", from: .standalone) == "new")
    }

    @Test("Write preserves unrelated keys in the same store")
    func testWritePreservesSiblings() throws {
        let h = Harness(); defer { h.tearDown() }
        try h.writeStandaloneJSON(#"{"a":{"b":"keep"},"other":"preserve"}"#)
        try SecretsStore.write("a.c", value: "new", to: .standalone)

        #expect(try SecretsStore.read("a.b", from: .standalone) == "keep")
        #expect(try SecretsStore.read("a.c", from: .standalone) == "new")
        #expect(try SecretsStore.read("other", from: .standalone) == "preserve")
    }

    @Test("Written files have 0600 perms")
    func testWrittenFilePerms() throws {
        let h = Harness(); defer { h.tearDown() }
        try SecretsStore.write("a.b", value: "x", to: .standalone)
        let path = h.configDir.appendingPathComponent("secrets.json").path
        let attrs = try FileManager.default.attributesOfItem(atPath: path)
        let mode = (attrs[.posixPermissions] as! NSNumber).uint16Value & 0o777
        #expect(mode == 0o600)
    }

    @Test("Standalone write drops Spotlight marker")
    func testSpotlightMarker() throws {
        let h = Harness(); defer { h.tearDown() }
        try SecretsStore.write("a.b", value: "x", to: .standalone)
        let marker = h.configDir.appendingPathComponent(".metadata_never_index").path
        #expect(FileManager.default.fileExists(atPath: marker))
    }

    // MARK: - List + unset

    @Test("List returns dotted keys sorted, values never leak")
    func testListReturnsKeys() throws {
        let h = Harness(); defer { h.tearDown() }
        try h.writeStandaloneJSON(#"""
        {"smtp":{"icloud":{"password":"p","username":"u"}},"api":{"key":"k"}}
        """#)
        let keys = try SecretsStore.list(from: .standalone)
        #expect(keys == ["api.key", "smtp.icloud.password", "smtp.icloud.username"])
    }

    @Test("Unset removes key from store, cleans empty parents")
    func testUnsetRemoves() throws {
        let h = Harness(); defer { h.tearDown() }
        try h.writeStandaloneJSON(#"{"smtp":{"icloud":{"password":"p"}},"keep":"v"}"#)
        #expect(try SecretsStore.unset("smtp.icloud.password", from: .standalone))

        let keys = try SecretsStore.list(from: .standalone)
        // Empty parents pruned; only "keep" remains.
        #expect(keys == ["keep"])
    }

    @Test("Unset returns false when key absent")
    func testUnsetMissingKey() throws {
        let h = Harness(); defer { h.tearDown() }
        try h.writeStandaloneJSON(#"{}"#)
        #expect(try SecretsStore.unset("nope", from: .standalone) == false)
    }

    // MARK: - Error surfaces

    @Test("Malformed store throws malformedStore")
    func testMalformedJSON() throws {
        let h = Harness(); defer { h.tearDown() }
        try "this is not json".write(
            to: h.configDir.appendingPathComponent("secrets.json"),
            atomically: true, encoding: .utf8
        )
        #expect(throws: SecretsError.self) {
            _ = try SecretsStore.read("a.b", from: .standalone)
        }
    }

    @Test("Read on missing key throws notFound")
    func testReadMissingKeyThrows() throws {
        let h = Harness(); defer { h.tearDown() }
        try h.writeStandaloneJSON(#"{"a":"b"}"#)
        #expect(throws: SecretsError.self) {
            _ = try SecretsStore.read("missing", from: .standalone)
        }
    }

    // MARK: - Pointer helpers

    @Test("Nested pointer insertion creates intermediate dicts")
    func testNestedInsert() {
        var d: [String: Any] = [:]
        SecretsStore.insertPointer(["a", "b", "c"], value: "x", in: &d)
        #expect((d["a"] as? [String: Any])?["b"] as? [String: String] == ["c": "x"])
    }

    @Test("Flatten reconstructs dotted keys")
    func testFlatten() {
        let dict: [String: Any] = ["a": ["b": "x", "c": "y"], "top": "z"]
        #expect(SecretsStore.flatten(dict, prefix: "").sorted() == ["a.b", "a.c", "top"])
    }
}
