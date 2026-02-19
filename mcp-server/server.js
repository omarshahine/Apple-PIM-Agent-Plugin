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
  markToolResult,
  getDatamarkingPreamble,
} from "./sanitize.js";
import {
  buildCalendarCreateArgs,
  buildCalendarDeleteArgs,
  buildCalendarUpdateArgs,
  buildContactCreateArgs,
  buildContactUpdateArgs,
  buildReminderCreateArgs,
  buildReminderUpdateArgs,
} from "./tool-args.js";
import { formatMailGetResult } from "./mail-format.js";

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

// Shared schema fragments
const recurrenceSchema = {
  type: "object",
  description: "Recurrence rule for repeating events/reminders",
  properties: {
    frequency: {
      type: "string",
      enum: ["daily", "weekly", "monthly", "yearly", "none"],
      description: "How often it repeats. Use 'none' to remove recurrence.",
    },
    interval: { type: "number", description: "Repeat every N periods (default: 1)" },
    endDate: { type: "string", description: "Stop repeating after this date (ISO format)" },
    occurrenceCount: { type: "number", description: "Stop after N occurrences" },
    daysOfTheWeek: {
      type: "array",
      items: { type: "string" },
      description: "Days for weekly recurrence (e.g., ['monday', 'wednesday', 'friday'])",
    },
    daysOfTheMonth: {
      type: "array",
      items: { type: "number" },
      description: "Days for monthly recurrence (e.g., [1, 15])",
    },
  },
  required: ["frequency"],
};

