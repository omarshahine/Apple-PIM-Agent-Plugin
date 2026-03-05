import { describe, expect, it } from "vitest";
import { isMutation, buildDryRunResponse } from "../../lib/dry-run.js";

describe("isMutation", () => {
  it("identifies calendar mutation actions", () => {
    expect(isMutation("calendar", "create")).toBe(true);
    expect(isMutation("calendar", "update")).toBe(true);
    expect(isMutation("calendar", "delete")).toBe(true);
    expect(isMutation("calendar", "batch_create")).toBe(true);
  });

  it("identifies calendar read actions as non-mutations", () => {
    expect(isMutation("calendar", "list")).toBe(false);
    expect(isMutation("calendar", "events")).toBe(false);
    expect(isMutation("calendar", "get")).toBe(false);
    expect(isMutation("calendar", "search")).toBe(false);
    expect(isMutation("calendar", "schema")).toBe(false);
  });

  it("identifies reminder mutation actions", () => {
    expect(isMutation("reminder", "create")).toBe(true);
    expect(isMutation("reminder", "complete")).toBe(true);
    expect(isMutation("reminder", "batch_complete")).toBe(true);
    expect(isMutation("reminder", "batch_delete")).toBe(true);
  });

  it("identifies mail mutation actions", () => {
    expect(isMutation("mail", "send")).toBe(true);
    expect(isMutation("mail", "reply")).toBe(true);
    expect(isMutation("mail", "move")).toBe(true);
    expect(isMutation("mail", "delete")).toBe(true);
    expect(isMutation("mail", "batch_update")).toBe(true);
    expect(isMutation("mail", "batch_delete")).toBe(true);
  });

  it("returns false for unknown tools", () => {
    expect(isMutation("unknown", "create")).toBe(false);
  });

  it("returns false for apple-pim (no mutations)", () => {
    expect(isMutation("apple-pim", "status")).toBe(false);
    expect(isMutation("apple-pim", "authorize")).toBe(false);
  });
});

describe("buildDryRunResponse", () => {
  it("returns dryRun: true with description for calendar create", () => {
    const response = buildDryRunResponse("calendar", {
      action: "create",
      title: "Team Standup",
      start: "2026-03-05T10:00",
      calendar: "Work",
    });
    expect(response.dryRun).toBe(true);
    expect(response.tool).toBe("calendar");
    expect(response.action).toBe("create");
    expect(response.description).toContain("Team Standup");
    expect(response.description).toContain("Work");
    expect(response.warning).toBeUndefined();
  });

  it("includes destructive warning for delete actions", () => {
    const response = buildDryRunResponse("calendar", {
      action: "delete",
      id: "evt_123",
      futureEvents: true,
    });
    expect(response.dryRun).toBe(true);
    expect(response.warning).toContain("destructive");
    expect(response.description).toContain("future occurrences");
  });

  it("describes mail send with recipients", () => {
    const response = buildDryRunResponse("mail", {
      action: "send",
      to: ["alice@example.com", "bob@example.com"],
      subject: "Meeting notes",
      body: "See attached",
    });
    expect(response.description).toContain("alice@example.com");
    expect(response.description).toContain("bob@example.com");
    expect(response.description).toContain("Meeting notes");
  });

  it("describes batch operations with counts", () => {
    const response = buildDryRunResponse("reminder", {
      action: "batch_delete",
      ids: ["r1", "r2", "r3"],
    });
    expect(response.description).toContain("3");
    expect(response.warning).toContain("destructive");
  });

  it("strips internal params from parameters object", () => {
    const response = buildDryRunResponse("calendar", {
      action: "create",
      dryRun: true,
      fields: ["id", "title"],
      configDir: "~/.config/test",
      profile: "work",
      title: "Test",
      start: "2026-03-05",
    });
    expect(response.parameters).not.toHaveProperty("dryRun");
    expect(response.parameters).not.toHaveProperty("fields");
    expect(response.parameters).not.toHaveProperty("configDir");
    expect(response.parameters).not.toHaveProperty("profile");
    expect(response.parameters).toHaveProperty("title", "Test");
  });
});
