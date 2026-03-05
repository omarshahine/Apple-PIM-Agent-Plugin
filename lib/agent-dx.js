/**
 * Agent DX (Developer Experience) middleware.
 *
 * Wraps tool handlers to add cross-cutting agent-friendly features:
 * - `fields`: Post-filters response to requested keys only
 * - `dryRun`: Returns mutation preview without executing
 * - `schema`: Returns the tool's JSON Schema for runtime introspection
 */

import { applyFieldSelection } from "./fields.js";
import { isMutation, buildDryRunResponse } from "./dry-run.js";
import { tools } from "./schemas.js";

/** Index tool schemas by name for O(1) lookup. */
const toolSchemaMap = Object.fromEntries(tools.map((t) => [t.name, t]));

/**
 * Wrap a handler function with agent DX features.
 *
 * @param {string} toolName - The tool name (calendar, reminder, etc.).
 * @param {Function} handler - The original handler(args, runCLI).
 * @returns {Function} Wrapped handler with identical signature.
 */
export function withAgentDX(toolName, handler) {
  return async function agentDXHandler(args, runCLI) {
    // Schema introspection — no CLI call needed
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

    // Dry-run — validate and preview, no CLI call
    if (args.dryRun && isMutation(toolName, args.action)) {
      return buildDryRunResponse(toolName, args);
    }

    // Normal execution
    const result = await handler(args, runCLI);

    // Field selection — post-filter response
    return applyFieldSelection(result, args.fields);
  };
}
