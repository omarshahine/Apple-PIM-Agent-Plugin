---
description: Check and request macOS permissions for calendars, reminders, contacts, and Mail.app automation
argument-hint: "[status|request] [--domain calendars|reminders|contacts|mail]"
allowed-tools:
  - mcp__apple-pim__apple-pim
---

# Authorize Apple PIM Access

Check and request macOS privacy permissions for the Apple PIM plugin.

## Available Operations

### Check Authorization Status
Use `apple-pim` with action `status` to check current permission status for all domains:
- Returns authorization state for each domain: calendars, reminders, contacts, mail
- Does **not** trigger any system prompts
- Useful for diagnosing "access denied" errors

Status values:
- `authorized` - Full access granted
- `denied` - User denied access (must enable in System Settings)
- `restricted` - System-level restriction (MDM, parental controls)
- `notDetermined` - Never requested (use action `authorize` to prompt)
- `writeOnly` - Limited write-only access (upgrade in System Settings)
- `unavailable` - Domain disabled in plugin config or Mail.app not running

### Request Authorization
Use `apple-pim` with action `authorize` to trigger macOS permission prompts:
- Optional: `domain` to request access for a specific domain only
- If no domain specified, requests access for all enabled domains
- Only triggers prompts for domains with `notDetermined` status
- For `denied` domains, directs user to System Settings

## Examples

**Check all permissions:**
```
/apple-pim:authorize status
```

**Request all permissions:**
```
/apple-pim:authorize request
```

**Request specific domain:**
```
/apple-pim:authorize request --domain reminders
```

## Parsing User Intent

- "Can the plugin access my calendars?" -> `apple-pim` with action `status`
- "I'm getting permission errors" -> `apple-pim` with action `status` then guide user
- "Grant access to reminders" -> `apple-pim` with action `authorize` and domain "reminders"
- "Set up permissions" -> `apple-pim` with action `authorize` for all domains

## Troubleshooting

If a domain shows `denied`:
1. Open **System Settings > Privacy & Security**
2. Find the relevant section (Calendars, Reminders, Contacts, or Automation)
3. Enable access for the terminal application (Terminal, iTerm2, VS Code, etc.)
4. Restart the terminal application
5. Run `/apple-pim:authorize status` again to verify

For Mail.app:
- Mail.app must be **running** before authorization can be requested
- Automation permission is under System Settings > Privacy & Security > Automation
- The terminal app must be allowed to control Mail.app

For SSH sessions:
- Permissions must be granted on the Mac where the CLI runs
- SSH does not inherit GUI-level permission dialogs
- Grant permissions locally first, then SSH sessions will inherit them
