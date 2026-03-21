import ICAL from "ical.js";
import { randomUUID } from "crypto";
import {
  addDays,
  addYears,
  formatDate,
  icalKeyToDate,
  occurrenceWindow,
  parseEventId,
  parseUserDate,
  startOfDay,
} from "./common.js";
import {
  calendarToDict,
  fetchCalendarObjectByUrl,
  resolveSingleCalendar,
  resolveTargetCalendars,
} from "./client.js";
import {
  addExdate,
  applyMasterUpdate,
  applyOccurrenceUpdate,
  buildCalendarObjectData,
  buildUpdateVerificationInput,
  buildVerification,
  getMasterVevent,
  normalizeEventInput,
  normalizeUpdateInput,
  parseCalendarObjectEvents,
  parseSingleObjectEvent,
  rekeyCalendarObject,
  removeFutureExceptions,
  removeMatchingException,
  truncateRecurringSeries,
} from "./event-model.js";

export async function listCalendars(client) {
  const calendars = await client.fetchCalendars();

  return {
    success: true,
    calendars: calendars.map(calendarToDict),
    count: calendars.length,
  };
}

export async function listEvents(client, args, calendarAliases) {
  const range = buildEventsRange(args);
  const calendars = await resolveTargetCalendars(client, args.calendar, calendarAliases);
  const limit = Number(args.limit || 100);
  const events = await fetchExpandedEvents(client, calendars, range, limit);

  return {
    success: true,
    events,
    count: events.length,
    dateRange: {
      from: formatDate(range.start),
      to: formatDate(range.end),
    },
  };
}

