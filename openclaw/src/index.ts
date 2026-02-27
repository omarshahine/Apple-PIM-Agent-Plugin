/**
 * OpenClaw plugin entry for Apple PIM CLI Tools.
 *
 * Registers 5 tool factories that spawn the Swift CLIs directly (no MCP server).
 * Uses the factory pattern so each agent gets per-workspace config resolution.
 * Supports per-call environment isolation via configDir/profile parameters
 * and automatic workspace convention discovery.
 */

import { createCLIRunner, findSwiftBinDir } from "../lib/cli-runner.js";
import { tools } from "../lib/schemas.js";
import { markToolResult, getDatamarkingPreamble } from "../lib/sanitize.js";
import { handleCalendar } from "../lib/handlers/calendar.js";
import { handleReminder } from "../lib/handlers/reminder.js";
import { handleContact } from "../lib/handlers/contact.js";
import { handleMail } from "../lib/handlers/mail.js";
import { handleApplePim } from "../lib/handlers/apple-pim.js";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { execFileSync } from "child_process";
import { homedir } from "os";

// OpenClaw plugin config (set by the gateway from openclaw.plugin.json configSchema)
interface PluginConfig {
  binDir?: string;
  profile?: string;
  configDir?: string;
}

// Tool args always include optional isolation params
interface ToolArgs {
  action: string;
  configDir?: string;
  profile?: string;
  [key: string]: unknown;
}

// OpenClaw tool result content block (pi-agent-core AgentToolResult)
interface TextContent {
  type: "text";
  text: string;
}

// OpenClaw tool definition (pi-agent-core AgentTool convention)
//
// OpenClaw's internal tool system uses `parameters` (not `inputSchema`) and a
// 4-argument `execute` signature that returns `{ content: TextContent[] }`.
// This differs from the MCP convention used by the MCP server in ../mcp-server/.
interface OpenClawToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (partialResult: unknown) => void
  ) => Promise<{ content: TextContent[]; details?: unknown }>;
}

// Context provided to factory functions at tool resolution time.
// Contains per-agent workspace information for config auto-discovery.
interface OpenClawPluginToolContext {
  config?: Record<string, unknown>; // full gateway config (NOT plugin config)
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  messageChannel?: string;
  agentAccountId?: string;
  sandboxed?: boolean;
}

// Factory function that receives per-agent context and returns tool definition(s)
type OpenClawPluginToolFactory = (ctx: OpenClawPluginToolContext) =>
  OpenClawToolDefinition | OpenClawToolDefinition[] | null | undefined;

// OpenClaw plugin registration interface (pi-agent-core convention)
interface OpenClawContext {
  config?: PluginConfig;
  registerTool(toolOrFactory: OpenClawToolDefinition | OpenClawPluginToolFactory): void;
}

// Map MCP tool names to OpenClaw snake_case names
const TOOL_NAME_MAP: Record<string, string> = {
  "calendar": "apple_pim_calendar",
  "reminder": "apple_pim_reminder",
  "contact": "apple_pim_contact",
  "mail": "apple_pim_mail",
  "apple-pim": "apple_pim_system",
};

// Map MCP tool names to handler functions
const HANDLERS: Record<string, (args: ToolArgs, runCLI: (cli: string, args: string[]) => Promise<object>) => Promise<object>> = {
  "calendar": handleCalendar,
  "reminder": handleReminder,
  "contact": handleContact,
  "mail": handleMail,
  "apple-pim": handleApplePim,
};

/**
 * Resolve the binary directory using a discovery chain:
 * 1. Plugin config binDir
 * 2. Env var APPLE_PIM_BIN_DIR
 * 3. PATH lookup (which calendar-cli)
 * 4. ~/.local/bin/ (setup.sh --install target)
 */
