import { describe, expect, it } from "vitest";
import ICAL from "ical.js";
import { createCalDAVCalendarHandler } from "../../lib/handlers/calendar-caldav.js";

const BASE_CONFIG = {
  caldavUsername: "test@example.com",
  caldavPassword: "app-specific-password",
};

function makeClient({ calendars, objectsByUrl }) {
  return {
    async fetchCalendars() {
      return calendars;
    },
    async fetchCalendarObjects({ calendar, objectUrls }) {
      return objectUrls.map((url) => {
        const object = objectsByUrl.get(url);
        if (!object) return null;
        if (calendar && !url.startsWith(calendar.url)) return null;
        return object;
      }).filter(Boolean);
    },
    async updateCalendarObject({ calendarObject }) {
      objectsByUrl.set(calendarObject.url, {
        ...objectsByUrl.get(calendarObject.url),
        ...calendarObject,
      });
      return { ok: true, status: 204 };
    },
    async createCalendarObject({ calendar, filename, iCalString }) {
      const url = new URL(filename, calendar.url).href;
      objectsByUrl.set(url, {
        url,
        etag: "created",
        data: iCalString,
      });
      return { ok: true, status: 201 };
    },
    async deleteCalendarObject() {
      throw new Error("unexpected delete call");
    },
  };
}

describe("createCalDAVCalendarHandler", () => {
  it("deletes this and future recurring occurrences by truncating the series", async () => {
    const calendar = { displayName: "Daily Plan", url: "https://example.com/daily/" };
    const objectUrl = `${calendar.url}run.ics`;
    const occurrenceKey = "20260325T083000Z";
    const object = {
      url: objectUrl,
      etag: "1",
      data: `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//en
BEGIN:VEVENT
UID:run-series
DTSTAMP:20260321T010000Z
DTSTART:20260323T083000Z
DTEND:20260323T090000Z
RRULE:FREQ=DAILY;COUNT=5
SUMMARY:Run
END:VEVENT
BEGIN:VEVENT
UID:run-series
RECURRENCE-ID:20260325T083000Z
DTSTAMP:20260321T010000Z
DTSTART:20260325T100000Z
DTEND:20260325T103000Z
SUMMARY:Moved run
END:VEVENT
END:VCALENDAR`,
    };
    const objectsByUrl = new Map([[objectUrl, object]]);
    const handler = createCalDAVCalendarHandler(BASE_CONFIG, {
      client: makeClient({ calendars: [calendar], objectsByUrl }),
    });

    const result = await handler({
      action: "delete",
      id: `${objectUrl}#${encodeURIComponent(occurrenceKey)}`,
      futureEvents: true,
    });

    expect(result.success).toBe(true);
    expect(result.deletedEvent.id).toBe(`${objectUrl}#${encodeURIComponent(occurrenceKey)}`);

    const updated = ICAL.Component.fromString(objectsByUrl.get(objectUrl).data);
    const master = updated.getAllSubcomponents("vevent").find((component) => !component.hasProperty("recurrence-id"));
    const recur = master.getFirstPropertyValue("rrule").toJSON();
    expect(recur.count).toBeUndefined();
    expect(recur.until).toBe("2026-03-25T08:29:59Z");
    expect(
      updated
        .getAllSubcomponents("vevent")
        .some((component) => component.getFirstPropertyValue("recurrence-id")?.toICALString() === occurrenceKey)
    ).toBe(false);
  });

  it("creates single-day all-day events with an exclusive next-day end", async () => {
    const calendar = { displayName: "Daily Plan", url: "https://example.com/daily/" };
    const objectsByUrl = new Map();
    const handler = createCalDAVCalendarHandler(BASE_CONFIG, {
      client: makeClient({ calendars: [calendar], objectsByUrl }),
    });

    const result = await handler({
      action: "create",
      title: "Holiday",
      start: "2026-03-23",
      allDay: true,
    });

    expect(result.success).toBe(true);
    expect(result.event.isAllDay).toBe(true);

    const created = [...objectsByUrl.values()][0];
    const vevent = ICAL.Component.fromString(created.data).getFirstSubcomponent("vevent");
    expect(vevent.getFirstPropertyValue("dtstart").toICALString()).toBe("20260323");
    expect(vevent.getFirstPropertyValue("dtend").toICALString()).toBe("20260324");
  });

  it("allows update to switch an event to all-day", async () => {
    const calendar = { displayName: "Daily Plan", url: "https://example.com/daily/" };
    const objectUrl = `${calendar.url}lunch.ics`;
    const object = {
      url: objectUrl,
      etag: "1",
      data: `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//en
BEGIN:VEVENT
UID:lunch
DTSTAMP:20260321T010000Z
DTSTART:20260323T120000Z
DTEND:20260323T130000Z
SUMMARY:Lunch
END:VEVENT
END:VCALENDAR`,
    };
    const objectsByUrl = new Map([[objectUrl, object]]);
    const handler = createCalDAVCalendarHandler(BASE_CONFIG, {
      client: makeClient({ calendars: [calendar], objectsByUrl }),
    });

    const result = await handler({
      action: "update",
      id: objectUrl,
      allDay: true,
    });

    expect(result.success).toBe(true);
    expect(result.event.isAllDay).toBe(true);

    const updated = ICAL.Component.fromString(objectsByUrl.get(objectUrl).data);
    const vevent = updated.getFirstSubcomponent("vevent");
    expect(vevent.getFirstPropertyValue("dtstart").isDate).toBe(true);
    expect(vevent.getFirstPropertyValue("dtend").isDate).toBe(true);
    expect(vevent.getFirstPropertyValue("dtstart").toICALString()).toBe("20260323");
    expect(vevent.getFirstPropertyValue("dtend").toICALString()).toBe("20260324");
  });

  it("does not silently default to an arbitrary calendar when Daily Plan and Shared are absent", async () => {
    const calendar = { displayName: "Work", url: "https://example.com/work/" };
    const handler = createCalDAVCalendarHandler(BASE_CONFIG, {
      client: makeClient({ calendars: [calendar], objectsByUrl: new Map() }),
    });

    await expect(handler({
      action: "create",
      title: "Test",
      start: "2026-03-23 10:00",
    })).rejects.toThrow("no default writable icloud calendar found. specify calendar explicitly.");
  });

  it("reports non-commitment calendars as non-writable in list output", async () => {
    const calendars = [
      { displayName: "Work", url: "https://example.com/work/" },
      { displayName: "Shared", url: "https://example.com/shared/" },
    ];
    const handler = createCalDAVCalendarHandler(BASE_CONFIG, {
      client: makeClient({ calendars, objectsByUrl: new Map() }),
    });

    const result = await handler({ action: "list" });

    expect(result.calendars).toEqual([
      expect.objectContaining({ title: "Work", allowsModifications: false }),
      expect.objectContaining({ title: "Shared", allowsModifications: true }),
    ]);
  });
});