// Consolidated tool definitions (5 tools replacing 40)
const tools = [
  {
    name: "calendar",
    description:
      "Manage macOS calendar events. Actions: list (calendars), events (query by date range), get (by ID), search (by text), create, update, delete, batch_create.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "events", "get", "search", "create", "update", "delete", "batch_create"],
          description: "Operation to perform",
        },
        id: { type: "string", description: "Event ID (get/update/delete)" },
        calendar: { type: "string", description: "Calendar name or ID" },
        query: { type: "string", description: "Search query (search)" },
        from: { type: "string", description: "Start date (events/search)" },
        to: { type: "string", description: "End date (events/search)" },
        lastDays: { type: "number", description: "Include events from N days ago" },
        nextDays: { type: "number", description: "Include events up to N days ahead" },
        limit: { type: "number", description: "Maximum results" },
        title: { type: "string", description: "Event title (create/update)" },
        start: { type: "string", description: "Start date/time (create/update)" },
        end: { type: "string", description: "End date/time (create/update)" },
        duration: { type: "number", description: "Duration in minutes (create)" },
        location: { type: "string", description: "Event location" },
        notes: { type: "string", description: "Event notes" },
        allDay: { type: "boolean", description: "All-day event" },
        alarm: { type: "array", items: { type: "number" }, description: "Alarm minutes before event" },
        url: { type: "string", description: "URL" },
        recurrence: recurrenceSchema,
        futureEvents: { type: "boolean", description: "Apply to future occurrences (update/delete recurring)" },
        events: {
          type: "array",
          description: "Events array (batch_create)",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              start: { type: "string" },
              end: { type: "string" },
              duration: { type: "number" },
              calendar: { type: "string" },
              location: { type: "string" },
              notes: { type: "string" },
              url: { type: "string" },
              allDay: { type: "boolean" },
              alarm: { type: "array", items: { type: "number" } },
              recurrence: recurrenceSchema,
            },
            required: ["title", "start"],
          },
        },
      },
      required: ["action"],
    },
  },

  {
    name: "reminder",
    description:
      "Manage macOS reminders. Actions: lists (all lists), items (list reminders with optional filter), get (by ID), search (by text), create, complete, update, delete, batch_create, batch_complete, batch_delete.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "lists", "items", "get", "search", "create",
            "complete", "update", "delete",
            "batch_create", "batch_complete", "batch_delete",
          ],
          description: "Operation to perform",
        },
        id: { type: "string", description: "Reminder ID (get/complete/update/delete)" },
        ids: { type: "array", items: { type: "string" }, description: "Reminder IDs (batch_complete/batch_delete)" },
        list: { type: "string", description: "Reminder list name or ID" },
        filter: {
          type: "string",
          enum: ["overdue", "today", "tomorrow", "week", "upcoming", "completed", "all"],
          description: "Filter reminders by time (items)",
        },
        completed: { type: "boolean", description: "Include completed reminders" },
        lastDays: { type: "number", description: "Include reminders due from N days ago" },
        nextDays: { type: "number", description: "Include reminders due up to N days ahead" },
        limit: { type: "number", description: "Maximum results" },
        query: { type: "string", description: "Search query (search)" },
        title: { type: "string", description: "Reminder title (create/update)" },
        due: { type: "string", description: "Due date/time (create/update)" },
        notes: { type: "string", description: "Notes (create/update)" },
        priority: { type: "number", description: "Priority: 0=none, 1=high, 5=medium, 9=low" },
        url: { type: "string", description: "URL (create/update, empty string to remove)" },
        alarm: { type: "array", items: { type: "number" }, description: "Alarm minutes before due" },
        location: {
          description: "Location-based alarm (arrive/depart). Pass empty object to remove.",
          oneOf: [
            { type: "object", properties: {}, additionalProperties: false },
            {
              type: "object",
              properties: {
                name: { type: "string", description: "Location name" },
                latitude: { type: "number" },
                longitude: { type: "number" },
                radius: { type: "number", description: "Geofence radius in meters (default: 100)" },
                proximity: { type: "string", enum: ["arrive", "depart"] },
              },
              required: ["latitude", "longitude", "proximity"],
            },
          ],
        },
        recurrence: recurrenceSchema,
        undo: { type: "boolean", description: "Mark as incomplete (complete/batch_complete)" },
        reminders: {
          type: "array",
          description: "Reminders array (batch_create)",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              list: { type: "string" },
              due: { type: "string" },
              notes: { type: "string" },
              priority: { type: "number" },
              url: { type: "string" },
              alarm: { type: "array", items: { type: "number" } },
              location: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  latitude: { type: "number" },
                  longitude: { type: "number" },
                  radius: { type: "number" },
                  proximity: { type: "string", enum: ["arrive", "depart"] },
                },
                required: ["latitude", "longitude", "proximity"],
              },
              recurrence: recurrenceSchema,
            },
            required: ["title"],
          },
        },
      },
      required: ["action"],
    },
  },

  {
    name: "contact",
    description:
      "Manage macOS contacts. Actions: groups (list groups), list (list contacts), search (by name/email/phone), get (by ID with photo), create, update, delete.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["groups", "list", "search", "get", "create", "update", "delete"],
          description: "Operation to perform",
        },
        id: { type: "string", description: "Contact ID (get/update/delete)" },
        group: { type: "string", description: "Group name or ID (list)" },
        query: { type: "string", description: "Search query (search)" },
        limit: { type: "number", description: "Maximum results" },
        name: { type: "string", description: "Full name (create, parsed into first/last)" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        middleName: { type: "string" },
        namePrefix: { type: "string" },
        nameSuffix: { type: "string" },
        nickname: { type: "string" },
        previousFamilyName: { type: "string" },
        phoneticGivenName: { type: "string" },
        phoneticMiddleName: { type: "string" },
        phoneticFamilyName: { type: "string" },
        phoneticOrganizationName: { type: "string" },
        organization: { type: "string" },
        jobTitle: { type: "string" },
        department: { type: "string" },
        contactType: { type: "string", enum: ["person", "organization"] },
        email: { type: "string", description: "Simple email (uses 'work' label)" },
        phone: { type: "string", description: "Simple phone (uses 'main' label)" },
        emails: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
            },
            required: ["value"],
          },
        },
        phones: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
            },
            required: ["value"],
          },
        },
        addresses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              street: { type: "string" },
              city: { type: "string" },
              state: { type: "string" },
              postalCode: { type: "string" },
              country: { type: "string" },
              isoCountryCode: { type: "string" },
              subLocality: { type: "string" },
              subAdministrativeArea: { type: "string" },
            },
          },
        },
        urls: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
            },
            required: ["value"],
          },
        },
        socialProfiles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              service: { type: "string" },
              username: { type: "string" },
              url: { type: "string" },
              userIdentifier: { type: "string" },
            },
          },
        },
        instantMessages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              service: { type: "string" },
              username: { type: "string" },
            },
          },
        },
        relations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              name: { type: "string" },
            },
            required: ["name"],
          },
        },
        birthday: { type: "string", description: "YYYY-MM-DD or MM-DD format" },
        dates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              year: { type: "number" },
              month: { type: "number" },
              day: { type: "number" },
            },
            required: ["month", "day"],
          },
        },
        notes: { type: "string" },
      },
      required: ["action"],
    },
  },

  {
    name: "mail",
    description:
      "Manage Mail.app messages. Requires Mail.app to be running. Actions: accounts, mailboxes, messages (list), get (full message by ID), search, update (flags), move, delete, batch_update, batch_delete.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "accounts", "mailboxes", "messages", "get", "search",
            "update", "move", "delete", "batch_update", "batch_delete",
          ],
          description: "Operation to perform",
        },
        id: { type: "string", description: "RFC 2822 message ID (get/update/move/delete)" },
        ids: { type: "array", items: { type: "string" }, description: "Message IDs (batch_update/batch_delete)" },
        account: { type: "string", description: "Account name" },
        mailbox: { type: "string", description: "Mailbox name" },
        limit: { type: "number", description: "Maximum results" },
        filter: {
          type: "string",
          enum: ["unread", "flagged", "all"],
          description: "Filter messages (messages action)",
        },
        query: { type: "string", description: "Search query (search)" },
        field: {
          type: "string",
          enum: ["subject", "sender", "content", "all"],
          description: "Search field (search)",
        },
        format: {
          type: "string",
          enum: ["plain", "markdown"],
          description: "Body format (get)",
        },
        read: { type: "boolean", description: "Set read status (update/batch_update)" },
        flagged: { type: "boolean", description: "Set flagged status (update/batch_update)" },
        junk: { type: "boolean", description: "Set junk status (update/batch_update)" },
        toMailbox: { type: "string", description: "Destination mailbox (move)" },
        toAccount: { type: "string", description: "Destination account (move)" },
      },
      required: ["action"],
    },
  },

  {
    name: "apple-pim",
    description:
      "PIM system management. Actions: status (check authorization), authorize (request permissions), config_show (view config), config_init (discover calendars/lists).",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "authorize", "config_show", "config_init"],
          description: "Operation to perform",
        },
        domain: {
          type: "string",
          enum: ["calendars", "reminders", "contacts", "mail"],
          description: "Specific domain (authorize)",
        },
        profile: {
          type: "string",
          description: "PIM profile name (config_show/config_init)",
        },
      },
      required: ["action"],
    },
  },
];

