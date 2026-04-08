# Fix Send-with-Attachment Bugs

## Problem

Sending emails with attachments through the OpenClaw plugin silently fails. The email sends but no attachments are included. The CLI works correctly when called directly.

Two root causes:

### Bug 1: `oneOf` schema type dropped by OpenClaw gateway

The `attachment` property in `lib/schemas.js` uses a `oneOf` union type:

```javascript
attachment: {
  oneOf: [
    { type: "string" },
    { type: "array", items: { type: "string" } },
  ],
  description: "File path(s) to attach (send/reply). Accepts a single path or array of paths.",
},
```

The OpenClaw gateway does not support `oneOf` in tool parameter schemas. It silently drops the property during tool registration. The parameter never reaches the handler, so `args.attachment` is always `undefined` and the attachment block in the handler never fires.

Evidence: the gateway's exposed tool definition for `apple_pim_mail` does not include `attachment` in its parameter list. All five test emails sent through the plugin had `attachmentCount: 0`. A direct CLI call with `--attachment` produced `attachmentCount: 1`.

### Bug 2: Handler does not validate file existence

The JS handler in `lib/handlers/mail.js` passes file paths straight through to the CLI without checking if they exist:

```javascript
if (args.attachment) {
  const attachments = Array.isArray(args.attachment) ? args.attachment : [args.attachment];
  for (const filePath of attachments) sendArgs.push("--attachment", filePath);
}
```

The Swift CLI does validate with `FileManager.default.fileExists(atPath:)` and throws `CLIError.invalidInput`. So bad paths will error at the CLI layer. But the handler should validate too for a clean error message at the JS layer, before spawning a process.

This applies to both the `send` and `reply` cases (lines ~116-119 and ~129-132).

## Fix

### schemas.js (line ~382)

Replace the `oneOf` union with a plain array type:

```javascript
attachment: {
  type: "array",
  items: { type: "string" },
  description: "File path(s) to attach (send/reply).",
},
```

The handler already normalizes with `Array.isArray(args.attachment) ? args.attachment : [args.attachment]`, so it handles both forms. But since the gateway only passes what the schema declares, just use `array`. Agents will always pass an array.

### handlers/mail.js — send case (line ~116)

Add file existence validation before building CLI args:

```javascript
if (args.attachment) {
  const attachments = Array.isArray(args.attachment) ? args.attachment : [args.attachment];
  for (const filePath of attachments) {
    const expanded = filePath.replace(/^~/, require("os").homedir());
    if (!require("fs").existsSync(expanded)) {
      throw new Error(`Attachment file not found: ${filePath}`);
    }
    sendArgs.push("--attachment", filePath);
  }
}
```

### handlers/mail.js — reply case (line ~129)

Same validation pattern as send.

### MCP server

The MCP server (`mcp-server/dist/server.js`) uses the same `lib/schemas.js` and `lib/handlers/mail.js`. The `oneOf` schema works fine in MCP (the MCP protocol supports `oneOf`), so this is OpenClaw-specific. But changing to `array` is fine for MCP too since Claude/agents will just pass arrays. No MCP-specific changes needed.

## Verification

After fixing, test through the OpenClaw plugin (not direct CLI):

1. Send with single attachment: `attachment: ["/tmp/test.txt"]`
2. Send with multiple attachments: `attachment: ["/tmp/a.txt", "/tmp/b.txt"]`
3. Send with nonexistent file: `attachment: ["/tmp/does-not-exist.txt"]` — should error before sending
4. Reply with attachment: same pattern
5. Send without attachment: regression check, should work as before
6. Verify received emails have `attachmentCount > 0` and `attachments` array populated

## Files to Change

- `lib/schemas.js` — line ~382, replace `oneOf` with `type: "array"`
- `lib/handlers/mail.js` — lines ~116 and ~129, add file existence checks
