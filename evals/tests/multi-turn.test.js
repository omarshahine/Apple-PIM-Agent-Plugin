import { describe, expect, it } from "vitest";
import { loadScenario, runScenario } from "../helpers/scenario-runner.js";
import { handleCalendar } from "../../lib/handlers/calendar.js";
import { handleReminder } from "../../lib/handlers/reminder.js";
import { handleContact } from "../../lib/handlers/contact.js";
import { handleMail } from "../../lib/handlers/mail.js";

const handlers = {
  calendar: handleCalendar,
  reminder: handleReminder,
  contact: handleContact,
  mail: handleMail,
};

const scenarioFile = loadScenario("multi-turn.yaml");

describe("Category 3: Multi-turn Sequences", () => {
  for (const scenario of scenarioFile.scenarios) {
    describe(scenario.description, () => {
      it(`runs ${scenario.turns.length} turn(s) with correct CLI calls`, async () => {
        const { calls, results, errors } = await runScenario(scenario, handlers);

        // Check there were no unexpected errors
        for (const err of errors) {
          // Only fail if an error wasn't expected
          expect(err).toBeUndefined();
        }

        // Apply grading assertions
        for (const grade of scenario.grading) {
          switch (grade.assert) {
            case "call_count":
              expect(calls).toHaveLength(grade.value);
              break;

            case "call_cli":
              expect(calls[grade.index].cli).toBe(grade.cli);
              break;

            case "call_args_contain":
              for (const val of grade.values) {
                expect(calls[grade.index].args).toContain(val);
              }
              break;

            default:
              throw new Error(`Unknown grading assert: ${grade.assert}`);
          }
        }
      });
    });
  }

  describe("scenario: schedule dinner", () => {
    it("produces correct start time and calendar in CLI args", async () => {
      const scenario = scenarioFile.scenarios.find((s) => s.id === "schedule-dinner");
      const { calls } = await runScenario(scenario, handlers);

      const args = calls[0].args;
      expect(args).toContain("--start");
      expect(args).toContain("2026-03-15T19:00:00-07:00");
      expect(args).toContain("--calendar");
      expect(args).toContain("Personal");
    });
  });

  describe("scenario: search then update", () => {
    it("uses correct event ID from search in update call", async () => {
      const scenario = scenarioFile.scenarios.find((s) => s.id === "search-then-update");
      const { calls } = await runScenario(scenario, handlers);

      // First call: search
      expect(calls[0].cli).toBe("calendar");
      expect(calls[0].args[0]).toBe("search");

      // Second call: update with the correct event ID
      expect(calls[1].cli).toBe("calendar");
      expect(calls[1].args).toContain("update");
      expect(calls[1].args).toContain("--id");
      expect(calls[1].args).toContain("E003");
    });
  });

  describe("scenario: batch create standups", () => {
    it("passes 5 events as JSON in a single batch-create call", async () => {
      const scenario = scenarioFile.scenarios.find((s) => s.id === "batch-create-standups");
      const { calls } = await runScenario(scenario, handlers);

      expect(calls).toHaveLength(1);
      expect(calls[0].args).toContain("batch-create");
      expect(calls[0].args).toContain("--json");

      // Parse the JSON arg and verify 5 events with recurrence
      const jsonIdx = calls[0].args.indexOf("--json");
      const events = JSON.parse(calls[0].args[jsonIdx + 1]);
      expect(events).toHaveLength(5);
      for (const event of events) {
        expect(event.recurrence).toBeDefined();
        expect(event.recurrence.frequency).toBe("weekly");
      }
    });
  });

  describe("scenario: create contact then email", () => {
    it("calls contacts-cli first, then mail-cli", async () => {
      const scenario = scenarioFile.scenarios.find((s) => s.id === "create-contact-then-email");
      const { calls } = await runScenario(scenario, handlers);

      expect(calls).toHaveLength(2);
      expect(calls[0].cli).toBe("contacts-cli");
      expect(calls[1].cli).toBe("mail-cli");
      expect(calls[1].args).toContain("--to");
      expect(calls[1].args).toContain("alex@example.com");
    });
  });
});
