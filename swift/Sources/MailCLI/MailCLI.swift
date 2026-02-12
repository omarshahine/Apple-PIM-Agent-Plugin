import ArgumentParser
import AppKit
import Foundation

@main
struct MailCLI: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "mail-cli",
        abstract: "Manage macOS Mail.app via JXA (JavaScript for Automation)",
        subcommands: [
            ListAccounts.self,
            ListMailboxes.self,
            ListMessages.self,
            GetMessage.self,
            SearchMessages.self,
            UpdateMessage.self,
            MoveMessage.self,
            DeleteMessage.self,
            BatchUpdateMessages.self,
            BatchDeleteMessages.self,
        ]
    )
}

// MARK: - Shared Utilities

enum CLIError: Error, LocalizedError {
    case appNotRunning(String)
    case jxaError(String)
    case notFound(String)
    case invalidInput(String)
    case timeout(String)
    case accessDenied(String)

    var errorDescription: String? {
        switch self {
        case .appNotRunning(let msg): return msg
        case .jxaError(let msg): return msg
        case .notFound(let msg): return msg
        case .invalidInput(let msg): return msg
        case .timeout(let msg): return msg
        case .accessDenied(let msg): return msg
        }
    }
}

func outputJSON(_ value: Any) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]),
       let string = String(data: data, encoding: .utf8) {
        print(string)
    }
}

/// Escape a string for safe interpolation into JXA string literals (single or double quoted).
/// Escapes backslashes first, then quotes and control characters.
func escapeForJXA(_ s: String) -> String {
    return s
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "'", with: "\\'")
        .replacingOccurrences(of: "\"", with: "\\\"")
        .replacingOccurrences(of: "\n", with: "\\n")
        .replacingOccurrences(of: "\r", with: "\\r")
        .replacingOccurrences(of: "\t", with: "\\t")
}

func ensureMailRunning() throws {
    let running = NSWorkspace.shared.runningApplications.contains {
        $0.bundleIdentifier == "com.apple.mail"
    }
    guard running else {
        throw CLIError.appNotRunning("Mail.app is not running. Please open Mail.app first.")
    }
}

