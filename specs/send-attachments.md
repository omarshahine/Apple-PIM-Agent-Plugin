# Send Attachments Spec

Add attachment support to the `send` and `reply` subcommands in mail-cli.

## Verified AppleScript Pattern

Tested and confirmed working on macOS 15 / Mail.app:

```applescript
tell application "Mail"
    set newMessage to make new outgoing message with properties {subject:"test", visible:false}
    tell newMessage
        make new to recipient at end of to recipients with properties {address:"recipient@example.com"}
    end tell
    set content of newMessage to "body text"
    tell newMessage
        make new attachment with properties {file name:"/path/to/file.pdf"} at after the last paragraph
        make new attachment with properties {file name:"/path/to/other.txt"} at after the last paragraph
    end tell
    send newMessage
end tell
```

Key ordering: set `content` BEFORE adding attachments (attachments go `at after the last paragraph`). Multiple attachments work by repeating the `make new attachment` line.

## Changes

### 1. Swift CLI: `SendMessage` struct (MailCLI.swift ~line 1284)

Add a new option:

```swift
@Option(name: .long, help: "File path to attach (repeatable)")
var attachment: [String] = []
```

In the `run()` method, after the existing `set content of newMessage to bodyText` line, add attachment lines to the AppleScript:

```swift
var attachmentLines = ""
for filePath in attachment {
    // Validate file exists before building the script
    let expandedPath = (filePath as NSString).expandingTildeInPath
    guard FileManager.default.fileExists(atPath: expandedPath) else {
        throw CLIError.invalidInput("Attachment file not found: \(filePath)")
    }
    attachmentLines += "\n        make new attachment with properties {file name:\"\(escapeForAppleScript(expandedPath))\"} at after the last paragraph"
}
```

The AppleScript template becomes:

```applescript
set bodyText to read POSIX file "{bodyFile.path}" as «class utf8»
tell application "Mail"
    set newMessage to make new outgoing message with properties {subject:"{escapedSubject}", visible:false{senderProp}}
    tell newMessage{recipientLines}
    end tell
    set content of newMessage to bodyText
    tell newMessage{attachmentLines}
    end tell
    send newMessage
end tell
```

Note: the `tell newMessage{attachmentLines}\nend tell` block should only be emitted when `attachmentLines` is non-empty. When there are no attachments, the script stays identical to today.

Update the success output to include attachment info:

```swift
var result: [String: Any] = [
    "success": true,
    "message": "Email sent successfully",
    "to": to,
    "subject": subject
]
if !attachment.isEmpty {
    result["attachments"] = attachment.map { ($0 as NSString).expandingTildeInPath }
}
outputJSON(result)
```

### 2. Swift CLI: `ReplyMessage` struct (MailCLI.swift ~line 1364)

Same pattern. Add:

```swift
@Option(name: .long, help: "File path to attach (repeatable)")
var attachment: [String] = []
```

In the `run()` method, after `set content of replyMsg to replyBody & return & return & content of replyMsg`, add the attachment block before `send replyMsg`:

```swift
var attachmentLines = ""
for filePath in attachment {
    let expandedPath = (filePath as NSString).expandingTildeInPath
    guard FileManager.default.fileExists(atPath: expandedPath) else {
        throw CLIError.invalidInput("Attachment file not found: \(filePath)")
    }
    attachmentLines += "\n        make new attachment with properties {file name:\"\(escapeForAppleScript(expandedPath))\"} at after the last paragraph"
}
```

Insert the `tell replyMsg{attachmentLines}\nend tell` block (if non-empty) between the content assignment and the `send replyMsg` line.

### 3. JS Handler: `lib/handlers/mail.js`

In the `send` case (~line 120), after the existing `bcc` handling:

```javascript
if (args.attachment) {
  const attachments = Array.isArray(args.attachment) ? args.attachment : [args.attachment];
  for (const filePath of attachments) sendArgs.push("--attachment", filePath);
}
```

In the `reply` case (~line 138), add the same block after the existing `account` handling:

```javascript
if (args.attachment) {
  const attachments = Array.isArray(args.attachment) ? args.attachment : [args.attachment];
  for (const filePath of attachments) replyArgs.push("--attachment", filePath);
}
```

### 4. Schema: `lib/schemas.js`

Add to the mail tool's properties (after the existing `bcc` property):

```javascript
attachment: {
  oneOf: [
    { type: "string" },
    { type: "array", items: { type: "string" } }
  ],
  description: "File path(s) to attach (send/reply). Accepts a single path or array of paths."
},
```

Update the mail tool description to mention attachment support:

```javascript
"Manage Mail.app messages. Requires Mail.app to be running. Actions: accounts, mailboxes, messages (list with attachmentCount), get (full message by ID with attachment metadata), search, update (flags), move, delete, batch_update, batch_delete, send (with optional attachments), reply (with optional attachments), save_attachment (save message attachments to disk), auth_check, schema (show input schema)."
```

### 5. OpenClaw plugin: No changes needed

The plugin delegates to the handler which delegates to the CLI. The new parameter flows through automatically.

## Error Cases

- File not found: validated in Swift before building the AppleScript. Throws `CLIError.invalidInput("Attachment file not found: /path/to/file")`.
- File not readable (permissions): Mail.app will throw an AppleScript error. The existing error handling will surface it.
- Empty attachment array: no-op, script is identical to today.

## What NOT to Build

- No inline/base64 attachment content (always file paths on disk).
- No URL-based attachments (must be local files).
- No attachment size limits (Mail.app handles that).
- No HTML body support (separate feature).

## Testing

1. `send` with single `--attachment /path/to/file.txt` — verify email arrives with attachment
2. `send` with multiple `--attachment` flags — verify all attachments present
3. `send` with nonexistent file path — verify clean error before sending
4. `send` without `--attachment` — verify no regression, identical behavior to today
5. `reply` with `--attachment` — verify attachment on reply
6. Agent call with `attachment: "/path/to/file"` (string) — verify handler normalizes
7. Agent call with `attachment: ["/path/to/a", "/path/to/b"]` (array) — verify handler passes multiple flags
