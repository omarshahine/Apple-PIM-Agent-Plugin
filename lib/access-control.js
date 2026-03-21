/**
 * Agent-layer access control for calendars and reminders.
 *
 * This is a JS middleware layer that pre-filters at the plugin/MCP level,
 * giving agents clear error messages before the Swift CLI is ever invoked and
 * post-filtering read results that the CLI returns unfiltered. The Swift CLIs
 * have their own config-based filtering via PIMConfig, but that layer operates
 * at the CLI process level and returns generic errors. This module reads a
 * separate config file (access.json) to enforce visibility, read-only, and
 * default-target semantics at the agent-facing surface.
 *
 * Both adapters (OpenClaw plugin and MCP server) call initAccessConfig() at
 * startup. If no config file exists, all access is open (current behavior).
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Module-level singleton
// ---------------------------------------------------------------------------

let _config = null;
let _initialized = false;

const DEFAULT_PATH = resolve(homedir(), ".config", "apple-pim", "access.json");
const VALID_MODES = new Set(["open", "allowlist", "blocklist"]);

const DOMAIN_MAP = {
  calendar: "calendars",
  reminder: "reminders",
};

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Load and validate the access control config file.
 * Call once at plugin/server startup.
 *
 * Resolution: filePath arg > APPLE_PIM_ACCESS_FILE env > ~/.config/apple-pim/access.json
 *
 * If file does not exist → open mode (null config).
 * If file exists but is malformed → throws.
 *
 * @param {string} [filePath]
 */