func runJXA(_ script: String) throws -> Any {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    proc.arguments = ["-l", "JavaScript", "-e", script]

    let stdoutPipe = Pipe()
    let stderrPipe = Pipe()
    proc.standardOutput = stdoutPipe
    proc.standardError = stderrPipe

    try proc.run()

    // Read pipe data concurrently BEFORE waitUntilExit to prevent deadlock.
    // If output exceeds the ~64KB pipe buffer and we wait first, the child
    // blocks on write and never exits — classic pipe deadlock.
    var stdoutData = Data()
    var stderrData = Data()
    let readGroup = DispatchGroup()

    readGroup.enter()
    DispatchQueue.global().async {
        stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        readGroup.leave()
    }
    readGroup.enter()
    DispatchQueue.global().async {
        stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
        readGroup.leave()
    }

    // 30-second timeout
    let deadline = DispatchTime.now() + .seconds(30)
    let waitGroup = DispatchGroup()
    waitGroup.enter()
    DispatchQueue.global().async {
        proc.waitUntilExit()
        waitGroup.leave()
    }
    let result = waitGroup.wait(timeout: deadline)
    if result == .timedOut {
        proc.terminate()
        throw CLIError.timeout("Mail.app did not respond within 30 seconds")
    }

    // Wait for pipe reads to finish (they will, since the process has exited)
    readGroup.wait()

    let stderrStr = String(data: stderrData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

    guard proc.terminationStatus == 0 else {
        if stderrStr.contains("not allowed to send keystrokes") || stderrStr.contains("not allowed assistive access") {
            throw CLIError.accessDenied("Grant access in System Settings > Privacy & Security > Automation")
        }
        throw CLIError.jxaError(stderrStr.isEmpty ? "JXA script failed with exit code \(proc.terminationStatus)" : stderrStr)
    }

    let stdoutStr = String(data: stdoutData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

    guard !stdoutStr.isEmpty else {
        return [String: Any]()
    }

    guard let data = stdoutStr.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) else {
        throw CLIError.jxaError("Failed to parse JXA output as JSON: \(stdoutStr.prefix(200))")
    }

    return json
}

// Shared JXA helper for finding a message by ID.
// Accepts optional mailbox/account to narrow the search.
// Priority order: specified mailbox > INBOX/Sent/Archive/Drafts > all mailboxes.
func findMessageJXA(targetId: String, mailbox: String?, account: String?) -> String {
    let escapedId = escapeForJXA(targetId)
    let mailboxFilter = mailbox.map { "'\(escapeForJXA($0))'" } ?? "null"
    let accountFilter = account.map { "'\(escapeForJXA($0))'" } ?? "null"

    return """
    function findMessage() {
        const Mail = Application("Mail");
        const targetId = '\(escapedId)';
        const mboxHint = \(mailboxFilter);
        const acctHint = \(accountFilter);

        function searchInMailbox(mbox) {
            try {
                const found = mbox.messages.whose({messageId: targetId})();
                if (found.length > 0) return found[0];
            } catch(e) {}
            return null;
        }

        // Search priority mailboxes first, then remaining mailboxes
        const priority = ['INBOX', 'Sent Messages', 'Archive', 'Drafts', 'Deleted Messages', 'Junk'];
        const accounts = acctHint ? Mail.accounts.whose({name: acctHint})() : Mail.accounts();
        const searched = new Set();

        // If mailbox hint given, try it first (optimization, not a hard filter)
        if (mboxHint) {
            for (let a = 0; a < accounts.length; a++) {
                const mbs = accounts[a].mailboxes.whose({name: mboxHint})();
                for (let m = 0; m < mbs.length; m++) {
                    searched.add(accounts[a].name() + '/' + mbs[m].name());
                    const r = searchInMailbox(mbs[m]);
                    if (r) return r;
                }
            }
        }

        for (let a = 0; a < accounts.length; a++) {
            for (let p = 0; p < priority.length; p++) {
                const mbs = accounts[a].mailboxes.whose({name: priority[p]})();
                for (let m = 0; m < mbs.length; m++) {
                    const key = accounts[a].name() + '/' + mbs[m].name();
                    if (searched.has(key)) continue;
                    searched.add(key);
                    const r = searchInMailbox(mbs[m]);
                    if (r) return r;
                }
            }
        }

        // Search remaining mailboxes (non-priority)
        for (let a = 0; a < accounts.length; a++) {
            const mbs = accounts[a].mailboxes();
            for (let m = 0; m < mbs.length; m++) {
                const key = accounts[a].name() + '/' + mbs[m].name();
                if (searched.has(key)) continue;
                const r = searchInMailbox(mbs[m]);
                if (r) return r;
            }
        }
        return null;
    }
    """
}

// MARK: - Commands

struct ListAccounts: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "accounts",
        abstract: "List all mail accounts"
    )

    func run() async throws {
        try ensureMailRunning()

        let script = """
        const Mail = Application("Mail");
        const accounts = Mail.accounts();
        const result = accounts.map(a => ({
            name: a.name(),
            id: a.id(),
            enabled: a.enabled(),
            userName: a.userName(),
            accountType: a.accountType()
        }));
        JSON.stringify(result);
        """

        let result = try runJXA(script)
        outputJSON([
            "success": true,
            "accounts": result
        ])
    }
}

