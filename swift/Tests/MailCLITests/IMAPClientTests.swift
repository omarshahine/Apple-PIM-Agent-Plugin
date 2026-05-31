import Foundation
import Testing
@testable import MailCLI

@Suite("IMAPClient APPEND")
struct IMAPClientTests {

    private func client(verbose: Bool = false, logSink: SMTPLogSink = StderrSink()) -> IMAPClient {
        IMAPClient(
            host: "imap.example.com",
            credentials: .init(username: "user@example.com", password: "secret-pw"),
            sentFolder: "Sent Messages",
            verbose: verbose,
            logSink: logSink
        )
    }

    private static let rawMessage = Data("From: a@b.com\r\nSubject: Hi\r\n\r\nBody line\r\n".utf8)
    private static let fixedDate = Date(timeIntervalSince1970: 1713369296)

    // MARK: - Happy path

    @Test("APPEND drives greeting → LOGIN → APPEND literal → LOGOUT")
    func testHappyPath() async throws {
        let raw = Self.rawMessage
        let len = raw.count
        let rawString = String(data: raw, encoding: .utf8)!

        let fake = FakeTransport([
            .reply(lines: ["* OK [CAPABILITY IMAP4rev1] imap.example.com ready"]),
            .expectSend({
                $0.hasPrefix("A1 LOGIN \"user@example.com\" \"secret-pw\"") && $0.hasSuffix("\r\n")
            }, label: "LOGIN"),
            .reply(lines: ["A1 OK LOGIN completed"]),
            .expectSend({
                $0.hasPrefix("A2 APPEND \"Sent Messages\" (\\Seen) ")
                    && $0.contains("{\(len)}")
                    && $0.hasSuffix("\r\n")
            }, label: "APPEND command"),
            .reply(lines: ["+ go ahead"]),
            // raw already ends in CRLF, so no extra CRLF is appended.
            .expectSend({ $0 == rawString }, label: "APPEND literal"),
            .reply(lines: ["A2 OK [APPENDUID 1 99] APPEND completed"]),
            .expectSend({ $0 == "A3 LOGOUT\r\n" }, label: "LOGOUT"),
            .reply(lines: ["* BYE logging out", "A3 OK LOGOUT completed"]),
        ])

        try await client().runAppend(transport: fake, rawMessage: raw, internalDate: Self.fixedDate)
        try fake.verifyComplete()
    }

    @Test("APPEND skips untagged status lines before the tagged OK")
    func testSkipsUntaggedBeforeTagged() async throws {
        let raw = Self.rawMessage
        let rawString = String(data: raw, encoding: .utf8)!
        let fake = FakeTransport([
            .reply(lines: ["* OK ready"]),
            .expectSend({ $0.hasPrefix("A1 LOGIN ") }, label: "LOGIN"),
            // Untagged capability line precedes the tagged OK.
            .reply(lines: ["* CAPABILITY IMAP4rev1 UIDPLUS", "A1 OK done"]),
            .expectSend({ $0.hasPrefix("A2 APPEND ") }, label: "APPEND command"),
            .reply(lines: ["+ ready for literal"]),
            .expectSend({ $0 == rawString }, label: "literal"),
            .reply(lines: ["A2 OK appended"]),
            .expectSend({ $0 == "A3 LOGOUT\r\n" }, label: "LOGOUT"),
            .reply(lines: ["A3 OK"]),
        ])
        try await client().runAppend(transport: fake, rawMessage: raw, internalDate: Self.fixedDate)
        try fake.verifyComplete()
    }

    // MARK: - Failure modes

