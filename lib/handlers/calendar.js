import { createCalDAVCalendarHandler } from "./calendar-caldav.js";

export async function handleCalendar(args, _runCLI, runtime = {}) {
  switch (args.action) {
    case "list":
    case "events":
    case "create":
      break;
    case "get":
    case "update":
    case "delete":
      if (!args.id) throw new Error("Event ID is required");
      break;
    case "search":
      if (!args.query) throw new Error("Search query is required");
      break;
    case "batch_create":
      if (!args.events || !Array.isArray(args.events) || args.events.length === 0) {
        throw new Error("Events array is required and cannot be empty");
      }
      break;
    default:
      throw new Error(`Unknown calendar action: ${args.action}`);
  }

  if (_runCLI?.__calendarResponder) return await _runCLI.__calendarResponder(args);
  _runCLI?.__recordCalendarCall?.(args);
  const config = runtime?.pluginConfig || {};
  const handler = createCalDAVCalendarHandler(config, {
    client: runtime?.calendarClient || _runCLI?.__calendarClient,
  });
  return await handler(args);
}
