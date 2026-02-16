import { describe, expect, it } from "vitest";
import {
  applyDefaultCalendar,
  applyDefaultReminderList,
  buildCalendarCreateArgs,
  buildCalendarDeleteArgs,
  buildCalendarUpdateArgs,
  buildContactCreateArgs,
  buildContactUpdateArgs,
  buildReminderCreateArgs,
  buildReminderUpdateArgs,
} from "../tool-args.js";

describe("buildCalendarDeleteArgs", () => {
  it("uses safe single-occurrence delete by default", () => {
    expect(buildCalendarDeleteArgs({ id: "evt_123" })).toEqual([
      "delete",
      "--id",
      "evt_123",
    ]);
  });

  it("adds future-events flag when requested", () => {
    expect(
      buildCalendarDeleteArgs({ id: "evt_123", futureEvents: true })
    ).toEqual(["delete", "--id", "evt_123", "--future-events"]);
  });
});

describe("applyDefaultCalendar", () => {
  it("applies default calendar when missing", () => {
    const events = [{ title: "A" }, { title: "B", calendar: "Work" }];
    expect(applyDefaultCalendar(events, "Personal")).toEqual([
      { title: "A", calendar: "Personal" },
      { title: "B", calendar: "Work" },
    ]);
  });
});

describe("applyDefaultReminderList", () => {
  it("applies default list when missing", () => {
    const reminders = [{ title: "A" }, { title: "B", list: "Errands" }];
    expect(applyDefaultReminderList(reminders, "Reminders")).toEqual([
      { title: "A", list: "Reminders" },
      { title: "B", list: "Errands" },
    ]);
  });
});

describe("buildCalendarCreateArgs", () => {
  it("maps recurrence and url args for calendar create", () => {
    const args = buildCalendarCreateArgs(
      {
        title: "Team sync",
        start: "2026-02-18 10:00",
        url: "https://example.com",
        recurrence: { frequency: "weekly", daysOfTheWeek: ["monday"] },
      },
      "Work"
    );
    expect(args).toEqual([
      "create",
      "--title",
      "Team sync",
      "--start",
      "2026-02-18 10:00",
      "--calendar",
      "Work",
      "--url",
      "https://example.com",
      "--recurrence",
      JSON.stringify({ frequency: "weekly", daysOfTheWeek: ["monday"] }),
    ]);
  });
});

describe("buildCalendarUpdateArgs", () => {
  it("maps futureEvents and recurrence args for calendar update", () => {
    const args = buildCalendarUpdateArgs({
      id: "evt_1",
      recurrence: { frequency: "monthly", daysOfTheMonth: [1, 15] },
      futureEvents: true,
    });
    expect(args).toEqual([
      "update",
      "--id",
      "evt_1",
      "--recurrence",
      JSON.stringify({ frequency: "monthly", daysOfTheMonth: [1, 15] }),
      "--future-events",
    ]);
  });
});

describe("buildReminderCreateArgs", () => {
  it("maps recurrence args for reminder create", () => {
    const args = buildReminderCreateArgs(
      {
        title: "Pay rent",
        recurrence: { frequency: "monthly", interval: 1 },
      },
      "Reminders"
    );
    expect(args).toEqual([
      "create",
      "--title",
      "Pay rent",
      "--list",
      "Reminders",
      "--recurrence",
      JSON.stringify({ frequency: "monthly", interval: 1 }),
    ]);
  });
});

describe("buildReminderUpdateArgs", () => {
  it("maps recurrence args for reminder update", () => {
    const args = buildReminderUpdateArgs({
      id: "rem_1",
      recurrence: { frequency: "weekly", daysOfTheWeek: ["friday"] },
    });
    expect(args).toEqual([
      "update",
      "--id",
      "rem_1",
      "--recurrence",
      JSON.stringify({ frequency: "weekly", daysOfTheWeek: ["friday"] }),
    ]);
  });
});

describe("buildContactCreateArgs", () => {
  it("omits empty rich arrays to prevent accidental clearing", () => {
    const args = buildContactCreateArgs({
      name: "Ada Lovelace",
      emails: [],
      phones: [],
      addresses: [],
      notes: "Test",
    });
    expect(args).toEqual(["create", "--name", "Ada Lovelace", "--notes", "Test"]);
  });

  it("maps non-empty rich arrays as JSON", () => {
    const args = buildContactCreateArgs({
      firstName: "Ada",
      emails: [{ label: "work", value: "ada@example.com" }],
      relations: [{ label: "assistant", name: "Charles" }],
    });
    expect(args).toEqual([
      "create",
      "--first-name",
      "Ada",
      "--emails",
      JSON.stringify([{ label: "work", value: "ada@example.com" }]),
      "--relations",
      JSON.stringify([{ label: "assistant", name: "Charles" }]),
    ]);
  });
});

describe("buildContactUpdateArgs", () => {
  it("includes id and omits empty rich arrays", () => {
    const args = buildContactUpdateArgs({
      id: "contact_1",
      emails: [],
      phones: [],
      firstName: "Grace",
    });
    expect(args).toEqual(["update", "--id", "contact_1", "--first-name", "Grace"]);
  });
});