function resolveBinDir(config?: PluginConfig): string {
  // 1. Plugin config
  if (config?.binDir && existsSync(join(config.binDir, "calendar-cli"))) {
    return config.binDir;
  }

  // 2. Env var
  const envBinDir = process.env.APPLE_PIM_BIN_DIR;
  if (envBinDir && existsSync(join(envBinDir, "calendar-cli"))) {
    return envBinDir;
  }

  // 3. PATH lookup (execFileSync avoids shell injection)
  try {
    const whichResult = execFileSync("which", ["calendar-cli"], { encoding: "utf8" }).trim();
    if (whichResult) {
      return dirname(whichResult);
    }
  } catch {
    // Not on PATH, continue
  }

  // 4-5. Standard locations via findSwiftBinDir
  return findSwiftBinDir();
}

/**
 * Check if a workspace has an apple-pim config directory by convention.
 * Convention: {workspaceDir}/apple-pim/config.json
 */
function resolveWorkspaceConfigDir(workspaceDir?: string): string | undefined {
  if (!workspaceDir) return undefined;
  const conventionPath = join(workspaceDir, "apple-pim");
  return existsSync(join(conventionPath, "config.json")) ? conventionPath : undefined;
}

/**
 * Resolve per-call environment overrides for workspace isolation.
 *
 * Priority chain (per parameter):
 * 1. Tool parameter (per-call override)
 * 2. Workspace convention ({workspaceDir}/apple-pim/)
 * 3. Plugin config (gateway-level default)
 * 4. Process env (APPLE_PIM_CONFIG_DIR / APPLE_PIM_PROFILE)
 * 5. Default (~/.config/apple-pim/)
 */
function resolveEnvOverrides(
  args: ToolArgs,
  config?: PluginConfig,
  workspaceDir?: string
): Record<string, string> {
  const env: Record<string, string> = {};

  // Resolve configDir with workspace convention at priority 2
  const workspaceConfigDir = resolveWorkspaceConfigDir(workspaceDir);
  const configDir = args.configDir || workspaceConfigDir || config?.configDir || process.env.APPLE_PIM_CONFIG_DIR;
  if (configDir) {
    env.APPLE_PIM_CONFIG_DIR = configDir.replace(/^~/, homedir());
  }

  // Resolve profile
  const profile = args.profile || config?.profile || process.env.APPLE_PIM_PROFILE;
  if (profile) {
    env.APPLE_PIM_PROFILE = profile;
  }

  return env;
}

/**
 * OpenClaw plugin activation function.
 * Called by the OpenClaw gateway when the plugin is loaded.
 *
 * Registers tool factories (not static tools) so each agent gets
 * per-workspace config resolution via ctx.workspaceDir.
 */
export default function activate(context: OpenClawContext): void {
  const config = context.config;
  const binDir = resolveBinDir(config);

  for (const tool of tools) {
    const openclawName = TOOL_NAME_MAP[tool.name];
    const handler = HANDLERS[tool.name];

    if (!openclawName || !handler) continue;

    context.registerTool((ctx: OpenClawPluginToolContext) => {
      const workspaceDir = ctx.workspaceDir;

      return {
        name: openclawName,
        label: openclawName,
        description: tool.description,
        parameters: tool.inputSchema as Record<string, unknown>,

        async execute(
          _toolCallId: string,
          params: Record<string, unknown>,
          _signal?: AbortSignal,
          _onUpdate?: (partialResult: unknown) => void
        ) {
          // Runtime validation — ensure required 'action' field is present and valid
          if (typeof params.action !== "string" || !params.action) {
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "Missing required 'action' parameter" }, null, 2) }],
            };
          }
          const toolArgs = params as ToolArgs;

          // Per-call environment isolation — never mutates process.env
          const envOverrides = resolveEnvOverrides(toolArgs, config, workspaceDir);
          const { runCLI } = createCLIRunner(binDir, envOverrides);

          try {
            const result = await handler(toolArgs, runCLI);

            // Apply datamarking for prompt injection defense
            const markedResult = markToolResult(result, tool.name);
            const preamble = getDatamarkingPreamble(tool.name);

            return {
              content: [{ type: "text" as const, text: `${preamble}\n\n${JSON.stringify(markedResult, null, 2)}` }],
            };
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }, null, 2) }],
            };
          }
        },
      };
    });
  }
}