struct ListMailboxes: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "mailboxes",
        abstract: "List mailboxes with unread counts"
    )

    @Option(name: .long, help: "Filter by account name")
    var account: String?

    func run() async throws {
        try ensureMailRunning()

        let accountFilter = account.map { "'\(escapeForJXA($0))'" } ?? "null"

        let script = """
        const Mail = Application("Mail");
        const accountFilter = \(accountFilter);
        const results = [];

        function collectMailboxes(mailboxes, accountName) {
            for (let i = 0; i < mailboxes.length; i++) {
                const mb = mailboxes[i];
                results.push({
                    name: mb.name(),
                    account: accountName,
                    unreadCount: mb.unreadCount(),
                    messageCount: mb.messages.length
                });
            }
        }

        if (accountFilter) {
            const accts = Mail.accounts.whose({name: accountFilter})();
            if (accts.length === 0) {
                JSON.stringify({error: "Account not found: " + accountFilter});
            } else {
                collectMailboxes(accts[0].mailboxes(), accountFilter);
                JSON.stringify(results);
            }
        } else {
            const accounts = Mail.accounts();
            for (let a = 0; a < accounts.length; a++) {
                const acct = accounts[a];
                collectMailboxes(acct.mailboxes(), acct.name());
            }
            JSON.stringify(results);
        }
        """

        let raw = try runJXA(script)

        // Check for error from JXA
        if let dict = raw as? [String: Any], let error = dict["error"] as? String {
            throw CLIError.notFound(error)
        }

        outputJSON([
            "success": true,
            "mailboxes": raw
        ])
    }
}

struct ListMessages: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "messages",
        abstract: "List messages in a mailbox"
    )

    @Option(name: .long, help: "Mailbox name (default: INBOX)")
    var mailbox: String = "INBOX"

    @Option(name: .long, help: "Account name (searches all accounts if omitted)")
    var account: String?

    @Option(name: .long, help: "Maximum messages to return (default: 25)")
    var limit: Int = 25

    @Option(name: .long, help: "Filter: unread, flagged, or all (default: all)")
    var filter: String?

    func run() async throws {
        try ensureMailRunning()

        let accountFilter = account.map { "'\(escapeForJXA($0))'" } ?? "null"
        let mailboxName = escapeForJXA(mailbox)
        let filterVal = filter.map { "'\(escapeForJXA($0))'" } ?? "null"

        let script = """
        const Mail = Application("Mail");
        const accountFilter = \(accountFilter);
        const mailboxName = '\(mailboxName)';
        const limit = \(limit);
        const filterType = \(filterVal);

        function findMailbox() {
            const accounts = accountFilter
                ? Mail.accounts.whose({name: accountFilter})()
                : Mail.accounts();
            for (let a = 0; a < accounts.length; a++) {
                const mbs = accounts[a].mailboxes.whose({name: mailboxName})();
                if (mbs.length > 0) return mbs[0];
            }
            return null;
        }

        const mbox = findMailbox();
        if (!mbox) {
            JSON.stringify({error: "Mailbox not found: " + mailboxName});
        } else {
            const msgs = mbox.messages;
            const count = msgs.length;
            if (count === 0) {
                JSON.stringify({messages: [], mailbox: mailboxName, totalInMailbox: 0});
            } else {
                const results = [];
                // Scan cap: when filtering, scan up to 10x limit to find enough matches.
                // Without a filter, scan exactly limit messages.
                const scanCap = filterType ? Math.min(count, limit * 10) : Math.min(count, limit);

                // Per-message fetching with error handling (batch .slice can fail on null dates)
                for (let i = 0; i < scanCap && results.length < limit; i++) {
                    try {
                        const m = msgs[i];
                        const isRead = m.readStatus();
                        const isFlagged = m.flaggedStatus();
                        if (filterType === 'unread' && isRead) continue;
                        if (filterType === 'flagged' && !isFlagged) continue;
                        const dr = m.dateReceived();
                        results.push({
                            messageId: m.messageId(),
                            sender: m.sender(),
                            subject: m.subject(),
                            dateReceived: dr ? dr.toISOString() : null,
                            isRead: isRead,
                            isFlagged: isFlagged,
                            isJunk: m.junkMailStatus()
                        });
                    } catch(e) { /* skip messages that fail to read */ }
                }

                JSON.stringify({
                    messages: results,
                    mailbox: mailboxName,
                    totalInMailbox: count
                });
            }
        }
        """

        let raw = try runJXA(script)

        if let dict = raw as? [String: Any], let error = dict["error"] as? String {
            throw CLIError.notFound(error)
        }

        guard let dict = raw as? [String: Any] else {
            outputJSON(["success": true, "messages": [] as [Any], "count": 0])
            return
        }

        let messages = dict["messages"] as? [Any] ?? []
        outputJSON([
            "success": true,
            "mailbox": dict["mailbox"] ?? mailbox,
            "messages": messages,
            "count": messages.count,
            "totalInMailbox": dict["totalInMailbox"] ?? 0
        ])
    }
}

