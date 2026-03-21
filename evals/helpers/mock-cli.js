import { vi } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { relativeDateString } from "../../lib/cli-runner.js";
import {
  buildCalendarCreateArgs,
  buildCalendarDeleteArgs,
  buildCalendarUpdateArgs,
} from "../../lib/tool-args.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

function calendarActionName(action) {
  return action === "batch_create" ? "batch-create" : action;
}

function buildCalendarPseudoArgs(args) {
  switch (args.action) {
    case "list":
      return ["list"];
    case "events": {
      const cliArgs = ["events"];
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
      return cliArgs;
    }
    case "get":
      return ["get", "--id", args.id];
    case "search": {
      const cliArgs = ["search", args.query];
      if (args.calendar) cliArgs.push("--calendar", args.calendar);
      if (args.from) cliArgs.push("--from", args.from);
      if (args.to) cliArgs.push("--to", args.to);
      if (args.limit) cliArgs.push("--limit", String(args.limit));
      return cliArgs;
    }
    case "create":
      return buildCalendarCreateArgs(args, args.calendar);
    case "update":
      return buildCalendarUpdateArgs(args);
    case "delete":
      return buildCalendarDeleteArgs(args);
    case "batch_create":
      return [
        "batch-create",
        "--json",
        JSON.stringify(
          Array.isArray(args.events)
            ? args.events.map((event) => (
                event.calendar || !args.calendar
                  ? event
                  : { ...event, calendar: args.calendar }
              ))
            : []
        ),
      ];
    default:
      return [String(args.action)];
  }
}

/**
 * Load a fixture JSON file by domain and name.
 * @param {string} domain - e.g. "calendar", "reminder", "contact", "mail"
 * @param {string} name - e.g. "create-success", "events-list"
 * @returns {object} Parsed JSON fixture
 */
export function loadFixture(domain, name) {
  const path = join(fixturesDir, domain, `${name}.json`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Create a mock runCLI function that returns fixture data based on a response map.
 *
 * @param {Record<string, object>} responseMap - Keys are "cli:action" (e.g. "calendar:create"),
 *   values are the JSON response to return. If the value is an Error instance, the mock rejects.
 * @returns {import("vitest").Mock} A vi.fn() mock
 */
export function createMockCLI(responseMap = {}) {
  const mock = vi.fn(async (cli, args) => {
    const action = args[0]; // first positional arg is always the action
    const key = `${cli}:${action}`;

    if (responseMap[key] instanceof Error) {
      throw responseMap[key];
    }

    if (responseMap[key] !== undefined) {
      return responseMap[key];
    }

    // Fallback: return a generic success
    return { success: true };
  });

  mock.__recordCalendarCall = (args) => {
    mock.mock.calls.push(["calendar", buildCalendarPseudoArgs(args)]);
  };

  mock.__calendarResponder = async (args) => {
    mock.__recordCalendarCall(args);
    const action = calendarActionName(args.action);
    const key = `calendar:${action}`;

    if (responseMap[key] instanceof Error) throw responseMap[key];
    if (responseMap[key] !== undefined) return responseMap[key];
    return { success: true };
  };

  return mock;
}

/**
 * Create a mock CLI that records calls and returns fixture responses in sequence.
 * Useful for multi-turn scenarios.
 *
 * @param {object[]} responses - Array of responses returned in order of calls
 * @returns {{ mock: import("vitest").Mock, calls: Array<{cli: string, args: string[]}> }}
 */
export function createSequentialMockCLI(responses = []) {
  let callIndex = 0;
  const calls = [];

  const mock = vi.fn(async (cli, args) => {
    calls.push({ cli, args: [...args] });
    const response = responses[callIndex] || { success: true };
    callIndex++;

    if (response instanceof Error) throw response;
    return response;
  });

  mock.__recordCalendarCall = (args) => {
    calls.push({ cli: "calendar", args: buildCalendarPseudoArgs(args) });
  };

  mock.__calendarResponder = async (args) => {
    mock.__recordCalendarCall(args);
    const response = responses[callIndex] || { success: true };
    callIndex++;
    if (response instanceof Error) throw response;
    return response;
  };

  return { mock, calls };
}