// Domain handlers

async function handleCalendar(args) {
  const cliArgs = [];

  switch (args.action) {
    case "list":
      return await runCLI("calendar-cli", ["list"]);

    case "events":
      cliArgs.push("events");
      if (args.calendar) cliArgs.push("--calendar", args.calendar);
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
      return await runCLI("calendar-cli", cliArgs);

    case "get":
      if (!args.id) throw new Error("Event ID is required for calendar get");
      return await runCLI("calendar-cli", ["get", "--id", args.id]);

    case "search":
      if (!args.query) throw new Error("Search query is required for calendar search");
      cliArgs.push("search", args.query);
      if (args.calendar) cliArgs.push("--calendar", args.calendar);
      if (args.from) cliArgs.push("--from", args.from);
      if (args.to) cliArgs.push("--to", args.to);
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return await runCLI("calendar-cli", cliArgs);

    case "create":
      return await runCLI(
        "calendar-cli",
        buildCalendarCreateArgs(args, args.calendar)
      );

    case "update":
      return await runCLI("calendar-cli", buildCalendarUpdateArgs(args));

    case "delete":
      return await runCLI("calendar-cli", buildCalendarDeleteArgs(args));

    case "batch_create":
      if (!args.events || !Array.isArray(args.events) || args.events.length === 0) {
        throw new Error("Events array is required and cannot be empty");
      }
      return await runCLI("calendar-cli", [
        "batch-create",
        "--json",
        JSON.stringify(args.events),
      ]);

    default:
      throw new Error(`Unknown calendar action: ${args.action}`);
  }
}

