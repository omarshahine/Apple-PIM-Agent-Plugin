/**
 * Calendar Reasoning Evals — Model-in-the-Loop with LLM-as-Judge
 *
 * Tests whether the model correctly reasons about calendar data:
 * - Assigns events to the right local date (not UTC date)
 * - Identifies multi-day blocking ranges (trips, visits)
 * - Finds genuinely open evenings
 * - Plans efficient range queries (not day-by-day)
 *
 * Response generation: `claude -p` with configurable model (EVAL_MODEL env)
 * Grading: LLM-as-judge via Haiku — no regex fragility
 *
 * Skip with: SKIP_MODEL_EVALS=1 npm test
 * Run with: npm test -- --testPathPattern calendar-reasoning
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { callModel, gradeResponse } from "../helpers/model-grader.js";
import { loadFixture } from "../helpers/mock-cli.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const itModel = process.env.SKIP_MODEL_EVALS ? it.skip : it;

const scenarioFile = readFileSync(
  join(__dirname, "..", "scenarios", "calendar-reasoning.yaml"),
  "utf-8"
);
const scenarioDef = yaml.load(scenarioFile);
const systemContext = scenarioDef.system_context;
const MODEL = process.env.EVAL_MODEL || undefined;

// Response generation ~30s + judge calls ~5s each, complex scenarios have many assertions
const TIMEOUT = 180_000;

/**
 * Run a single scenario: generate response, grade with LLM judge, assert.
 */
async function runScenario(scenario, { passThreshold = 1.0 } = {}) {
  const fixture = scenario.fixture ? loadFixture(...scenario.fixture.split("/")) : undefined;
  const { text } = await callModel(systemContext, scenario.user_message, {
    model: MODEL,
    fixture,
  });

  const result = await gradeResponse(text, scenario.grading);
  if (!result.pass) {
    console.log("Response:", text);
    console.log(`Score: ${result.score}/${result.total}`);
    console.log("Failures:", result.failures);
  }

  if (passThreshold < 1.0) {
    const passRate = result.score / result.total;
    expect(
      passRate,
      `Score: ${result.score}/${result.total}. Failures: ${result.failures.join("; ")}`
    ).toBeGreaterThanOrEqual(passThreshold);
  } else {
    expect(result.pass, `Failures: ${result.failures.join("; ")}`).toBe(true);
  }
}

describe("Calendar Reasoning (model-in-the-loop)", () => {
  describe("UTC Cross-Midnight Date Assignment", () => {
    itModel("events assigned to local date, not UTC date",
      () => runScenario(scenarioDef.scenarios.find((s) => s.id === "utc-cross-midnight")),
      TIMEOUT);

    itModel("evening events with UTC dates crossing into next day",
      () => runScenario(scenarioDef.scenarios.find((s) => s.id === "utc-cross-midnight-april3")),
      TIMEOUT);
  });

  describe("Multi-Day Blocking Range Detection", () => {
    itModel("family visit blocks entire date range",
      () => runScenario(scenarioDef.scenarios.find((s) => s.id === "blocking-range-sarah-visit")),
      TIMEOUT);

    itModel("trip blocks the entire week",
      () => runScenario(scenarioDef.scenarios.find((s) => s.id === "blocking-range-mexico")),
      TIMEOUT);
  });

  describe("Availability Analysis", () => {
    itModel("correctly identifies open Wed/Thu/Fri evenings",
      () => runScenario(
        scenarioDef.scenarios.find((s) => s.id === "open-evening-identification"),
        { passThreshold: 0.8 }
      ),
      TIMEOUT);
  });

  describe("Existing Event Detection", () => {
    itModel("recognizes evenings with existing dinner plans",
      () => runScenario(scenarioDef.scenarios.find((s) => s.id === "dinner-already-booked")),
      TIMEOUT);
  });

  describe("Late Night / Cross-Midnight Events", () => {
    itModel("late dinner assigned to correct local date",
      () => runScenario(scenarioDef.scenarios.find((s) => s.id === "late-dinner-date-assignment")),
      TIMEOUT);
  });

  describe("Query Strategy", () => {
    itModel("plans single range query, not day-by-day",
      () => runScenario(scenarioDef.scenarios.find((s) => s.id === "single-range-query")),
      TIMEOUT);
  });
});