    @Test("Non-OK greeting fails")
    func testBadGreeting() async throws {
        let fake = FakeTransport([.reply(lines: ["* BYE server too busy"])])
        await #expect(throws: IMAPClientError.self) {
            try await client().runAppend(transport: fake, rawMessage: Self.rawMessage, internalDate: Self.fixedDate)
        }
    }

    @Test("LOGIN failure (tagged NO) surfaces as loginFailed")
    func testLoginFailed() async throws {
        let fake = FakeTransport([
            .reply(lines: ["* OK ready"]),
            .expectSend({ $0.hasPrefix("A1 LOGIN ") }, label: "LOGIN"),
            .reply(lines: ["A1 NO [AUTHENTICATIONFAILED] Invalid credentials"]),
        ])
        await #expect(throws: IMAPClientError.self) {
            try await client().runAppend(transport: fake, rawMessage: Self.rawMessage, internalDate: Self.fixedDate)
        }
    }

    @Test("APPEND with no continuation (folder missing) surfaces as error")
    func testNoContinuation() async throws {
        let fake = FakeTransport([
            .reply(lines: ["* OK ready"]),
            .expectSend({ $0.hasPrefix("A1 LOGIN ") }, label: "LOGIN"),
            .reply(lines: ["A1 OK done"]),
            .expectSend({ $0.hasPrefix("A2 APPEND ") }, label: "APPEND command"),
            // Server rejects directly with a tagged NO instead of a + continuation.
            .reply(lines: ["A2 NO [TRYCREATE] Mailbox doesn't exist"]),
        ])
        await #expect(throws: IMAPClientError.self) {
            try await client().runAppend(transport: fake, rawMessage: Self.rawMessage, internalDate: Self.fixedDate)
        }
    }

    @Test("APPEND rejected after literal (tagged NO) surfaces as error")
    func testAppendRejectedAfterLiteral() async throws {
        let raw = Self.rawMessage
        let rawString = String(data: raw, encoding: .utf8)!
        let fake = FakeTransport([
            .reply(lines: ["* OK ready"]),
            .expectSend({ $0.hasPrefix("A1 LOGIN ") }, label: "LOGIN"),
            .reply(lines: ["A1 OK done"]),
            .expectSend({ $0.hasPrefix("A2 APPEND ") }, label: "APPEND command"),
            .reply(lines: ["+ go ahead"]),
            .expectSend({ $0 == rawString }, label: "literal"),
            .reply(lines: ["A2 NO over quota"]),
        ])
        await #expect(throws: IMAPClientError.self) {
            try await client().runAppend(transport: fake, rawMessage: raw, internalDate: Self.fixedDate)
        }
    }

    // MARK: - Encoding helpers

    @Test("quoteIMAP escapes backslashes and quotes")
    func testQuoteIMAP() {
        #expect(IMAPClient.quoteIMAP("Sent Messages") == "\"Sent Messages\"")
        #expect(IMAPClient.quoteIMAP("a\"b\\c") == "\"a\\\"b\\\\c\"")
    }

    @Test("imapInternalDate matches RFC 3501 date-time shape")
    func testInternalDate() {
        let s = IMAPClient.imapInternalDate(Self.fixedDate)
        #expect(s.range(of: #"^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}:\d{2} [+-]\d{4}$"#,
                        options: .regularExpression) != nil,
                "Unexpected IMAP date-time shape: \(s)")
    }

    @Test("Verbose mode never logs the plaintext password")
    func testVerboseRedaction() async throws {
        let collector = CollectorSink()
        let raw = Self.rawMessage
        let rawString = String(data: raw, encoding: .utf8)!
        let fake = FakeTransport([
            .reply(lines: ["* OK ready"]),
            .expectSend({ $0.hasPrefix("A1 LOGIN ") }, label: "LOGIN"),
            .reply(lines: ["A1 OK done"]),
            .expectSend({ $0.hasPrefix("A2 APPEND ") }, label: "APPEND command"),
            .reply(lines: ["+ go"]),
            .expectSend({ $0 == rawString }, label: "literal"),
            .reply(lines: ["A2 OK appended"]),
            .expectSend({ $0 == "A3 LOGOUT\r\n" }, label: "LOGOUT"),
            .reply(lines: ["A3 OK"]),
        ])
        try await client(verbose: true, logSink: collector)
            .runAppend(transport: fake, rawMessage: raw, internalDate: Self.fixedDate)
        let logged = collector.lines.joined(separator: "\n")
        #expect(!logged.contains("secret-pw"))
        #expect(logged.contains("<PASSWORD>"))
    }
}
