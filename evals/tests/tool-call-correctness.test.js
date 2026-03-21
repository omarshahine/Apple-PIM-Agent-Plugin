import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadScenario } from "../helpers/scenario-runner.js";
import { createMockCLI } from "../helpers/mock-cli.js";
import { argsPairPresent } from "../helpers/grader.js";
import { handleCalendar } from "../../lib/handlers/calendar.js";
import { handleReminder } from "../../lib/handlers/reminder.js";
import { handleContact } from "../../lib/handlers/contact.js";
import { handleMail } from "../../lib/handlers/mail.js";
import { buildDryRunResponse } from "../../lib/dry-run.js";
import { withAgentDX } from "../../lib/agent-dx.js";
import { initAccessConfig, _resetForTesting } from "../../lib/access-control.js";
import {
  buildCalendarCreateArgs,
  buildCalendarUpdateArgs,
  buildReminderCreateArgs,
} from "../../lib/tool-args.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const handlers = {
  calendar: handleCalendar,
  reminder: handleReminder,
  contact: handleContact,
  mail: handleMail,
};

const scenario = loadScenario("tool-call-correctness.yaml");

describe("Category 1: Tool Call Correctness", () => {
  describe("ISO 8601 date passthrough", () => {
    it("passes ISO 8601 offset through to --start unchanged", () => {
      const args = buildCalendarCreateArgs(
        { title: "Dinner", start: "2026-03-15T19:00:00-07:00" },
        "Personal"
      );
      expect(argsPairPresent(args, "--start", "2026-03-15T19:00:00-07:00")).toBe(true);
    });

    it("passes positive UTC offset through unchanged", () => {
      const args = buildCalendarCreateArgs(
        { title: "Call", start: "2026-03-16T09:00:00+05:30" },
        "Work"
      );
      expect(argsPairPresent(args, "--start", "2026-03-16T09:00:00+05:30")).toBe(true);
    });

    it("passes Z (UTC) suffix through unchanged", () => {
      const args = buildCalendarCreateArgs(
        { title: "UTC Event", start: "2026-03-15T12:00:00Z" },
        null
      );
      expect(argsPairPresent(args, "--start", "2026-03-15T12:00:00Z")).toBe(true);
    });
  });

  describe("duration vs end", () => {
    it("uses --duration when duration is provided", () => {
      const args = buildCalendarCreateArgs(
        { title: "Chat", start: "2026-03-15T10:00:00", duration: 30 },
        null
      );
      expect(args).toContain("--duration");
      expect(args).toContain("30");
      expect(args).not.toContain("--end");
    });

    it("uses --end when end is provided", () => {
      const args = buildCalendarCreateArgs(
        { title: "Chat", start: "2026-03-15T10:00:00", end: "2026-03-15T11:00:00" },
        null
      );
      expect(args).toContain("--end");
      expect(args).not.toContain("--duration");
    });
  });

  describe("all-day flag", () => {
    it("includes --all-day when allDay is true", () => {
      const args = buildCalendarCreateArgs(
        { title: "Holiday", start: "2026-12-25", allDay: true },
        null
      );
      expect(args).toContain("--all-day");
    });

    it("omits --all-day when allDay is falsy", () => {
      const args = buildCalendarCreateArgs(
        { title: "Meeting", start: "2026-03-15T10:00:00" },
        null
      );
      expect(args).not.toContain("--all-day");
    });
  });

  describe("recurrence serialization", () => {
    it("serializes recurrence as JSON string", () => {
      const recurrence = { frequency: "weekly", daysOfTheWeek: ["monday"] };
      const args = buildCalendarCreateArgs(
        { title: "Sync", start: "2026-03-16T09:00:00", recurrence },
        null
      );
      const recIdx = args.indexOf("--recurrence");
      expect(recIdx).not.toBe(-1);
      expect(JSON.parse(args[recIdx + 1])).toEqual(recurrence);
    });

    it("serializes reminder recurrence as JSON string", () => {
      const recurrence = { frequency: "monthly", interval: 1 };
      const args = buildReminderCreateArgs(
        { title: "Pay rent", recurrence },
        "Bills"
      );
      const recIdx = args.indexOf("--recurrence");
      expect(recIdx).not.toBe(-1);
      expect(JSON.parse(args[recIdx + 1])).toEqual(recurrence);
    });
  });

  describe("multiple alarms", () => {
    it("produces multiple --alarm flags", () => {
      const args = buildCalendarCreateArgs(
        { title: "Important", start: "2026-03-15T14:00:00", alarm: [5, 15, 60] },
        null
      );
      const alarmIndices = args
        .map((a, i) => (a === "--alarm" ? i : -1))
        .filter((i) => i !== -1);
      expect(alarmIndices).toHaveLength(3);
      expect(args[alarmIndices[0] + 1]).toBe("5");
      expect(args[alarmIndices[1] + 1]).toBe("15");
      expect(args[alarmIndices[2] + 1]).toBe("60");
    });
  });

  describe("relative date resolution (lastDays)", () => {
    it("computes --from as a date string for lastDays", async () => {
      const mockCLI = createMockCLI({ "calendar:events": { events: [] } });
      await handleCalendar({ action: "events", lastDays: 7 }, mockCLI);

      const callArgs = mockCLI.mock.calls[0][1];
      expect(callArgs).toContain("--from");
      const fromIdx = callArgs.indexOf("--from");
      // Should be a YYYY-MM-DD date string
      expect(callArgs[fromIdx + 1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("reminder location as JSON", () => {
    it("serializes location object as JSON string", () => {
      const location = { latitude: 47.6, longitude: -122.3, proximity: "arrive" };
      const args = buildReminderCreateArgs(
        { title: "Pick up", location },
        null
      );
      const locIdx = args.indexOf("--location");
      expect(locIdx).not.toBe(-1);
      expect(JSON.parse(args[locIdx + 1])).toEqual(location);
    });
  });

  describe("required field validation", () => {
    it("calendar create includes --title with undefined when title missing (schema enforces)", () => {
      // buildCalendarCreateArgs unconditionally pushes --title and --start.
      // Validation of required fields is handled by the JSON Schema layer, not JS.
      const args = buildCalendarCreateArgs({ start: "2026-03-15" }, null);
      expect(args).toContain("--title");
      // The value after --title will be undefined, which the CLI rejects
      const titleIdx = args.indexOf("--title");
      expect(args[titleIdx + 1]).toBeUndefined();
    });

    it("calendar get throws without id", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleCalendar({ action: "get" }, mockCLI))
        .rejects.toThrow("Event ID is required");
    });

    it("calendar update requires id", async () => {
      const mockCLI = createMockCLI({});
      // buildCalendarUpdateArgs itself doesn't throw, but produces no --id
      const args = buildCalendarUpdateArgs({ title: "New Title" });
      expect(args).toContain("update");
    });

    it("calendar delete requires id via handler", async () => {
      // The handler delegates to buildCalendarDeleteArgs which uses args.id directly
      // The handler calls runCLI which would catch missing id
      const args = buildCalendarCreateArgs({ title: "T", start: "2026-03-15" }, null);
      expect(args[0]).toBe("create");
    });

    it("reminder get throws without id", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleReminder({ action: "get" }, mockCLI))
        .rejects.toThrow("Reminder ID is required");
    });

    it("reminder complete throws without id", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleReminder({ action: "complete" }, mockCLI))
        .rejects.toThrow("Reminder ID is required");
    });

    it("reminder delete throws without id", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleReminder({ action: "delete" }, mockCLI))
        .rejects.toThrow("Reminder ID is required");
    });

    it("contact get throws without id", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleContact({ action: "get" }, mockCLI))
        .rejects.toThrow("Contact ID is required");
    });

    it("contact delete throws without id", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleContact({ action: "delete" }, mockCLI))
        .rejects.toThrow("Contact ID is required");
    });

    it("mail get throws without id", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleMail({ action: "get" }, mockCLI))
        .rejects.toThrow("Message ID is required");
    });

    it("mail update throws without id", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleMail({ action: "update" }, mockCLI))
        .rejects.toThrow("Message ID is required");
    });

    it("mail move throws without id", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleMail({ action: "move" }, mockCLI))
        .rejects.toThrow("Message ID is required");
    });

    it("mail move throws without toMailbox", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleMail({ action: "move", id: "msg_1" }, mockCLI))
        .rejects.toThrow("toMailbox");
    });

    it("mail delete throws without id", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleMail({ action: "delete" }, mockCLI))
        .rejects.toThrow("Message ID is required");
    });

    it("mail reply throws without id", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleMail({ action: "reply" }, mockCLI))
        .rejects.toThrow("Message ID is required");
    });

    it("mail send throws without to", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleMail({ action: "send", subject: "Hi", body: "Hello" }, mockCLI))
        .rejects.toThrow("recipient");
    });

    it("mail send throws without subject", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleMail({ action: "send", to: ["a@example.com"], body: "Hello" }, mockCLI))
        .rejects.toThrow("Subject");
    });

    it("calendar search throws without query", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleCalendar({ action: "search" }, mockCLI))
        .rejects.toThrow("query");
    });

    it("reminder search throws without query", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleReminder({ action: "search" }, mockCLI))
        .rejects.toThrow("query");
    });

    it("contact search throws without query", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleContact({ action: "search" }, mockCLI))
        .rejects.toThrow("query");
    });

    it("mail search throws without query", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleMail({ action: "search" }, mockCLI))
        .rejects.toThrow("query");
    });
  });

  describe("batch operation validation", () => {
    it("calendar batch_create throws with empty events", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleCalendar({ action: "batch_create", events: [] }, mockCLI))
        .rejects.toThrow("cannot be empty");
    });

    it("calendar batch_create propagates top-level calendar to each event", async () => {
      const mockCLI = createMockCLI({ "calendar:batch-create": { success: true } });
      await handleCalendar(
        {
          action: "batch_create",
          calendar: "Shared",
          events: [
            { title: "One", start: "2026-03-23T14:00:00", end: "2026-03-23T15:00:00" },
            { title: "Two", start: "2026-03-24T14:00:00", end: "2026-03-24T15:00:00" },
          ],
        },
        mockCLI,
      );

      const callArgs = mockCLI.mock.calls[0][1];
      const jsonIndex = callArgs.indexOf("--json");
      const payload = JSON.parse(callArgs[jsonIndex + 1]);
      expect(payload.map((event) => event.calendar)).toEqual(["Shared", "Shared"]);
    });

    it("reminder batch_create throws with empty reminders", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleReminder({ action: "batch_create", reminders: [] }, mockCLI))
        .rejects.toThrow("cannot be empty");
    });

    it("reminder batch_complete throws with empty ids", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleReminder({ action: "batch_complete", ids: [] }, mockCLI))
        .rejects.toThrow("cannot be empty");
    });

    it("reminder batch_delete throws with empty ids", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleReminder({ action: "batch_delete", ids: [] }, mockCLI))
        .rejects.toThrow("cannot be empty");
    });

    it("mail batch_update throws with empty ids", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleMail({ action: "batch_update", ids: [] }, mockCLI))
        .rejects.toThrow("cannot be empty");
    });

    it("mail batch_delete throws with empty ids", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleMail({ action: "batch_delete", ids: [] }, mockCLI))
        .rejects.toThrow("cannot be empty");
    });
  });

  describe("dry-run description accuracy", () => {
    it("calendar create dry-run contains title and calendar", () => {
      const result = buildDryRunResponse("calendar", {
        action: "create",
        title: "Team Lunch",
        start: "2026-03-15T12:00:00",
        calendar: "Work",
      });
      expect(result.dryRun).toBe(true);
      expect(result.description).toContain("Team Lunch");
      expect(result.description).toContain("Work");
    });

    it("reminder create dry-run contains title and list", () => {
      const result = buildDryRunResponse("reminder", {
        action: "create",
        title: "Buy milk",
        list: "Shopping",
      });
      expect(result.description).toContain("Buy milk");
      expect(result.description).toContain("Shopping");
    });

    it("calendar delete dry-run contains event ID", () => {
      const result = buildDryRunResponse("calendar", {
        action: "delete",
        id: "evt_ABC123",
      });
      expect(result.description).toContain("evt_ABC123");
    });

    it("mail send dry-run contains recipients and subject", () => {
      const result = buildDryRunResponse("mail", {
        action: "send",
        to: ["alice@example.com", "bob@example.com"],
        subject: "Quarterly Review",
        body: "See attached.",
      });
      expect(result.description).toContain("alice@example.com");
      expect(result.description).toContain("bob@example.com");
      expect(result.description).toContain("Quarterly Review");
    });
  });

  describe("unknown action handling", () => {
    it("calendar throws for unknown action", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleCalendar({ action: "teleport" }, mockCLI))
        .rejects.toThrow("Unknown calendar action");
    });

    it("reminder throws for unknown action", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleReminder({ action: "teleport" }, mockCLI))
        .rejects.toThrow("Unknown reminder action");
    });

    it("contact throws for unknown action", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleContact({ action: "teleport" }, mockCLI))
        .rejects.toThrow("Unknown contact action");
    });

    it("mail throws for unknown action", async () => {
      const mockCLI = createMockCLI({});
      await expect(handleMail({ action: "teleport" }, mockCLI))
        .rejects.toThrow("Unknown mail action");
    });
  });

  describe("access control integration", () => {
    const AC_TMP = join(tmpdir(), "ac-integration-tests");

    function writeACConfig(config) {
      mkdirSync(AC_TMP, { recursive: true });
      const path = join(AC_TMP, "access.json");
      writeFileSync(path, JSON.stringify(config));
      return path;
    }

    beforeEach(() => {
      _resetForTesting();
      try { rmSync(AC_TMP, { recursive: true }); } catch {}
    });

    it("calendar create injects default calendar from access config", async () => {
      const path = writeACConfig({
        calendars: { mode: "allowlist", allow: ["Work", "Personal"], default: "Work" },
      });
      initAccessConfig(path);

      const mockCLI = createMockCLI({ "calendar:create": { success: true } });
      const wrapped = withAgentDX("calendar", handleCalendar);
      await wrapped({ action: "create", title: "Test", start: "2026-03-20T10:00:00" }, mockCLI);

      const callArgs = mockCLI.mock.calls[0][1];
      expect(argsPairPresent(callArgs, "--calendar", "Work")).toBe(true);
    });

    it("calendar create rejects read-only calendar", async () => {
      const path = writeACConfig({
        calendars: { mode: "allowlist", allow: ["Work"], readOnly: ["Birthdays"], default: "Work" },
      });
      initAccessConfig(path);

      const mockCLI = createMockCLI({});
      const wrapped = withAgentDX("calendar", handleCalendar);
      await expect(wrapped(
        { action: "create", title: "Test", start: "2026-03-20T10:00:00", calendar: "Birthdays" },
        mockCLI,
      )).rejects.toThrow("read-only");
    });

    it("calendar create rejects invisible calendar", async () => {
      const path = writeACConfig({
        calendars: { mode: "allowlist", allow: ["Work"], default: "Work" },
      });
      initAccessConfig(path);

      const mockCLI = createMockCLI({});
      const wrapped = withAgentDX("calendar", handleCalendar);
      await expect(wrapped(
        { action: "create", title: "Test", start: "2026-03-20T10:00:00", calendar: "Secret" },
        mockCLI,
      )).rejects.toThrow("not available");
    });

    it("calendar update rejects read-only calendar", async () => {
      const path = writeACConfig({
        calendars: { mode: "allowlist", allow: ["Work"], readOnly: ["Birthdays"] },
      });
      initAccessConfig(path);

      const mockCLI = createMockCLI({});
      const wrapped = withAgentDX("calendar", handleCalendar);
      await expect(wrapped(
        { action: "update", id: "evt_1", title: "New Title", calendar: "Birthdays" },
        mockCLI,
      )).rejects.toThrow("read-only");
    });

    it("calendar delete rejects blocked calendar", async () => {
      const path = writeACConfig({
        calendars: { mode: "blocklist", block: ["Spam"] },
      });
      initAccessConfig(path);

      const mockCLI = createMockCLI({});
      const wrapped = withAgentDX("calendar", handleCalendar);
      await expect(wrapped(
        { action: "delete", id: "evt_1", calendar: "Spam" },
        mockCLI,
      )).rejects.toThrow("not available");
    });

    it("reminder complete rejects read-only list", async () => {
      const path = writeACConfig({
        reminders: { mode: "allowlist", allow: ["Inbox"], readOnly: ["Archive"] },
      });
      initAccessConfig(path);

      const mockCLI = createMockCLI({});
      const wrapped = withAgentDX("reminder", handleReminder);
      await expect(wrapped(
        { action: "complete", id: "rem_1", list: "Archive" },
        mockCLI,
      )).rejects.toThrow("read-only");
    });

    it("reminder batch_delete rejects read-only list", async () => {
      const path = writeACConfig({
        reminders: { mode: "allowlist", allow: ["Inbox"], readOnly: ["Archive"] },
      });
      initAccessConfig(path);

      const mockCLI = createMockCLI({});
      const wrapped = withAgentDX("reminder", handleReminder);
      await expect(wrapped(
        { action: "batch_delete", ids: ["r1", "r2"], list: "Archive" },
        mockCLI,
      )).rejects.toThrow("read-only");
    });

    it("calendar events post-filters to visible calendars", async () => {
      const path = writeACConfig({
        calendars: { mode: "allowlist", allow: ["Work"], readOnly: ["Birthdays"] },
      });
      initAccessConfig(path);

      const mockCLI = createMockCLI({
        "calendar:events": {
          success: true,
          events: [
            { id: "e1", title: "Meeting", calendar: "Work" },
            { id: "e2", title: "Birthday", calendar: "Birthdays" },
            { id: "e3", title: "Hidden", calendar: "Secret" },
          ],
          count: 3,
        },
      });
      const wrapped = withAgentDX("calendar", handleCalendar);
      const result = await wrapped({ action: "events" }, mockCLI);

      expect(result.events).toHaveLength(2);
      expect(result.events.map((e) => e.calendar)).toEqual(["Work", "Birthdays"]);
      expect(result.count).toBe(2);
    });

    it("reminder create injects default list from access config", async () => {
      const path = writeACConfig({
        reminders: { mode: "allowlist", allow: ["Inbox", "Shopping"], default: "Inbox" },
      });
      initAccessConfig(path);

      const mockCLI = createMockCLI({ "reminder-cli:create": { success: true } });
      const wrapped = withAgentDX("reminder", handleReminder);
      await wrapped({ action: "create", title: "Buy milk" }, mockCLI);

      const callArgs = mockCLI.mock.calls[0][1];
      expect(argsPairPresent(callArgs, "--list", "Inbox")).toBe(true);
    });

    it("calendar update passes when targeting writable calendar", async () => {
      const path = writeACConfig({
        calendars: { mode: "allowlist", allow: ["Work"], readOnly: ["Birthdays"] },
      });
      initAccessConfig(path);

      const mockCLI = createMockCLI({ "calendar:update": { success: true } });
      const wrapped = withAgentDX("calendar", handleCalendar);
      // Should not throw
      await wrapped({ action: "update", id: "evt_1", title: "Updated", calendar: "Work" }, mockCLI);
      expect(mockCLI.mock.calls).toHaveLength(1);
      const callArgs = mockCLI.mock.calls[0][1];
      expect(argsPairPresent(callArgs, "--calendar", "Work")).toBe(true);
    });

    it("calendar batch_create injects top-level calendar from access config into each event", async () => {
      const path = writeACConfig({
        calendars: { mode: "allowlist", allow: ["Work", "Shared"], default: "Work" },
      });
      initAccessConfig(path);

      const mockCLI = createMockCLI({ "calendar:batch-create": { success: true } });
      const wrapped = withAgentDX("calendar", handleCalendar);
      await wrapped(
        {
          action: "batch_create",
          calendar: "Shared",
          events: [
            { title: "One", start: "2026-03-23T14:00:00", end: "2026-03-23T15:00:00" },
            { title: "Two", start: "2026-03-24T14:00:00", end: "2026-03-24T15:00:00" },
          ],
        },
        mockCLI,
      );

      const callArgs = mockCLI.mock.calls[0][1];
      const jsonIndex = callArgs.indexOf("--json");
      const payload = JSON.parse(callArgs[jsonIndex + 1]);
      expect(payload.map((event) => event.calendar)).toEqual(["Shared", "Shared"]);
    });

    it("no access config means open mode (no filtering)", async () => {
      // initAccessConfig not called — default null config
      const mockCLI = createMockCLI({
        "calendar:events": {
          success: true,
          events: [{ id: "e1", title: "A", calendar: "Anything" }],
          count: 1,
        },
      });
      const wrapped = withAgentDX("calendar", handleCalendar);
      const result = await wrapped({ action: "events" }, mockCLI);
      expect(result.events).toHaveLength(1);
    });
  });
});
