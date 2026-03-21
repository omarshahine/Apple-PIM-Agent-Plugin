import { getCalDAVClient, resolveCalendarAliases } from "./client.js";
import { batchCreateEvents, createEvent, deleteEvent, getEvent, listCalendars, listEvents, searchEvents, updateEvent } from "./operations.js";

export function createCalDAVCalendarHandler(config = {}, overrides = {}) {
  return async function handleCalendarCalDAV(args) {
    const calendarAliases = resolveCalendarAliases(config);
    const client = overrides.client || await getCalDAVClient(config);

    switch (args.action) {
      case "list":
        return await listCalendars(client);
      case "events":
        return await listEvents(client, args, calendarAliases);
      case "get":
        if (!args.id) throw new Error("event id is required for calendar get");
        return await getEvent(client, args.id);
      case "search":
        if (!args.query) throw new Error("search query is required for calendar search");
        return await searchEvents(client, args, calendarAliases);
      case "create":
        return await createEvent(client, args, calendarAliases);
      case "update":
        if (!args.id) throw new Error("event id is required for calendar update");
        return await updateEvent(client, args, calendarAliases);
      case "delete":
        if (!args.id) throw new Error("event id is required for calendar delete");
        return await deleteEvent(client, args);
      case "batch_create":
        if (!Array.isArray(args.events) || args.events.length === 0) {
          throw new Error("events array is required and cannot be empty");
        }
        return await batchCreateEvents(client, args, calendarAliases);
      default:
        throw new Error(`unknown calendar action: ${args.action}`);
    }
  };
}
