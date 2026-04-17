import Foundation
import Network

/// Abstract I/O for the SMTP state machine. A real deployment uses `NWConnectionTransport`;
/// unit tests use a `FakeTransport` that scripts a conversation.
public protocol SMTPTransport: AnyObject, Sendable {
    /// Send raw bytes to the peer.
    func send(_ data: Data) async throws

    /// Read one line, terminated by CRLF. Returns the line without the CRLF.
    /// Throws on EOF before CRLF or on timeout.
    func receiveLine() async throws -> String

    /// Close the connection. Idempotent.
    func close() async
}

/// A single SMTP status reply, possibly multi-line.
public struct SMTPResponse: Sendable, CustomStringConvertible {
    public let code: Int
    public let lines: [String]

    public var description: String {
        lines.map { "\(code) \($0)" }.joined(separator: "\n")
    }
    public var firstText: String { lines.first ?? "" }
}

/// Errors raised by the SMTP transport layer.
public enum SMTPTransportError: Error, CustomStringConvertible {
    case connectFailed(host: String, port: Int, underlying: Error)
    case sendFailed(Error)
    case connectionClosed
    case timedOut(stage: String)
    case invalidResponse(String)

    public var description: String {
        switch self {
        case .connectFailed(let h, let p, let e):
            return "failed to connect to \(h):\(p): \(e.localizedDescription)"
        case .sendFailed(let e): return "send failed: \(e.localizedDescription)"
        case .connectionClosed: return "connection closed by peer mid-read"
        case .timedOut(let stage): return "timed out during \(stage)"
        case .invalidResponse(let s): return "invalid SMTP response: \(s)"
        }
    }
}

// MARK: - Line reader helpers usable across transports

/// Parse a multi-line SMTP response from a transport.
/// Example multi-line reply:
///   `250-smtp.example.com greets you`
///   `250-AUTH LOGIN PLAIN`
///   `250 8BITMIME`
/// A dash after the code (`NNN-...`) indicates more lines follow; a space (`NNN ...`) terminates.
public func readSMTPResponse(from transport: SMTPTransport) async throws -> SMTPResponse {
    var lines: [String] = []
    var code: Int = 0
    while true {
        let line = try await transport.receiveLine()
        guard line.count >= 4 else {
            throw SMTPTransportError.invalidResponse(line)
        }
        let codePrefix = String(line.prefix(3))
        guard let parsedCode = Int(codePrefix) else {
            throw SMTPTransportError.invalidResponse(line)
        }
        code = parsedCode
        let separator = line[line.index(line.startIndex, offsetBy: 3)]
        let text = String(line.dropFirst(4))
        lines.append(text)
        if separator == " " { break }
        if separator != "-" {
            throw SMTPTransportError.invalidResponse(line)
        }
    }
    return SMTPResponse(code: code, lines: lines)
}

// MARK: - Production transport backed by Network.framework

/// TLS-enabled TCP transport using `NWConnection` and `NWProtocolTLS`.
/// Suitable for implicit-TLS SMTP on port 465.
///
/// This class is a reference type so `NWConnection` can be retained across
/// async hops. It is marked `@unchecked Sendable` because all mutable state
/// is serialized through a private `DispatchQueue`.
public final class NWConnectionTransport: SMTPTransport, @unchecked Sendable {

    private let host: String
    private let port: Int
    private let connection: NWConnection
    private let queue: DispatchQueue
    private let timeout: TimeInterval

    // Buffer for partial line accumulation, serialized on `queue`.
    private var buffer: Data = Data()
    // Continuation to signal the next waiting reader when new data arrives.
    private var waitingReader: CheckedContinuation<Void, Error>? = nil
    private var closed: Bool = false
    private var receiveError: Error? = nil

