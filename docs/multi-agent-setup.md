# Multi-Agent Workspace Isolation

Give each agent its own base config by setting `APPLE_PIM_CONFIG_DIR`. Each agent gets independent access control without needing profiles — just a separate `config.json` per workspace.

## How It Works

The PIM CLIs resolve their config directory in this order:

1. **`APPLE_PIM_CONFIG_DIR` env var** (if set) — CLIs read `$APPLE_PIM_CONFIG_DIR/config.json`
2. **Default** — CLIs read `~/.config/apple-pim/config.json`

This overrides the **base config**, not a profile. Profiles are a separate, optional layer on top (see [Configuration in CLAUDE.md](../CLAUDE.md#configuration-pimconfig)).

```
Default:                ~/.config/apple-pim/config.json
With env var override:  $APPLE_PIM_CONFIG_DIR/config.json
```

## Directory Layout

A typical multi-agent workspace looks like this:

```
~/agents/
├── agent-a/
│   ├── apple-pim/
│   │   └── config.json          # agent-a's base config
│   └── bin/
│       ├── calendar-cli          # wrapper script
│       ├── reminder-cli
│       └── contacts-cli
├── agent-b/
│   ├── apple-pim/
│   │   └── config.json          # agent-b's base config (different access)
│   └── bin/
│       ├── calendar-cli
│       ├── reminder-cli
│       └── contacts-cli
```

## Wrapper Script Template

Each wrapper sets the env var and delegates to the real CLI:

```bash
#!/bin/bash
export APPLE_PIM_CONFIG_DIR="$(dirname "$0")/../apple-pim"
exec ~/GitHub/Apple-PIM-Agent-Plugin/swift/.build/release/calendar-cli "$@"
```

Create one per CLI (`calendar-cli`, `reminder-cli`, `contacts-cli`), replacing the binary name in the `exec` line.

## Config Examples

**Full access** (`config.json` — agent can see everything):

```json
{
  "calendars": { "mode": "all" },
  "reminders": { "mode": "all" },
  "contacts": { "mode": "all" }
}
```

**Restricted** (`config.json` — agent blocked from specific calendars):

```json
{
  "calendars": {
    "mode": "blocklist",
    "blocked": ["Private", "Family"]
  },
  "reminders": { "mode": "all" },
  "contacts": {
    "mode": "allowlist",
    "allowed": ["Work"]
  },
  "defaultCalendar": "Work",
  "defaultReminderList": "Tasks"
}
```

## Common Mistake

> **This uses base configs, not profiles.** There is no `profiles/` directory involved in workspace isolation. Each agent's `APPLE_PIM_CONFIG_DIR` points to a directory containing a plain `config.json` — that's the base config for that agent. Profiles (`~/.config/apple-pim/profiles/*.json`) are a separate optional feature for switching access within a single config root.
