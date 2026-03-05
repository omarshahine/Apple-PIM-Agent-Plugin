import { describe, expect, it, vi } from "vitest";
import { withAgentDX } from "../../lib/agent-dx.js";

describe("withAgentDX", () => {
  const mockRunCLI = vi.fn();

  describe("schema action", () => {
    it("returns tool schema without calling CLI", async () => {
      const handler = vi.fn();
      const wrapped = withAgentDX("calendar", handler);

      const result = await wrapped({ action: "schema" }, mockRunCLI);

      expect(handler).not.toHaveBeenCalled();
      expect(mockRunCLI).not.toHaveBeenCalled();
      expect(result.tool).toBe("calendar");
      expect(result.inputSchema).toBeDefined();
      expect(result.inputSchema.properties.action).toBeDefined();
      expect(result.description).toContain("calendar");
    });

    it("works for all tool names", async () => {
      for (const name of ["calendar", "reminder", "contact", "mail", "apple-pim"]) {
        const wrapped = withAgentDX(name, vi.fn());
        const result = await wrapped({ action: "schema" }, mockRunCLI);
        expect(result.tool).toBe(name);
        expect(result.inputSchema).toBeDefined();
      }
    });
  });

  describe("dryRun", () => {
    it("returns dry-run response for mutations without calling handler", async () => {
      const handler = vi.fn();
      const wrapped = withAgentDX("calendar", handler);

      const result = await wrapped(
        { action: "create", dryRun: true, title: "Test", start: "2026-03-05" },
        mockRunCLI
      );

      expect(handler).not.toHaveBeenCalled();
      expect(result.dryRun).toBe(true);
      expect(result.action).toBe("create");
      expect(result.description).toContain("Test");
    });

    it("passes through to handler for reads with dryRun flag and signals skip", async () => {
      const handler = vi.fn().mockResolvedValue({ calendars: [] });
      const wrapped = withAgentDX("calendar", handler);

      const result = await wrapped(
        { action: "list", dryRun: true },
        mockRunCLI
      );

      expect(handler).toHaveBeenCalled();
      expect(result.calendars).toEqual([]);
      expect(result._dryRunSkipped).toBe(true);
      expect(result._note).toContain("no effect");
    });
  });

  describe("fields", () => {
    it("filters handler result to requested fields", async () => {
      const handler = vi.fn().mockResolvedValue({
        events: [
          { id: "1", title: "A", notes: "n1", start: "2026-03-05" },
        ],
      });
      const wrapped = withAgentDX("calendar", handler);

      const result = await wrapped(
        { action: "events", fields: ["title"] },
        mockRunCLI
      );

      expect(result.events[0]).toEqual({ id: "1", title: "A" });
      expect(result.events[0].notes).toBeUndefined();
    });
  });

  describe("normal passthrough", () => {
    it("calls handler normally when no agent DX params are set", async () => {
      const handler = vi.fn().mockResolvedValue({ calendars: [{ id: "c1", title: "Work" }] });
      const wrapped = withAgentDX("calendar", handler);

      const result = await wrapped({ action: "list" }, mockRunCLI);

      expect(handler).toHaveBeenCalledWith({ action: "list" }, mockRunCLI);
      expect(result).toEqual({ calendars: [{ id: "c1", title: "Work" }] });
    });
  });
});
