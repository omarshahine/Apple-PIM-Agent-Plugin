import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import { createSequentialMockCLI, loadFixture } from "./mock-cli.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenariosDir = join(__dirname, "..", "scenarios");

/**
 * Load and parse a YAML scenario file.
 * @param {string} filename - e.g. "tool-call-correctness.yaml"
 * @returns {object} Parsed scenario definition
 */
export function loadScenario(filename) {
  const path = join(scenariosDir, filename);
  return yaml.load(readFileSync(path, "utf-8"));
}

/**
 * Resolve a fixture reference to actual data.
 * Fixture refs use the format "domain/name" (e.g. "calendar/create-success").
 * @param {string|object} ref - Either a fixture ref string or inline data
 * @returns {object} The resolved data
 */
function resolveFixture(ref) {
  if (typeof ref === "string" && ref.includes("/")) {
    const [domain, name] = ref.split("/");
    return loadFixture(domain, name);
  }
  return ref;
}

/**
 * Run a multi-turn scenario against handler functions.
 *
 * @param {object} scenario - A single scenario definition with turns
 * @param {Record<string, Function>} handlers - Map of tool name to handler function
 * @returns {{ calls: Array<{cli: string, args: string[]}>, results: object[], errors: Error[] }}
 */
export async function runScenario(scenario, handlers) {
  const responses = (scenario.setup?.responses || []).map(resolveFixture);
  const { mock, calls } = createSequentialMockCLI(responses);
  const results = [];
  const errors = [];

  for (const turn of scenario.turns || []) {
    const handler = handlers[turn.tool];
    if (!handler) {
      errors.push(new Error(`No handler for tool: ${turn.tool}`));
      continue;
    }

    try {
      const result = await handler(turn.input, mock);
      results.push(result);
    } catch (err) {
      errors.push(err);
      results.push(null);
    }
  }

  return { calls, results, errors };
}
