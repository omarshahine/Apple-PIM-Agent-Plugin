#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { homedir } from "os";
import {
  loadConfig,
  isDomainEnabled,
  filterCalendars,
  filterReminderLists,
  filterEvents,
  filterReminders,
  isCalendarAllowed,
  isReminderListAllowed,
  validateCalendarForWrite,
  validateReminderListForWrite,
  getDefaultCalendar,
  getDefaultReminderList,
} from "./config.js";
import {
  markToolResult,
  getDatamarkingPreamble,
} from "./sanitize.js";
import {
  applyDefaultCalendar,
  applyDefaultReminderList,
  buildCalendarDeleteArgs,
} from "./tool-args.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Find Swift CLIs - check multiple locations in order of preference
function findSwiftBinDir() {
  const locations = [
    // 1. Relative to bundled server (plugin cache)
    join(__dirname, "..", "swift", ".build", "release"),
    // 2. Plugin root swift folder (if not in dist/)
    join(__dirname, "..", "..", "swift", ".build", "release"),
    // 3. Source repo (fallback for development)
    join(homedir(), "GitHub", "Apple-PIM-Agent-Plugin", "swift", ".build", "release"),
  ];

  for (const loc of locations) {
    if (existsSync(join(loc, "reminder-cli"))) {
      return loc;
    }
  }

  // Return first location as default (will fail with helpful error)
  return locations[0];
}

const SWIFT_BIN_DIR = findSwiftBinDir();

// Helper to calculate relative date string from days offset
function relativeDateString(daysOffset) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return date.toISOString().split("T")[0]; // YYYY-MM-DD format
}

// Helper to run CLI commands
async function runCLI(cli, args) {
  return new Promise((resolve, reject) => {
    const cliPath = join(SWIFT_BIN_DIR, cli);
    const proc = spawn(cliPath, args);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({ success: true, output: stdout });
        }
      } else {
        reject(new Error(stderr || `CLI exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to run CLI: ${err.message}`));
    });
  });
}

