/**
 * OpenClaw plugin entry for Apple PIM CLI Tools.
 *
 * Registers 5 tool factories with direct handlers (no MCP server).
 * Uses the factory pattern so each agent gets per-workspace config resolution.
 * Supports per-call environment isolation via configDir/profile parameters
 * and automatic workspace convention discovery.
 */

import { createCLIRunner, findSwiftBinDir } from "../lib/cli-runner.js";
import { tools } from "../lib/schemas.js";
import { markToolResult, getDatamarkingPreamble } from "../lib/sanitize.js";
import { withAgentDX } from "../lib/agent-dx.js";
import { initAccessConfig } from "../lib/access-control.js";
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
  accessFile?: string;
  caldavServerUrl?: string;
  caldavUsername?: string;
  caldavPassword?: string;
  caldavPasswordEnvVar?: string;
  calendarAliasesFile?: string;
  caldavTimeoutMs?: number;
}

const PLUGIN_CONFIG_KEYS = new Set([
  "binDir",
  "profile",
  "configDir",
  "accessFile",
  "caldavServerUrl",
  "caldavUsername",
  "caldavPassword",
  "caldavPasswordEnvVar",
  "calendarAliasesFile",
  "caldavTimeoutMs",
]);

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function resolvePluginConfig(rawConfig?: unknown): PluginConfig | undefined {
  const record = asRecord(rawConfig);
  if (!record) return undefined;

  // Some OpenClaw paths hand plugins their own config directly.
  if (Object.keys(record).some((key) => PLUGIN_CONFIG_KEYS.has(key))) {
    return record as PluginConfig;
  }

  // Other paths hand plugins the full gateway config. In that case, pull the
  // nested plugin entry back out so handlers see the actual apple-pim config.
  const plugins = asRecord(record.plugins);
  const entries = asRecord(plugins?.entries);
  const pluginEntry = asRecord(entries?.["apple-pim-cli"]);
  const nestedConfig = asRecord(pluginEntry?.config);
  return nestedConfig as PluginConfig | undefined;
}

// Map MCP tool names to OpenClaw snake_case names
const TOOL_NAME_MAP: Record<string, string> = {
  "calendar": "apple_pim_calendar",
  "reminder": "apple_pim_reminder",
  "contact": "apple_pim_contact",
  "mail": "apple_pim_mail",
  "apple-pim": "apple_pim_system",
};

// Map MCP tool names to default handler functions (wrapped with agent DX features)
const HANDLERS: Record<string, (args: ToolArgs, runCLI: (cli: string, args: string[]) => Promise<object>, runtime?: unknown) => Promise<object>> = {
  "calendar": withAgentDX("calendar", handleCalendar) as typeof handleCalendar,
  "reminder": withAgentDX("reminder", handleReminder) as typeof handleReminder,
  "contact": withAgentDX("contact", handleContact) as typeof handleContact,
  "mail": withAgentDX("mail", handleMail) as typeof handleMail,
  "apple-pim": withAgentDX("apple-pim", handleApplePim) as typeof handleApplePim,
};

/**
 * Resolve the binary directory for reminder/contact/mail CLIs using a discovery chain:
 * 1. Plugin config binDir
 * 2. Env var APPLE_PIM_BIN_DIR
 * 3. PATH lookup (which reminder-cli)
 * 4. ~/.local/bin/ (setup.sh --install target)
 */
function resolveBinDir(config?: PluginConfig): string {
  const requiredBins = ["reminder-cli", "contacts-cli", "mail-cli"];

  // 1. Plugin config
  if (config?.binDir && requiredBins.every((bin) => existsSync(join(config.binDir as string, bin)))) {
    return config.binDir;
  }

  // 2. Env var
  const envBinDir = process.env.APPLE_PIM_BIN_DIR;
  if (envBinDir && requiredBins.every((bin) => existsSync(join(envBinDir, bin)))) {
    return envBinDir;
  }

  // 3. PATH lookup (execFileSync avoids shell injection)
  try {
    const whichResult = execFileSync("which", ["reminder-cli"], { encoding: "utf8" }).trim();
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
  const config = resolvePluginConfig(context.config);
  const binDir = resolveBinDir(config);

  // Load access control config (calendar/reminder visibility and write restrictions).
  // Uses: config.accessFile > APPLE_PIM_ACCESS_FILE env > ~/.config/apple-pim/access.json
  // If no file exists, all access is open (current behavior).
  initAccessConfig(config?.accessFile);

  for (const tool of tools) {
    const openclawName = TOOL_NAME_MAP[tool.name];
    const defaultHandler = HANDLERS[tool.name];

    if (!openclawName || !defaultHandler) continue;

    context.registerTool((ctx: OpenClawPluginToolContext) => {
      const workspaceDir = ctx.workspaceDir;
      const runtimePluginConfig = resolvePluginConfig(ctx.config) || config;

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
          const envOverrides = resolveEnvOverrides(toolArgs, runtimePluginConfig, workspaceDir);
          const { runCLI } = createCLIRunner(binDir, envOverrides);
          const handler = defaultHandler;
          const calendarBackend = tool.name === "calendar"
            ? "icloud-caldav"
            : null;

          try {
            const rawResult = await handler(toolArgs, runCLI, {
              pluginConfig: runtimePluginConfig,
              workspaceDir,
              toolContext: ctx,
            });
            const result = calendarBackend && rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)
              ? { backend: calendarBackend, ...rawResult }
              : rawResult;

            // Apply datamarking for prompt injection defense
            const markedResult = markToolResult(result, tool.name);
            const preamble = getDatamarkingPreamble(tool.name);

            return {
              content: [{ type: "text" as const, text: `${preamble}\n\n${JSON.stringify(markedResult, null, 2)}` }],
            };
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            const payload = calendarBackend
              ? { success: false, backend: calendarBackend, error: message }
              : { success: false, error: message };
            return {
              content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
            };
          }
        },
      };
    });
  }
}
