# Bugbot Rules

## PII and Personal Path Detection

If a file contains paths matching `/Users/[username]/` (macOS home directory), then:
- Add a blocking bug: "Hardcoded macOS home directory path detected. Use wildcards or environment variables instead of personal paths."
- Suggest replacing with a wildcard pattern like `~/` or `*/`

If a file contains paths matching `C:\Users\[username]\` (Windows home directory), then:
- Add a blocking bug: "Hardcoded Windows home directory path detected. Use wildcards or environment variables instead of personal paths."

If a file contains what appears to be a personal username in a path (e.g., `/Users/[name]/` or `[name]-agent-plugins`), then:
- Add a blocking bug: "Personal username detected in file. Remove or replace with a generic placeholder or wildcard."

## Marketplace Path Patterns

If a markdown file in `agents/`, `skills/`, or `commands/` contains a hardcoded marketplace path like `.claude/plugins/cache/[specific-name]/` without wildcards, then:
- Add a blocking bug: "Hardcoded marketplace cache path detected. Use wildcard pattern like `~/.claude/plugins/cache/*/plugin-name/` for portability across different users."

## Email Address Detection

If a file contains an email address pattern (except @example.com, @anthropic.com, or @noreply addresses), then:
- Add a non-blocking bug: "Email address detected. Verify this is not personal information that should be parameterized or removed."

Exclude from email checks:
- CHANGELOG.md
- package-lock.json
- node_modules/

## API Keys and Secrets

If a file contains patterns like `api_key=`, `token=`, `secret=`, or `password=` followed by a string value, then:
- Add a blocking bug: "Possible API key or secret detected. Use environment variables instead of hardcoding credentials."

Exclude from secret checks:
- .env.example files (these are templates)
- Documentation showing example patterns

## Phone Number Detection

If a file contains US phone number patterns (XXX-XXX-XXXX or similar), then:
- Add a non-blocking bug: "Possible phone number detected. Ensure this is not personal information."

## Absolute Paths in Plugin Files

If a markdown file in the `plugins/` directory contains absolute paths starting with `/` or `~` that don't use wildcards, then:
- Add a non-blocking bug: "Absolute path detected. Consider using relative paths or wildcard patterns for better portability."