// Tool definitions
const tools = [
  // Calendar tools
  {
    name: "calendar_list",
    description: "List all calendars",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "calendar_events",
    description: "List calendar events within a date range",
    inputSchema: {
      type: "object",
      properties: {
        calendar: {
          type: "string",
          description: "Calendar name or ID to filter by (optional)",
        },
        from: {
          type: "string",
          description:
            "Start date (default: today). Accepts ISO dates or natural language like 'today', 'tomorrow'",
        },
        to: {
          type: "string",
          description: "End date (default: 7 days from start)",
        },
        lastDays: {
          type: "number",
          description:
            "Include events from N days ago (alternative to 'from'). E.g., 7 means include events from 7 days ago",
        },
        nextDays: {
          type: "number",
          description:
            "Include events up to N days in the future (alternative to 'to'). E.g., 14 means include events up to 14 days from now",
        },
        limit: {
          type: "number",
          description: "Maximum number of events (default: 100)",
        },
      },
    },
  },
  {
    name: "calendar_get",
    description: "Get a single calendar event by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Event ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "calendar_search",
    description: "Search calendar events by title, notes, or location",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        calendar: {
          type: "string",
          description: "Calendar to search in (optional)",
        },
        from: {
          type: "string",
          description: "Start date for search range (default: 30 days ago)",
        },
        to: {
          type: "string",
          description: "End date for search range (default: 1 year from now)",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 50)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "calendar_create",
    description: "Create a new calendar event",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Event title",
        },
        start: {
          type: "string",
          description: "Start date/time",
        },
        end: {
          type: "string",
          description: "End date/time (default: 1 hour after start)",
        },
        duration: {
          type: "number",
          description: "Duration in minutes (alternative to end)",
        },
        calendar: {
          type: "string",
          description: "Calendar name or ID (default: default calendar)",
        },
        location: {
          type: "string",
          description: "Event location",
        },
        notes: {
          type: "string",
          description: "Event notes",
        },
        allDay: {
          type: "boolean",
          description: "All-day event",
        },
        alarm: {
          type: "array",
          items: { type: "number" },
          description: "Alarm minutes before event",
        },
        url: {
          type: "string",
          description: "URL associated with the event",
        },
        recurrence: {
          type: "object",
          description: "Recurrence rule for repeating events",
          properties: {
            frequency: {
              type: "string",
              enum: ["daily", "weekly", "monthly", "yearly"],
              description: "How often the event repeats",
            },
            interval: {
              type: "number",
              description: "Repeat every N periods (default: 1)",
            },
            endDate: {
              type: "string",
              description: "Stop repeating after this date (ISO format)",
            },
            occurrenceCount: {
              type: "number",
              description: "Stop after N occurrences",
            },
            daysOfTheWeek: {
              type: "array",
              items: { type: "string" },
              description:
                "Days of the week for weekly recurrence (e.g., ['monday', 'wednesday', 'friday'])",
            },
            daysOfTheMonth: {
              type: "array",
              items: { type: "number" },
              description:
                "Days of the month for monthly recurrence (e.g., [1, 15])",
            },
          },
          required: ["frequency"],
        },
      },
      required: ["title", "start"],
    },
  },
  {
    name: "calendar_update",
    description:
      "Update an existing calendar event. For recurring events, use futureEvents to apply changes to all future occurrences. To remove recurrence and make it a single event, set recurrence.frequency to 'none'.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Event ID to update",
        },
        title: {
          type: "string",
          description: "New title",
        },
        start: {
          type: "string",
          description: "New start date/time",
        },
        end: {
          type: "string",
          description: "New end date/time",
        },
        location: {
          type: "string",
          description: "New location",
        },
        notes: {
          type: "string",
          description: "New notes",
        },
        url: {
          type: "string",
          description: "New URL",
        },
        recurrence: {
          type: "object",
          description:
            "New recurrence rule (replaces existing). Set frequency to 'none' to remove recurrence entirely.",
          properties: {
            frequency: {
              type: "string",
              enum: ["daily", "weekly", "monthly", "yearly", "none"],
              description:
                "How often the event repeats. Use 'none' to remove recurrence.",
            },
            interval: {
              type: "number",
              description: "Repeat every N periods (default: 1)",
            },
            endDate: {
              type: "string",
              description: "Stop repeating after this date (ISO format)",
            },
            occurrenceCount: {
              type: "number",
              description: "Stop after N occurrences",
            },
            daysOfTheWeek: {
              type: "array",
              items: { type: "string" },
              description:
                "Days of the week for weekly recurrence (e.g., ['monday', 'wednesday', 'friday'])",
            },
            daysOfTheMonth: {
              type: "array",
              items: { type: "number" },
              description:
                "Days of the month for monthly recurrence (e.g., [1, 15])",
            },
          },
          required: ["frequency"],
        },
        futureEvents: {
          type: "boolean",
          description:
            "Apply changes to all future events in a recurring series. Default: false (only updates this occurrence).",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "calendar_delete",
    description:
      "Delete a calendar event. Safe for recurring events — by default, only the single occurrence identified by the event ID is removed; the rest of the series is untouched. To delete this and all future occurrences, set futureEvents to true.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Event ID to delete",
        },
        futureEvents: {
          type: "boolean",
          description:
            "Delete this and all future occurrences of a recurring event. Default: false (only deletes the single occurrence).",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "calendar_batch_create",
    description:
      "Create multiple calendar events in a single transaction for better performance",
    inputSchema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          description: "Array of events to create",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Event title" },
              start: { type: "string", description: "Start date/time" },
              end: {
                type: "string",
                description: "End date/time (default: 1 hour after start)",
              },
              duration: {
                type: "number",
                description: "Duration in minutes (alternative to end)",
              },
              calendar: {
                type: "string",
                description: "Calendar name or ID",
              },
              location: { type: "string", description: "Event location" },
              notes: { type: "string", description: "Event notes" },
              url: { type: "string", description: "URL associated with event" },
              allDay: { type: "boolean", description: "All-day event" },
              alarm: {
                type: "array",
                items: { type: "number" },
                description: "Alarm minutes before event",
              },
              recurrence: {
                type: "object",
                properties: {
                  frequency: {
                    type: "string",
                    enum: ["daily", "weekly", "monthly", "yearly"],
                  },
                  interval: { type: "number" },
                  endDate: { type: "string" },
                  occurrenceCount: { type: "number" },
                  daysOfTheWeek: { type: "array", items: { type: "string" } },
                  daysOfTheMonth: { type: "array", items: { type: "number" } },
                },
                required: ["frequency"],
              },
            },
            required: ["title", "start"],
          },
        },
      },
      required: ["events"],
    },
  },

  // Reminder tools
  {
    name: "reminder_lists",
    description: "List all reminder lists",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "reminder_items",
    description:
      "List reminders from a list, with optional date-based filtering (overdue, today, tomorrow, week, upcoming)",
    inputSchema: {
      type: "object",
      properties: {
        list: {
          type: "string",
          description: "Reminder list name or ID (optional)",
        },
        filter: {
          type: "string",
          enum: ["overdue", "today", "tomorrow", "week", "upcoming", "completed", "all"],
          description:
            "Filter reminders by time: 'overdue' (past due), 'today' (due today + overdue), 'tomorrow' (due tomorrow), 'week' (due this calendar week), 'upcoming' (all with due dates), 'completed' (finished), 'all' (everything). Default: incomplete reminders.",
        },
        completed: {
          type: "boolean",
          description: "Include completed reminders (default: false). Overridden by filter if set.",
        },
        lastDays: {
          type: "number",
          description:
            "Include reminders due from N days ago (for HyperContext compatibility). Note: Currently reminders are not filtered by date in the CLI",
        },
        nextDays: {
          type: "number",
          description:
            "Include reminders due up to N days in the future (for HyperContext compatibility). Note: Currently reminders are not filtered by date in the CLI",
        },
        limit: {
          type: "number",
          description: "Maximum number of reminders (default: 100)",
        },
      },
    },
  },
  {
    name: "reminder_get",
    description: "Get a single reminder by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Reminder ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "reminder_search",
    description: "Search reminders by title or notes",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        list: {
          type: "string",
          description: "Reminder list to search in (optional)",
        },
        completed: {
          type: "boolean",
          description: "Include completed reminders (default: false)",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 50)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "reminder_create",
    description: "Create a new reminder",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Reminder title",
        },
        list: {
          type: "string",
          description: "Reminder list name or ID (default: default list)",
        },
        due: {
          type: "string",
          description: "Due date/time",
        },
        notes: {
          type: "string",
          description: "Notes",
        },
        priority: {
          type: "number",
          description: "Priority (0=none, 1=high, 5=medium, 9=low)",
        },
        url: {
          type: "string",
          description: "URL associated with the reminder",
        },
        alarm: {
          type: "array",
          items: { type: "number" },
          description: "Alarm minutes before due",
        },
        location: {
          type: "object",
          description:
            "Location-based alarm that triggers when arriving at or departing from a place",
          properties: {
            name: {
              type: "string",
              description: "Name of the location (e.g., 'Home', 'Office')",
            },
            latitude: {
              type: "number",
              description: "Latitude of the location",
            },
            longitude: {
              type: "number",
              description: "Longitude of the location",
            },
            radius: {
              type: "number",
              description:
                "Geofence radius in meters (default: 100)",
            },
            proximity: {
              type: "string",
              enum: ["arrive", "depart"],
              description:
                "Trigger when arriving at or departing from the location",
            },
          },
          required: ["latitude", "longitude", "proximity"],
        },
        recurrence: {
          type: "object",
          description: "Recurrence rule for repeating reminders",
          properties: {
            frequency: {
              type: "string",
              enum: ["daily", "weekly", "monthly", "yearly"],
              description: "How often the reminder repeats",
            },
            interval: {
              type: "number",
              description: "Repeat every N periods (default: 1)",
            },
            endDate: {
              type: "string",
              description: "Stop repeating after this date (ISO format)",
            },
            occurrenceCount: {
              type: "number",
              description: "Stop after N occurrences",
            },
            daysOfTheWeek: {
              type: "array",
              items: { type: "string" },
              description:
                "Days of the week for weekly recurrence (e.g., ['monday', 'wednesday', 'friday'])",
            },
            daysOfTheMonth: {
              type: "array",
              items: { type: "number" },
              description:
                "Days of the month for monthly recurrence (e.g., [1, 15])",
            },
          },
          required: ["frequency"],
        },
      },
      required: ["title"],
    },
  },
  {
    name: "reminder_complete",
    description: "Mark a reminder as complete or incomplete",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Reminder ID",
        },
        undo: {
          type: "boolean",
          description: "Mark as incomplete instead (default: false)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "reminder_update",
    description:
      "Update an existing reminder. To remove recurrence, set recurrence.frequency to 'none'.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Reminder ID to update",
        },
        title: {
          type: "string",
          description: "New title",
        },
        due: {
          type: "string",
          description: "New due date/time",
        },
        notes: {
          type: "string",
          description: "New notes",
        },
        priority: {
          type: "number",
          description: "New priority",
        },
        url: {
          type: "string",
          description:
            "New URL (pass empty string to remove existing URL)",
        },
        location: {
          description:
            "Location-based alarm (replaces existing location alarm). Pass empty object to remove.",
          oneOf: [
            {
              type: "object",
              properties: {},
              additionalProperties: false,
              description: "Empty object to remove location alarm",
            },
            {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Name of the location (e.g., 'Home', 'Office')",
                },
                latitude: {
                  type: "number",
                  description: "Latitude of the location",
                },
                longitude: {
                  type: "number",
                  description: "Longitude of the location",
                },
                radius: {
                  type: "number",
                  description:
                    "Geofence radius in meters (default: 100)",
                },
                proximity: {
                  type: "string",
                  enum: ["arrive", "depart"],
                  description:
                    "Trigger when arriving at or departing from the location",
                },
              },
              required: ["latitude", "longitude", "proximity"],
              description: "Complete location object with required fields",
            },
          ],
        },
        recurrence: {
          type: "object",
          description:
            "New recurrence rule (replaces existing). Set frequency to 'none' to remove recurrence entirely.",
          properties: {
            frequency: {
              type: "string",
              enum: ["daily", "weekly", "monthly", "yearly", "none"],
              description:
                "How often the reminder repeats. Use 'none' to remove recurrence.",
            },
            interval: {
              type: "number",
              description: "Repeat every N periods (default: 1)",
            },
            endDate: {
              type: "string",
              description: "Stop repeating after this date (ISO format)",
            },
            occurrenceCount: {
              type: "number",
              description: "Stop after N occurrences",
            },
            daysOfTheWeek: {
              type: "array",
              items: { type: "string" },
              description:
                "Days of the week for weekly recurrence (e.g., ['monday', 'wednesday', 'friday'])",
            },
            daysOfTheMonth: {
              type: "array",
              items: { type: "number" },
              description:
                "Days of the month for monthly recurrence (e.g., [1, 15])",
            },
          },
          required: ["frequency"],
        },
      },
      required: ["id"],
    },
  },
  {
    name: "reminder_delete",
    description: "Delete a reminder",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Reminder ID to delete",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "reminder_batch_create",
    description:
      "Create multiple reminders in a single transaction for better performance",
    inputSchema: {
      type: "object",
      properties: {
        reminders: {
          type: "array",
          description: "Array of reminders to create",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "Reminder title" },
              list: { type: "string", description: "Reminder list name or ID" },
              due: { type: "string", description: "Due date/time" },
              notes: { type: "string", description: "Notes" },
              priority: {
                type: "number",
                description: "Priority (0=none, 1=high, 5=medium, 9=low)",
              },
              url: {
                type: "string",
                description: "URL associated with reminder",
              },
              alarm: {
                type: "array",
                items: { type: "number" },
                description: "Alarm minutes before due",
              },
              location: {
                type: "object",
                description:
                  "Location-based alarm (arrive/depart)",
                properties: {
                  name: { type: "string", description: "Location name" },
                  latitude: { type: "number", description: "Latitude" },
                  longitude: { type: "number", description: "Longitude" },
                  radius: {
                    type: "number",
                    description: "Geofence radius in meters (default: 100)",
                  },
                  proximity: {
                    type: "string",
                    enum: ["arrive", "depart"],
                    description: "Trigger on arrive or depart",
                  },
                },
                required: ["latitude", "longitude", "proximity"],
              },
              recurrence: {
                type: "object",
                properties: {
                  frequency: {
                    type: "string",
                    enum: ["daily", "weekly", "monthly", "yearly"],
                  },
                  interval: { type: "number" },
                  endDate: { type: "string" },
                  occurrenceCount: { type: "number" },
                  daysOfTheWeek: { type: "array", items: { type: "string" } },
                  daysOfTheMonth: { type: "array", items: { type: "number" } },
                },
                required: ["frequency"],
              },
            },
            required: ["title"],
          },
        },
      },
      required: ["reminders"],
    },
  },

  // Mail tools
  {
    name: "mail_accounts",
    description:
      "List all mail accounts configured in Mail.app. Requires Mail.app to be running.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "mail_mailboxes",
    description:
      "List mailboxes with unread and total message counts. Requires Mail.app to be running.",
    inputSchema: {
      type: "object",
      properties: {
        account: {
          type: "string",
          description: "Filter by account name (optional)",
        },
      },
    },
  },
  {
    name: "mail_messages",
    description:
      "List messages in a mailbox with optional filters. Requires Mail.app to be running.",
    inputSchema: {
      type: "object",
      properties: {
        mailbox: {
          type: "string",
          description: "Mailbox name (default: INBOX)",
        },
        account: {
          type: "string",
          description: "Account name (searches all accounts if omitted)",
        },
        limit: {
          type: "number",
          description: "Maximum messages to return (default: 25)",
        },
        filter: {
          type: "string",
          enum: ["unread", "flagged", "all"],
          description: "Filter messages: unread, flagged, or all (default: all)",
        },
      },
    },
  },
  {
    name: "mail_get",
    description:
      "Get a single message by RFC 2822 message ID, including full body content. Requires Mail.app to be running.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "RFC 2822 message ID",
        },
        mailbox: {
          type: "string",
          description:
            "Mailbox name hint to speed up lookup (from prior list/search results)",
        },
        account: {
          type: "string",
          description:
            "Account name hint to speed up lookup (from prior list/search results)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "mail_search",
    description:
      "Search messages by subject, sender, or content. Requires Mail.app to be running.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        field: {
          type: "string",
          enum: ["subject", "sender", "content", "all"],
          description:
            "Search field: subject, sender, content (message body), or all (default: all). Note: content search is slower as it fetches each message body.",
        },
        mailbox: {
          type: "string",
          description: "Mailbox name to search in (searches all if omitted)",
        },
        account: {
          type: "string",
          description: "Account name",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 25)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "mail_update",
    description:
      "Update message flags: read/unread, flagged/unflagged, junk. Requires Mail.app to be running.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "RFC 2822 message ID",
        },
        read: {
          type: "boolean",
          description: "Set read status",
        },
        flagged: {
          type: "boolean",
          description: "Set flagged status",
        },
        junk: {
          type: "boolean",
          description: "Set junk status",
        },
        mailbox: {
          type: "string",
          description:
            "Mailbox name hint to speed up lookup (from prior list/search results)",
        },
        account: {
          type: "string",
          description:
            "Account name hint to speed up lookup (from prior list/search results)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "mail_move",
    description:
      "Move a message to a different mailbox. Requires Mail.app to be running.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "RFC 2822 message ID",
        },
        toMailbox: {
          type: "string",
          description: "Destination mailbox name",
        },
        toAccount: {
          type: "string",
          description:
            "Destination account name (uses same account if omitted)",
        },
        mailbox: {
          type: "string",
          description:
            "Source mailbox name hint to speed up lookup (from prior list/search results)",
        },
        account: {
          type: "string",
          description:
            "Source account name hint to speed up lookup (from prior list/search results)",
        },
      },
      required: ["id", "toMailbox"],
    },
  },
  {
    name: "mail_delete",
    description:
      "Delete a message (moves to Trash). Requires Mail.app to be running.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "RFC 2822 message ID",
        },
        mailbox: {
          type: "string",
          description:
            "Mailbox name hint to speed up lookup (from prior list/search results)",
        },
        account: {
          type: "string",
          description:
            "Account name hint to speed up lookup (from prior list/search results)",
        },
      },
      required: ["id"],
    },
  },

  // Contact tools
  {
    name: "contact_groups",
    description: "List all contact groups",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "contact_list",
    description: "List contacts",
    inputSchema: {
      type: "object",
      properties: {
        group: {
          type: "string",
          description: "Group name or ID to filter by (optional)",
        },
        limit: {
          type: "number",
          description: "Maximum number of contacts (default: 100)",
        },
      },
    },
  },
  {
    name: "contact_search",
    description: "Search contacts by name, email, or phone",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 50)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "contact_get",
    description:
      "Get full details for a contact, including base64-encoded photo if available",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Contact ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "contact_create",
    description: "Create a new contact with full support for all Contacts framework fields",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Full name (parsed into first/last)",
        },
        firstName: {
          type: "string",
          description: "First name (alternative to name)",
        },
        lastName: {
          type: "string",
          description: "Last name (alternative to name)",
        },
        middleName: {
          type: "string",
          description: "Middle name",
        },
        namePrefix: {
          type: "string",
          description: "Name prefix (e.g. Dr., Mr., Ms.)",
        },
        nameSuffix: {
          type: "string",
          description: "Name suffix (e.g. Jr., III, PhD)",
        },
        nickname: {
          type: "string",
          description: "Nickname",
        },
        previousFamilyName: {
          type: "string",
          description: "Previous family name (maiden name)",
        },
        phoneticGivenName: {
          type: "string",
          description: "Phonetic first name (for pronunciation)",
        },
        phoneticMiddleName: {
          type: "string",
          description: "Phonetic middle name",
        },
        phoneticFamilyName: {
          type: "string",
          description: "Phonetic last name",
        },
        phoneticOrganizationName: {
          type: "string",
          description: "Phonetic organization name",
        },
        organization: {
          type: "string",
          description: "Organization/company name",
        },
        jobTitle: {
          type: "string",
          description: "Job title",
        },
        department: {
          type: "string",
          description: "Department name",
        },
        contactType: {
          type: "string",
          enum: ["person", "organization"],
          description: "Contact type: person or organization",
        },
        email: {
          type: "string",
          description: "Simple email address (uses 'work' label)",
        },
        phone: {
          type: "string",
          description: "Simple phone number (uses 'main' label)",
        },
        emails: {
          type: "array",
          description: "Labeled email addresses",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label: home, work, school, icloud, other" },
              value: { type: "string", description: "Email address" },
            },
            required: ["value"],
          },
        },
        phones: {
          type: "array",
          description: "Labeled phone numbers",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label: mobile, main, home, work, iphone, home fax, work fax, pager, other" },
              value: { type: "string", description: "Phone number" },
            },
            required: ["value"],
          },
        },
        addresses: {
          type: "array",
          description: "Postal addresses",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label: home, work, school, other" },
              street: { type: "string" },
              city: { type: "string" },
              state: { type: "string" },
              postalCode: { type: "string" },
              country: { type: "string" },
              isoCountryCode: { type: "string", description: "ISO country code (e.g. US)" },
              subLocality: { type: "string", description: "Neighborhood or village" },
              subAdministrativeArea: { type: "string", description: "County" },
            },
          },
        },
        urls: {
          type: "array",
          description: "URL addresses",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label: homepage, home, work, school, other" },
              value: { type: "string", description: "URL" },
            },
            required: ["value"],
          },
        },
        socialProfiles: {
          type: "array",
          description: "Social media profiles",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label (e.g. home, work, other)" },
              service: { type: "string", description: "Service name (e.g. Twitter, LinkedIn, Facebook)" },
              username: { type: "string" },
              url: { type: "string", description: "Profile URL" },
              userIdentifier: { type: "string" },
            },
          },
        },
        instantMessages: {
          type: "array",
          description: "Instant message addresses",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label (e.g. home, work, other)" },
              service: { type: "string", description: "Service name (e.g. Skype, Jabber, GoogleTalk)" },
              username: { type: "string" },
            },
          },
        },
        relations: {
          type: "array",
          description: "Related people",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Relationship: spouse, child, parent, sibling, friend, partner, assistant, manager, etc." },
              name: { type: "string", description: "Related person's name" },
            },
            required: ["name"],
          },
        },
        birthday: {
          type: "string",
          description: "Birthday in YYYY-MM-DD format (with year) or MM-DD format (without year)",
        },
        dates: {
          type: "array",
          description: "Important dates (e.g. anniversaries)",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label: anniversary, other" },
              year: { type: "number" },
              month: { type: "number" },
              day: { type: "number" },
            },
            required: ["month", "day"],
          },
        },
        notes: {
          type: "string",
          description: "Notes",
        },
      },
    },
  },
  {
    name: "contact_update",
    description: "Update an existing contact. Simple fields replace values. Array fields (emails, phones, addresses, etc.) replace ALL entries when provided — read the contact first to preserve existing entries.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Contact ID to update",
        },
        firstName: {
          type: "string",
          description: "New first name",
        },
        lastName: {
          type: "string",
          description: "New last name",
        },
        middleName: {
          type: "string",
          description: "New middle name",
        },
        namePrefix: {
          type: "string",
          description: "New name prefix (e.g. Dr., Mr.)",
        },
        nameSuffix: {
          type: "string",
          description: "New name suffix (e.g. Jr., III)",
        },
        nickname: {
          type: "string",
          description: "New nickname",
        },
        previousFamilyName: {
          type: "string",
          description: "New previous family name (maiden name)",
        },
        phoneticGivenName: {
          type: "string",
          description: "New phonetic first name",
        },
        phoneticMiddleName: {
          type: "string",
          description: "New phonetic middle name",
        },
        phoneticFamilyName: {
          type: "string",
          description: "New phonetic last name",
        },
        phoneticOrganizationName: {
          type: "string",
          description: "New phonetic organization name",
        },
        organization: {
          type: "string",
          description: "New organization",
        },
        jobTitle: {
          type: "string",
          description: "New job title",
        },
        department: {
          type: "string",
          description: "New department name",
        },
        contactType: {
          type: "string",
          enum: ["person", "organization"],
          description: "Contact type: person or organization",
        },
        email: {
          type: "string",
          description: "New email (replaces primary only, keeps others)",
        },
        phone: {
          type: "string",
          description: "New phone (replaces primary only, keeps others)",
        },
        emails: {
          type: "array",
          description: "Replace ALL emails with these labeled entries",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label: home, work, school, icloud, other" },
              value: { type: "string", description: "Email address" },
            },
            required: ["value"],
          },
        },
        phones: {
          type: "array",
          description: "Replace ALL phones with these labeled entries",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label: mobile, main, home, work, iphone, other" },
              value: { type: "string", description: "Phone number" },
            },
            required: ["value"],
          },
        },
        addresses: {
          type: "array",
          description: "Replace ALL postal addresses",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label: home, work, school, other" },
              street: { type: "string" },
              city: { type: "string" },
              state: { type: "string" },
              postalCode: { type: "string" },
              country: { type: "string" },
              isoCountryCode: { type: "string", description: "ISO country code (e.g. US)" },
              subLocality: { type: "string", description: "Neighborhood or village" },
              subAdministrativeArea: { type: "string", description: "County" },
            },
          },
        },
        urls: {
          type: "array",
          description: "Replace ALL URLs",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label: homepage, home, work, school, other" },
              value: { type: "string", description: "URL" },
            },
            required: ["value"],
          },
        },
        socialProfiles: {
          type: "array",
          description: "Replace ALL social profiles",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label (e.g. home, work, other)" },
              service: { type: "string", description: "Service name (e.g. Twitter, LinkedIn, Facebook)" },
              username: { type: "string" },
              url: { type: "string", description: "Profile URL" },
              userIdentifier: { type: "string" },
            },
          },
        },
        instantMessages: {
          type: "array",
          description: "Replace ALL instant messages",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label (e.g. home, work, other)" },
              service: { type: "string", description: "Service name (e.g. Skype, Jabber, GoogleTalk)" },
              username: { type: "string" },
            },
          },
        },
        relations: {
          type: "array",
          description: "Replace ALL relations",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Relationship: spouse, child, parent, sibling, friend, partner, assistant, manager, etc." },
              name: { type: "string", description: "Related person's name" },
            },
            required: ["name"],
          },
        },
        birthday: {
          type: "string",
          description: "New birthday in YYYY-MM-DD format (with year) or MM-DD format (without year)",
        },
        dates: {
          type: "array",
          description: "Replace ALL dates (e.g. anniversaries)",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Label: anniversary, other" },
              year: { type: "number" },
              month: { type: "number" },
              day: { type: "number" },
            },
            required: ["month", "day"],
          },
        },
        notes: {
          type: "string",
          description: "New notes",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "contact_delete",
    description: "Delete a contact",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Contact ID to delete",
        },
      },
      required: ["id"],
    },
  },

  // PIM authorization tools
  {
    name: "pim_status",
    description:
      "Check macOS authorization status for all PIM domains (calendars, reminders, contacts, mail). Does not trigger any permission prompts. Returns current authorization state for each domain.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "pim_authorize",
    description:
      "Request macOS permission for PIM domains. Triggers the system permission dialog for domains that have not yet been requested. For domains already denied, provides guidance to enable access in System Settings.",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          enum: ["calendars", "reminders", "contacts", "mail"],
          description:
            "Specific domain to authorize. If omitted, requests access for all enabled domains.",
        },
      },
    },
  },

  // Batch reminder operations
  {
    name: "reminder_batch_complete",
    description:
      "Mark multiple reminders as complete (or incomplete) in one operation. More efficient than calling reminder_complete multiple times.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Array of reminder IDs to complete",
        },
        undo: {
          type: "boolean",
          description:
            "Mark as incomplete instead of complete (default: false)",
        },
      },
      required: ["ids"],
    },
  },
  {
    name: "reminder_batch_delete",
    description:
      "Delete multiple reminders in one operation. More efficient than calling reminder_delete multiple times.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Array of reminder IDs to delete",
        },
      },
      required: ["ids"],
    },
  },

  // Batch mail operations
  {
    name: "mail_batch_update",
    description:
      "Update flags on multiple messages in one operation. Requires Mail.app to be running.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Array of RFC 2822 message IDs",
        },
        read: {
          type: "boolean",
          description: "Set read status for all messages",
        },
        flagged: {
          type: "boolean",
          description: "Set flagged status for all messages",
        },
        junk: {
          type: "boolean",
          description: "Set junk status for all messages",
        },
        mailbox: {
          type: "string",
          description: "Mailbox name hint for faster lookup",
        },
        account: {
          type: "string",
          description: "Account name hint for faster lookup",
        },
      },
      required: ["ids"],
    },
  },
  {
    name: "mail_batch_delete",
    description:
      "Delete multiple messages in one operation (moves to Trash). Requires Mail.app to be running.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Array of RFC 2822 message IDs",
        },
        mailbox: {
          type: "string",
          description: "Mailbox name hint for faster lookup",
        },
        account: {
          type: "string",
          description: "Account name hint for faster lookup",
        },
      },
      required: ["ids"],
    },
  },
];

