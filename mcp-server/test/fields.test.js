import { describe, expect, it } from "vitest";
import { applyFieldSelection } from "../../lib/fields.js";

describe("applyFieldSelection", () => {
  it("returns result unchanged when fields is undefined", () => {
    const result = { id: "1", title: "Test", notes: "Hello" };
    expect(applyFieldSelection(result, undefined)).toEqual(result);
  });

  it("returns result unchanged when fields is empty array", () => {
    const result = { id: "1", title: "Test", notes: "Hello" };
    expect(applyFieldSelection(result, [])).toEqual(result);
  });

  it("filters top-level item to requested fields", () => {
    const result = { id: "1", title: "Meeting", start: "2026-03-05", notes: "Long notes", location: "Office" };
    const filtered = applyFieldSelection(result, ["title", "start"]);
    expect(filtered).toEqual({ id: "1", title: "Meeting", start: "2026-03-05" });
  });

  it("always includes id even if not requested", () => {
    const result = { id: "evt_123", title: "Meeting", start: "2026-03-05" };
    const filtered = applyFieldSelection(result, ["title"]);
    expect(filtered).toEqual({ id: "evt_123", title: "Meeting" });
  });

  it("filters items inside wrapper arrays (events)", () => {
    const result = {
      events: [
        { id: "1", title: "A", notes: "n1", start: "2026-03-05" },
        { id: "2", title: "B", notes: "n2", start: "2026-03-06" },
      ],
    };
    const filtered = applyFieldSelection(result, ["title", "start"]);
    expect(filtered).toEqual({
      events: [
        { id: "1", title: "A", start: "2026-03-05" },
        { id: "2", title: "B", start: "2026-03-06" },
      ],
    });
  });

  it("filters items inside wrapper arrays (messages)", () => {
    const result = {
      messages: [
        { id: "m1", subject: "Hi", body: "Long body", sender: "a@example.com" },
      ],
    };
    const filtered = applyFieldSelection(result, ["subject", "sender"]);
    expect(filtered).toEqual({
      messages: [
        { id: "m1", subject: "Hi", sender: "a@example.com" },
      ],
    });
  });

  it("preserves structural wrapper keys that are not arrays", () => {
    const result = { success: true, calendars: [{ id: "c1", title: "Work", color: "#FF0000" }] };
    const filtered = applyFieldSelection(result, ["title"]);
    expect(filtered).toEqual({
      success: true,
      calendars: [{ id: "c1", title: "Work" }],
    });
  });

  it("handles null/non-object results gracefully", () => {
    expect(applyFieldSelection(null, ["title"])).toBeNull();
    expect(applyFieldSelection("text", ["title"])).toBe("text");
  });
});