async function handleReminder(args) {
  const cliArgs = [];

  switch (args.action) {
    case "lists":
      return await runCLI("reminder-cli", ["lists"]);

    case "items":
      cliArgs.push("items");
      if (args.list) cliArgs.push("--list", args.list);
      if (args.filter) cliArgs.push("--filter", args.filter);
      if (!args.filter && args.completed) cliArgs.push("--completed");
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return await runCLI("reminder-cli", cliArgs);

    case "get":
      if (!args.id) throw new Error("Reminder ID is required for reminder get");
      return await runCLI("reminder-cli", ["get", "--id", args.id]);

    case "search":
      if (!args.query) throw new Error("Search query is required for reminder search");
      cliArgs.push("search", args.query);
      if (args.list) cliArgs.push("--list", args.list);
      if (args.completed) cliArgs.push("--completed");
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return await runCLI("reminder-cli", cliArgs);

    case "create":
      return await runCLI(
        "reminder-cli",
        buildReminderCreateArgs(args, args.list)
      );

    case "complete":
      if (!args.id) throw new Error("Reminder ID is required for reminder complete");
      cliArgs.push("complete", "--id", args.id);
      if (args.undo) cliArgs.push("--undo");
      return await runCLI("reminder-cli", cliArgs);

    case "update":
      return await runCLI("reminder-cli", buildReminderUpdateArgs(args));

    case "delete":
      if (!args.id) throw new Error("Reminder ID is required for reminder delete");
      return await runCLI("reminder-cli", ["delete", "--id", args.id]);

    case "batch_create":
      if (!args.reminders || !Array.isArray(args.reminders) || args.reminders.length === 0) {
        throw new Error("Reminders array is required and cannot be empty");
      }
      return await runCLI("reminder-cli", [
        "batch-create",
        "--json",
        JSON.stringify(args.reminders),
      ]);

    case "batch_complete":
      if (!args.ids || !Array.isArray(args.ids) || args.ids.length === 0) {
        throw new Error("IDs array is required and cannot be empty");
      }
      cliArgs.push("batch-complete", "--json", JSON.stringify(args.ids));
      if (args.undo) cliArgs.push("--undo");
      return await runCLI("reminder-cli", cliArgs);

    case "batch_delete":
      if (!args.ids || !Array.isArray(args.ids) || args.ids.length === 0) {
        throw new Error("IDs array is required and cannot be empty");
      }
      return await runCLI("reminder-cli", [
        "batch-delete",
        "--json",
        JSON.stringify(args.ids),
      ]);

    default:
      throw new Error(`Unknown reminder action: ${args.action}`);
  }
}

async function handleContact(args) {
  const cliArgs = [];

  switch (args.action) {
    case "groups":
      return await runCLI("contacts-cli", ["groups"]);

    case "list":
      cliArgs.push("list");
      if (args.group) cliArgs.push("--group", args.group);
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return await runCLI("contacts-cli", cliArgs);

    case "search":
      if (!args.query) throw new Error("Search query is required for contact search");
      cliArgs.push("search", args.query);
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return await runCLI("contacts-cli", cliArgs);

    case "get":
      if (!args.id) throw new Error("Contact ID is required for contact get");
      return await runCLI("contacts-cli", ["get", "--id", args.id]);

    case "create":
      return await runCLI("contacts-cli", buildContactCreateArgs(args));

    case "update":
      return await runCLI("contacts-cli", buildContactUpdateArgs(args));

    case "delete":
      if (!args.id) throw new Error("Contact ID is required for contact delete");
      return await runCLI("contacts-cli", ["delete", "--id", args.id]);

    default:
      throw new Error(`Unknown contact action: ${args.action}`);
  }
}

