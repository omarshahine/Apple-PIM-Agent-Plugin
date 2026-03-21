import { describe, expect, it, beforeEach } from "vitest";
import {
  initAccessConfig,
  getDomainConfig,
  isVisible,
  isWritable,
  getWritableNames,
  resolveWriteTarget,
  validateVisible,
  filterResults,
  _resetForTesting,
} from "../../lib/access-control.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP_DIR = join(tmpdir(), "access-control-tests");

function writeConfig(filename, content) {
  mkdirSync(TMP_DIR, { recursive: true });
  const path = join(TMP_DIR, filename);
  writeFileSync(path, JSON.stringify(content));
  return path;
}

beforeEach(() => {
  _resetForTesting();
  try { rmSync(TMP_DIR, { recursive: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

describe("Config loading", () => {
  it("returns null config when file does not exist", () => {
    initAccessConfig("/tmp/nonexistent-access-config-abc.json");
    expect(getDomainConfig("calendar")).toBeNull();
    expect(getDomainConfig("reminder")).toBeNull();
  });

  it("loads valid config", () => {
    const path = writeConfig("valid.json", {
      calendars: { mode: "allowlist", allow: ["Work", "Personal"] },
    });
    initAccessConfig(path);
    expect(getDomainConfig("calendar")).toEqual({
      mode: "allowlist",
      allow: ["Work", "Personal"],
    });
    expect(getDomainConfig("reminder")).toBeNull();
  });

  it("throws on malformed JSON", () => {
    mkdirSync(TMP_DIR, { recursive: true });
    const path = join(TMP_DIR, "bad.json");
    writeFileSync(path, "not json {{{");
    expect(() => initAccessConfig(path)).toThrow("invalid JSON");
  });

  it("throws on invalid mode", () => {
    const path = writeConfig("bad-mode.json", {
      calendars: { mode: "yolo" },
    });
    expect(() => initAccessConfig(path)).toThrow("must be one of");
  });

  it("throws on allowlist without allow array", () => {
    const path = writeConfig("no-allow.json", {
      calendars: { mode: "allowlist" },
    });
    expect(() => initAccessConfig(path)).toThrow("allow");
  });

  it("throws on blocklist without block array", () => {
    const path = writeConfig("no-block.json", {
      reminders: { mode: "blocklist" },
    });
    expect(() => initAccessConfig(path)).toThrow("block");
  });

  it("throws on unexpected top-level key", () => {
    const path = writeConfig("extra.json", {
      calendars: { mode: "open" },
      contacts: {},
    });
    expect(() => initAccessConfig(path)).toThrow("unexpected top-level key");
  });

  it("throws on unexpected domain key", () => {
    const path = writeConfig("extra-domain.json", {
      calendars: { mode: "open", foo: "bar" },
    });
    expect(() => initAccessConfig(path)).toThrow('unexpected key "calendars.foo"');
  });

  it("returns null for non-calendar/reminder tools", () => {
    const path = writeConfig("cal-only.json", {
      calendars: { mode: "open" },
    });
    initAccessConfig(path);
    expect(getDomainConfig("contact")).toBeNull();
    expect(getDomainConfig("mail")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isVisible
// ---------------------------------------------------------------------------

describe("isVisible", () => {
  it("returns true for any name in open mode", () => {
    const config = { mode: "open" };
    expect(isVisible("Anything", config)).toBe(true);
  });

  it("returns true for null domainConfig", () => {
    expect(isVisible("Anything", null)).toBe(true);
  });

  describe("allowlist mode", () => {
    const config = {
      mode: "allowlist",
      allow: ["Work", "Personal"],
      readOnly: ["Birthdays"],
    };

    it("allows listed calendars", () => {
      expect(isVisible("Work", config)).toBe(true);
      expect(isVisible("Personal", config)).toBe(true);
    });

    it("allows readOnly calendars", () => {
      expect(isVisible("Birthdays", config)).toBe(true);
    });

    it("rejects unlisted calendars", () => {
      expect(isVisible("Secret", config)).toBe(false);
    });

    it("matches case-insensitively", () => {
      expect(isVisible("work", config)).toBe(true);
      expect(isVisible("PERSONAL", config)).toBe(true);
      expect(isVisible("birthdays", config)).toBe(true);
    });
  });

  describe("blocklist mode", () => {
    const config = {
      mode: "blocklist",
      block: ["Spam", "Subscriptions"],
    };

    it("allows non-blocked calendars", () => {
      expect(isVisible("Work", config)).toBe(true);
    });

    it("rejects blocked calendars", () => {
      expect(isVisible("Spam", config)).toBe(false);
      expect(isVisible("Subscriptions", config)).toBe(false);
    });

    it("matches case-insensitively", () => {
      expect(isVisible("spam", config)).toBe(false);
      expect(isVisible("SPAM", config)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// isWritable
// ---------------------------------------------------------------------------

describe("isWritable", () => {
  const config = {
    mode: "allowlist",
    allow: ["Work", "Personal"],
    readOnly: ["Birthdays"],
  };

  it("returns true for writable calendars", () => {
    expect(isWritable("Work", config)).toBe(true);
    expect(isWritable("Personal", config)).toBe(true);
  });

  it("returns false for readOnly calendars", () => {
    expect(isWritable("Birthdays", config)).toBe(false);
  });

  it("returns false for invisible calendars", () => {
    expect(isWritable("Secret", config)).toBe(false);
  });

  it("matches readOnly case-insensitively", () => {
    expect(isWritable("birthdays", config)).toBe(false);
  });

  it("returns true with null domainConfig", () => {
    expect(isWritable("Anything", null)).toBe(true);
  });

  it("works with blocklist + readOnly", () => {
    const blocklist = {
      mode: "blocklist",
      block: ["Spam"],
      readOnly: ["Holidays"],
    };
    expect(isWritable("Work", blocklist)).toBe(true);
    expect(isWritable("Holidays", blocklist)).toBe(false);
    expect(isWritable("Spam", blocklist)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getWritableNames
// ---------------------------------------------------------------------------

describe("getWritableNames", () => {
  it("returns allow minus readOnly in allowlist mode", () => {
    const config = {
      mode: "allowlist",
      allow: ["Work", "Personal", "Family"],
      readOnly: ["Family"],
    };
    expect(getWritableNames(config)).toEqual(["Work", "Personal"]);
  });

  it("returns null for open mode", () => {
    expect(getWritableNames({ mode: "open" })).toBeNull();
  });

  it("returns null for blocklist mode", () => {
    expect(getWritableNames({ mode: "blocklist", block: ["X"] })).toBeNull();
  });

  it("returns null for null config", () => {
    expect(getWritableNames(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveWriteTarget
// ---------------------------------------------------------------------------

describe("resolveWriteTarget", () => {
  const config = {
    mode: "allowlist",
    allow: ["Work", "Personal"],
    readOnly: ["Birthdays"],
    default: "Work",
  };

  it("returns target when writable", () => {
    expect(resolveWriteTarget("Personal", config, "Calendar")).toBe("Personal");
  });

  it("injects default when target is undefined", () => {
    expect(resolveWriteTarget(undefined, config, "Calendar")).toBe("Work");
  });

  it("returns undefined when no target and no default", () => {
    const noDefault = { mode: "allowlist", allow: ["Work"] };
    expect(resolveWriteTarget(undefined, noDefault, "Calendar")).toBeUndefined();
  });

  it("throws when target is not visible", () => {
    expect(() => resolveWriteTarget("Secret", config, "Calendar"))
      .toThrow('Calendar "Secret" is not available');
  });

  it("throws when target is read-only", () => {
    expect(() => resolveWriteTarget("Birthdays", config, "Calendar"))
      .toThrow('Calendar "Birthdays" is read-only');
  });

  it("includes writable names in error for allowlist mode", () => {
    expect(() => resolveWriteTarget("Secret", config, "Calendar"))
      .toThrow("Writable: Work, Personal");
  });

  it("returns target with null domainConfig", () => {
    expect(resolveWriteTarget("Anything", null, "Calendar")).toBe("Anything");
  });
});

// ---------------------------------------------------------------------------
// validateVisible
// ---------------------------------------------------------------------------

describe("validateVisible", () => {
  const config = {
    mode: "allowlist",
    allow: ["Work"],
    readOnly: ["Birthdays"],
  };

  it("does not throw for visible calendars", () => {
    expect(() => validateVisible("Work", config, "Calendar")).not.toThrow();
    expect(() => validateVisible("Birthdays", config, "Calendar")).not.toThrow();
  });

  it("throws for invisible calendars with visible list", () => {
    expect(() => validateVisible("Secret", config, "Calendar"))
      .toThrow("Visible: Work, Birthdays");
  });

  it("does not throw with null domainConfig", () => {
    expect(() => validateVisible("Anything", null, "Calendar")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// filterResults
// ---------------------------------------------------------------------------

describe("filterResults", () => {
  const config = {
    mode: "allowlist",
    allow: ["Work", "Personal"],
    readOnly: ["Birthdays"],
  };

  it("filters calendar list by title", () => {
    const result = {
      success: true,
      calendars: [
        { title: "Work", id: "1" },
        { title: "Personal", id: "2" },
        { title: "Birthdays", id: "3" },
        { title: "Hidden", id: "4" },
      ],
    };
    const filtered = filterResults(result, config, "calendars", "title");
    expect(filtered.calendars).toHaveLength(3);
    expect(filtered.calendars.map((c) => c.title)).toEqual(["Work", "Personal", "Birthdays"]);
  });

  it("filters events by calendar", () => {
    const result = {
      success: true,
      events: [
        { id: "e1", title: "Meeting", calendar: "Work" },
        { id: "e2", title: "Lunch", calendar: "Personal" },
        { id: "e3", title: "Hidden Event", calendar: "Secret" },
      ],
      count: 3,
    };
    const filtered = filterResults(result, config, "events", "calendar");
    expect(filtered.events).toHaveLength(2);
    expect(filtered.count).toBe(2);
  });

  it("filters reminders by list", () => {
    const result = {
      success: true,
      reminders: [
        { id: "r1", title: "Buy milk", list: "Work" },
        { id: "r2", title: "Spam", list: "Hidden" },
      ],
      count: 2,
    };
    const filtered = filterResults(result, config, "reminders", "list");
    expect(filtered.reminders).toHaveLength(1);
    expect(filtered.count).toBe(1);
  });

  it("keeps items with null name field", () => {
    const result = {
      success: true,
      events: [
        { id: "e1", title: "Orphan", calendar: null },
      ],
      count: 1,
    };
    const filtered = filterResults(result, config, "events", "calendar");
    expect(filtered.events).toHaveLength(1);
  });

  it("returns result unchanged with null domainConfig", () => {
    const result = { success: true, calendars: [{ title: "Anything" }] };
    expect(filterResults(result, null, "calendars", "title")).toBe(result);
  });

  it("returns result unchanged when array key is missing", () => {
    const result = { success: true };
    expect(filterResults(result, config, "events", "calendar")).toBe(result);
  });
});
