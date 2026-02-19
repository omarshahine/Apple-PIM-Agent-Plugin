/**
 * OpenClaw plugin entry for Apple PIM CLI Tools.
 *
 * Registers 5 tools that spawn the Swift CLIs directly (no MCP server).
 * Supports per-call environment isolation via configDir/profile parameters
 * for multi-agent workspaces.
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

// OpenClaw tool registration interface
interface OpenClawContext {
  config?: PluginConfig;
  registerTool(definition: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (args: Record<string, unknown>) => Promise<{ content: string }>;
  }): void;
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
 * Resolve per-call environment overrides for workspace isolation.
 *
 * Priority chain (per parameter):
 * 1. Tool parameter (per-call override)
 * 2. Plugin config (gateway-level default)
 * 3. Process env (APPLE_PIM_CONFIG_DIR / APPLE_PIM_PROFILE)
 * 4. Default (~/.config/apple-pim/)
 */
function resolveEnvOverrides(args: ToolArgs, config?: PluginConfig): Record<string, string> {
  const env: Record<string, string> = {};

  // Resolve configDir
  const configDir = args.configDir || config?.configDir || process.env.APPLE_PIM_CONFIG_DIR;
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
 */
export default function activate(context: OpenClawContext): void {
  const config = context.config;
  const binDir = resolveBinDir(config);

  for (const tool of tools) {
    const openclawName = TOOL_NAME_MAP[tool.name];
    const handler = HANDLERS[tool.name];

    if (!openclawName || !handler) continue;

    context.registerTool({
      name: openclawName,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,

      async execute(args: Record<string, unknown>) {
        // Runtime validation — ensure required 'action' field is present and valid
        if (typeof args.action !== "string" || !args.action) {
          return {
            content: JSON.stringify({ success: false, error: "Missing required 'action' parameter" }, null, 2),
          };
        }
        const toolArgs = args as ToolArgs;

        // Per-call environment isolation — never mutates process.env
        const envOverrides = resolveEnvOverrides(toolArgs, config);
        const { runCLI } = createCLIRunner(binDir, envOverrides);

        try {
          const result = await handler(toolArgs, runCLI);

          // Apply datamarking for prompt injection defense
          const markedResult = markToolResult(result, tool.name);
          const preamble = getDatamarkingPreamble(tool.name);

          return {
            content: `${preamble}\n\n${JSON.stringify(markedResult, null, 2)}`,
          };
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: JSON.stringify({ success: false, error: message }, null, 2),
          };
        }
      },
    });
  }
}