export function initAccessConfig(filePath) {
  const resolved = filePath
    || process.env.APPLE_PIM_ACCESS_FILE
    || DEFAULT_PATH;

  if (!existsSync(resolved)) {
    _config = null;
    _initialized = true;
    return;
  }

  let raw;
  try {
    raw = readFileSync(resolved, "utf-8");
  } catch (err) {
    throw new Error(`access-control: failed to read ${resolved}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`access-control: invalid JSON in ${resolved}: ${err.message}`);
  }

  validateConfig(parsed, resolved);
  _config = parsed;
  _initialized = true;
}

/**
 * Get the domain-specific config for a tool.
 * Returns the `calendars` or `reminders` sub-object, or null.
 *
 * @param {string} toolName - "calendar" or "reminder"
 * @returns {object|null}
 */
export function getDomainConfig(toolName) {
  if (!_initialized) return null; // not yet initialized — open mode
  if (!_config) return null;
  const key = DOMAIN_MAP[toolName];
  if (!key) return null;
  return _config[key] ?? null;
}

/**
 * Reset config state. For testing only.
 */
export function _resetForTesting() {
  _config = null;
  _initialized = false;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateConfig(config, filePath) {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error(`access-control: config must be a JSON object (${filePath})`);
  }

  const validKeys = new Set(["calendars", "reminders"]);
  for (const key of Object.keys(config)) {
    if (!validKeys.has(key)) {
      throw new Error(`access-control: unexpected top-level key "${key}" (${filePath})`);
    }
  }

  if (config.calendars) validateDomain(config.calendars, "calendars", filePath);
  if (config.reminders) validateDomain(config.reminders, "reminders", filePath);
}

function validateDomain(domain, name, filePath) {
  if (typeof domain !== "object" || domain === null || Array.isArray(domain)) {
    throw new Error(`access-control: "${name}" must be an object (${filePath})`);
  }

  const validKeys = new Set(["mode", "allow", "block", "readOnly", "default"]);
  for (const key of Object.keys(domain)) {
    if (!validKeys.has(key)) {
      throw new Error(`access-control: unexpected key "${name}.${key}" (${filePath})`);
    }
  }

  if (domain.mode !== undefined && !VALID_MODES.has(domain.mode)) {
    throw new Error(`access-control: "${name}.mode" must be one of: ${[...VALID_MODES].join(", ")} (${filePath})`);
  }

  for (const arrKey of ["allow", "block", "readOnly"]) {
    if (domain[arrKey] !== undefined) {
      if (!Array.isArray(domain[arrKey]) || !domain[arrKey].every((v) => typeof v === "string")) {
        throw new Error(`access-control: "${name}.${arrKey}" must be an array of strings (${filePath})`);
      }
    }
  }

  if (domain.default !== undefined && typeof domain.default !== "string") {
    throw new Error(`access-control: "${name}.default" must be a string (${filePath})`);
  }

  const mode = domain.mode || "open";
  if (mode === "allowlist" && !domain.allow) {
    throw new Error(`access-control: "${name}" uses allowlist mode but "allow" is not defined (${filePath})`);
  }
  if (mode === "blocklist" && !domain.block) {
    throw new Error(`access-control: "${name}" uses blocklist mode but "block" is not defined (${filePath})`);
  }
}

// ---------------------------------------------------------------------------
// Visibility / writability checks
// ---------------------------------------------------------------------------

/**
 * Is a calendar/list name visible under the given domain config?
 * @param {string} name
 * @param {object} domainConfig
 * @returns {boolean}
 */
export function isVisible(name, domainConfig) {
  if (!domainConfig) return true;
  const mode = domainConfig.mode || "open";
  const lower = name.toLowerCase();

  if (mode === "open") return true;

  if (mode === "allowlist") {
    const allow = (domainConfig.allow || []).map((s) => s.toLowerCase());
    const readOnly = (domainConfig.readOnly || []).map((s) => s.toLowerCase());
    return allow.includes(lower) || readOnly.includes(lower);
  }

  if (mode === "blocklist") {
    const block = (domainConfig.block || []).map((s) => s.toLowerCase());
    return !block.includes(lower);
  }

  return true;
}

/**
 * Is a calendar/list name writable (visible AND not read-only)?
 * @param {string} name
 * @param {object} domainConfig
 * @returns {boolean}
 */
export function isWritable(name, domainConfig) {
  if (!isVisible(name, domainConfig)) return false;
  const readOnly = (domainConfig?.readOnly || []).map((s) => s.toLowerCase());
  return !readOnly.includes(name.toLowerCase());
}

/**
 * Get writable names from the config. Only meaningful in allowlist mode.
 * Returns null for open/blocklist (we don't know the full set).
 * @param {object} domainConfig
 * @returns {string[]|null}
 */
export function getWritableNames(domainConfig) {
  if (!domainConfig) return null;
  const mode = domainConfig.mode || "open";
  if (mode !== "allowlist") return null;

  const readOnlyLower = new Set((domainConfig.readOnly || []).map((s) => s.toLowerCase()));
  return (domainConfig.allow || []).filter((s) => !readOnlyLower.has(s.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Write target resolution
// ---------------------------------------------------------------------------

/**
 * Validate and optionally inject a default write target.
 * Returns the resolved target name.
 * Throws with a helpful error if the target is not writable.
 *
 * @param {string|undefined} target - The calendar/list name the agent specified
 * @param {object} domainConfig
 * @param {string} targetLabel - "Calendar" or "Reminder list" for error messages
 * @returns {string|undefined} The resolved target (may be the injected default)
 */
export function resolveWriteTarget(target, domainConfig, targetLabel) {
  if (!domainConfig) return target;

  // If no target specified, inject default
  if (!target) {
    if (domainConfig.default) {
      return domainConfig.default;
    }
    // No target and no default — let the CLI handle it (it may have its own default)
    return undefined;
  }

  // Target specified — validate it
  if (!isVisible(target, domainConfig)) {
    const writable = getWritableNames(domainConfig);
    const hint = writable ? ` Writable: ${writable.join(", ")}.` : "";
    throw new Error(`${targetLabel} "${target}" is not available.${hint}`);
  }

  if (!isWritable(target, domainConfig)) {
    const writable = getWritableNames(domainConfig);
    const hint = writable ? ` Writable: ${writable.join(", ")}.` : "";
    throw new Error(`${targetLabel} "${target}" is read-only.${hint}`);
  }

  return target;
}

/**
 * Validate that a calendar/list is visible (for read actions where the agent specifies one).
 * Throws with a helpful error if not visible.
 *
 * @param {string} name
 * @param {object} domainConfig
 * @param {string} targetLabel
 */
export function validateVisible(name, domainConfig, targetLabel) {
  if (!domainConfig) return;
  if (!isVisible(name, domainConfig)) {
    const mode = domainConfig.mode || "open";
    if (mode === "allowlist") {
      const visible = [...(domainConfig.allow || []), ...(domainConfig.readOnly || [])];
      throw new Error(`${targetLabel} "${name}" is not available. Visible: ${visible.join(", ")}.`);
    }
    throw new Error(`${targetLabel} "${name}" is not available.`);
  }
}

// ---------------------------------------------------------------------------
// Result filtering
// ---------------------------------------------------------------------------

/**
 * Post-filter a CLI result object to only include items from visible calendars/lists.
 *
 * @param {object} result - Parsed CLI response
 * @param {object} domainConfig
 * @param {string} arrayKey - Key holding the array ("calendars", "events", "reminders", "lists")
 * @param {string} nameField - Field on each item holding the calendar/list name ("title", "calendar", "list")
 * @returns {object} Filtered result
 */
export function filterResults(result, domainConfig, arrayKey, nameField) {
  if (!domainConfig) return result;
  if (!result || !Array.isArray(result[arrayKey])) return result;

  const filtered = result[arrayKey].filter((item) => {
    const name = item[nameField];
    return name == null || isVisible(name, domainConfig);
  });

  const updated = { ...result, [arrayKey]: filtered };
  // Update count if present
  if ("count" in result) {
    updated.count = filtered.length;
  }
  return updated;
}