struct GetMessage: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "get",
        abstract: "Get a single message by message ID"
    )

    @Option(name: .long, help: "RFC 2822 message ID")
    var id: String

    @Option(name: .long, help: "Mailbox name hint (speeds up lookup)")
    var mailbox: String?

    @Option(name: .long, help: "Account name hint (speeds up lookup)")
    var account: String?

    func run() async throws {
        try ensureMailRunning()

        let findHelper = findMessageJXA(targetId: id, mailbox: mailbox, account: account)

        let script = """
        \(findHelper)

        const msg = findMessage();
        if (!msg) {
            JSON.stringify({error: "Message not found: \(escapeForJXA(id))"});
        } else {
            const result = {
                messageId: msg.messageId(),
                subject: msg.subject(),
                sender: msg.sender(),
                dateReceived: msg.dateReceived() ? msg.dateReceived().toISOString() : null,
                dateSent: msg.dateSent() ? msg.dateSent().toISOString() : null,
                isRead: msg.readStatus(),
                isFlagged: msg.flaggedStatus(),
                isJunk: msg.junkMailStatus(),
                replyTo: msg.replyTo(),
                mailbox: msg.mailbox().name(),
                account: msg.mailbox().account().name(),
                content: msg.content()
            };

            // Get recipients
            try {
                const toRecips = msg.toRecipients();
                result.to = toRecips.map(r => ({name: r.name(), address: r.address()}));
            } catch(e) { result.to = []; }

            try {
                const ccRecips = msg.ccRecipients();
                result.cc = ccRecips.map(r => ({name: r.name(), address: r.address()}));
            } catch(e) { result.cc = []; }

            // Get headers if available
            try {
                result.allHeaders = msg.allHeaders();
            } catch(e) {}

            JSON.stringify(result);
        }
        """

        let raw = try runJXA(script)

        if let dict = raw as? [String: Any], let error = dict["error"] as? String {
            throw CLIError.notFound(error)
        }

        outputJSON([
            "success": true,
            "message": raw
        ])
    }
}

struct SearchMessages: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "search",
        abstract: "Search messages by subject, sender, or content"
    )

    @Argument(help: "Search query")
    var query: String

    @Option(name: .long, help: "Search field: subject, sender, content, or all (default: all)")
    var field: String = "all"

    @Option(name: .long, help: "Mailbox name to search in (searches all if omitted)")
    var mailbox: String?

    @Option(name: .long, help: "Account name")
    var account: String?

    @Option(name: .long, help: "Maximum results (default: 25)")
    var limit: Int = 25

    func run() async throws {
        try ensureMailRunning()

        let escapedQuery = escapeForJXA(query.lowercased())
        let accountFilter = account.map { "'\(escapeForJXA($0))'" } ?? "null"
        let mailboxFilter = mailbox.map { "'\(escapeForJXA($0))'" } ?? "null"
        let escapedField = escapeForJXA(field)

        let script = """
        const Mail = Application("Mail");
        const query = '\(escapedQuery)';
        const searchField = '\(escapedField)';
        const accountFilter = \(accountFilter);
        const mailboxFilter = \(mailboxFilter);
        const limit = \(limit);
        const results = [];

        function searchMailbox(mbox, accountName) {
            if (results.length >= limit) return;

            const msgs = mbox.messages;
            const count = msgs.length;
            const batchSize = Math.min(count, 500);

            for (let i = 0; i < batchSize && results.length < limit; i++) {
                try {
                    const m = msgs[i];
                    const subj = (m.subject() || '').toLowerCase();
                    const sndr = (m.sender() || '').toLowerCase();

                    let match = false;
                    if (searchField === 'subject') match = subj.includes(query);
                    else if (searchField === 'sender') match = sndr.includes(query);
                    else if (searchField === 'content') {
                        try { match = (m.content() || '').toLowerCase().includes(query); } catch(e2) {}
                    } else {
                        // 'all': search subject + sender (content is too slow for all-field scan)
                        match = subj.includes(query) || sndr.includes(query);
                    }

                    if (match) {
                        const dr = m.dateReceived();
                        results.push({
                            messageId: m.messageId(),
                            sender: m.sender(),
                            subject: m.subject(),
                            dateReceived: dr ? dr.toISOString() : null,
                            isRead: m.readStatus(),
                            isFlagged: m.flaggedStatus(),
                            mailbox: mbox.name(),
                            account: accountName
                        });
                    }
                } catch(e) { /* skip messages that fail to read */ }
            }
        }

        const accounts = accountFilter
            ? Mail.accounts.whose({name: accountFilter})()
            : Mail.accounts();

        for (let a = 0; a < accounts.length && results.length < limit; a++) {
            const acct = accounts[a];
            const mbs = mailboxFilter
                ? acct.mailboxes.whose({name: mailboxFilter})()
                : acct.mailboxes();
            for (let m = 0; m < mbs.length && results.length < limit; m++) {
                searchMailbox(mbs[m], acct.name());
            }
        }

        JSON.stringify(results);
        """

        let raw = try runJXA(script)
        let messages = raw as? [Any] ?? []

        outputJSON([
            "success": true,
            "query": query,
            "field": field,
            "messages": messages,
            "count": messages.count
        ])
    }
}

