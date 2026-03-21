import ICAL from "ical.js";
import { randomUUID } from "crypto";
import {
  PRODID,
  WEEKDAY_TO_ICAL,
  addDays,
  buildEventId,
  buildSeriesUntilBeforeOccurrence,
  ensureParsedDate,
  formatDate,
  icalDayToLong,
  icalKeyToDate,
  icalKeyToTime,
  normalize,
  normalizeAllDayBounds,
  parseUserDate,
  removeAllProperties,
  removeAllSubcomponents,
  toICALTime,
} from "./common.js";

export function parseSingleObjectEvent(calendar, calendarObject) {
  const events = parseCalendarObjectEvents(calendar, calendarObject, false);
  const event = events[0];
  if (!event) {
    throw new Error(`calendar object contained no events: ${calendarObject.url}`);
  }
  return stripInternalKeys(event);
}

export function parseCalendarObjectEvents(calendar, calendarObject, expanded) {
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

export function buildCalendarObjectData(eventInput) {
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

export function applyMasterUpdate(component, args) {
  applyEventMutations(component, args);
}

export function applyOccurrenceUpdate(root, masterComponent, occurrenceKey, args) {
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

export function normalizeEventInput(input, calendarOverride) {
  const allDay = Boolean(input.allDay);
  let startDate = parseUserDate(input.start);
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

  if (allDay) {
    ({ startDate, endDate } = normalizeAllDayBounds(startDate, endDate, Boolean(input.end)));
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

export function normalizeUpdateInput(input) {
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

export function buildUpdateVerificationInput(args, savedEvent) {
  return {
    start: args.start,
    startDate: args.start ? ensureParsedDate(args.start, "invalid start date") : ensureParsedDate(savedEvent.startDate, "invalid stored start date"),
    end: args.end,
    endDate: args.end ? ensureParsedDate(args.end, "invalid end date") : ensureParsedDate(savedEvent.endDate, "invalid stored end date"),
    calendar: args.calendar,
  };
}

export function buildVerification(event, requested) {
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

export function truncateRecurringSeries(masterComponent, occurrenceKey) {
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

export function addExdate(masterComponent, occurrenceKey) {
  const exdate = icalKeyToTime(occurrenceKey);
  if (!exdate) {
    throw new Error(`invalid recurrence key: ${occurrenceKey}`);
  }

  const property = new ICAL.Property("exdate");
  property.setValue(exdate);
  masterComponent.addProperty(property);
}

export function removeMatchingException(root, occurrenceKey) {
  const match = findMatchingException(root, occurrenceKey);
  if (match) {
    root.removeSubcomponent(match);
  }
}

export function removeFutureExceptions(root, occurrenceKey) {
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

export function rekeyCalendarObject(root) {
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

export function getMasterVevent(root) {
  return root.getAllSubcomponents("vevent").find((component) => !component.hasProperty("recurrence-id"))
    || root.getFirstSubcomponent("vevent");
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

  let nextStartDate = input.startDate || null;
  let nextEndDate = input.endDate || null;
  if (input.allDay !== undefined) {
    nextStartDate ||= event.startDate.toJSDate();
    nextEndDate ||= event.endDate.toJSDate();
  }

  if (nextAllDay && nextStartDate && nextEndDate) {
    ({ startDate: nextStartDate, endDate: nextEndDate } = normalizeAllDayBounds(
      nextStartDate,
      nextEndDate,
      input.endDate !== undefined
    ));
  }

  if (nextStartDate) {
    event.startDate = toICALTime(nextStartDate, nextAllDay);
  }
  if (nextEndDate) {
    event.endDate = toICALTime(nextEndDate, nextAllDay);
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

function findMatchingException(root, occurrenceKey) {
  return root.getAllSubcomponents("vevent").find((component) => {
    const recurrenceId = component.getFirstPropertyValue("recurrence-id");
    return recurrenceId && recurrenceId.toICALString() === occurrenceKey;
  });
}

function cloneComponent(component) {
  return new ICAL.Component(JSON.parse(JSON.stringify(component.toJSON())));
}
