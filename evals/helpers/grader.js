/**
 * Programmatic grading functions for eval assertions.
 */

/**
 * Check that CLI args array contains all expected argument fragments.
 * @param {string[]} actual - The CLI args produced by a handler
 * @param {string[]} expected - Fragments that must appear in order
 * @returns {{ pass: boolean, missing: string[] }}
 */
export function argsContain(actual, expected) {
  const missing = [];
  for (const fragment of expected) {
    if (!actual.includes(fragment)) {
      missing.push(fragment);
    }
  }
  return { pass: missing.length === 0, missing };
}

/**
 * Check that CLI args contain a specific flag-value pair adjacent to each other.
 * @param {string[]} actual - The CLI args
 * @param {string} flag - e.g. "--start"
 * @param {string} value - e.g. "2026-03-15T19:00:00-07:00"
 * @returns {boolean}
 */
export function argsPairPresent(actual, flag, value) {
  const idx = actual.indexOf(flag);
  return idx !== -1 && actual[idx + 1] === value;
}

/**
 * Check that a string contains all expected substrings.
 * @param {string} text - The text to search
 * @param {string[]} substrings - Required substrings
 * @returns {{ pass: boolean, missing: string[] }}
 */
export function textContainsAll(text, substrings) {
  const missing = substrings.filter((s) => !text.includes(s));
  return { pass: missing.length === 0, missing };
}

/**
 * Check that a result object has all expected keys with non-undefined values.
 * @param {object} result - The result to check
 * @param {string[]} keys - Required keys
 * @returns {{ pass: boolean, missing: string[] }}
 */
export function hasKeys(result, keys) {
  const missing = keys.filter((k) => result[k] === undefined);
  return { pass: missing.length === 0, missing };
}