struct UpdateMessage: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "update",
        abstract: "Update message flags (read/unread, flagged, junk)"
    )

    @Option(name: .long, help: "RFC 2822 message ID")
    var id: String

    @Option(name: .long, help: "Set read status (true/false)")
    var read: String?

    @Option(name: .long, help: "Set flagged status (true/false)")
    var flagged: String?

    @Option(name: .long, help: "Set junk status (true/false)")
    var junk: String?

    @Option(name: .long, help: "Mailbox name hint (speeds up lookup)")
    var mailbox: String?

    @Option(name: .long, help: "Account name hint (speeds up lookup)")
    var account: String?

    func run() async throws {
        try ensureMailRunning()

        var updates = [String]()
        if let read = read {
            updates.append("msg.readStatus = \(read == "true" ? "true" : "false");")
        }
        if let flagged = flagged {
            updates.append("msg.flaggedStatus = \(flagged == "true" ? "true" : "false");")
        }
        if let junk = junk {
            updates.append("msg.junkMailStatus = \(junk == "true" ? "true" : "false");")
        }

        guard !updates.isEmpty else {
            throw CLIError.invalidInput("No updates specified. Use --read, --flagged, or --junk.")
        }

        let updateCode = updates.joined(separator: "\n            ")
        let findHelper = findMessageJXA(targetId: id, mailbox: mailbox, account: account)

        let script = """
        \(findHelper)

        const msg = findMessage();
        if (!msg) {
            JSON.stringify({error: "Message not found: \(escapeForJXA(id))"});
        } else {
            \(updateCode)
            JSON.stringify({
                messageId: msg.messageId(),
                subject: msg.subject(),
                isRead: msg.readStatus(),
                isFlagged: msg.flaggedStatus(),
                isJunk: msg.junkMailStatus()
            });
        }
        """

        let raw = try runJXA(script)

        if let dict = raw as? [String: Any], let error = dict["error"] as? String {
            throw CLIError.notFound(error)
        }

        outputJSON([
            "success": true,
            "message": "Message updated successfully",
            "result": raw
        ])
    }
}

