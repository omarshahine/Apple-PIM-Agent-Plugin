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
    description: "List reminders from a list",
    inputSchema: {
      type: "object",
      properties: {
        list: {
          type: "string",
          description: "Reminder list name or ID (optional)",
        },
        completed: {
          type: "boolean",
          description: "Include completed reminders (default: false)",
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
        alarm: {
          type: "array",
          items: { type: "number" },
          description: "Alarm minutes before due",
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
    description: "Create a new contact",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Full name",
        },
        firstName: {
          type: "string",
          description: "First name (alternative to name)",
        },
        lastName: {
          type: "string",
          description: "Last name (alternative to name)",
        },
        email: {
          type: "string",
          description: "Email address",
        },
        phone: {
          type: "string",
          description: "Phone number",
        },
        organization: {
          type: "string",
          description: "Organization/company name",
        },
        jobTitle: {
          type: "string",
          description: "Job title",
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
    description: "Update an existing contact",
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
        email: {
          type: "string",
          description: "New email (replaces primary)",
        },
        phone: {
          type: "string",
          description: "New phone (replaces primary)",
        },
        organization: {
          type: "string",
          description: "New organization",
        },
        jobTitle: {
          type: "string",
          description: "New job title",
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

      const deleteArgs = ["delete", "--id", args.id];
      if (args.futureEvents) deleteArgs.push("--future-events");
      return await runCLI("calendar-cli", deleteArgs);
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
      const eventsWithDefaults = args.events.map((event) => ({
        ...event,
        calendar: event.calendar || defaultCalendar,
      }));

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
      if (args.completed) cliArgs.push("--completed");
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
      if (args.alarm) {
        for (const minutes of args.alarm) {
          cliArgs.push("--alarm", String(minutes));
        }
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
      const remindersWithDefaults = args.reminders.map((reminder) => ({
        ...reminder,
        list: reminder.list || defaultList,
      }));

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
      if (args.name) cliArgs.push("--name", args.name);
      if (args.firstName) cliArgs.push("--first-name", args.firstName);
      if (args.lastName) cliArgs.push("--last-name", args.lastName);
      if (args.email) cliArgs.push("--email", args.email);
      if (args.phone) cliArgs.push("--phone", args.phone);
      if (args.organization) cliArgs.push("--organization", args.organization);
      if (args.jobTitle) cliArgs.push("--job-title", args.jobTitle);
      if (args.notes) cliArgs.push("--notes", args.notes);
      return await runCLI("contacts-cli", cliArgs);

    case "contact_update":
      cliArgs.push("update", "--id", args.id);
      if (args.firstName) cliArgs.push("--first-name", args.firstName);
      if (args.lastName) cliArgs.push("--last-name", args.lastName);
      if (args.email) cliArgs.push("--email", args.email);
      if (args.phone) cliArgs.push("--phone", args.phone);
      if (args.organization) cliArgs.push("--organization", args.organization);
      if (args.jobTitle) cliArgs.push("--job-title", args.jobTitle);
      if (args.notes) cliArgs.push("--notes", args.notes);
      return await runCLI("contacts-cli", cliArgs);

    case "contact_delete":
      return await runCLI("contacts-cli", ["delete", "--id", args.id]);

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
  return null;
}

// Create and run server
const server = new Server(
  {
    name: "apple-pim",
    version: "2.0.0",
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
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
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
