# Code Review: Apple-PIM Mail Attachment PRs

We're about to submit two PRs to upstream (omarshahine/Apple-PIM-Agent-Plugin). Both branches are based on `origin/main` (commit `9d5ba49`). Fork remote is `juan-deere-4000/Apple-PIM-Agent-Plugin`.

Please review both branches for correctness, edge cases, and anything that would embarrass us in a public PR.

## Branches

### 1. `feat/mail-attachment-receive` (commit `083da0e`)

Adds attachment metadata to `messages` and `get` actions, plus a new `save_attachment` action.

**Files changed:**
- `swift/Sources/MailCLI/MailCLI.swift` — bulk of the work: `SaveAttachment` command struct, `inferMimeJXA()` helper, attachment metadata in `ListMessages` and `GetMessage` JXA, filename sanitization, dedup logic
- `lib/handlers/mail.js` — `save_attachment` case with ID validation, arg construction
- `lib/schemas.js` — `save_attachment` added to action enum, `index` and `destDir` properties added, description updated
- `lib/dry-run.js` — `save_attachment` added to mutation set and describe
- `evals/scenarios/safety.yaml` — `save_attachment` in id_required_actions
- `evals/tests/safety.test.js` — coverage set updated, isMutation assertion added
- `evals/tests/tool-call-correctness.test.js` — save_attachment validation and arg construction tests
- `evals/fixtures/mail/get-with-attachments.json` — new fixture
- `mcp-server/dist/server.js` — rebuilt bundle

### 2. `feat/mail-attachment-send` (commit `df8fb96`)

Adds `--attachment` (repeatable) to `send` and `reply` actions.

**Files changed:**
- `swift/Sources/MailCLI/MailCLI.swift` — `--attachment` option on `SendMessage` and `ReplyMessage`, file existence validation, AppleScript attachment block injection
- `lib/handlers/mail.js` — attachment validation (existsSync + tilde expansion) and `--attachment` flag construction for both send and reply
- `lib/schemas.js` — `attachment` property added as `{ type: "array", items: { type: "string" } }` (NOT `oneOf` — OpenClaw gateway silently drops `oneOf` params), description updated
- `lib/dry-run.js` — send/reply descriptions include attachment count
- `evals/tests/tool-call-correctness.test.js` — 6 new tests covering single/multi/missing attachments for send and reply
- `mcp-server/dist/server.js` — rebuilt bundle

## What to look for

1. **Swift correctness** — AppleScript/JXA injection risks from unsanitized input, proper escaping, error handling paths
2. **JS handler correctness** — arg construction, edge cases (empty arrays, single string vs array normalization), error messages
3. **Schema correctness** — property types, descriptions, enum completeness
4. **Eval coverage** — are we missing any important test cases?
5. **Consistency between the two branches** — they don't depend on each other but they touch some of the same files. Any conflicts or inconsistencies?
6. **MCP server bundle** — the rebuilt `mcp-server/dist/server.js` includes upstream dependency diffs from esbuild rebuild (mailparser, ajv changes). These are NOT part of our changes but will show in the diff. This is expected and matches what upstream would get from a clean `npm run build`.

## How to review

```bash
cd ~/projects/apple-pim

# PR 1
git diff origin/main..feat/mail-attachment-receive -- swift/ lib/ evals/

# PR 2
git diff origin/main..feat/mail-attachment-send -- swift/ lib/ evals/

# Run evals on either branch
git checkout feat/mail-attachment-receive  # or feat/mail-attachment-send
cd evals && npm test
```

## Context

- Upstream repo: https://github.com/omarshahine/Apple-PIM-Agent-Plugin
- Fork: https://github.com/juan-deere-4000/Apple-PIM-Agent-Plugin
- Both features were developed and tested locally. Send attachments were verified end-to-end (4 test cases: single, multiple, nonexistent, none). Receive attachments were verified with real emails containing PDF and markdown attachments.