struct MoveMessage: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "move",
        abstract: "Move message to a different mailbox"
    )

    @Option(name: .long, help: "RFC 2822 message ID")
    var id: String

    @Option(name: .long, help: "Destination mailbox name")
    var toMailbox: String

    @Option(name: .long, help: "Destination account name (uses same account if omitted)")
    var toAccount: String?

    @Option(name: .long, help: "Source mailbox name hint (speeds up lookup)")
    var mailbox: String?

    @Option(name: .long, help: "Source account name hint (speeds up lookup)")
    var account: String?

    func run() async throws {
        try ensureMailRunning()

        let escapedMailbox = escapeForJXA(toMailbox)
        let toAccountFilter = toAccount.map { "'\(escapeForJXA($0))'" } ?? "null"
        let findHelper = findMessageJXA(targetId: id, mailbox: mailbox, account: account)

        let script = """
        \(findHelper)

        const Mail = Application("Mail");
        const destMailboxName = '\(escapedMailbox)';
        const destAccountName = \(toAccountFilter);

        function findDestMailbox(sourceAccount) {
            const accounts = destAccountName
                ? Mail.accounts.whose({name: destAccountName})()
                : [sourceAccount];
            for (let a = 0; a < accounts.length; a++) {
                const mbs = accounts[a].mailboxes.whose({name: destMailboxName})();
                if (mbs.length > 0) return mbs[0];
            }
            return null;
        }

        const msg = findMessage();
        if (!msg) {
            JSON.stringify({error: "Message not found: \(escapeForJXA(id))"});
        } else {
            const sourceAccount = msg.mailbox().account();
            const destMbox = findDestMailbox(sourceAccount);
            if (!destMbox) {
                JSON.stringify({error: "Destination mailbox not found: " + destMailboxName});
            } else {
                const fromMailbox = msg.mailbox().name();
                Mail.move(msg, {to: destMbox});
                JSON.stringify({
                    messageId: '\(escapeForJXA(id))',
                    from: fromMailbox,
                    to: destMailboxName,
                    moved: true
                });
            }
        }
        """

        let raw = try runJXA(script)

        if let dict = raw as? [String: Any], let error = dict["error"] as? String {
            throw CLIError.notFound(error)
        }

        outputJSON([
            "success": true,
            "message": "Message moved successfully",
            "result": raw
        ])
    }
}

struct DeleteMessage: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "delete",
        abstract: "Delete message (move to Trash)"
    )

    @Option(name: .long, help: "RFC 2822 message ID")
    var id: String

    @Option(name: .long, help: "Mailbox name hint (speeds up lookup)")
    var mailbox: String?

    @Option(name: .long, help: "Account name hint (speeds up lookup)")
    var account: String?

    func run() async throws {
        try ensureMailRunning()

        let findHelper = findMessageJXA(targetId: id, mailbox: mailbox, account: account)

        let script = """
        \(findHelper)

        const Mail = Application("Mail");
        const msg = findMessage();
        if (!msg) {
            JSON.stringify({error: "Message not found: \(escapeForJXA(id))"});
        } else {
            const subject = msg.subject();
            const mboxName = msg.mailbox().name();
            Mail.delete(msg);
            JSON.stringify({
                messageId: '\(escapeForJXA(id))',
                subject: subject,
                fromMailbox: mboxName,
                deleted: true
            });
        }
        """

        let raw = try runJXA(script)

        if let dict = raw as? [String: Any], let error = dict["error"] as? String {
            throw CLIError.notFound(error)
        }

        outputJSON([
            "success": true,
            "message": "Message deleted (moved to Trash)",
            "result": raw
        ])
    }
}

// MARK: - Batch Operations

struct BatchUpdateInput: Codable {
    let id: String
    let read: Bool?
    let flagged: Bool?
    let junk: Bool?
}

