import ICAL from "ical.js";
import * as chrono from "chrono-node";

export const DEFAULT_SERVER_URL = "https://caldav.icloud.com";
export const DEFAULT_PASSWORD_ENV_VAR = "ICLOUD_APP_SPECIFIC_PASSWORD";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const PRODID = "-//apple-pim//icloud caldav//en";

export const WEEKDAY_TO_ICAL = {
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

export function parseUserDate(value, refDate = new Date()) {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return null;

  const parsed = chrono.parseDate(value, refDate);
  if (parsed) return parsed;

  const direct = new Date(value);
  return Number.isNaN(direct.getTime()) ? null : direct;
}

export function ensureParsedDate(value, label) {
  const parsed = parseUserDate(value);
  if (!parsed) {
    throw new Error(`${label}: ${value}`);
  }
  return parsed;
}

export function normalizeAllDayBounds(startDate, endDate, hasExplicitEnd = false) {
  const normalizedStart = startOfDay(startDate);
  let normalizedEnd = startOfDay(endDate);
  const endIsMidnight = endDate.getHours() === 0
    && endDate.getMinutes() === 0
    && endDate.getSeconds() === 0
    && endDate.getMilliseconds() === 0;

  if (hasExplicitEnd && !endIsMidnight) {
    normalizedEnd = addDays(normalizedEnd, 1);
  }
  if (normalizedEnd <= normalizedStart) {
    normalizedEnd = addDays(normalizedStart, 1);
  }

  return {
    startDate: normalizedStart,
    endDate: normalizedEnd,
  };
}

export function buildSeriesUntilBeforeOccurrence(occurrenceKey) {
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

export function toICALTime(date, allDay = false) {
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

export function icalKeyToTime(key) {
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

export function icalKeyToDate(key) {
  const time = icalKeyToTime(key);
  return time ? time.toJSDate() : null;
}

export function occurrenceWindow(date) {
  return {
    start: addDays(date, -1),
    end: addDays(date, 2),
  };
}

export function buildEventId(objectUrl, occurrenceKey) {
  return occurrenceKey ? `${objectUrl}#${encodeURIComponent(occurrenceKey)}` : objectUrl;
}

export function parseEventId(id) {
  const hashIndex = id.indexOf("#");
  if (hashIndex === -1) {
    return { objectUrl: id, occurrenceKey: null };
  }
  return {
    objectUrl: id.slice(0, hashIndex),
    occurrenceKey: decodeURIComponent(id.slice(hashIndex + 1)),
  };
}

export function removeAllProperties(component, name) {
  component.getAllProperties(name).forEach((property) => component.removeProperty(property));
}

export function removeAllSubcomponents(component, name) {
  component.getAllSubcomponents(name).forEach((child) => component.removeSubcomponent(child));
}

export function icalDayToLong(value) {
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

export function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addYears(date, years) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

export function formatDate(date) {
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

export function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeAliasKey(value) {
  return normalize(String(value || "").replace(/[_-]+/g, " ").replace(/\s+/g, " "));
}

export function resolveCalendarAliasTarget(requested, aliases) {
  if (!requested || !aliases) return requested;
  return aliases[normalizeAliasKey(requested)] || requested;
}

export function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

export function isWritableCalendar(calendar) {
  const name = normalize(calendar?.displayName);
  return name === "daily plan" || name === "shared";
}