// Tool handlers
async function handleTool(name, args) {
  const cliArgs = [];

  switch (name) {
    // Calendar tools
    case "calendar_list": {
      const result = await runCLI("calendar-cli", ["list"]);
      // Filter calendars based on config
      if (result.calendars) {
        result.calendars = await filterCalendars(result.calendars);
      }
      return result;
    }

    case "calendar_events": {
      // Validate calendar filter if specified
      if (args.calendar) {
        const allowed = await isCalendarAllowed(args.calendar);
        if (!allowed) {
          throw new Error(
            `Calendar '${args.calendar}' is not in your allowed list.\n` +
              `Run /apple-pim:configure to add it.`
          );
        }
      }

      cliArgs.push("events");
      if (args.calendar) cliArgs.push("--calendar", args.calendar);
      // Support both from/to and lastDays/nextDays
      if (args.lastDays !== undefined) {
        cliArgs.push("--from", relativeDateString(-args.lastDays));
      } else if (args.from) {
        cliArgs.push("--from", args.from);
      }
      if (args.nextDays !== undefined) {
        cliArgs.push("--to", relativeDateString(args.nextDays));
      } else if (args.to) {
        cliArgs.push("--to", args.to);
      }
      if (args.limit) cliArgs.push("--limit", String(args.limit));

      const result = await runCLI("calendar-cli", cliArgs);
      // Filter events based on config (in case no specific calendar was requested)
      if (result.events) {
        result.events = await filterEvents(result.events);
      }
      return result;
    }

    case "calendar_get": {
      const result = await runCLI("calendar-cli", ["get", "--id", args.id]);
      // Check if event's calendar is allowed
      if (result.calendar) {
        const allowed = await isCalendarAllowed(result.calendar);
        if (!allowed) {
          throw new Error(
            `This event belongs to calendar '${result.calendar}' which is not in your allowed list.\n` +
              `Run /apple-pim:configure to add it.`
          );
        }
      }
      return result;
    }

    case "calendar_search": {
      // Validate calendar filter if specified
      if (args.calendar) {
        const allowed = await isCalendarAllowed(args.calendar);
        if (!allowed) {
          throw new Error(
            `Calendar '${args.calendar}' is not in your allowed list.\n` +
              `Run /apple-pim:configure to add it.`
          );
        }
      }

      cliArgs.push("search", args.query);
      if (args.calendar) cliArgs.push("--calendar", args.calendar);
      if (args.from) cliArgs.push("--from", args.from);
      if (args.to) cliArgs.push("--to", args.to);
      if (args.limit) cliArgs.push("--limit", String(args.limit));

      const result = await runCLI("calendar-cli", cliArgs);
      // Filter results based on config
      if (result.events) {
        result.events = await filterEvents(result.events);
      }
      return result;
    }

    case "calendar_create": {
      // Validate target calendar
      await validateCalendarForWrite(args.calendar);

      // Use default calendar from config if not specified
      let targetCalendar = args.calendar;
      if (!targetCalendar) {
        targetCalendar = await getDefaultCalendar();
      }

      cliArgs.push("create", "--title", args.title, "--start", args.start);
      if (args.end) cliArgs.push("--end", args.end);
      if (args.duration) cliArgs.push("--duration", String(args.duration));
      if (targetCalendar) cliArgs.push("--calendar", targetCalendar);
      if (args.location) cliArgs.push("--location", args.location);
      if (args.notes) cliArgs.push("--notes", args.notes);
      if (args.url) cliArgs.push("--url", args.url);
      if (args.allDay) cliArgs.push("--all-day");
      if (args.alarm) {
        for (const minutes of args.alarm) {
          cliArgs.push("--alarm", String(minutes));
        }
      }
      if (args.recurrence) {
        cliArgs.push("--recurrence", JSON.stringify(args.recurrence));
      }
      return await runCLI("calendar-cli", cliArgs);
    }

    case "calendar_update": {
      // First get the event to check its calendar
      const event = await runCLI("calendar-cli", ["get", "--id", args.id]);
      if (event.calendar) {
        const allowed = await isCalendarAllowed(event.calendar);
        if (!allowed) {
          throw new Error(
            `This event belongs to calendar '${event.calendar}' which is not in your allowed list.\n` +
              `Run /apple-pim:configure to add it.`
          );
        }
      }

      cliArgs.push("update", "--id", args.id);
      if (args.title) cliArgs.push("--title", args.title);
      if (args.start) cliArgs.push("--start", args.start);
      if (args.end) cliArgs.push("--end", args.end);
      if (args.location) cliArgs.push("--location", args.location);
      if (args.notes) cliArgs.push("--notes", args.notes);
      if (args.url) cliArgs.push("--url", args.url);
      if (args.recurrence) {
        cliArgs.push("--recurrence", JSON.stringify(args.recurrence));
      }
      if (args.futureEvents) cliArgs.push("--future-events");
      return await runCLI("calendar-cli", cliArgs);
    }

    case "calendar_delete": {
      // First get the event to check its calendar
      const event = await runCLI("calendar-cli", ["get", "--id", args.id]);
      if (event.calendar) {
        const allowed = await isCalendarAllowed(event.calendar);
        if (!allowed) {
          throw new Error(
            `This event belongs to calendar '${event.calendar}' which is not in your allowed list.\n` +
              `Run /apple-pim:configure to add it.`
          );
        }
      }

      return await runCLI("calendar-cli", buildCalendarDeleteArgs(args));
    }

    case "calendar_batch_create": {
      if (!args.events || !Array.isArray(args.events) || args.events.length === 0) {
        throw new Error("Events array is required and cannot be empty");
      }

      // Validate all calendars before proceeding
      for (const event of args.events) {
        if (event.calendar) {
          await validateCalendarForWrite(event.calendar);
        }
      }

      // Get default calendar for events without one specified
      const defaultCalendar = await getDefaultCalendar();

      // Transform events to include default calendar if not specified
      const eventsWithDefaults = applyDefaultCalendar(
        args.events,
        defaultCalendar
      );

      return await runCLI("calendar-cli", [
        "batch-create",
        "--json",
        JSON.stringify(eventsWithDefaults),
      ]);
    }

    // Reminder tools
    case "reminder_lists": {
      const result = await runCLI("reminder-cli", ["lists"]);
      // Filter lists based on config
      if (result.lists) {
        result.lists = await filterReminderLists(result.lists);
      }
      return result;
    }

    case "reminder_items": {
      // Validate list filter if specified
      if (args.list) {
        const allowed = await isReminderListAllowed(args.list);
        if (!allowed) {
          throw new Error(
            `Reminder list '${args.list}' is not in your allowed list.\n` +
              `Run /apple-pim:configure to add it.`
          );
        }
      }

      cliArgs.push("items");
      if (args.list) cliArgs.push("--list", args.list);

      // Pass filter directly to CLI (native filtering + sorting)
      if (args.filter) cliArgs.push("--filter", args.filter);
      // Legacy completed flag (overridden by filter if both set)
      if (!args.filter && args.completed) cliArgs.push("--completed");
      if (args.limit) cliArgs.push("--limit", String(args.limit));

      const result = await runCLI("reminder-cli", cliArgs);
      // Filter reminders based on config (in case no specific list was requested)
      if (result.reminders) {
        result.reminders = await filterReminders(result.reminders);
      }

      return result;
    }

    case "reminder_get": {
      const result = await runCLI("reminder-cli", ["get", "--id", args.id]);
      // Check if reminder's list is allowed
      if (result.list) {
        const allowed = await isReminderListAllowed(result.list);
        if (!allowed) {
          throw new Error(
            `This reminder belongs to list '${result.list}' which is not in your allowed list.\n` +
              `Run /apple-pim:configure to add it.`
          );
        }
      }
      return result;
    }

    case "reminder_search": {
      // Validate list filter if specified
      if (args.list) {
        const allowed = await isReminderListAllowed(args.list);
        if (!allowed) {
          throw new Error(
            `Reminder list '${args.list}' is not in your allowed list.\n` +
              `Run /apple-pim:configure to add it.`
          );
        }
      }

      cliArgs.push("search", args.query);
      if (args.list) cliArgs.push("--list", args.list);
      if (args.completed) cliArgs.push("--completed");
      if (args.limit) cliArgs.push("--limit", String(args.limit));

      const result = await runCLI("reminder-cli", cliArgs);
      // Filter results based on config
      if (result.reminders) {
        result.reminders = await filterReminders(result.reminders);
      }
      return result;
    }

    case "reminder_create": {
      // Validate target list
      await validateReminderListForWrite(args.list);

      // Use default list from config if not specified
      let targetList = args.list;
      if (!targetList) {
        targetList = await getDefaultReminderList();
      }

      cliArgs.push("create", "--title", args.title);
      if (targetList) cliArgs.push("--list", targetList);
      if (args.due) cliArgs.push("--due", args.due);
      if (args.notes) cliArgs.push("--notes", args.notes);
      if (args.priority !== undefined)
        cliArgs.push("--priority", String(args.priority));
      if (args.url) cliArgs.push("--url", args.url);
      if (args.alarm) {
        for (const minutes of args.alarm) {
          cliArgs.push("--alarm", String(minutes));
        }
      }
      if (args.location) {
        cliArgs.push("--location", JSON.stringify(args.location));
      }
      if (args.recurrence) {
        cliArgs.push("--recurrence", JSON.stringify(args.recurrence));
      }
      return await runCLI("reminder-cli", cliArgs);
    }

    case "reminder_complete": {
      // First get the reminder to check its list
      const reminder = await runCLI("reminder-cli", ["get", "--id", args.id]);
      if (reminder.list) {
        const allowed = await isReminderListAllowed(reminder.list);
        if (!allowed) {
          throw new Error(
            `This reminder belongs to list '${reminder.list}' which is not in your allowed list.\n` +
              `Run /apple-pim:configure to add it.`
          );
        }
      }

      cliArgs.push("complete", "--id", args.id);
      if (args.undo) cliArgs.push("--undo");
      return await runCLI("reminder-cli", cliArgs);
    }

    case "reminder_update": {
      // First get the reminder to check its list
      const reminder = await runCLI("reminder-cli", ["get", "--id", args.id]);
      if (reminder.list) {
        const allowed = await isReminderListAllowed(reminder.list);
        if (!allowed) {
          throw new Error(
            `This reminder belongs to list '${reminder.list}' which is not in your allowed list.\n` +
              `Run /apple-pim:configure to add it.`
          );
        }
      }

      cliArgs.push("update", "--id", args.id);
      if (args.title) cliArgs.push("--title", args.title);
      if (args.due) cliArgs.push("--due", args.due);
      if (args.notes) cliArgs.push("--notes", args.notes);
      if (args.priority !== undefined)
        cliArgs.push("--priority", String(args.priority));
      if (args.url !== undefined) cliArgs.push("--url", args.url);
      if (args.location) {
        cliArgs.push("--location", JSON.stringify(args.location));
      }
      if (args.recurrence) {
        cliArgs.push("--recurrence", JSON.stringify(args.recurrence));
      }
      return await runCLI("reminder-cli", cliArgs);
    }

    case "reminder_delete": {
      // First get the reminder to check its list
      const reminder = await runCLI("reminder-cli", ["get", "--id", args.id]);
      if (reminder.list) {
        const allowed = await isReminderListAllowed(reminder.list);
        if (!allowed) {
          throw new Error(
            `This reminder belongs to list '${reminder.list}' which is not in your allowed list.\n` +
              `Run /apple-pim:configure to add it.`
          );
        }
      }

      return await runCLI("reminder-cli", ["delete", "--id", args.id]);
    }

    case "reminder_batch_create": {
      if (
        !args.reminders ||
        !Array.isArray(args.reminders) ||
        args.reminders.length === 0
      ) {
        throw new Error("Reminders array is required and cannot be empty");
      }

      // Validate all lists before proceeding
      for (const reminder of args.reminders) {
        if (reminder.list) {
          await validateReminderListForWrite(reminder.list);
        }
      }

      // Get default list for reminders without one specified
      const defaultList = await getDefaultReminderList();

      // Transform reminders to include default list if not specified
      const remindersWithDefaults = applyDefaultReminderList(
        args.reminders,
        defaultList
      );

      return await runCLI("reminder-cli", [
        "batch-create",
        "--json",
        JSON.stringify(remindersWithDefaults),
      ]);
    }

    // Mail tools (no config filtering — Mail.app handles its own accounts)
    case "mail_accounts":
      return await runCLI("mail-cli", ["accounts"]);

    case "mail_mailboxes":
      cliArgs.push("mailboxes");
      if (args.account) cliArgs.push("--account", args.account);
      return await runCLI("mail-cli", cliArgs);

    case "mail_messages":
      cliArgs.push("messages");
      if (args.mailbox) cliArgs.push("--mailbox", args.mailbox);
      if (args.account) cliArgs.push("--account", args.account);
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      if (args.filter) cliArgs.push("--filter", args.filter);
      return await runCLI("mail-cli", cliArgs);

    case "mail_get": {
      const getArgs = ["get", "--id", args.id];
      if (args.mailbox) getArgs.push("--mailbox", args.mailbox);
      if (args.account) getArgs.push("--account", args.account);
      return await runCLI("mail-cli", getArgs);
    }

    case "mail_search":
      cliArgs.push("search", args.query);
      if (args.field) cliArgs.push("--field", args.field);
      if (args.mailbox) cliArgs.push("--mailbox", args.mailbox);
      if (args.account) cliArgs.push("--account", args.account);
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return await runCLI("mail-cli", cliArgs);

    case "mail_update": {
      const updateArgs = ["update", "--id", args.id];
      if (args.read !== undefined) updateArgs.push("--read", String(args.read));
      if (args.flagged !== undefined)
        updateArgs.push("--flagged", String(args.flagged));
      if (args.junk !== undefined) updateArgs.push("--junk", String(args.junk));
      if (args.mailbox) updateArgs.push("--mailbox", args.mailbox);
      if (args.account) updateArgs.push("--account", args.account);
      return await runCLI("mail-cli", updateArgs);
    }

    case "mail_move": {
      const moveArgs = [
        "move",
        "--id",
        args.id,
        "--to-mailbox",
        args.toMailbox,
      ];
      if (args.toAccount) moveArgs.push("--to-account", args.toAccount);
      if (args.mailbox) moveArgs.push("--mailbox", args.mailbox);
      if (args.account) moveArgs.push("--account", args.account);
      return await runCLI("mail-cli", moveArgs);
    }

    case "mail_delete": {
      const delArgs = ["delete", "--id", args.id];
      if (args.mailbox) delArgs.push("--mailbox", args.mailbox);
      if (args.account) delArgs.push("--account", args.account);
      return await runCLI("mail-cli", delArgs);
    }

    // Contact tools (no filtering for contacts by default, but groups could be filtered)
    case "contact_groups":
      return await runCLI("contacts-cli", ["groups"]);

    case "contact_list":
      cliArgs.push("list");
      if (args.group) cliArgs.push("--group", args.group);
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return await runCLI("contacts-cli", cliArgs);

    case "contact_search":
      cliArgs.push("search", args.query);
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return await runCLI("contacts-cli", cliArgs);

    case "contact_get":
      return await runCLI("contacts-cli", ["get", "--id", args.id]);

    case "contact_create":
      cliArgs.push("create");
      // Name fields
      if (args.name) cliArgs.push("--name", args.name);
      if (args.firstName) cliArgs.push("--first-name", args.firstName);
      if (args.lastName) cliArgs.push("--last-name", args.lastName);
      if (args.middleName) cliArgs.push("--middle-name", args.middleName);
      if (args.namePrefix) cliArgs.push("--name-prefix", args.namePrefix);
      if (args.nameSuffix) cliArgs.push("--name-suffix", args.nameSuffix);
      if (args.nickname) cliArgs.push("--nickname", args.nickname);
      if (args.previousFamilyName) cliArgs.push("--previous-family-name", args.previousFamilyName);
      // Phonetic names
      if (args.phoneticGivenName) cliArgs.push("--phonetic-given-name", args.phoneticGivenName);
      if (args.phoneticMiddleName) cliArgs.push("--phonetic-middle-name", args.phoneticMiddleName);
      if (args.phoneticFamilyName) cliArgs.push("--phonetic-family-name", args.phoneticFamilyName);
      if (args.phoneticOrganizationName) cliArgs.push("--phonetic-organization-name", args.phoneticOrganizationName);
      // Organization
      if (args.organization) cliArgs.push("--organization", args.organization);
      if (args.jobTitle) cliArgs.push("--job-title", args.jobTitle);
      if (args.department) cliArgs.push("--department", args.department);
      if (args.contactType) cliArgs.push("--contact-type", args.contactType);
      // Simple communication
      if (args.email) cliArgs.push("--email", args.email);
      if (args.phone) cliArgs.push("--phone", args.phone);
      // Rich labeled arrays (JSON - skip empty arrays)
      if (args.emails?.length) cliArgs.push("--emails", JSON.stringify(args.emails));
      if (args.phones?.length) cliArgs.push("--phones", JSON.stringify(args.phones));
      if (args.addresses?.length) cliArgs.push("--addresses", JSON.stringify(args.addresses));
      if (args.urls?.length) cliArgs.push("--urls", JSON.stringify(args.urls));
      if (args.socialProfiles?.length) cliArgs.push("--social-profiles", JSON.stringify(args.socialProfiles));
      if (args.instantMessages?.length) cliArgs.push("--instant-messages", JSON.stringify(args.instantMessages));
      if (args.relations?.length) cliArgs.push("--relations", JSON.stringify(args.relations));
      // Dates
      if (args.birthday) cliArgs.push("--birthday", args.birthday);
      if (args.dates?.length) cliArgs.push("--dates", JSON.stringify(args.dates));
      // Notes
      if (args.notes) cliArgs.push("--notes", args.notes);
      return await runCLI("contacts-cli", cliArgs);

    case "contact_update":
      cliArgs.push("update", "--id", args.id);
      // Name fields
      if (args.firstName) cliArgs.push("--first-name", args.firstName);
      if (args.lastName) cliArgs.push("--last-name", args.lastName);
      if (args.middleName) cliArgs.push("--middle-name", args.middleName);
      if (args.namePrefix) cliArgs.push("--name-prefix", args.namePrefix);
      if (args.nameSuffix) cliArgs.push("--name-suffix", args.nameSuffix);
      if (args.nickname) cliArgs.push("--nickname", args.nickname);
      if (args.previousFamilyName) cliArgs.push("--previous-family-name", args.previousFamilyName);
      // Phonetic names
      if (args.phoneticGivenName) cliArgs.push("--phonetic-given-name", args.phoneticGivenName);
      if (args.phoneticMiddleName) cliArgs.push("--phonetic-middle-name", args.phoneticMiddleName);
      if (args.phoneticFamilyName) cliArgs.push("--phonetic-family-name", args.phoneticFamilyName);
      if (args.phoneticOrganizationName) cliArgs.push("--phonetic-organization-name", args.phoneticOrganizationName);
      // Organization
      if (args.organization) cliArgs.push("--organization", args.organization);
      if (args.jobTitle) cliArgs.push("--job-title", args.jobTitle);
      if (args.department) cliArgs.push("--department", args.department);
      if (args.contactType) cliArgs.push("--contact-type", args.contactType);
      // Simple communication (replaces primary)
      if (args.email) cliArgs.push("--email", args.email);
      if (args.phone) cliArgs.push("--phone", args.phone);
      // Rich labeled arrays (JSON - replaces all; skip empty arrays to prevent accidental clearing)
      if (args.emails?.length) cliArgs.push("--emails", JSON.stringify(args.emails));
      if (args.phones?.length) cliArgs.push("--phones", JSON.stringify(args.phones));
      if (args.addresses?.length) cliArgs.push("--addresses", JSON.stringify(args.addresses));
      if (args.urls?.length) cliArgs.push("--urls", JSON.stringify(args.urls));
      if (args.socialProfiles?.length) cliArgs.push("--social-profiles", JSON.stringify(args.socialProfiles));
      if (args.instantMessages?.length) cliArgs.push("--instant-messages", JSON.stringify(args.instantMessages));
      if (args.relations?.length) cliArgs.push("--relations", JSON.stringify(args.relations));
      // Dates
      if (args.birthday) cliArgs.push("--birthday", args.birthday);
      if (args.dates?.length) cliArgs.push("--dates", JSON.stringify(args.dates));
      // Notes
      if (args.notes) cliArgs.push("--notes", args.notes);
      return await runCLI("contacts-cli", cliArgs);

    case "contact_delete":
      return await runCLI("contacts-cli", ["delete", "--id", args.id]);

    // PIM authorization tools
    case "pim_status": {
      const status = {};

      // Use auth-status subcommands — check authorization without triggering prompts
      const domains = [
        { name: "calendars", cli: "calendar-cli" },
        { name: "reminders", cli: "reminder-cli" },
        { name: "contacts", cli: "contacts-cli" },
        { name: "mail", cli: "mail-cli" },
      ];

      const statusMessages = {
        authorized: "Full access granted",
        notDetermined: "Permission not yet requested. Run pim_authorize to prompt.",
        denied: "Access denied. Enable in System Settings > Privacy & Security.",
        restricted: "Access restricted by system policy (MDM or parental controls).",
        writeOnly: "Write-only access. Upgrade in System Settings > Privacy & Security.",
        unavailable: "Not available",
      };

      for (const domain of domains) {
        const enabled = await isDomainEnabled(domain.name);
        if (!enabled) {
          status[domain.name] = {
            enabled: false,
            authorization: "unavailable",
            message: "Domain disabled in plugin configuration",
          };
          continue;
        }

        try {
          const result = await runCLI(domain.cli, ["auth-status"]);
          const auth = result.authorization || "unknown";
          status[domain.name] = {
            enabled: true,
            authorization: auth,
            message: result.message || statusMessages[auth] || `Status: ${auth}`,
          };
        } catch (err) {
          status[domain.name] = {
            enabled: true,
            authorization: "error",
            message: err.message,
          };
        }
      }

      return { status };
    }

    case "pim_authorize": {
      const targetDomain = args.domain;
      const results = {};

      const domains = [
        { name: "calendars", cli: "calendar-cli", args: ["list"] },
        { name: "reminders", cli: "reminder-cli", args: ["lists"] },
        { name: "contacts", cli: "contacts-cli", args: ["groups"] },
        { name: "mail", cli: "mail-cli", args: ["accounts"] },
      ];

      const toAuthorize = targetDomain
        ? domains.filter((d) => d.name === targetDomain)
        : domains;

      for (const domain of toAuthorize) {
        const enabled = await isDomainEnabled(domain.name);
        if (!enabled) {
          results[domain.name] = {
            success: false,
            message:
              "Domain disabled in plugin configuration. Run /apple-pim:configure to enable it.",
          };
          continue;
        }

        try {
          // Running the CLI triggers the permission prompt if not yet determined
          await runCLI(domain.cli, domain.args);
          results[domain.name] = {
            success: true,
            message: "Access authorized",
          };
        } catch (err) {
          const msg = err.message.toLowerCase();
          if (msg.includes("denied") || msg.includes("not granted")) {
            results[domain.name] = {
              success: false,
              message:
                "Access denied. The user must manually enable access:\n" +
                "1. Open System Settings > Privacy & Security\n" +
                `2. Find the ${domain.name === "mail" ? "Automation" : domain.name.charAt(0).toUpperCase() + domain.name.slice(1)} section\n` +
                "3. Enable access for the terminal application\n" +
                "4. Restart the terminal and try again",
            };
          } else if (msg.includes("not running")) {
            results[domain.name] = {
              success: false,
              message:
                "Mail.app must be running before authorization can be requested. Ask the user to open Mail.app.",
            };
          } else {
            results[domain.name] = {
              success: false,
              message: err.message,
            };
          }
        }
      }

      return { results };
    }

    // Batch reminder operations (native CLI — single process, single EventKit commit)
    case "reminder_batch_complete": {
      if (!args.ids || !Array.isArray(args.ids) || args.ids.length === 0) {
        throw new Error("IDs array is required and cannot be empty");
      }

      // Check list authorization for each reminder before batch operation
      const allowedCompleteIds = [];
      const deniedComplete = [];
      for (const id of args.ids) {
        try {
          const reminder = await runCLI("reminder-cli", ["get", "--id", id]);
          if (reminder.list) {
            const allowed = await isReminderListAllowed(reminder.list);
            if (!allowed) {
              deniedComplete.push({ id, list: reminder.list });
              continue;
            }
          }
          allowedCompleteIds.push(id);
        } catch (err) {
          deniedComplete.push({ id, error: err.message });
        }
      }

      if (allowedCompleteIds.length === 0) {
        throw new Error(
          `None of the reminders are in allowed lists. Denied: ${JSON.stringify(deniedComplete)}\n` +
            `Run /apple-pim:configure to update your allowed lists.`
        );
      }

      const completeArgs = [
        "batch-complete",
        "--json",
        JSON.stringify(allowedCompleteIds),
      ];
      if (args.undo) completeArgs.push("--undo");
      const completeResult = await runCLI("reminder-cli", completeArgs);
      if (deniedComplete.length > 0) {
        completeResult.denied = deniedComplete;
        completeResult.deniedCount = deniedComplete.length;
      }
      return completeResult;
    }

    case "reminder_batch_delete": {
      if (!args.ids || !Array.isArray(args.ids) || args.ids.length === 0) {
        throw new Error("IDs array is required and cannot be empty");
      }

      // Check list authorization for each reminder before batch operation
      const allowedDeleteIds = [];
      const deniedDelete = [];
      for (const id of args.ids) {
        try {
          const reminder = await runCLI("reminder-cli", ["get", "--id", id]);
          if (reminder.list) {
            const allowed = await isReminderListAllowed(reminder.list);
            if (!allowed) {
              deniedDelete.push({ id, list: reminder.list });
              continue;
            }
          }
          allowedDeleteIds.push(id);
        } catch (err) {
          deniedDelete.push({ id, error: err.message });
        }
      }

      if (allowedDeleteIds.length === 0) {
        throw new Error(
          `None of the reminders are in allowed lists. Denied: ${JSON.stringify(deniedDelete)}\n` +
            `Run /apple-pim:configure to update your allowed lists.`
        );
      }

      const deleteResult = await runCLI("reminder-cli", [
        "batch-delete",
        "--json",
        JSON.stringify(allowedDeleteIds),
      ]);
      if (deniedDelete.length > 0) {
        deleteResult.denied = deniedDelete;
        deleteResult.deniedCount = deniedDelete.length;
      }
      return deleteResult;
    }

    // Batch mail operations (native CLI — single JXA call)
    case "mail_batch_update": {
      if (!args.ids || !Array.isArray(args.ids) || args.ids.length === 0) {
        throw new Error("IDs array is required and cannot be empty");
      }

      // Build update objects for the native CLI
      const updates = args.ids.map((id) => {
        const obj = { id };
        if (args.read !== undefined) obj.read = args.read;
        if (args.flagged !== undefined) obj.flagged = args.flagged;
        if (args.junk !== undefined) obj.junk = args.junk;
        return obj;
      });

      const batchArgs = ["batch-update", "--json", JSON.stringify(updates)];
      if (args.mailbox) batchArgs.push("--mailbox", args.mailbox);
      if (args.account) batchArgs.push("--account", args.account);
      return await runCLI("mail-cli", batchArgs);
    }

    case "mail_batch_delete": {
      if (!args.ids || !Array.isArray(args.ids) || args.ids.length === 0) {
        throw new Error("IDs array is required and cannot be empty");
      }

      const batchArgs = [
        "batch-delete",
        "--json",
        JSON.stringify(args.ids),
      ];
      if (args.mailbox) batchArgs.push("--mailbox", args.mailbox);
      if (args.account) batchArgs.push("--account", args.account);
      return await runCLI("mail-cli", batchArgs);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Map tool name prefix to config domain
function toolDomain(toolName) {
  if (toolName.startsWith("calendar_")) return "calendars";
  if (toolName.startsWith("reminder_")) return "reminders";
  if (toolName.startsWith("contact_")) return "contacts";
  if (toolName.startsWith("mail_")) return "mail";
  // pim_ tools are cross-domain, always available
  if (toolName.startsWith("pim_")) return null;
  return null;
}

// Create and run server
const server = new Server(
  {
    name: "apple-pim",
    version: "2.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // Filter out tools whose domain is disabled
  const enabledTools = [];
  for (const tool of tools) {
    const domain = toolDomain(tool.name);
    if (!domain || (await isDomainEnabled(domain))) {
      enabledTools.push(tool);
    }
  }
  return { tools: enabledTools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Check if tool's domain is enabled
    const domain = toolDomain(name);
    if (domain && !(await isDomainEnabled(domain))) {
      throw new Error(
        `The ${domain} domain is disabled in your configuration.\n` +
          `Run /apple-pim:configure to enable it.`
      );
    }

    const result = await handleTool(name, args || {});

    // Apply datamarking to untrusted PIM content fields
    const markedResult = markToolResult(result, name);
    const preamble = getDatamarkingPreamble();

    return {
      content: [
        {
          type: "text",
          text: `${preamble}\n\n${JSON.stringify(markedResult, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: false,
              error: error.message,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