async function handleMail(args) {
  const cliArgs = [];

  switch (args.action) {
    case "accounts":
      return await runCLI("mail-cli", ["accounts"]);

    case "mailboxes":
      cliArgs.push("mailboxes");
      if (args.account) cliArgs.push("--account", args.account);
      return await runCLI("mail-cli", cliArgs);

    case "messages":
      cliArgs.push("messages");
      if (args.mailbox) cliArgs.push("--mailbox", args.mailbox);
      if (args.account) cliArgs.push("--account", args.account);
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      if (args.filter) cliArgs.push("--filter", args.filter);
      return await runCLI("mail-cli", cliArgs);

    case "get": {
      if (!args.id) throw new Error("Message ID is required for mail get");
      const getArgs = ["get", "--id", args.id];
      if (args.mailbox) getArgs.push("--mailbox", args.mailbox);
      if (args.account) getArgs.push("--account", args.account);
      if (args.format === "markdown") getArgs.push("--include-source");
      const result = await runCLI("mail-cli", getArgs);
      return await formatMailGetResult(result, args.format || "plain");
    }

    case "search":
      if (!args.query) throw new Error("Search query is required for mail search");
      cliArgs.push("search", args.query);
      if (args.field) cliArgs.push("--field", args.field);
      if (args.mailbox) cliArgs.push("--mailbox", args.mailbox);
      if (args.account) cliArgs.push("--account", args.account);
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return await runCLI("mail-cli", cliArgs);

    case "update": {
      if (!args.id) throw new Error("Message ID is required for mail update");
      const updateArgs = ["update", "--id", args.id];
      if (args.read !== undefined) updateArgs.push("--read", String(args.read));
      if (args.flagged !== undefined) updateArgs.push("--flagged", String(args.flagged));
      if (args.junk !== undefined) updateArgs.push("--junk", String(args.junk));
      if (args.mailbox) updateArgs.push("--mailbox", args.mailbox);
      if (args.account) updateArgs.push("--account", args.account);
      return await runCLI("mail-cli", updateArgs);
    }

    case "move": {
      if (!args.id) throw new Error("Message ID is required for mail move");
      if (!args.toMailbox) throw new Error("Target mailbox (toMailbox) is required for mail move");
      const moveArgs = ["move", "--id", args.id, "--to-mailbox", args.toMailbox];
      if (args.toAccount) moveArgs.push("--to-account", args.toAccount);
      if (args.mailbox) moveArgs.push("--mailbox", args.mailbox);
      if (args.account) moveArgs.push("--account", args.account);
      return await runCLI("mail-cli", moveArgs);
    }

    case "delete": {
      if (!args.id) throw new Error("Message ID is required for mail delete");
      const delArgs = ["delete", "--id", args.id];
      if (args.mailbox) delArgs.push("--mailbox", args.mailbox);
      if (args.account) delArgs.push("--account", args.account);
      return await runCLI("mail-cli", delArgs);
    }

    case "batch_update": {
      if (!args.ids || !Array.isArray(args.ids) || args.ids.length === 0) {
        throw new Error("IDs array is required and cannot be empty");
      }
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

    case "batch_delete": {
      if (!args.ids || !Array.isArray(args.ids) || args.ids.length === 0) {
        throw new Error("IDs array is required and cannot be empty");
      }
      const batchArgs = ["batch-delete", "--json", JSON.stringify(args.ids)];
      if (args.mailbox) batchArgs.push("--mailbox", args.mailbox);
      if (args.account) batchArgs.push("--account", args.account);
      return await runCLI("mail-cli", batchArgs);
    }

    default:
      throw new Error(`Unknown mail action: ${args.action}`);
  }
}

async function handleApplePim(args) {
  switch (args.action) {
    case "status": {
      const status = {};
      const domains = [
        { name: "calendars", cli: "calendar-cli" },
        { name: "reminders", cli: "reminder-cli" },
        { name: "contacts", cli: "contacts-cli" },
        { name: "mail", cli: "mail-cli" },
      ];

      const statusMessages = {
        authorized: "Full access granted",
        notDetermined: "Permission not yet requested. Run authorize to prompt.",
        denied: "Access denied. Enable in System Settings > Privacy & Security.",
        restricted: "Access restricted by system policy (MDM or parental controls).",
        writeOnly: "Write-only access. Upgrade in System Settings > Privacy & Security.",
        unavailable: "Not available",
      };

      for (const domain of domains) {
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
            enabled: false,
            authorization: "error",
            message: err.message,
          };
        }
      }

      return { status };
    }

    case "authorize": {
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
        try {
          await runCLI(domain.cli, domain.args);
          results[domain.name] = { success: true, message: "Access authorized" };
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
          } else if (msg.includes("not running") && domain.name === "mail") {
            results[domain.name] = {
              success: false,
              message: "Mail.app must be running before authorization can be requested.",
            };
          } else {
            results[domain.name] = { success: false, message: err.message };
          }
        }
      }

      return { results };
    }

    case "config_show": {
      const configArgs = ["config", "show"];
      if (args.profile) configArgs.push("--profile", args.profile);
      return await runCLI("calendar-cli", configArgs);
    }

    case "config_init": {
      const configArgs = ["config", "init"];
      if (args.profile) configArgs.push("--profile", args.profile);
      return await runCLI("calendar-cli", configArgs);
    }

    default:
      throw new Error(`Unknown apple-pim action: ${args.action}`);
  }
}

// Main tool dispatcher
async function handleTool(name, args) {
  switch (name) {
    case "calendar":
      return await handleCalendar(args);
    case "reminder":
      return await handleReminder(args);
    case "contact":
      return await handleContact(args);
    case "mail":
      return await handleMail(args);
    case "apple-pim":
      return await handleApplePim(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Create and run server
const server = new Server(
  {
    name: "apple-pim",
    version: "3.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await handleTool(name, args || {});

    // Apply datamarking to untrusted PIM content fields
    const markedResult = markToolResult(result, name);
    const preamble = getDatamarkingPreamble(name);

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
