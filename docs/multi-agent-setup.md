# Multi-Agent Workspace Isolation

When running multiple agents (via OpenClaw, Claude Code teams, or separate workspace sessions), each agent can have isolated access to PIM data. This prevents a travel-planning agent from seeing your work calendar, or a work agent from accessing personal reminders.

## Overview

Two isolation strategies, usable independently or together:

| Strategy | What It Does | Best For |
|----------|-------------|----------|
| **Profiles** | Same config root, different access per agent | Agents on the same machine sharing a config directory |
| **Config Directories** | Completely separate config roots per agent | Hard isolation between agents with no config sharing |

## Strategy 1: Profiles

Profiles are the simplest approach. All agents share `~/.config/apple-pim/` but each uses a different profile file that overrides which calendars/lists are visible.

### Create Profiles

```
~/.config/apple-pim/
├── config.json              # Base config (superset of access)
└── profiles/
    ├── personal.json        # Personal assistant agent
    ├── travel.json          # Travel planning agent
    └── work.json            # Work/productivity agent
```

**Base config** — everything enabled:
```json
{
  "calendars": { "enabled": true, "mode": "all", "items": [] },
  "reminders": { "enabled": true, "mode": "all", "items": [] },
  "contacts": { "enabled": true },
  "mail": { "enabled": true },
  "default_calendar": "Personal",
  "default_reminder_list": "Reminders"
}
```

**`travel.json`** — only travel-related data:
```json
{
  "calendars": {
    "enabled": true,
    "mode": "allowlist",
    "items": ["Travel", "Flighty", "NetJets Itinerary"]
  },
  "reminders": {
    "enabled": true,
    "mode": "allowlist",
    "items": ["Travel"]
  },
  "mail": { "enabled": false },
  "contacts": { "enabled": false },
  "default_calendar": "Travel",
  "default_reminder_list": "Travel"
}
```

**`work.json`** — work calendar only:
```json
{
  "calendars": {
    "enabled": true,
    "mode": "allowlist",
    "items": ["Work"]
  },
  "reminders": {
    "enabled": true,
    "mode": "allowlist",
    "items": ["Work"]
  },
  "contacts": { "enabled": true },
  "mail": { "enabled": false },
  "default_calendar": "Work",
  "default_reminder_list": "Work"
}
```

### Assign Profiles

**OpenClaw plugin** (recommended — per-call isolation):

```
// In OpenClaw plugin config (gateway-level default)
plugins.entries.apple-pim-cli.config.profile = "travel"

// Or per-call override (tool parameter)
apple_pim_calendar({ action: "list", profile: "travel" })
apple_pim_calendar({ action: "list", profile: "work" })
```

**Claude Code** (environment variable):

```bash
APPLE_PIM_PROFILE=travel   # Set in agent's environment
```

**Direct CLI** (flag or environment):

```bash
calendar-cli list --profile travel
# or
APPLE_PIM_PROFILE=travel calendar-cli list
```

### Profile Merge Semantics

Profiles use **whole-section replacement**, not field-level merge:

| Base config | Profile | Result |
|-------------|---------|--------|
| `calendars: {mode: "all"}` | `calendars: {mode: "allowlist", items: ["Work"]}` | Profile's calendars config used entirely |
| `reminders: {mode: "allowlist", items: ["A", "B"]}` | *(not specified)* | Base's reminders config inherited |
| `default_calendar: "Personal"` | `default_calendar: "Work"` | Profile's default used |

## Strategy 2: Config Directory Isolation

For hard isolation, give each agent its own config directory. No shared config root.

### OpenClaw Plugin (Recommended)

Pass `configDir` as a tool parameter. The OpenClaw plugin handles per-spawn env isolation automatically — no wrapper scripts needed.

**Gateway-level default** (in OpenClaw config):
```
plugins.entries.apple-pim-cli.config.configDir = "~/agents/travel/apple-pim"
```

**Per-call override**:
```
apple_pim_calendar({ action: "list", configDir: "~/agents/travel/apple-pim" })
apple_pim_calendar({ action: "list", configDir: "~/agents/work/apple-pim" })
```

### Direct CLI Usage

Set `APPLE_PIM_CONFIG_DIR` per agent:

```bash
APPLE_PIM_CONFIG_DIR=~/agents/travel/apple-pim calendar-cli list
APPLE_PIM_CONFIG_DIR=~/agents/work/apple-pim calendar-cli list
```

Or use wrapper scripts:

```bash
#!/bin/bash
export APPLE_PIM_CONFIG_DIR="$(dirname "$0")/../apple-pim"
exec /path/to/swift/.build/release/calendar-cli "$@"
```

### Directory Layout

```
~/agents/
├── travel/
│   └── apple-pim/
│       └── config.json          # Travel agent's base config
├── work/
│   └── apple-pim/
│       └── config.json          # Work agent's base config
└── personal/
    └── apple-pim/
        ├── config.json          # Personal agent's base config
        └── profiles/            # Can still use profiles within a config dir
            └── family.json
```

## Isolation Chain

Each tool call resolves `configDir` and `profile` from this priority chain:

| Priority | Source | Example |
|----------|--------|---------|
| 1 | **Tool parameter** | `apple_pim_calendar({ configDir: "~/agents/a/..." })` |
| 2 | **Plugin config** | `plugins.entries.apple-pim-cli.config.configDir` |
| 3 | **Process env** | `APPLE_PIM_CONFIG_DIR` / `APPLE_PIM_PROFILE` |
| 4 | **Default** | `~/.config/apple-pim/` |

The OpenClaw plugin resolves these per-call and passes them as `child_process.spawn()` env vars — `process.env` is never mutated. Two concurrent calls with different `configDir` values are fully isolated.

## Verification

Confirm each profile/config sees only its allowed data:

```bash
# Personal sees everything except Work
calendar-cli list --profile personal | jq '.calendars[].title'

# Travel sees only travel calendars
calendar-cli list --profile travel | jq '.calendars[].title'

# Work sees only Work calendar
calendar-cli list --profile work | jq '.calendars[].title'

# Config dir isolation
APPLE_PIM_CONFIG_DIR=~/agents/travel/apple-pim calendar-cli list | jq '.calendars[].title'
```

## Common Mistakes

**Profiles vs base configs**: `APPLE_PIM_CONFIG_DIR` overrides the **base config root**, not a profile. Profiles are a separate, optional layer on top. Each agent's config directory contains its own `config.json` (the base config for that agent).

**Don't mutate process.env for OpenClaw**: Use tool parameters (`configDir`, `profile`) instead of setting `process.env.APPLE_PIM_CONFIG_DIR`. The plugin handles per-spawn isolation automatically.

**Profile files must exist**: If a profile is explicitly requested but doesn't exist, the CLI exits with an error (fail-closed) instead of silently falling back to the base config.
