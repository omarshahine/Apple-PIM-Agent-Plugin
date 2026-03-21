import { createCalDAVCalendarHandler } from "./calendar-caldav.js";

function calendarRuntimeInfo(runtime = {}) {
  const pluginConfig = runtime?.pluginConfig || {};
  const passwordEnvVar = pluginConfig.caldavPasswordEnvVar || "ICLOUD_APP_SPECIFIC_PASSWORD";
  const username = pluginConfig.caldavUsername || process.env.ICLOUD_APPLE_ID || "";
  const password = pluginConfig.caldavPassword || process.env[passwordEnvVar] || "";
  const calendarAliasesFile =
    pluginConfig.calendarAliasesFile ||
    process.env.APPLE_PIM_CALENDAR_ALIASES_FILE ||
    null;
  const calendarAliasEnvVars = Object.keys(process.env)
    .filter((key) => key.startsWith("APPLE_PIM_CALENDAR_ALIAS_"))
    .sort();

  return {
    backend: "icloud-caldav",
    remote: true,
    configured: Boolean(username && password),
    usernameConfigured: Boolean(username),
    passwordConfigured: Boolean(password),
    passwordEnvVar,
    calendarAliasesFile,
    calendarAliasEnvVars,
  };
}

function buildCalendarStatus(runtime = {}) {
  const info = calendarRuntimeInfo(runtime);
  return {
    enabled: info.configured,
    authorization: info.configured ? "configured" : "missingConfig",
    message: info.configured
      ? "Direct iCloud CalDAV backend configured"
      : "Direct iCloud CalDAV backend is missing credentials. Set caldavUsername and an Apple app-specific password.",
    backend: info.backend,
    remote: info.remote,
    ...(info.calendarAliasesFile ? { calendarAliasesFile: info.calendarAliasesFile } : {}),
    ...(info.calendarAliasEnvVars.length > 0 ? { calendarAliasEnvVars: info.calendarAliasEnvVars } : {}),
  };
}

export async function handleApplePim(args, runCLI, runtime = {}) {
  switch (args.action) {
    case "status": {
      const status = {
        calendars: buildCalendarStatus(runtime),
      };
      const domains = [
        { name: "reminders", cli: "reminder-cli" },
        { name: "contacts", cli: "contacts-cli" },
        { name: "mail", cli: "mail-cli" },
      ];

      const statusMessages = {
        authorized: "Full access granted",
        notDetermined: "Permission not yet requested. Run authorize to prompt.",
        denied: "Access denied. Enable in System Settings > Privacy & Security.",
        restricted: "Access restricted by system policy (MDM or parental controls).",
        writeOnly: "Write-only access. Upgrade in System Settings > Privacy & Security.",
        unavailable: "Not available",
      };

      for (const domain of domains) {
        try {
          const result = await runCLI(domain.cli, ["auth-status"]);
          const auth = result.authorization || "unknown";
          status[domain.name] = {
            enabled: true,
            authorization: auth,
            message: result.message || statusMessages[auth] || `Status: ${auth}`,
          };
        } catch (err) {
          status[domain.name] = {
            enabled: false,
            authorization: "error",
            message: err.message,
          };
        }
      }

      return { status };
    }

    case "authorize": {
      const targetDomain = args.domain;
      const results = {};

      if (!targetDomain || targetDomain === "calendars") {
        const calendarStatus = buildCalendarStatus(runtime);
        results.calendars = calendarStatus.enabled
          ? {
              success: true,
              message: "Calendar uses direct iCloud CalDAV. No local macOS permission prompt is required.",
            }
          : {
              success: false,
              message: "Calendar uses direct iCloud CalDAV and is missing credentials. Set caldavUsername and an Apple app-specific password.",
            };
      }

      const domains = [
        { name: "reminders", cli: "reminder-cli", args: ["lists"] },
        { name: "contacts", cli: "contacts-cli", args: ["groups"] },
        { name: "mail", cli: "mail-cli", args: ["accounts"] },
      ];

      const toAuthorize = targetDomain
        ? domains.filter((d) => d.name === targetDomain)
        : domains;

      for (const domain of toAuthorize) {
        try {
          await runCLI(domain.cli, domain.args);
          results[domain.name] = { success: true, message: "Access authorized" };
        } catch (err) {
          const msg = err.message.toLowerCase();
          if (msg.includes("denied") || msg.includes("not granted")) {
            results[domain.name] = {
              success: false,
              message:
                "Access denied. The user must manually enable access:\n" +
                "1. Open System Settings > Privacy & Security\n" +
                `2. Find the ${domain.name === "mail" ? "Automation" : domain.name.charAt(0).toUpperCase() + domain.name.slice(1)} section\n` +
                "3. Enable access for the terminal application\n" +
                "4. Restart the terminal and try again",
            };
          } else if (msg.includes("not running") && domain.name === "mail") {
            results[domain.name] = {
              success: false,
              message: "Mail.app must be running before authorization can be requested.",
            };
          } else {
            results[domain.name] = { success: false, message: err.message };
          }
        }
      }

      return { results };
    }

    case "config_show": {
      const configArgs = ["config", "show"];
      if (args.profile) configArgs.push("--profile", args.profile);
      return await runCLI("reminder-cli", configArgs);
    }

    case "config_init": {
      const configArgs = ["config", "init"];
      const showArgs = ["config", "show"];
      if (args.profile) {
        configArgs.push("--profile", args.profile);
        showArgs.push("--profile", args.profile);
      }

      const [reminderConfig, resolvedConfig, calendarResult] = await Promise.all([
        runCLI("reminder-cli", configArgs),
        runCLI("reminder-cli", showArgs),
        createCalDAVCalendarHandler(runtime?.pluginConfig || {} )({ action: "list" }),
      ]);

      return {
        success: true,
        configPath: reminderConfig.configPath,
        profilesDir: reminderConfig.profilesDir,
        availableCalendars: calendarResult.calendars || [],
        availableReminderLists: reminderConfig.availableReminderLists || [],
        defaultCalendar: resolvedConfig.config?.default_calendar || "",
        defaultReminderList:
          reminderConfig.defaultReminderList ||
          resolvedConfig.config?.default_reminder_list ||
          "",
      };
    }

    default:
      throw new Error(`Unknown apple-pim action: ${args.action}`);
  }
}