export async function searchEvents(client, args, calendarAliases) {
  const range = buildSearchRange(args);
  const calendars = await resolveTargetCalendars(client, args.calendar, calendarAliases);
  const limit = Number(args.limit || 50);
  const query = String(args.query).trim().toLowerCase();
  const events = await fetchExpandedEvents(client, calendars, range, limit * 4);

  const filtered = events
    .filter((event) => {
      const haystack = [
        event.title,
        event.notes,
        event.location,
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return haystack.includes(query);
    })
    .slice(0, limit);

  return {
    success: true,
    query: args.query,
    events: filtered,
    count: filtered.length,
  };
}

export async function getEvent(client, id) {
  const parsedId = parseEventId(id);
  const { calendar, calendarObject } = await fetchCalendarObjectByUrl(client, parsedId.objectUrl);

  if (!parsedId.occurrenceKey) {
    const event = parseSingleObjectEvent(calendar, calendarObject);
    return {
      success: true,
      event,
    };
  }

  const occurrenceDate = icalKeyToDate(parsedId.occurrenceKey);
  if (!occurrenceDate) {
    throw new Error(`invalid occurrence key in event id: ${id}`);
  }

  const range = occurrenceWindow(occurrenceDate);
  const objects = await client.fetchCalendarObjects({
    calendar,
    objectUrls: [parsedId.objectUrl],
    timeRange: {
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    },
    expand: true,
  });
  const object = objects[0];
  if (!object) {
    throw new Error(`event not found: ${id}`);
  }

  const events = parseCalendarObjectEvents(calendar, object, true);
  const event = events.find((entry) => entry._occurrenceKey === parsedId.occurrenceKey);
  if (!event) {
    throw new Error(`event not found: ${id}`);
  }

  delete event._occurrenceKey;
  return {
    success: true,
    event,
  };
}

export async function createEvent(client, args, calendarAliases) {
  if (!args.title) throw new Error("event title is required for calendar create");
  if (!args.start) throw new Error("event start is required for calendar create");

  const payload = normalizeEventInput(args, args.calendar);
  const calendar = await resolveSingleCalendar(client, payload.calendar, calendarAliases);
  const filename = `${randomUUID()}.ics`;
  const objectUrl = new URL(filename, calendar.url).href;
  const iCalString = buildCalendarObjectData(payload);

  const response = await client.createCalendarObject({
    calendar,
    filename,
    iCalString,
  });
  if (!response.ok) {
    throw new Error(`caldav create failed with status ${response.status}`);
  }

  const created = await fetchCalendarObjectByUrl(client, objectUrl, [calendar]);
  const event = parseSingleObjectEvent(created.calendar, created.calendarObject);

  return {
    success: true,
    message: "event created successfully",
    event,
    verification: buildVerification(event, payload),
  };
}

export async function batchCreateEvents(client, args, calendarAliases) {
  const created = [];
  const errors = [];

  for (const [index, eventInput] of args.events.entries()) {
    try {
      const payload = normalizeEventInput(eventInput, eventInput.calendar || args.calendar);
      const calendar = await resolveSingleCalendar(client, payload.calendar, calendarAliases);
      const filename = `${randomUUID()}.ics`;
      const objectUrl = new URL(filename, calendar.url).href;
      const iCalString = buildCalendarObjectData(payload);

      const response = await client.createCalendarObject({
        calendar,
        filename,
        iCalString,
      });
      if (!response.ok) {
        throw new Error(`caldav create failed with status ${response.status}`);
      }

      const createdObject = await fetchCalendarObjectByUrl(client, objectUrl, [calendar]);
      created.push(parseSingleObjectEvent(createdObject.calendar, createdObject.calendarObject));
    } catch (error) {
      errors.push({
        index,
        title: eventInput.title || "",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    success: errors.length === 0,
    message: "batch create completed",
    created,
    createdCount: created.length,
    errors,
    errorCount: errors.length,
  };
}

export async function updateEvent(client, args, calendarAliases) {
  const parsedId = parseEventId(args.id);
  const { calendar: sourceCalendar, calendarObject } = await fetchCalendarObjectByUrl(client, parsedId.objectUrl);
  const root = ICAL.Component.fromString(calendarObject.data);
  const masterComponent = getMasterVevent(root);
  if (!masterComponent) {
    throw new Error(`event not found: ${args.id}`);
  }

  const destinationCalendar = args.calendar
    ? await resolveSingleCalendar(client, args.calendar, calendarAliases)
    : sourceCalendar;
  const patch = normalizeUpdateInput(args);

  if (parsedId.occurrenceKey) {
    applyOccurrenceUpdate(root, masterComponent, parsedId.occurrenceKey, patch);
  } else {
    applyMasterUpdate(masterComponent, patch);
  }

  let savedUrl = calendarObject.url;

  if (destinationCalendar.url !== sourceCalendar.url) {
    rekeyCalendarObject(root);
    const filename = `${randomUUID()}.ics`;
    const createResponse = await client.createCalendarObject({
      calendar: destinationCalendar,
      filename,
      iCalString: root.toString(),
    });
    if (!createResponse.ok) {
      throw new Error(`caldav move failed with status ${createResponse.status}`);
    }
    const deleteResponse = await client.deleteCalendarObject({ calendarObject });
    if (!deleteResponse.ok) {
      throw new Error(`caldav cleanup delete failed with status ${deleteResponse.status}`);
    }
    savedUrl = new URL(filename, destinationCalendar.url).href;
  } else {
    calendarObject.data = root.toString();
    const updateResponse = await client.updateCalendarObject({ calendarObject });
    if (!updateResponse.ok) {
      throw new Error(`caldav update failed with status ${updateResponse.status}`);
    }
  }

  const saved = await fetchCalendarObjectByUrl(client, savedUrl, [destinationCalendar]);
  const event = parsedId.occurrenceKey
    ? await readOccurrenceAfterSave(client, saved.calendar, saved.calendarObject, parsedId.occurrenceKey)
    : parseSingleObjectEvent(saved.calendar, saved.calendarObject);

  return {
    success: true,
    message: "event updated successfully",
    event,
    verification: buildVerification(event, buildUpdateVerificationInput(args, event)),
  };
}

export async function deleteEvent(client, args) {
  const parsedId = parseEventId(args.id);
  const { calendar, calendarObject } = await fetchCalendarObjectByUrl(client, parsedId.objectUrl);

  if (!parsedId.occurrenceKey) {
    const deletedEvent = parseSingleObjectEvent(calendar, calendarObject);
    const response = await client.deleteCalendarObject({ calendarObject });
    if (!response.ok) {
      throw new Error(`caldav delete failed with status ${response.status}`);
    }
    return {
      success: true,
      message: "event deleted successfully",
      deletedEvent,
    };
  }

  const root = ICAL.Component.fromString(calendarObject.data);
  const masterComponent = getMasterVevent(root);
  if (!masterComponent) {
    throw new Error(`event not found: ${args.id}`);
  }

  const deletedEvent = await readOccurrenceAfterSave(client, calendar, calendarObject, parsedId.occurrenceKey);
  if (args.futureEvents) {
    truncateRecurringSeries(masterComponent, parsedId.occurrenceKey);
    removeFutureExceptions(root, parsedId.occurrenceKey);
  } else {
    addExdate(masterComponent, parsedId.occurrenceKey);
    removeMatchingException(root, parsedId.occurrenceKey);
  }
  calendarObject.data = root.toString();

  const response = await client.updateCalendarObject({ calendarObject });
  if (!response.ok) {
    throw new Error(`caldav delete failed with status ${response.status}`);
  }

  return {
    success: true,
    message: "event deleted successfully",
    deletedEvent,
  };
}

export function buildEventsRange(args) {
  const now = new Date();
  const start =
    args.lastDays !== undefined
      ? addDays(now, -Number(args.lastDays))
      : args.from
        ? parseUserDate(args.from)
        : startOfDay(now);
  if (!start) {
    throw new Error(`invalid start date: ${args.from}`);
  }

  const end =
    args.nextDays !== undefined
      ? addDays(now, Number(args.nextDays))
      : args.to
        ? parseUserDate(args.to, start)
        : addDays(start, 7);
  if (!end) {
    throw new Error(`invalid end date: ${args.to}`);
  }

  return { start, end };
}

export function buildSearchRange(args) {
  const now = new Date();
  const start = args.from ? parseUserDate(args.from) : addDays(now, -30);
  const end = args.to ? parseUserDate(args.to, start || now) : addYears(now, 1);
  if (!start) throw new Error(`invalid start date: ${args.from}`);
  if (!end) throw new Error(`invalid end date: ${args.to}`);
  return { start, end };
}

async function fetchExpandedEvents(client, calendars, range, limit) {
  const responses = await Promise.all(
    calendars.map(async (calendar) => {
      const objects = await client.fetchCalendarObjects({
        calendar,
        timeRange: {
          start: range.start.toISOString(),
          end: range.end.toISOString(),
        },
        expand: true,
      });
      return objects.flatMap((object) => parseCalendarObjectEvents(calendar, object, true));
    })
  );

  return responses
    .flat()
    .sort((left, right) => left._sortStartMs - right._sortStartMs)
    .slice(0, limit)
    .map((event) => {
      const clone = { ...event };
      delete clone._occurrenceKey;
      delete clone._sortStartMs;
      return clone;
    });
}

async function readOccurrenceAfterSave(client, calendar, calendarObject, occurrenceKey) {
  const date = icalKeyToDate(occurrenceKey);
  if (!date) {
    throw new Error(`invalid occurrence key: ${occurrenceKey}`);
  }
  const range = occurrenceWindow(date);
  const objects = await client.fetchCalendarObjects({
    calendar,
    objectUrls: [calendarObject.url],
    timeRange: {
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    },
    expand: true,
  });
  const object = objects[0];
  if (!object) {
    throw new Error(`event not found after update: ${calendarObject.url}`);
  }
  const events = parseCalendarObjectEvents(calendar, object, true);
  const event = events.find((entry) => entry._occurrenceKey === occurrenceKey);
  if (!event) {
    throw new Error(`event occurrence not found after update: ${occurrenceKey}`);
  }
  delete event._occurrenceKey;
  return event;
}
