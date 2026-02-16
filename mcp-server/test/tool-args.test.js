import { describe, expect, it } from "vitest";
import {
  applyDefaultCalendar,
  applyDefaultReminderList,
  buildCalendarDeleteArgs,
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
