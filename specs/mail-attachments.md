# Mail Attachments Spec

## Problem

The `mail` tool (via `mail-cli`) can list and read email messages but has no way to access attachments. When a message has attachments, the agent sees the body text but cannot list, inspect, or extract the attached files. This blocks workflows where Joe emails files to Juan (research reports, documents, etc.) and expects Juan to file or process them.

## Prior Art: What the Mail.app Scripting Dictionary Exposes

From `/System/Applications/Mail.app/Contents/Resources/Mail.sdef`, the `mail attachment` class:

```
name        text     (r/o)  — filename
MIME type   text     (r/o)  — e.g. "text/plain" (unreliable, fails on some messages)
file size   integer  (r/o)  — approximate bytes
downloaded  boolean  (r/o)  — whether the attachment has been fetched from server
id          text     (r/o)  — unique identifier within the message
```

Responds to `save` command: `save attachment in <file path>`.

### Verified Working (JXA)

```javascript
const att = msg.mailAttachments[0];
att.name()        // "report.md"
att.downloaded()  // true
att.fileSize()    // 62548
att.id()          // "2"
Mail.save(att, {in: Path("/tmp/report.md")});  // saves the file
```

### Known Issues

- `att.mimeType()` throws `AppleEvent handler failed` (-10000) for many messages. Not reliably accessible. Treat it as optional/best-effort. Fall back to inferring from file extension.
- `msg.mailAttachments()` (calling as function on the collection) throws in JXA. Use `msg.mailAttachments[i]` (indexing) instead.

## Design

### Two new actions on the existing `mail` tool

No new CLI subcommands. Extend the existing `get` action and add one new action.

#### 1. Extend `get` action: include attachment metadata

When getting a message, always include an `attachments` array in the response:

```json
{
  "message": {
    "messageId": "...",
    "subject": "...",
    "attachments": [
      {
        "index": 0,
        "name": "report.md",
        "fileSize": 62548,
        "downloaded": true,
        "mimeType": "text/markdown"
      }
    ]
  }
}
```

- `index`: zero-based position in the attachment list (used as the stable reference for save)
- `mimeType`: best-effort. Try `att.mimeType()` in a try/catch. If it fails, infer from extension using a hardcoded map (`.md` -> `text/markdown`, `.pdf` -> `application/pdf`, `.jpg`/`.jpeg` -> `image/jpeg`, `.png` -> `image/png`, `.doc`/`.docx` -> `application/msword`, `.xls`/`.xlsx` -> `application/vnd.ms-excel`, `.csv` -> `text/csv`, `.txt` -> `text/plain`, `.zip` -> `application/zip`, `.html` -> `text/html`). Default: `application/octet-stream`.
- `downloaded`: if false, the attachment hasn't been fetched from the server yet. Save will fail.

Also include `attachmentCount` at the message level for quick checks without needing to inspect the array.

#### 2. New action: `save-attachment`

Saves one or all attachments from a message to a local directory.

**Parameters:**
- `id` (required): RFC 2822 message ID
- `index` (optional): zero-based attachment index. If omitted, saves all attachments.
- `destDir` (optional): directory path to save into. Default: `~/.openclaw/workspace/mail-attachments/`. Created if it doesn't exist.
- `mailbox` (optional): hint for faster message lookup
- `account` (optional): hint for faster message lookup

**Behavior:**
1. Find the message by ID (reuse existing `findMessageJXA`).
2. Get the attachment(s) at the specified index (or all if no index).
3. Check `downloaded` status. If not downloaded, return an error.
4. Save to `{destDir}/{sanitized_filename}`. If a file with that name exists, append a counter: `report.md` -> `report_1.md`.
5. Return the saved file path(s) so the agent can read them.

**Output:**
```json
{
  "success": true,
  "saved": [
    {
      "index": 0,
      "name": "report.md",
      "path": "/Users/joe/.openclaw/workspace/mail-attachments/report.md",
      "fileSize": 62548,
      "mimeType": "text/markdown"
    }
  ]
}
```

**Error cases:**
- Message not found: standard `notFound` error
- Attachment index out of range: error with available count
- Attachment not downloaded: error with `downloaded: false`
- Save failed (permissions, disk): error with OS message

### Changes needed in the `messages` (list) action

Add `attachmentCount` to each message in list results (cheap: just `msg.mailAttachments.length` in JXA). This lets the agent know which messages have attachments without fetching each one.

## Implementation Scope

### Swift CLI (`swift/Sources/MailCLI/MailCLI.swift`)

1. **Modify `GetMessage`**: add attachment metadata collection to the existing JXA script. After the current `JSON.stringify(result)` block, iterate `msg.mailAttachments` and build the array. Add `attachmentCount` field.

2. **Modify `ListMessages`**: add `attachmentCount` to each message object in the JXA loop. One extra line: `attachmentCount: m.mailAttachments.length`.

3. **New subcommand `SaveAttachment`**: new `ParsableCommand` struct.
   - Options: `--id` (message ID), `--index` (optional int), `--dest-dir` (optional string, default `~/.openclaw/workspace/mail-attachments/`), `--mailbox`, `--account`
   - JXA: reuse `findMessageJXA`, then `Mail.save(att, {in: Path(destPath)})` for each target attachment
   - Filename sanitization: strip path separators, null bytes. Keep the original name otherwise.
   - Dedup: if file exists, append `_1`, `_2`, etc. before the extension.

4. **MIME type helper** (shared): try/catch wrapper around `att.mimeType()` with extension-based fallback map.

5. **Register `SaveAttachment`** in the `MailCLI` subcommands array.

### JS handler (`lib/handlers/mail.js`)

Add `save_attachment` case to the switch:

```javascript
case "save_attachment": {
  if (!args.id) throw new Error("Message ID required");
  const saveArgs = ["save-attachment", "--id", args.id];
  if (args.index !== undefined) saveArgs.push("--index", String(args.index));
  if (args.destDir) saveArgs.push("--dest-dir", args.destDir);
  if (args.mailbox) saveArgs.push("--mailbox", args.mailbox);
  if (args.account) saveArgs.push("--account", args.account);
  return await runCLI("mail-cli", saveArgs);
}
```

### Schema (`lib/schemas.js`)

Add `save-attachment` to the mail tool's action enum. Add `index` (integer, optional) and `destDir` (string, optional) to the mail input schema.

### OpenClaw plugin (`openclaw/src/index.ts`)

No changes needed. The plugin delegates to the handler, which delegates to the CLI. The new action flows through automatically.

## What NOT to build

- No inline attachment content in `get` responses (binary data doesn't belong in JSON tool output).
- No attachment upload/compose (sending attachments is a separate feature).
- No streaming/partial download for large attachments.
- No attachment preview/thumbnail generation.

## Testing

1. Send an email with a text attachment (.md, .txt) -> verify `get` shows attachment metadata, `save-attachment` extracts it
2. Send an email with a binary attachment (.pdf, .png) -> same verification
3. Send an email with multiple attachments -> verify `save-attachment` without `--index` saves all, with `--index` saves one
4. Message with no attachments -> verify `attachments: []` in get, `save-attachment` returns clean error
5. Filename collision -> verify dedup counter works
6. MIME type fallback -> verify extension-based inference when `mimeType()` throws