struct BatchUpdateMessages: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "batch-update",
        abstract: "Update flags on multiple messages in a single JXA call"
    )

    @Option(name: .long, help: "JSON array of update objects: [{\"id\": \"...\", \"read\": true}, ...]")
    var json: String

    @Option(name: .long, help: "Mailbox name hint (speeds up lookup)")
    var mailbox: String?

    @Option(name: .long, help: "Account name hint (speeds up lookup)")
    var account: String?

    func run() async throws {
        try ensureMailRunning()

        guard let data = json.data(using: .utf8),
              let updates = try? JSONDecoder().decode([BatchUpdateInput].self, from: data) else {
            throw CLIError.invalidInput("Invalid JSON format. Expected an array of update objects with 'id' and optional 'read', 'flagged', 'junk' fields.")
        }

        if updates.isEmpty {
            throw CLIError.invalidInput("Updates array cannot be empty")
        }

        // Build the updates array as a JS literal
        let jsUpdates = updates.map { update -> String in
            var fields = [String]()
            fields.append("id: '\(escapeForJXA(update.id))'")
            if let read = update.read { fields.append("read: \(read)") }
            if let flagged = update.flagged { fields.append("flagged: \(flagged)") }
            if let junk = update.junk { fields.append("junk: \(junk)") }
            return "{\(fields.joined(separator: ", "))}"
        }.joined(separator: ",\n            ")

        let mailboxFilter = mailbox.map { "'\(escapeForJXA($0))'" } ?? "null"
        let accountFilter = account.map { "'\(escapeForJXA($0))'" } ?? "null"

        let script = """
        const Mail = Application("Mail");
        const updates = [
            \(jsUpdates)
        ];
        const mboxHint = \(mailboxFilter);
        const acctHint = \(accountFilter);

        function findMsg(targetId) {
            const priority = ['INBOX', 'Sent Messages', 'Archive', 'Drafts', 'Deleted Messages', 'Junk'];
            const accounts = acctHint ? Mail.accounts.whose({name: acctHint})() : Mail.accounts();
            const searched = new Set();

            function searchIn(mbox) {
                try {
                    const found = mbox.messages.whose({messageId: targetId})();
                    if (found.length > 0) return found[0];
                } catch(e) {}
                return null;
            }

            if (mboxHint) {
                for (let a = 0; a < accounts.length; a++) {
                    const mbs = accounts[a].mailboxes.whose({name: mboxHint})();
                    for (let m = 0; m < mbs.length; m++) {
                        searched.add(accounts[a].name() + '/' + mbs[m].name());
                        const r = searchIn(mbs[m]);
                        if (r) return r;
                    }
                }
            }
            for (let a = 0; a < accounts.length; a++) {
                for (let p = 0; p < priority.length; p++) {
                    const mbs = accounts[a].mailboxes.whose({name: priority[p]})();
                    for (let m = 0; m < mbs.length; m++) {
                        const key = accounts[a].name() + '/' + mbs[m].name();
                        if (searched.has(key)) continue;
                        searched.add(key);
                        const r = searchIn(mbs[m]);
                        if (r) return r;
                    }
                }
            }
            for (let a = 0; a < accounts.length; a++) {
                const mbs = accounts[a].mailboxes();
                for (let m = 0; m < mbs.length; m++) {
                    const key = accounts[a].name() + '/' + mbs[m].name();
                    if (searched.has(key)) continue;
                    const r = searchIn(mbs[m]);
                    if (r) return r;
                }
            }
            return null;
        }

        const results = [];
        const errors = [];

        for (const u of updates) {
            try {
                const msg = findMsg(u.id);
                if (!msg) {
                    errors.push({id: u.id, error: 'Message not found'});
                    continue;
                }
                if (u.read !== undefined) msg.readStatus = u.read;
                if (u.flagged !== undefined) msg.flaggedStatus = u.flagged;
                if (u.junk !== undefined) msg.junkMailStatus = u.junk;
                results.push({
                    id: u.id,
                    subject: msg.subject(),
                    isRead: msg.readStatus(),
                    isFlagged: msg.flaggedStatus(),
                    isJunk: msg.junkMailStatus()
                });
            } catch(e) {
                errors.push({id: u.id, error: e.message || String(e)});
            }
        }

        JSON.stringify({results: results, errors: errors});
        """

        let raw = try runJXA(script)

        guard let dict = raw as? [String: Any] else {
            throw CLIError.jxaError("Unexpected output from batch update")
        }

        let results = dict["results"] as? [Any] ?? []
        let errors = dict["errors"] as? [Any] ?? []

        outputJSON([
            "success": errors.isEmpty,
            "message": "Batch update completed",
            "updated": results,
            "updatedCount": results.count,
            "errors": errors,
            "errorCount": errors.count
        ])
    }
}