    /// Open a TLS connection to `host:port`.
    /// Blocks the caller's async context until the connection is ready or fails.
    public init(host: String, port: Int, timeout: TimeInterval = 30) async throws {
        self.host = host
        self.port = port
        self.timeout = timeout
        self.queue = DispatchQueue(label: "apple-pim.smtp.\(UUID().uuidString.prefix(8))")

        let tlsOptions = NWProtocolTLS.Options()
        // Default options use the system trust store and verify the server certificate.
        let params = NWParameters(tls: tlsOptions)
        let endpointHost = NWEndpoint.Host(host)
        guard let endpointPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
            throw SMTPTransportError.connectFailed(host: host, port: port,
                underlying: NSError(domain: "SMTPTransport", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "invalid port: \(port)"]))
        }
        self.connection = NWConnection(host: endpointHost, port: endpointPort, using: params)

        // Wait for the connection to become .ready, with a timeout.
        try await withConnectTimeout(timeout: timeout) { [self] in
            try await withCheckedThrowingContinuation { cont in
                connection.stateUpdateHandler = { [weak self] state in
                    guard let self else { return }
                    switch state {
                    case .ready:
                        cont.resume()
                        self.connection.stateUpdateHandler = { [weak self] st in self?.handleSteadyState(st) }
                        self.startReceiveLoop()
                    case .failed(let err):
                        cont.resume(throwing: SMTPTransportError.connectFailed(host: host, port: port, underlying: err))
                    case .cancelled:
                        cont.resume(throwing: SMTPTransportError.connectionClosed)
                    default:
                        break
                    }
                }
                connection.start(queue: queue)
            }
        }
    }

    public func send(_ data: Data) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            connection.send(content: data, completion: .contentProcessed { err in
                if let err {
                    cont.resume(throwing: SMTPTransportError.sendFailed(err))
                } else {
                    cont.resume()
                }
            })
        }
    }

    public func receiveLine() async throws -> String {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            if let line = try takeLineFromBuffer() { return line }
            if Date() > deadline {
                throw SMTPTransportError.timedOut(stage: "receiveLine")
            }
            try await waitForData(until: deadline)
        }
    }

    public func close() async {
        queue.sync {
            if closed { return }
            closed = true
            connection.cancel()
            if let w = waitingReader {
                w.resume(throwing: SMTPTransportError.connectionClosed)
                waitingReader = nil
            }
        }
    }

    // MARK: - Private

    private func startReceiveLoop() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            self.queue.async {
                if let data, !data.isEmpty {
                    self.buffer.append(data)
                }
                if let error {
                    self.receiveError = error
                    self.fulfillReader(throwing: error)
                    return
                }
                if isComplete {
                    self.closed = true
                    self.fulfillReader(throwing: nil)
                    return
                }
                // Wake any waiting reader and then continue receiving.
                self.fulfillReader(throwing: nil)
                self.startReceiveLoop()
            }
        }
    }

    private func fulfillReader(throwing err: Error?) {
        if let cont = waitingReader {
            waitingReader = nil
            if let err { cont.resume(throwing: err) }
            else { cont.resume() }
        }
    }

    private func handleSteadyState(_ state: NWConnection.State) {
        switch state {
        case .failed, .cancelled:
            queue.async {
                self.closed = true
                if let w = self.waitingReader {
                    w.resume(throwing: SMTPTransportError.connectionClosed)
                    self.waitingReader = nil
                }
            }
        default:
            break
        }
    }

    /// Pull a CRLF-terminated line out of the buffer if available.
    /// Runs on any thread — uses `queue.sync` for buffer access.
    private func takeLineFromBuffer() throws -> String? {
        try queue.sync {
            if let err = receiveError {
                receiveError = nil
                throw err
            }
            guard let crlfRange = buffer.range(of: Data("\r\n".utf8)) else {
                if closed && buffer.isEmpty { throw SMTPTransportError.connectionClosed }
                return nil
            }
            let lineData = buffer.subdata(in: 0..<crlfRange.lowerBound)
            buffer.removeSubrange(0..<crlfRange.upperBound)
            guard let s = String(data: lineData, encoding: .utf8) else {
                throw SMTPTransportError.invalidResponse("non-UTF8 SMTP reply")
            }
            return s
        }
    }

    private func waitForData(until deadline: Date) async throws {
        // Schedule ourselves into `waitingReader` and suspend until `fulfillReader` fires.
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            queue.async {
                if self.closed {
                    cont.resume(throwing: SMTPTransportError.connectionClosed)
                    return
                }
                if !self.buffer.isEmpty {
                    // Data arrived between calls — return immediately.
                    cont.resume()
                    return
                }
                self.waitingReader = cont
                // Arm a timeout on the queue.
                let remaining = deadline.timeIntervalSinceNow
                if remaining > 0 {
                    self.queue.asyncAfter(deadline: .now() + remaining) { [weak self] in
                        guard let self else { return }
                        if let w = self.waitingReader {
                            self.waitingReader = nil
                            w.resume(throwing: SMTPTransportError.timedOut(stage: "receive"))
                        }
                    }
                }
            }
        }
    }
}

