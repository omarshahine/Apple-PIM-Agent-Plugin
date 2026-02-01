/**
 * Configuration module for apple-pim plugin
 * Loads user preferences from <plugin>/data/config.local.md
 */

import { readFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "..", "data", "config.local.md");

// Default config when no file exists or parsing fails
const DEFAULT_CONFIG = {
  calendars: { mode: "all", items: [] },
  reminders: { mode: "all", items: [] },
  contacts: { mode: "all", items: [] },
  default_calendar: null,
  default_reminder_list: null,
};

/**
 * Load and parse configuration from <plugin>/data/config.local.md
 * Returns default config if file doesn't exist or can't be parsed
 * Note: Config is loaded fresh on each call to pick up file changes without restart
 */
export async function loadConfig() {
  try {
    const content = await readFile(CONFIG_PATH, "utf-8");

    // Extract YAML frontmatter between --- markers
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return DEFAULT_CONFIG;
    }

    const parsed = yaml.load(frontmatterMatch[1]);
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_CONFIG;
    }

    // Normalize config structure
    return {
      calendars: normalizeFilterConfig(parsed.calendars),
      reminders: normalizeFilterConfig(parsed.reminders),
      contacts: normalizeFilterConfig(parsed.contacts),
      default_calendar: parsed.default_calendar || null,
      default_reminder_list: parsed.default_reminder_list || null,
    };
  } catch (error) {
    // File doesn't exist or can't be read - use defaults
    return DEFAULT_CONFIG;
  }
}

/**
 * Normalize a filter config section
 */
function normalizeFilterConfig(config) {
  if (!config || typeof config !== "object") {
    return { mode: "all", items: [] };
  }

  const mode = config.mode || "all";
  if (!["allowlist", "blocklist", "all"].includes(mode)) {
    return { mode: "all", items: [] };
  }

  const items = Array.isArray(config.items) ? config.items : [];

  return { mode, items };
}

/**
 * Check if a calendar is allowed based on config
 * @param {string} name - Calendar name
 * @param {string} id - Calendar ID (optional)
 * @returns {boolean}
 */
export async function isCalendarAllowed(name, id = null) {
  const config = await loadConfig();
  return isItemAllowed(config.calendars, name, id);
}

/**
 * Check if a reminder list is allowed based on config
 * @param {string} name - List name
 * @param {string} id - List ID (optional)
 * @returns {boolean}
 */
export async function isReminderListAllowed(name, id = null) {
  const config = await loadConfig();
  return isItemAllowed(config.reminders, name, id);
}

/**
 * Check if a contact group is allowed based on config
 * @param {string} name - Group name
 * @param {string} id - Group ID (optional)
 * @returns {boolean}
 */
export async function isContactGroupAllowed(name, id = null) {
  const config = await loadConfig();
  return isItemAllowed(config.contacts, name, id);
}

/**
 * Check if an item is allowed based on a filter config
 */
function isItemAllowed(filterConfig, name, id) {
  const { mode, items } = filterConfig;

  if (mode === "all") {
    return true;
  }

  // Check if name or id matches any item in the list
  const matches = items.some(
    (item) =>
      item.toLowerCase() === name?.toLowerCase() ||
      item.toLowerCase() === id?.toLowerCase()
  );

  if (mode === "allowlist") {
    return matches;
  }

  if (mode === "blocklist") {
    return !matches;
  }

  return true;
}

/**
 * Filter an array of calendars based on config
 * @param {Array} calendars - Array of calendar objects with name/id properties
 * @returns {Promise<Array>}
 */
export async function filterCalendars(calendars) {
  const config = await loadConfig();
  if (config.calendars.mode === "all") {
    return calendars;
  }

  return calendars.filter((cal) =>
    isItemAllowed(config.calendars, cal.name || cal.title, cal.id)
  );
}

/**
 * Filter an array of reminder lists based on config
 * @param {Array} lists - Array of list objects with name/id properties
 * @returns {Promise<Array>}
 */
export async function filterReminderLists(lists) {
  const config = await loadConfig();
  if (config.reminders.mode === "all") {
    return lists;
  }

  return lists.filter((list) =>
    isItemAllowed(config.reminders, list.name || list.title, list.id)
  );
}

/**
 * Filter an array of contact groups based on config
 * @param {Array} groups - Array of group objects with name/id properties
 * @returns {Promise<Array>}
 */
export async function filterContactGroups(groups) {
  const config = await loadConfig();
  if (config.contacts.mode === "all") {
    return groups;
  }

  return groups.filter((group) =>
    isItemAllowed(config.contacts, group.name || group.title, group.id)
  );
}

/**
 * Filter an array of events, keeping only those from allowed calendars
 * @param {Array} events - Array of event objects
 * @returns {Promise<Array>}
 */
export async function filterEvents(events) {
  const config = await loadConfig();
  if (config.calendars.mode === "all") {
    return events;
  }

  return events.filter((event) =>
    isItemAllowed(config.calendars, event.calendar, event.calendarId)
  );
}

/**
 * Filter an array of reminders, keeping only those from allowed lists
 * @param {Array} reminders - Array of reminder objects
 * @returns {Promise<Array>}
 */
export async function filterReminders(reminders) {
  const config = await loadConfig();
  if (config.reminders.mode === "all") {
    return reminders;
  }

  return reminders.filter((reminder) =>
    isItemAllowed(config.reminders, reminder.list, reminder.listId)
  );
}

/**
 * Get the default calendar name
 * @returns {Promise<string|null>}
 */
export async function getDefaultCalendar() {
  const config = await loadConfig();
  return config.default_calendar;
}

/**
 * Get the default reminder list name
 * @returns {Promise<string|null>}
 */
export async function getDefaultReminderList() {
  const config = await loadConfig();
  return config.default_reminder_list;
}

/**
 * Validate that a calendar is allowed for write operations
 * Throws an error with helpful message if blocked
 * @param {string} name - Calendar name
 */
export async function validateCalendarForWrite(name) {
  if (!name) return; // Let CLI use default

  const allowed = await isCalendarAllowed(name);
  if (!allowed) {
    throw new Error(
      `Calendar '${name}' is not in your allowed list.\n` +
        `Run /apple-pim:configure to add it, then restart Claude Code.`
    );
  }
}

/**
 * Validate that a reminder list is allowed for write operations
 * Throws an error with helpful message if blocked
 * @param {string} name - List name
 */
export async function validateReminderListForWrite(name) {
  if (!name) return; // Let CLI use default

  const allowed = await isReminderListAllowed(name);
  if (!allowed) {
    throw new Error(
      `Reminder list '${name}' is not in your allowed list.\n` +
        `Run /apple-pim:configure to add it, then restart Claude Code.`
    );
  }
}

/**
 * Get the config file path
 * @returns {string}
 */
export function getConfigPath() {
  return CONFIG_PATH;
}

/**
 * Clear the cached config (no-op, kept for backwards compatibility)
 * Config is now loaded fresh on each call
 */
export function clearConfigCache() {
  // No-op - config is now loaded fresh on each call
}
