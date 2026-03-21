import {
  createCalendarObject as rawCreateCalendarObject,
  deleteCalendarObject as rawDeleteCalendarObject,
  fetchCalendarObjects as rawFetchCalendarObjects,
  fetchCalendars as rawFetchCalendars,
  getBasicAuthHeaders,
  updateCalendarObject as rawUpdateCalendarObject,
} from "tsdav";
import ICAL from "ical.js";
import * as chrono from "chrono-node";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { basename, join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

const DEFAULT_SERVER_URL = "https://caldav.icloud.com";
const DEFAULT_PASSWORD_ENV_VAR = "ICLOUD_APP_SPECIFIC_PASSWORD";
const DEFAULT_TIMEOUT_MS = 30_000;
const PRODID = "-//apple-pim//icloud caldav//en";

const WEEKDAY_TO_ICAL = {
  sunday: "SU",
  sun: "SU",
  monday: "MO",
  mon: "MO",
  tuesday: "TU",
  tue: "TU",
  wednesday: "WE",
  wed: "WE",
  thursday: "TH",
  thu: "TH",
  friday: "FR",
  fri: "FR",
  saturday: "SA",
  sat: "SA",
};

let cachedAccountInfo;
let cachedClientKey;
let cachedClientPromise;

export function createCalDAVCalendarHandler(config = {}, overrides = {}) {
  return async function handleCalendarCalDAV(args) {
    const settings = resolveCalDAVSettings(config);
    const calendarAliases = resolveCalendarAliases(config);
    const client = overrides.client || await getCalDAVClient(settings);

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

function resolveCalendarAliases(config = {}) {
  const aliases = {};
  const aliasesFile = config.calendarAliasesFile || process.env.APPLE_PIM_CALENDAR_ALIASES_FILE;

  if (aliasesFile) {
    const expandedPath = aliasesFile.replace(/^~/, homedir());
    if (!existsSync(expandedPath)) {
      throw new Error(`calendar aliases file not found: ${expandedPath}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(readFileSync(expandedPath, "utf8"));
    } catch (error) {
      throw new Error(
        `calendar aliases file is not valid JSON: ${expandedPath} (${error instanceof Error ? error.message : String(error)})`
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`calendar aliases file must contain a JSON object: ${expandedPath}`);
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string" || !value.trim()) continue;
      aliases[normalizeAliasKey(key)] = value.trim();
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("APPLE_PIM_CALENDAR_ALIAS_")) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    const aliasKey = key.slice("APPLE_PIM_CALENDAR_ALIAS_".length);
    if (!aliasKey) continue;
    aliases[normalizeAliasKey(aliasKey)] = value.trim();
  }

  return aliases;
}

function resolveCalDAVSettings(config = {}) {
  const accountInfo = readMobileMeCalendarAccountInfo();
  const passwordEnvVar = config.caldavPasswordEnvVar || DEFAULT_PASSWORD_ENV_VAR;
  const username =
    config.caldavUsername ||
    process.env.ICLOUD_APPLE_ID ||
    accountInfo.username ||
    accountInfo.accountId ||
    "";
  const password =
    config.caldavPassword ||
    (passwordEnvVar ? process.env[passwordEnvVar] : undefined) ||
    "";
  const serverUrl =
    config.caldavServerUrl ||
    process.env.ICLOUD_CALDAV_URL ||
    accountInfo.serverUrl ||
    DEFAULT_SERVER_URL;
  const timeoutMs = Number(config.caldavTimeoutMs || DEFAULT_TIMEOUT_MS);

  if (!username) {
    throw new Error(
      "icloud caldav backend needs an apple id username. set apple-pim-cli.caldavUsername or ICLOUD_APPLE_ID."
    );
  }
  if (!password) {
    throw new Error(
      `icloud caldav backend needs an app-specific password. set apple-pim-cli.caldavPassword or export ${passwordEnvVar}.`
    );
  }

  return {
    username,
    password,
    serverUrl,
    timeoutMs,
  };
}

function readMobileMeCalendarAccountInfo() {
  if (cachedAccountInfo) return cachedAccountInfo;

  const plistPath = join(homedir(), "Library", "Preferences", "MobileMeAccounts.plist");
  if (!existsSync(plistPath)) {
    cachedAccountInfo = {};
    return cachedAccountInfo;
  }

  try {
    const json = execFileSync("plutil", ["-convert", "json", "-o", "-", plistPath], {
      encoding: "utf8",
    });
    const parsed = JSON.parse(json);
    const account = Array.isArray(parsed.Accounts) ? parsed.Accounts[0] : null;
    const services = Array.isArray(account?.Services) ? account.Services : [];
    const calendarService = services.find((service) => service?.Name === "CALENDAR");
    cachedAccountInfo = {
      username: account?.AccountDescription || account?.AccountID || "",
      accountId: account?.AccountID || "",
      accountDsid: account?.AccountDSID || "",
      serverUrl: calendarService?.url || "",
    };
  } catch {
    cachedAccountInfo = {};
  }

  return cachedAccountInfo;
}

async function getCalDAVClient(settings) {
  const key = JSON.stringify({
    username: settings.username,
    password: settings.password,
    serverUrl: settings.serverUrl,
    timeoutMs: settings.timeoutMs,
  });

  if (cachedClientPromise && cachedClientKey === key) {
    return cachedClientPromise;
  }

  cachedClientKey = key;
  cachedClientPromise = Promise.resolve(createLowLevelCalDAVClient(settings));

  return cachedClientPromise;
}

function createLowLevelCalDAVClient(settings) {
  const fetchOverride = buildTimedFetch(settings.timeoutMs);
  const headers = getBasicAuthHeaders({
    username: settings.username,
    password: settings.password,
  });
  const account = buildCalDAVAccount(settings);

  return {
    account,
    headers,
    async fetchCalendars() {
      return rawFetchCalendars({
        account,
        headers,
        fetch: fetchOverride,
      });
    },
    async fetchCalendarObjects(params) {
      return rawFetchCalendarObjects({
        ...params,
        headers,
        fetch: fetchOverride,
      });
    },
    async createCalendarObject(params) {
      return rawCreateCalendarObject({
        ...params,
        headers,
        fetch: fetchOverride,
      });
    },
    async updateCalendarObject(params) {
      return rawUpdateCalendarObject({
        ...params,
        headers,
        fetch: fetchOverride,
      });
    },
    async deleteCalendarObject(params) {
      return rawDeleteCalendarObject({
        ...params,
        headers,
        fetch: fetchOverride,
      });
    },
  };
}

function buildCalDAVAccount(settings) {
  const accountInfo = readMobileMeCalendarAccountInfo();
  const dsid = accountInfo.accountDsid;
  if (!dsid) {
    throw new Error("icloud caldav backend could not find AccountDSID in MobileMeAccounts.plist");
  }

  const rootUrl = ensureTrailingSlash(settings.serverUrl);
  return {
    accountType: "caldav",
    serverUrl: rootUrl,
    credentials: {
      username: settings.username,
      password: settings.password,
    },
    rootUrl,
    principalUrl: new URL(`${dsid}/principal/`, rootUrl).href,
    homeUrl: new URL(`${dsid}/calendars/`, rootUrl).href,
  };
}

function buildTimedFetch(timeoutMs) {
  return async function timedFetch(input, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("caldav request timed out")), timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        signal: init.signal || controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

async function listCalendars(client) {
  const calendars = await client.fetchCalendars();

  return {
    success: true,
    calendars: calendars.map(calendarToDict),
    count: calendars.length,
  };
}

async function listEvents(client, args, calendarAliases) {
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

async function searchEvents(client, args, calendarAliases) {
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

async function getEvent(client, id) {
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

async function createEvent(client, args, calendarAliases) {
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

async function batchCreateEvents(client, args, calendarAliases) {
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

async function updateEvent(client, args, calendarAliases) {
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

async function deleteEvent(client, args) {
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

function buildEventsRange(args) {
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

function buildSearchRange(args) {
  const now = new Date();
  const start = args.from ? parseUserDate(args.from) : addDays(now, -30);
  const end = args.to ? parseUserDate(args.to, start || now) : addYears(now, 1);
  if (!start) throw new Error(`invalid start date: ${args.from}`);
  if (!end) throw new Error(`invalid end date: ${args.to}`);
  return { start, end };
}

async function resolveTargetCalendars(client, requestedCalendar, calendarAliases) {
  const calendars = await client.fetchCalendars();
  if (!requestedCalendar) return calendars;
  return [findCalendar(calendars, requestedCalendar, calendarAliases)];
}

async function resolveSingleCalendar(client, requestedCalendar, calendarAliases) {
  const calendars = await client.fetchCalendars();
  if (requestedCalendar) return findCalendar(calendars, requestedCalendar, calendarAliases);

  const preferred = calendars.find((calendar) => normalize(calendar.displayName) === "daily plan")
    || calendars.find((calendar) => normalize(calendar.displayName) === "shared");
  if (!preferred) {
    throw new Error("no default writable icloud calendar found. specify calendar explicitly.");
  }
  return preferred;
}

function findCalendar(calendars, requested, calendarAliases = null) {
  const resolvedRequested = resolveCalendarAliasTarget(requested, calendarAliases);
  const needle = normalize(resolvedRequested);
  const match = calendars.find((calendar) => {
    const displayName = normalize(calendar.displayName);
    const url = normalize(calendar.url);
    const path = normalize(new URL(calendar.url).pathname);
    return displayName === needle || url === needle || path === needle;
  });
  if (!match) {
    throw new Error(`calendar not found: ${requested}`);
  }
  return match;
}

function calendarToDict(calendar) {
  return {
    id: calendar.url,
    title: calendar.displayName,
    type: "caldav",
    color: [],
    allowsModifications: isWritableCalendar(calendar),
    source: "iCloud",
    url: calendar.url,
  };
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
    .map(stripInternalKeys);
}

function parseSingleObjectEvent(calendar, calendarObject) {
  const events = parseCalendarObjectEvents(calendar, calendarObject, false);
  const event = events[0];
  if (!event) {
    throw new Error(`calendar object contained no events: ${calendarObject.url}`);
  }
  return stripInternalKeys(event);
}

function parseCalendarObjectEvents(calendar, calendarObject, expanded) {
  const root = ICAL.Component.fromString(calendarObject.data);
  const vevents = root.getAllSubcomponents("vevent");
  if (vevents.length === 0) return [];

  const master = getMasterVevent(root);
  const masterEvent = master ? new ICAL.Event(master) : null;
  const masterRecurring = Boolean(masterEvent?.isRecurring?.());

  return vevents
    .filter((component) => component.name === "vevent")
    .map((component) => {
      const event = new ICAL.Event(component);
      const recurrenceId = component.getFirstPropertyValue("recurrence-id");
      const occurrenceKey = recurrenceId
        ? recurrenceId.toICALString()
        : (expanded && masterRecurring ? event.startDate.toICALString() : null);
      const id = buildEventId(calendarObject.url, occurrenceKey);
      const start = event.startDate.toJSDate();
      const end = event.endDate.toJSDate();

      return {
        id,
        _occurrenceKey: occurrenceKey,
        _sortStartMs: start.getTime(),
        objectUrl: calendarObject.url,
        etag: calendarObject.etag,
        title: event.summary || "",
        startDate: formatDate(start),
        endDate: formatDate(end),
        isAllDay: Boolean(event.startDate.isDate),
        calendar: calendar.displayName,
        calendarId: calendar.url,
        ...(event.location ? { location: event.location } : {}),
        ...(event.description ? { notes: event.description } : {}),
        ...(component.getFirstPropertyValue("url")
          ? { url: String(component.getFirstPropertyValue("url")) }
          : {}),
        ...buildRecurrenceOutput(component),
        ...buildAlarmOutput(component),
      };
    });
}

function stripInternalKeys(event) {
  const clone = { ...event };
  delete clone._occurrenceKey;
  delete clone._sortStartMs;
  return clone;
}

function buildRecurrenceOutput(component) {
  const rules = component.getAllProperties("rrule");
  if (rules.length === 0) return {};

  return {
    recurrence: rules.map((rule) => {
      const recur = rule.getFirstValue();
      const json = recur?.toJSON?.() || {};
      const daysOfTheWeek = Array.isArray(json.byday)
        ? json.byday.map((value) => icalDayToLong(value))
        : json.byday
          ? [icalDayToLong(json.byday)]
          : undefined;
      const daysOfTheMonth = Array.isArray(json.bymonthday)
        ? json.bymonthday
        : json.bymonthday !== undefined
          ? [json.bymonthday]
          : undefined;

      return {
        frequency: String(json.freq || "").toLowerCase(),
        interval: json.interval || 1,
        ...(json.until ? { endDate: formatDate(parseUserDate(json.until) || new Date(json.until)) } : {}),
        ...(json.count ? { occurrenceCount: json.count } : {}),
        ...(daysOfTheWeek?.length ? { daysOfTheWeek } : {}),
        ...(daysOfTheMonth?.length ? { daysOfTheMonth } : {}),
      };
    }),
  };
}

function buildAlarmOutput(component) {
  const alarms = component.getAllSubcomponents("valarm");
  if (alarms.length === 0) return {};

  return {
    alarms: alarms
      .map((alarm) => {
        const trigger = alarm.getFirstPropertyValue("trigger");
        if (!trigger) return null;
        if (typeof trigger.toSeconds === "function") {
          return { relativeOffset: trigger.toSeconds() };
        }
        return { absolute: String(trigger) };
      })
      .filter(Boolean),
  };
}

function buildCalendarObjectData(eventInput) {
  const vcalendar = new ICAL.Component("vcalendar");
  vcalendar.addPropertyWithValue("version", "2.0");
  vcalendar.addPropertyWithValue("prodid", PRODID);
  vcalendar.addPropertyWithValue("calscale", "GREGORIAN");

  const vevent = new ICAL.Component("vevent");
  vcalendar.addSubcomponent(vevent);
  applyBaseEventFields(vevent, eventInput, randomUUID());
  applyEventMutations(vevent, eventInput);

  return vcalendar.toString();
}

function applyMasterUpdate(component, args) {
  applyEventMutations(component, args);
}

function applyOccurrenceUpdate(root, masterComponent, occurrenceKey, args) {
  const exception = findMatchingException(root, occurrenceKey) || cloneComponent(masterComponent);
  const recurrenceTime = icalKeyToTime(occurrenceKey);
  if (!recurrenceTime) {
    throw new Error(`invalid occurrence key: ${occurrenceKey}`);
  }

  if (!findMatchingException(root, occurrenceKey)) {
    removeAllProperties(exception, "rrule");
    exception.addPropertyWithValue("recurrence-id", recurrenceTime);
    if (args.futureEvents) {
      const recurrenceId = exception.getFirstProperty("recurrence-id");
      recurrenceId?.setParameter("RANGE", "THISANDFUTURE");
    }
    root.addSubcomponent(exception);
  }

  applyEventMutations(exception, args);
}

function applyBaseEventFields(component, input, uid) {
  const event = new ICAL.Event(component);
  event.uid = uid;
  event.startDate = toICALTime(input.startDate, input.allDay);
  event.endDate = toICALTime(input.endDate, input.allDay);
  component.addPropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
}

function applyEventMutations(component, input) {
  const event = new ICAL.Event(component);
  const nextAllDay = input.allDay ?? event.startDate.isDate;

  if (input.title !== undefined) {
    event.summary = input.title || "";
  }
  if (input.startDate) {
    event.startDate = toICALTime(input.startDate, nextAllDay);
  } else if (input.allDay !== undefined) {
    event.startDate = toICALTime(event.startDate.toJSDate(), nextAllDay);
  }
  if (input.endDate) {
    event.endDate = toICALTime(input.endDate, nextAllDay);
  } else if (input.allDay !== undefined) {
    event.endDate = toICALTime(event.endDate.toJSDate(), nextAllDay);
  }
  if (input.location !== undefined) {
    setOrRemoveTextProperty(component, "location", input.location);
  }
  if (input.notes !== undefined) {
    setOrRemoveTextProperty(component, "description", input.notes);
  }
  if (input.url !== undefined) {
    setOrRemoveTextProperty(component, "url", input.url);
  }
  if (input.recurrence !== undefined) {
    setRecurrence(component, input.recurrence);
  }
  if (input.alarm !== undefined) {
    setAlarms(component, input.alarm || []);
  }
}

function setOrRemoveTextProperty(component, name, value) {
  removeAllProperties(component, name);
  if (value) {
    component.addPropertyWithValue(name, value);
  }
}

function setRecurrence(component, recurrence) {
  removeAllProperties(component, "rrule");
  if (!recurrence || normalize(recurrence.frequency) === "none") {
    return;
  }

  const recurData = {
    freq: String(recurrence.frequency).toUpperCase(),
    interval: Number(recurrence.interval || 1),
  };

  if (recurrence.endDate) {
    const endDate = parseUserDate(recurrence.endDate);
    if (!endDate) throw new Error(`invalid recurrence end date: ${recurrence.endDate}`);
    recurData.until = ICAL.Time.fromJSDate(endDate, true);
  } else if (recurrence.occurrenceCount) {
    recurData.count = Number(recurrence.occurrenceCount);
  }

  if (Array.isArray(recurrence.daysOfTheWeek) && recurrence.daysOfTheWeek.length > 0) {
    recurData.byday = recurrence.daysOfTheWeek
      .map((day) => WEEKDAY_TO_ICAL[String(day).toLowerCase()])
      .filter(Boolean);
  }

  if (Array.isArray(recurrence.daysOfTheMonth) && recurrence.daysOfTheMonth.length > 0) {
    recurData.bymonthday = recurrence.daysOfTheMonth.map((day) => Number(day));
  }

  component.addPropertyWithValue("rrule", ICAL.Recur.fromData(recurData));
}

function setAlarms(component, alarms) {
  removeAllSubcomponents(component, "valarm");

  for (const minutes of alarms) {
    const alarm = new ICAL.Component("valarm");
    alarm.addPropertyWithValue("action", "DISPLAY");
    alarm.addPropertyWithValue("description", "Reminder");
    const duration = ICAL.Duration.fromSeconds(Number(minutes) * -60);
    alarm.addPropertyWithValue("trigger", duration);
    component.addSubcomponent(alarm);
  }
}

function addExdate(masterComponent, occurrenceKey) {
  const exdate = icalKeyToTime(occurrenceKey);
  if (!exdate) {
    throw new Error(`invalid recurrence key: ${occurrenceKey}`);
  }

  const property = new ICAL.Property("exdate");
  property.setValue(exdate);
  masterComponent.addProperty(property);
}

function findMatchingException(root, occurrenceKey) {
  return root.getAllSubcomponents("vevent").find((component) => {
    const recurrenceId = component.getFirstPropertyValue("recurrence-id");
    return recurrenceId && recurrenceId.toICALString() === occurrenceKey;
  });
}

function removeMatchingException(root, occurrenceKey) {
  const match = findMatchingException(root, occurrenceKey);
  if (match) {
    root.removeSubcomponent(match);
  }
}

function removeFutureExceptions(root, occurrenceKey) {
  const cutoff = icalKeyToDate(occurrenceKey);
  if (!cutoff) {
    throw new Error(`invalid recurrence key: ${occurrenceKey}`);
  }

  for (const component of [...root.getAllSubcomponents("vevent")]) {
    const recurrenceId = component.getFirstPropertyValue("recurrence-id");
    if (!recurrenceId) continue;
    if (recurrenceId.toJSDate() >= cutoff) {
      root.removeSubcomponent(component);
    }
  }
}

function cloneComponent(component) {
  return new ICAL.Component(JSON.parse(JSON.stringify(component.toJSON())));
}

function rekeyCalendarObject(root) {
  const newUid = randomUUID();
  const stamp = ICAL.Time.fromJSDate(new Date(), true);

  for (const component of root.getAllSubcomponents("vevent")) {
    const uid = component.getFirstProperty("uid");
    if (uid) {
      uid.setValue(newUid);
    } else {
      component.addPropertyWithValue("uid", newUid);
    }
    component.updatePropertyWithValue("dtstamp", stamp);
  }
}

function getMasterVevent(root) {
  return root.getAllSubcomponents("vevent").find((component) => !component.hasProperty("recurrence-id"))
    || root.getFirstSubcomponent("vevent");
}

async function fetchCalendarObjectByUrl(client, objectUrl, preferredCalendars = null) {
  const calendars = preferredCalendars || await client.fetchCalendars();
  const calendar = calendars.find((entry) => objectUrl.startsWith(entry.url))
    || await findCalendarForObjectUrl(client, calendars, objectUrl);
  if (!calendar) {
    throw new Error(`calendar object not found: ${objectUrl}`);
  }

  const objects = await client.fetchCalendarObjects({
    calendar,
    objectUrls: [objectUrl],
  });
  const calendarObject = objects.find((entry) => entry.url === objectUrl) || objects[0];

  if (!calendarObject) {
    throw new Error(`calendar object not found: ${objectUrl}`);
  }

  return { calendar, calendarObject };
}

async function findCalendarForObjectUrl(client, calendars, objectUrl) {
  for (const calendar of calendars) {
    try {
      const objects = await client.fetchCalendarObjects({
        calendar,
        objectUrls: [objectUrl],
      });
      if (objects.length > 0) return calendar;
    } catch {
      // keep scanning
    }
  }
  return null;
}

function normalizeEventInput(input, calendarOverride) {
  const allDay = Boolean(input.allDay);
  const startDate = parseUserDate(input.start);
  if (!startDate) {
    throw new Error(`invalid start date: ${input.start}`);
  }

  let endDate;
  if (input.end) {
    endDate = parseUserDate(input.end, startDate);
    if (!endDate) {
      throw new Error(`invalid end date: ${input.end}`);
    }
  } else if (input.duration !== undefined) {
    endDate = new Date(startDate.getTime() + Number(input.duration) * 60_000);
  } else {
    endDate = new Date(startDate.getTime() + 60 * 60_000);
  }

  return {
    title: input.title,
    startDate,
    endDate,
    calendar: calendarOverride,
    location: input.location,
    notes: input.notes,
    url: input.url,
    allDay,
    alarm: Array.isArray(input.alarm) ? input.alarm : undefined,
    recurrence: input.recurrence,
  };
}

function normalizeUpdateInput(input) {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.start !== undefined
      ? { startDate: ensureParsedDate(input.start, "invalid start date") }
      : {}),
    ...(input.end !== undefined
      ? { endDate: ensureParsedDate(input.end, "invalid end date") }
      : {}),
    ...(input.location !== undefined ? { location: input.location } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.allDay !== undefined ? { allDay: Boolean(input.allDay) } : {}),
    ...(input.recurrence !== undefined ? { recurrence: input.recurrence } : {}),
    ...(input.alarm !== undefined ? { alarm: input.alarm } : {}),
  };
}

function buildUpdateVerificationInput(args, savedEvent) {
  return {
    start: args.start,
    startDate: args.start ? ensureParsedDate(args.start, "invalid start date") : ensureParsedDate(savedEvent.startDate, "invalid stored start date"),
    end: args.end,
    endDate: args.end ? ensureParsedDate(args.end, "invalid end date") : ensureParsedDate(savedEvent.endDate, "invalid stored end date"),
    calendar: args.calendar,
  };
}

function buildVerification(event, requested) {
  const requestedStart = requested.start || formatDate(requested.startDate);
  const requestedEnd = requested.end || formatDate(requested.endDate);
  const startMatch = normalize(event.startDate) === normalize(formatDate(requested.startDate));
  const endMatch = normalize(event.endDate) === normalize(formatDate(requested.endDate));
  const calendarMatch = requested.calendar
    ? normalize(event.calendar) === normalize(requested.calendar)
    : true;

  return {
    requestedStart,
    storedStart: event.startDate,
    startMatch,
    storedEnd: event.endDate,
    endMatch,
    ...(requested.calendar ? { requestedCalendar: requested.calendar, storedCalendar: event.calendar, calendarMatch } : {}),
    allFieldsMatch: startMatch && endMatch && calendarMatch,
  };
}

function parseUserDate(value, refDate = new Date()) {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return null;

  const parsed = chrono.parseDate(value, refDate);
  if (parsed) return parsed;

  const direct = new Date(value);
  return Number.isNaN(direct.getTime()) ? null : direct;
}

function ensureParsedDate(value, label) {
  const parsed = parseUserDate(value);
  if (!parsed) {
    throw new Error(`${label}: ${value}`);
  }
  return parsed;
}

function buildSeriesUntilBeforeOccurrence(occurrenceKey) {
  const occurrence = icalKeyToTime(occurrenceKey);
  if (!occurrence) {
    throw new Error(`invalid recurrence key: ${occurrenceKey}`);
  }

  if (occurrence.isDate) {
    const date = occurrence.toJSDate();
    date.setDate(date.getDate() - 1);
    return ICAL.Time.fromData({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      isDate: true,
    });
  }

  return ICAL.Time.fromJSDate(new Date(occurrence.toJSDate().getTime() - 1000), true);
}

function truncateRecurringSeries(masterComponent, occurrenceKey) {
  const until = buildSeriesUntilBeforeOccurrence(occurrenceKey);
  const rules = masterComponent.getAllProperties("rrule");
  if (rules.length === 0) {
    throw new Error("future occurrence delete requires an RRULE-backed recurring event");
  }

  for (const rule of rules) {
    const recur = rule.getFirstValue();
    const recurData = { ...(recur?.toJSON?.() || {}) };
    delete recurData.count;
    recurData.until = until;
    rule.setValue(ICAL.Recur.fromData(recurData));
  }
}

function toICALTime(date, allDay = false) {
  if (allDay) {
    return ICAL.Time.fromData({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      isDate: true,
    });
  }

  return ICAL.Time.fromJSDate(date, true);
}

function icalKeyToTime(key) {
  try {
    if (/^\d{8}$/.test(key)) {
      return ICAL.Time.fromDateString(`${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`);
    }
    if (/^\d{8}T\d{6}Z?$/.test(key)) {
      const normalized = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}T${key.slice(9, 11)}:${key.slice(11, 13)}:${key.slice(13, 15)}${key.endsWith("Z") ? "Z" : ""}`;
      return ICAL.Time.fromDateTimeString(normalized);
    }
    return ICAL.Time.fromString(key);
  } catch {
    return null;
  }
}

function icalKeyToDate(key) {
  const time = icalKeyToTime(key);
  return time ? time.toJSDate() : null;
}

function occurrenceWindow(date) {
  return {
    start: addDays(date, -1),
    end: addDays(date, 2),
  };
}

function buildEventId(objectUrl, occurrenceKey) {
  return occurrenceKey ? `${objectUrl}#${encodeURIComponent(occurrenceKey)}` : objectUrl;
}

function parseEventId(id) {
  const hashIndex = id.indexOf("#");
  if (hashIndex === -1) {
    return { objectUrl: id, occurrenceKey: null };
  }
  return {
    objectUrl: id.slice(0, hashIndex),
    occurrenceKey: decodeURIComponent(id.slice(hashIndex + 1)),
  };
}

function removeAllProperties(component, name) {
  component.getAllProperties(name).forEach((property) => component.removeProperty(property));
}

function removeAllSubcomponents(component, name) {
  component.getAllSubcomponents(name).forEach((child) => component.removeSubcomponent(child));
}

function icalDayToLong(value) {
  const day = String(value).slice(-2).toUpperCase();
  switch (day) {
    case "SU": return "sunday";
    case "MO": return "monday";
    case "TU": return "tuesday";
    case "WE": return "wednesday";
    case "TH": return "thursday";
    case "FR": return "friday";
    case "SA": return "saturday";
    default: return String(value).toLowerCase();
  }
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addYears(date, years) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

function formatDate(date) {
  const preset = String(process.env.APPLE_PIM_DATE_FORMAT || "utc").toLowerCase();
  const useLocal = preset === "local" || preset === "day-local";
  const useDay = preset === "day-utc" || preset === "day-local";

  const iso = useLocal ? formatLocalIso(date) : date.toISOString();
  if (!useDay) return iso;

  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: useLocal ? undefined : "UTC",
  }).format(date);

  return `${day}, ${iso}`;
}

function formatLocalIso(date) {
  const pad = (value) => String(value).padStart(2, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = pad(Math.floor(absOffset / 60));
  const offsetMins = pad(absOffset % 60);

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${offsetHours}:${offsetMins}`,
  ].join("");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAliasKey(value) {
  return normalize(String(value || "").replace(/[_-]+/g, " ").replace(/\s+/g, " "));
}

function isWritableCalendar(calendar) {
  const name = normalize(calendar?.displayName);
  return name === "daily plan" || name === "shared";
}

function resolveCalendarAliasTarget(requested, aliases) {
  if (!requested || !aliases) return requested;
  return aliases[normalizeAliasKey(requested)] || requested;
}

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}
