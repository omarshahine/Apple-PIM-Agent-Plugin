import { vi } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures");

/**
 * Load a fixture JSON file by domain and name.
 * @param {string} domain - e.g. "calendar", "reminder", "contact", "mail"
 * @param {string} name - e.g. "create-success", "events-list"
 * @returns {object} Parsed JSON fixture
 */
export function loadFixture(domain, name) {
  const path = join(fixturesDir, domain, `${name}.json`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

/**
 * Create a mock runCLI function that returns fixture data based on a response map.
 *
 * @param {Record<string, object>} responseMap - Keys are "cli:action" (e.g. "calendar-cli:create"),
 *   values are the JSON response to return. If the value is an Error instance, the mock rejects.
 * @returns {import("vitest").Mock} A vi.fn() mock
 */
export function createMockCLI(responseMap = {}) {
  return vi.fn(async (cli, args) => {
    const action = args[0]; // first positional arg is always the action
    const key = `${cli}:${action}`;

    if (responseMap[key] instanceof Error) {
      throw responseMap[key];
    }

    if (responseMap[key] !== undefined) {
      return responseMap[key];
    }

    // Fallback: return a generic success
    return { success: true };
  });
}

/**
 * Create a mock CLI that records calls and returns fixture responses in sequence.
 * Useful for multi-turn scenarios.
 *
 * @param {object[]} responses - Array of responses returned in order of calls
 * @returns {{ mock: import("vitest").Mock, calls: Array<{cli: string, args: string[]}> }}
 */
export function createSequentialMockCLI(responses = []) {
  let callIndex = 0;
  const calls = [];

  const mock = vi.fn(async (cli, args) => {
    calls.push({ cli, args: [...args] });
    const response = responses[callIndex] || { success: true };
    callIndex++;

    if (response instanceof Error) throw response;
    return response;
  });

  return { mock, calls };
}
