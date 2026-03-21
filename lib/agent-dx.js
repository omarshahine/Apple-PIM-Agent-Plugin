/**
 * Agent DX (Developer Experience) middleware.
 *
 * Wraps tool handlers to add cross-cutting agent-friendly features:
 * - Access control: calendar/reminder visibility and write restrictions
 * - `fields`: Post-filters response to requested keys only
 * - `dryRun`: Returns mutation preview without executing
 * - `schema`: Returns the tool's JSON Schema for runtime introspection
 */

import { applyFieldSelection } from "./fields.js";
import { isMutation, buildDryRunResponse } from "./dry-run.js";
import { tools } from "./schemas.js";
import {
  getDomainConfig,
  isVisible,
  isWritable,
  getWritableNames,
  resolveWriteTarget,
  validateVisible,
  filterResults,
} from "./access-control.js";

/** Index tool schemas by name for O(1) lookup. */
const toolSchemaMap = Object.fromEntries(tools.map((t) => [t.name, t]));

/**
 * Mapping from tool + action to the post-filter spec: which array key holds
 * the items, and which field on each item holds the calendar/list name.
 */
const READ_FILTER_MAP = {
  calendar: {
    list:   { arrayKey: "calendars", nameField: "title" },
    events: { arrayKey: "events",    nameField: "calendar" },
    search: { arrayKey: "events",    nameField: "calendar" },
  },
  reminder: {
    lists:  { arrayKey: "lists",     nameField: "title" },
    items:  { arrayKey: "reminders", nameField: "list" },
    search: { arrayKey: "reminders", nameField: "list" },
  },
};

/** Map tool name to the args field that holds the calendar/list target. */
const TARGET_FIELD = { calendar: "calendar", reminder: "list" };

/** Map tool name to the human-readable label for error messages. */
const TARGET_LABEL = { calendar: "Calendar", reminder: "Reminder list" };

/** Map tool name to the batch array field. */
const BATCH_FIELD = { calendar: "events", reminder: "reminders" };

// ---------------------------------------------------------------------------
// Access control helpers
// ---------------------------------------------------------------------------

function applyWritePreCheck(toolName, args, domainConfig) {
  const field = TARGET_FIELD[toolName];
  const label = TARGET_LABEL[toolName];
  if (!field || !label) return;

  const action = args.action;

  // Single create — resolve default, validate writable
  if (action === "create") {
    const resolved = resolveWriteTarget(args[field], domainConfig, label);
    if (resolved !== undefined) {
      args[field] = resolved;
    }
    return;
  }

  // Batch create — resolve default per item, validate each
  if (action === "batch_create") {
    const batchField = BATCH_FIELD[toolName];
    const items = args[batchField];
    if (!Array.isArray(items)) return;
    for (const item of items) {
      // Batch calls can specify a top-level calendar/list target that should
      // apply to every item unless an item overrides it explicitly.
      const requested = item[field] ?? args[field];
      const resolved = resolveWriteTarget(requested, domainConfig, label);
      if (resolved !== undefined) {
        item[field] = resolved;
      }
    }
    return;
  }

  // Other mutations with an explicit target — validate writable.
  // update/delete operate by event ID but may also carry the calendar/list
  // name. When present, enforce writability so readOnly protection holds.
  // complete/batch_complete/batch_delete are reminder-only, same logic.
  const otherMutations = new Set([
    "update", "delete", "complete", "batch_complete", "batch_delete",
  ]);
  if (otherMutations.has(action) && args[field]) {
    if (!isVisible(args[field], domainConfig)) {
      const writable = getWritableNames(domainConfig);
      const hint = writable ? ` Writable: ${writable.join(", ")}.` : "";
      throw new Error(`${label} "${args[field]}" is not available.${hint}`);
    }
    if (!isWritable(args[field], domainConfig)) {
      const writable = getWritableNames(domainConfig);
      const hint = writable ? ` Writable: ${writable.join(", ")}.` : "";
      throw new Error(`${label} "${args[field]}" is read-only.${hint}`);
    }
    return;
  }

  // Read actions with an explicit target — validate visibility
  if ((action === "events" || action === "items" || action === "search") && args[field]) {
    validateVisible(args[field], domainConfig, label);
  }
}

function applyReadPostFilter(toolName, action, result, domainConfig) {
  const toolFilters = READ_FILTER_MAP[toolName];
  if (!toolFilters) return result;
  const spec = toolFilters[action];
  if (!spec) return result;
  return filterResults(result, domainConfig, spec.arrayKey, spec.nameField);
}

// ---------------------------------------------------------------------------
// Middleware wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a handler function with agent DX features.
 *
 * @param {string} toolName - The tool name (calendar, reminder, etc.).
 * @param {Function} handler - The original handler(args, runCLI).
 * @returns {Function} Wrapped handler with identical signature.
 */
export function withAgentDX(toolName, handler) {
  return async function agentDXHandler(args, runCLI, ...rest) {
    // 1. Schema introspection — no CLI call needed
    if (args.action === "schema") {
      const schema = toolSchemaMap[toolName];
      if (!schema) {
        throw new Error(`No schema found for tool: ${toolName}`);
      }
      return {
        tool: toolName,
        inputSchema: schema.inputSchema,
        description: schema.description,
      };
    }

    // 2. Access control — write pre-check (before dry-run so previews
    //    don't show operations that would be blocked)
    const domainConfig = getDomainConfig(toolName);
    if (domainConfig) {
      applyWritePreCheck(toolName, args, domainConfig);
    }

    // 3. Dry-run — validate and preview, no CLI call
    if (args.dryRun) {
      if (isMutation(toolName, args.action)) {
        return buildDryRunResponse(toolName, args);
      }
      // Explicit signal that dryRun was requested but has no effect on read actions
      const result = await handler(args, runCLI, ...rest);
      const acFiltered = applyReadPostFilter(toolName, args.action, result, domainConfig);
      const filtered = applyFieldSelection(acFiltered, args.fields);
      return { ...filtered, _dryRunSkipped: true, _note: "dryRun has no effect on read actions" };
    }

    // 4. Normal execution
    const result = await handler(args, runCLI, ...rest);

    // 5. Access control — read post-filter
    const acFiltered = applyReadPostFilter(toolName, args.action, result, domainConfig);

    // 6. Field selection — post-filter response
    return applyFieldSelection(acFiltered, args.fields);
  };
}
