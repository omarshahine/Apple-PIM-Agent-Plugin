import {
  createCalendarObject as rawCreateCalendarObject,
  deleteCalendarObject as rawDeleteCalendarObject,
  fetchCalendarObjects as rawFetchCalendarObjects,
  fetchCalendars as rawFetchCalendars,
  getBasicAuthHeaders,
  updateCalendarObject as rawUpdateCalendarObject,
} from "tsdav";
import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  DEFAULT_PASSWORD_ENV_VAR,
  DEFAULT_SERVER_URL,
  DEFAULT_TIMEOUT_MS,
  ensureTrailingSlash,
  isWritableCalendar,
  normalize,
  normalizeAliasKey,
  resolveCalendarAliasTarget,
} from "./common.js";

let cachedAccountInfo;
let cachedClientKey;
let cachedClientPromise;

export function resolveCalendarAliases(config = {}) {
  const aliases = {};
  const aliasesFile = config.calendarAliasesFile || process.env.APPLE_PIM_CALENDAR_ALIASES_FILE;

  if (aliasesFile) {
    const expandedPath = aliasesFile.replace(/^~/, homedir());
    if (!existsSync(expandedPath)) {
      throw new Error(`calendar aliases file not found: ${expandedPath}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(readFileSync(expandedPath, "utf8"));
    } catch (error) {
      throw new Error(
        `calendar aliases file is not valid JSON: ${expandedPath} (${error instanceof Error ? error.message : String(error)})`
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`calendar aliases file must contain a JSON object: ${expandedPath}`);
    }

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string" || !value.trim()) continue;
      aliases[normalizeAliasKey(key)] = value.trim();
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("APPLE_PIM_CALENDAR_ALIAS_")) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    const aliasKey = key.slice("APPLE_PIM_CALENDAR_ALIAS_".length);
    if (!aliasKey) continue;
    aliases[normalizeAliasKey(aliasKey)] = value.trim();
  }

  return aliases;
}

export async function getCalDAVClient(config = {}) {
  const settings = resolveCalDAVSettings(config);
  const key = JSON.stringify({
    username: settings.username,
    password: settings.password,
    serverUrl: settings.serverUrl,
    timeoutMs: settings.timeoutMs,
  });

  if (cachedClientPromise && cachedClientKey === key) {
    return cachedClientPromise;
  }

  cachedClientKey = key;
  cachedClientPromise = Promise.resolve(createLowLevelCalDAVClient(settings));
  return cachedClientPromise;
}

function resolveCalDAVSettings(config = {}) {
  const accountInfo = readMobileMeCalendarAccountInfo();
  const passwordEnvVar = config.caldavPasswordEnvVar || DEFAULT_PASSWORD_ENV_VAR;
  const username =
    config.caldavUsername ||
    process.env.ICLOUD_APPLE_ID ||
    accountInfo.username ||
    accountInfo.accountId ||
    "";
  const password =
    config.caldavPassword ||
    (passwordEnvVar ? process.env[passwordEnvVar] : undefined) ||
    "";
  const serverUrl =
    config.caldavServerUrl ||
    process.env.ICLOUD_CALDAV_URL ||
    accountInfo.serverUrl ||
    DEFAULT_SERVER_URL;
  const timeoutMs = Number(config.caldavTimeoutMs || DEFAULT_TIMEOUT_MS);

  if (!username) {
    throw new Error(
      "icloud caldav backend needs an apple id username. set apple-pim-cli.caldavUsername or ICLOUD_APPLE_ID."
    );
  }
  if (!password) {
    throw new Error(
      `icloud caldav backend needs an app-specific password. set apple-pim-cli.caldavPassword or export ${passwordEnvVar}.`
    );
  }

  return {
    username,
    password,
    serverUrl,
    timeoutMs,
  };
}

function readMobileMeCalendarAccountInfo() {
  if (cachedAccountInfo) return cachedAccountInfo;

  const plistPath = join(homedir(), "Library", "Preferences", "MobileMeAccounts.plist");
  if (!existsSync(plistPath)) {
    cachedAccountInfo = {};
    return cachedAccountInfo;
  }

  try {
    const json = execFileSync("plutil", ["-convert", "json", "-o", "-", plistPath], {
      encoding: "utf8",
    });
    const parsed = JSON.parse(json);
    const account = Array.isArray(parsed.Accounts) ? parsed.Accounts[0] : null;
    const services = Array.isArray(account?.Services) ? account.Services : [];
    const calendarService = services.find((service) => service?.Name === "CALENDAR");
    cachedAccountInfo = {
      username: account?.AccountDescription || account?.AccountID || "",
      accountId: account?.AccountID || "",
      accountDsid: account?.AccountDSID || "",
      serverUrl: calendarService?.url || "",
    };
  } catch {
    cachedAccountInfo = {};
  }

  return cachedAccountInfo;
}

function createLowLevelCalDAVClient(settings) {
  const fetchOverride = buildTimedFetch(settings.timeoutMs);
  const headers = getBasicAuthHeaders({
    username: settings.username,
    password: settings.password,
  });
  const account = buildCalDAVAccount(settings);

  return {
    account,
    headers,
    async fetchCalendars() {
      return rawFetchCalendars({
        account,
        headers,
        fetch: fetchOverride,
      });
    },
    async fetchCalendarObjects(params) {
      return rawFetchCalendarObjects({
        ...params,
        headers,
        fetch: fetchOverride,
      });
    },
    async createCalendarObject(params) {
      return rawCreateCalendarObject({
        ...params,
        headers,
        fetch: fetchOverride,
      });
    },
    async updateCalendarObject(params) {
      return rawUpdateCalendarObject({
        ...params,
        headers,
        fetch: fetchOverride,
      });
    },
    async deleteCalendarObject(params) {
      return rawDeleteCalendarObject({
        ...params,
        headers,
        fetch: fetchOverride,
      });
    },
  };
}

function buildCalDAVAccount(settings) {
  const accountInfo = readMobileMeCalendarAccountInfo();
  const dsid = accountInfo.accountDsid;
  if (!dsid) {
    throw new Error("icloud caldav backend could not find AccountDSID in MobileMeAccounts.plist");
  }

  const rootUrl = ensureTrailingSlash(settings.serverUrl);
  return {
    accountType: "caldav",
    serverUrl: rootUrl,
    credentials: {
      username: settings.username,
      password: settings.password,
    },
    rootUrl,
    principalUrl: new URL(`${dsid}/principal/`, rootUrl).href,
    homeUrl: new URL(`${dsid}/calendars/`, rootUrl).href,
  };
}

function buildTimedFetch(timeoutMs) {
  return async function timedFetch(input, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("caldav request timed out")), timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        signal: init.signal || controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function resolveTargetCalendars(client, requestedCalendar, calendarAliases) {
  const calendars = await client.fetchCalendars();
  if (!requestedCalendar) return calendars;
  return [findCalendar(calendars, requestedCalendar, calendarAliases)];
}

export async function resolveSingleCalendar(client, requestedCalendar, calendarAliases) {
  const calendars = await client.fetchCalendars();
  if (requestedCalendar) return findCalendar(calendars, requestedCalendar, calendarAliases);

  const preferred = calendars.find((calendar) => normalize(calendar.displayName) === "daily plan")
    || calendars.find((calendar) => normalize(calendar.displayName) === "shared");
  if (!preferred) {
    throw new Error("no default writable icloud calendar found. specify calendar explicitly.");
  }
  return preferred;
}

function findCalendar(calendars, requested, calendarAliases = null) {
  const resolvedRequested = resolveCalendarAliasTarget(requested, calendarAliases);
  const needle = normalize(resolvedRequested);
  const match = calendars.find((calendar) => {
    const displayName = normalize(calendar.displayName);
    const url = normalize(calendar.url);
    const path = normalize(new URL(calendar.url).pathname);
    return displayName === needle || url === needle || path === needle;
  });
  if (!match) {
    throw new Error(`calendar not found: ${requested}`);
  }
  return match;
}

export function calendarToDict(calendar) {
  return {
    id: calendar.url,
    title: calendar.displayName,
    type: "caldav",
    color: [],
    allowsModifications: isWritableCalendar(calendar),
    source: "iCloud",
    url: calendar.url,
  };
}

export async function fetchCalendarObjectByUrl(client, objectUrl, preferredCalendars = null) {
  const calendars = preferredCalendars || await client.fetchCalendars();
  const calendar = calendars.find((entry) => objectUrl.startsWith(entry.url))
    || await findCalendarForObjectUrl(client, calendars, objectUrl);
  if (!calendar) {
    throw new Error(`calendar object not found: ${objectUrl}`);
  }

  const objects = await client.fetchCalendarObjects({
    calendar,
    objectUrls: [objectUrl],
  });
  const calendarObject = objects.find((entry) => entry.url === objectUrl) || objects[0];

  if (!calendarObject) {
    throw new Error(`calendar object not found: ${objectUrl}`);
  }

  return { calendar, calendarObject };
}

async function findCalendarForObjectUrl(client, calendars, objectUrl) {
  for (const calendar of calendars) {
    try {
      const objects = await client.fetchCalendarObjects({
        calendar,
        objectUrls: [objectUrl],
      });
      if (objects.length > 0) return calendar;
    } catch {
      // keep scanning
    }
  }
  return null;
}
