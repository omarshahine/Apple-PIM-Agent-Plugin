---
description: Manage macOS Mail.app - list mailboxes, read messages, search, update flags, move, delete with batch operations
argument-hint: "[accounts|mailboxes|messages|get|search|update|move|delete] [options]"
allowed-tools:
  - mcp__apple-pim__mail_accounts
  - mcp__apple-pim__mail_mailboxes
  - mcp__apple-pim__mail_messages
  - mcp__apple-pim__mail_get
  - mcp__apple-pim__mail_search
  - mcp__apple-pim__mail_update
  - mcp__apple-pim__mail_move
  - mcp__apple-pim__mail_delete
  - mcp__apple-pim__mail_batch_update
  - mcp__apple-pim__mail_batch_delete
---

# Mail Management

Manage macOS Mail.app messages via JXA (JavaScript for Automation). Mail.app must be running.

## Available Operations

When the user runs this command, determine which operation they need and use the appropriate MCP tool:

### List Accounts
Use `mail_accounts` to show all configured mail accounts.

### List Mailboxes
Use `mail_mailboxes` to list mailboxes with unread and total message counts:
- Optional: `account` (filter by account name)

### List Messages
Use `mail_messages` to list messages in a mailbox:
- Default mailbox: INBOX
- Parameters: `mailbox`, `account`, `limit` (default: 25), `filter` (unread, flagged, all)

### Get Message
Use `mail_get` to get a single message with full body content:
- Required: `id` (RFC 2822 message ID)
- Optional: `mailbox`, `account` (hints for faster lookup)
- Optional: `format` (`plain` default, or `markdown` for HTML-to-markdown conversion)

### Search Messages
Use `mail_search` to find messages by subject, sender, or content:
- Required: `query` (search term)
- Optional: `field` (subject, sender, content, all), `mailbox`, `account`, `limit`

### Update Message
Use `mail_update` to change message flags:
- Required: `id` (message ID)
- Optional: `read` (true/false), `flagged` (true/false), `junk` (true/false)

### Batch Update
Use `mail_batch_update` to update flags on multiple messages at once:
- Required: `ids` (array of message IDs)
- Optional: `read`, `flagged`, `junk`, `mailbox`, `account`
- Efficient for triaging: "mark all these as read"

### Move Message
Use `mail_move` to move a message to a different mailbox:
- Required: `id` (message ID), `toMailbox` (destination)
- Optional: `toAccount` (destination account)

### Delete Message
Use `mail_delete` to delete a single message (moves to Trash):
- Required: `id` (message ID)

### Batch Delete
Use `mail_batch_delete` to delete multiple messages at once:
- Required: `ids` (array of message IDs)
- Optional: `mailbox`, `account` (hints for faster lookup)

## Examples

**List accounts:**
```
/apple-pim:mail accounts
```

**List mailboxes:**
```
/apple-pim:mail mailboxes
/apple-pim:mail mailboxes --account "iCloud"
```

**List messages:**
```
/apple-pim:mail messages
/apple-pim:mail messages --mailbox INBOX --limit 10
/apple-pim:mail messages --filter unread
/apple-pim:mail messages --filter flagged
```

**Read a message:**
```
/apple-pim:mail get --id <message-id>
/apple-pim:mail get --id <message-id> --format markdown
```

**Search messages:**
```
/apple-pim:mail search "invoice"
/apple-pim:mail search "John" --field sender
/apple-pim:mail search "project update" --mailbox INBOX
```

**Mark as read:**
```
/apple-pim:mail update --id <message-id> --read true
```

**Mark multiple as read:**
```
/apple-pim:mail batch-update --ids [<id1>, <id2>, <id3>] --read true
```

**Flag a message:**
```
/apple-pim:mail update --id <message-id> --flagged true
```

**Move to archive:**
```
/apple-pim:mail move --id <message-id> --to-mailbox Archive
```

**Delete a message:**
```
/apple-pim:mail delete --id <message-id>
```

**Delete multiple messages:**
```
/apple-pim:mail batch-delete --ids [<id1>, <id2>]
```

## Parsing User Intent

When a user provides natural language, map to the appropriate operation:
- "Check my mail" -> `mail_messages` with default INBOX
- "Show unread messages" -> `mail_messages` with filter: unread
- "How many unread emails do I have?" -> `mail_mailboxes` to show unread counts
- "Show flagged messages" -> `mail_messages` with filter: flagged
- "Find emails from John" -> `mail_search` with field: sender
- "Search for invoices" -> `mail_search` with query "invoice"
- "Read that email" -> `mail_get` with the message ID
- "Mark it as read" -> `mail_update` with read: true
- "Mark all these as read" -> `mail_batch_update` with read: true
- "Flag this for later" -> `mail_update` with flagged: true
- "Archive this" -> `mail_move` to Archive mailbox
- "Delete that email" -> `mail_delete`
- "Clean up my inbox" -> List messages, then `mail_batch_delete` or `mail_move` as appropriate
- "Mark these as junk" -> `mail_batch_update` with junk: true

## Important Notes

- **Mail.app must be running** for all operations. If not running, the CLI returns a clear error.
- **Message IDs** are RFC 2822 message IDs (stable across mailbox moves).
- **Batch operations** process messages sequentially but in a single tool call for convenience.
- **For cloud email operations** (sending, composing, folder management), use the Fastmail MCP instead.
- This tool accesses Mail.app's local state -- "On My Mac" mailboxes, locally cached messages, and local search.