/// Bound a connect operation by wall-clock timeout.
private func withConnectTimeout<T: Sendable>(
    timeout: TimeInterval,
    operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            throw SMTPTransportError.timedOut(stage: "connect")
        }
        guard let first = try await group.next() else {
            throw SMTPTransportError.timedOut(stage: "connect")
        }
        group.cancelAll()
        return first
    }
}

// MARK: - Fake transport for unit tests

/// Test double that scripts both sides of an SMTP conversation.
/// Construct with a list of `Script.Step` values; each `.expectSend` asserts on the
/// next client write, each `.reply` emits server lines for the next `receiveLine`.
public final class FakeTransport: SMTPTransport, @unchecked Sendable {
    public enum Step: Sendable {
        /// The next `send(_:)` call is expected to write a string that satisfies this predicate.
        case expectSend(@Sendable (String) -> Bool, label: String)
        /// `receiveLine()` returns these lines in order (no CRLF included).
        case reply(lines: [String])
        /// The client should have closed by this point.
        case expectClose
    }

    public private(set) var sentPayloads: [Data] = []
    public private(set) var closed = false

    private var script: [Step]
    private var pendingReplyLines: [String] = []

    public init(_ script: [Step]) {
        self.script = script
    }

    public func send(_ data: Data) async throws {
        sentPayloads.append(data)
        guard !script.isEmpty else {
            throw SMTPTransportError.invalidResponse("FakeTransport: unexpected send (script exhausted)")
        }
        let step = script.removeFirst()
        guard case let .expectSend(predicate, label) = step else {
            throw SMTPTransportError.invalidResponse(
                "FakeTransport: expected reply/close, got send of \(data.count) bytes (next step: \(step))"
            )
        }
        let s = String(data: data, encoding: .utf8) ?? "<non-utf8>"
        if !predicate(s) {
            throw SMTPTransportError.invalidResponse(
                "FakeTransport: send predicate '\(label)' failed for payload: \(s)"
            )
        }
    }

    public func receiveLine() async throws -> String {
        if pendingReplyLines.isEmpty {
            guard !script.isEmpty else {
                throw SMTPTransportError.connectionClosed
            }
            let step = script.removeFirst()
            guard case let .reply(lines) = step else {
                throw SMTPTransportError.invalidResponse("FakeTransport: expected reply, got \(step)")
            }
            pendingReplyLines = lines
        }
        return pendingReplyLines.removeFirst()
    }

    public func close() async {
        closed = true
        if let step = script.first, case .expectClose = step {
            script.removeFirst()
        }
    }

    /// Assert the script ran to completion.
    public func verifyComplete() throws {
        guard script.isEmpty else {
            throw SMTPTransportError.invalidResponse(
                "FakeTransport: \(script.count) scripted step(s) unused"
            )
        }
    }
}