struct BatchDeleteMessages: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "batch-delete",
        abstract: "Delete multiple messages in a single JXA call (moves to Trash)"
    )

    @Option(name: .long, help: "JSON array of RFC 2822 message IDs to delete")
    var json: String

    @Option(name: .long, help: "Mailbox name hint (speeds up lookup)")
    var mailbox: String?

    @Option(name: .long, help: "Account name hint (speeds up lookup)")
    var account: String?

    func run() async throws {
        try ensureMailRunning()

        guard let data = json.data(using: .utf8),
              let ids = try? JSONDecoder().decode([String].self, from: data) else {
            throw CLIError.invalidInput("Invalid JSON format. Expected an array of message ID strings.")
        }

        if ids.isEmpty {
            throw CLIError.invalidInput("IDs array cannot be empty")
        }

        let jsIds = ids.map { "'\(escapeForJXA($0))'" }.joined(separator: ", ")
        let mailboxFilter = mailbox.map { "'\(escapeForJXA($0))'" } ?? "null"
        let accountFilter = account.map { "'\(escapeForJXA($0))'" } ?? "null"

        let script = """
        const Mail = Application("Mail");
        const ids = [\(jsIds)];
        const mboxHint = \(mailboxFilter);
        const acctHint = \(accountFilter);

        function findMsg(targetId) {
            const priority = ['INBOX', 'Sent Messages', 'Archive', 'Drafts', 'Deleted Messages', 'Junk'];
            const accounts = acctHint ? Mail.accounts.whose({name: acctHint})() : Mail.accounts();
            const searched = new Set();

            function searchIn(mbox) {
                try {
                    const found = mbox.messages.whose({messageId: targetId})();
                    if (found.length > 0) return found[0];
                } catch(e) {}
                return null;
            }

            if (mboxHint) {
                for (let a = 0; a < accounts.length; a++) {
                    const mbs = accounts[a].mailboxes.whose({name: mboxHint})();
                    for (let m = 0; m < mbs.length; m++) {
                        searched.add(accounts[a].name() + '/' + mbs[m].name());
                        const r = searchIn(mbs[m]);
                        if (r) return r;
                    }
                }
            }
            for (let a = 0; a < accounts.length; a++) {
                for (let p = 0; p < priority.length; p++) {
                    const mbs = accounts[a].mailboxes.whose({name: priority[p]})();
                    for (let m = 0; m < mbs.length; m++) {
                        const key = accounts[a].name() + '/' + mbs[m].name();
                        if (searched.has(key)) continue;
                        searched.add(key);
                        const r = searchIn(mbs[m]);
                        if (r) return r;
                    }
                }
            }
            for (let a = 0; a < accounts.length; a++) {
                const mbs = accounts[a].mailboxes();
                for (let m = 0; m < mbs.length; m++) {
                    const key = accounts[a].name() + '/' + mbs[m].name();
                    if (searched.has(key)) continue;
                    const r = searchIn(mbs[m]);
                    if (r) return r;
                }
            }
            return null;
        }

        const results = [];
        const errors = [];

        for (const targetId of ids) {
            try {
                const msg = findMsg(targetId);
                if (!msg) {
                    errors.push({id: targetId, error: 'Message not found'});
                    continue;
                }
                const subject = msg.subject();
                const mboxName = msg.mailbox().name();
                Mail.delete(msg);
                results.push({id: targetId, subject: subject, fromMailbox: mboxName});
            } catch(e) {
                errors.push({id: targetId, error: e.message || String(e)});
            }
        }

        JSON.stringify({results: results, errors: errors});
        """

        let raw = try runJXA(script)

        guard let dict = raw as? [String: Any] else {
            throw CLIError.jxaError("Unexpected output from batch delete")
        }

        let results = dict["results"] as? [Any] ?? []
        let errors = dict["errors"] as? [Any] ?? []

        outputJSON([
            "success": errors.isEmpty,
            "message": "Batch delete completed",
            "deleted": results,
            "deletedCount": results.count,
            "errors": errors,
            "errorCount": errors.count
        ])
    }
}
