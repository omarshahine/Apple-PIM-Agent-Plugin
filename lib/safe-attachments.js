import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";

const CONFIG_PATH = process.env.APPLE_PIM_MAIL_ATTACHMENTS_CONFIG
  || `${homedir()}/.config/apple-pim/mail-attachments.json`;

const DEFAULT_DENIED_BASENAMES = new Set([
  ".netrc", ".pgpass", ".env", ".envrc",
  "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa",
  "authorized_keys", "known_hosts",
  "credentials",
]);

const DEFAULT_DENIED_DIR_COMPONENTS = new Set([
  ".ssh", ".aws", ".gnupg", ".kube", ".docker",
  ".secrets", ".secrets-macbook-pro", ".chezmoi",
  "Keychains",
]);

const DEFAULT_DENIED_BASENAME_REGEX = [
  /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i,
  /^\.secrets/, /secret/i, /password/i, /credential/i, /token/i,
  /keychain-access/i,
];

function expandHome(p) {
  if (typeof p !== "string") throw new TypeError("Attachment path must be a string");
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  if (p === "~") return homedir();
  return p;
}

function loadPolicy() {
  if (!existsSync(CONFIG_PATH)) return { enabled: false };
  let raw;
  try {
    raw = readFileSync(CONFIG_PATH, "utf8");
  } catch (err) {
    throw new Error(`Cannot read mail attachments policy at ${CONFIG_PATH}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${CONFIG_PATH}: ${err.message}`);
  }
  return {
    enabled: parsed.enabled === true,
    allowedRoots: Array.isArray(parsed.allowedRoots) ? parsed.allowedRoots.map(expandHome).map((r) => resolve(r)) : [],
    extraDeniedBasenames: Array.isArray(parsed.deniedBasenames) ? parsed.deniedBasenames : [],
    extraDeniedDirComponents: Array.isArray(parsed.deniedDirComponents) ? parsed.deniedDirComponents : [],
  };
}

function canonicalizeRoot(root) {
  try {
    return realpathSync(root);
  } catch {
    return resolve(root);
  }
}

function isWithinRoot(canonicalPath, root) {
  const canonRoot = canonicalizeRoot(root);
  if (canonicalPath === canonRoot) return true;
  return canonicalPath.startsWith(canonRoot + sep);
}

function failsHardDenylist(canonicalPath, policy) {
  const parts = canonicalPath.split(sep);
  const basename = parts[parts.length - 1];
  if (DEFAULT_DENIED_BASENAMES.has(basename)) return `denylisted filename: ${basename}`;
  if (policy.extraDeniedBasenames?.includes(basename)) return `denylisted filename: ${basename}`;
  for (const re of DEFAULT_DENIED_BASENAME_REGEX) {
    if (re.test(basename)) return `denylisted filename pattern: ${basename}`;
  }
  for (const comp of parts.slice(0, -1)) {
    if (DEFAULT_DENIED_DIR_COMPONENTS.has(comp)) return `denylisted directory: ${comp}`;
    if (policy.extraDeniedDirComponents?.includes(comp)) return `denylisted directory: ${comp}`;
  }
  return null;
}

export function validateAttachment(rawPath, { policy = loadPolicy() } = {}) {
  if (!policy.enabled) {
    throw new Error(
      `Mail attachments are disabled by default to prevent local-file exfiltration. To enable, create ${CONFIG_PATH} with {"enabled": true, "allowedRoots": ["~/Downloads"]}. See plugin docs for details.`,
    );
  }
  if (!policy.allowedRoots || policy.allowedRoots.length === 0) {
    throw new Error(
      `Mail attachments policy at ${CONFIG_PATH} must list at least one entry in "allowedRoots".`,
    );
  }
  const expanded = expandHome(rawPath);
  if (!existsSync(expanded)) {
    throw new Error(`Attachment file not found: ${expanded}`);
  }
  let canonical;
  try {
    canonical = realpathSync(expanded);
  } catch (err) {
    throw new Error(`Cannot resolve attachment path ${expanded}: ${err.message}`);
  }
  let st;
  try {
    st = statSync(canonical);
  } catch (err) {
    throw new Error(`Cannot stat attachment ${canonical}: ${err.message}`);
  }
  if (!st.isFile()) {
    throw new Error(`Attachment must be a regular file: ${canonical}`);
  }
  const inAllowedRoot = policy.allowedRoots.some((root) => isWithinRoot(canonical, root));
  if (!inAllowedRoot) {
    throw new Error(
      `Attachment ${canonical} is outside allowedRoots (${policy.allowedRoots.join(", ")}). Refusing to attach.`,
    );
  }
  const denyReason = failsHardDenylist(canonical, policy);
  if (denyReason) {
    throw new Error(`Attachment refused (${denyReason}): ${canonical}`);
  }
  return canonical;
}

export function validateAttachments(paths, opts = {}) {
  const policy = opts.policy ?? loadPolicy();
  const list = Array.isArray(paths) ? paths : [paths];
  return list.map((p) => validateAttachment(p, { policy }));
}

export const _internals = { CONFIG_PATH, loadPolicy, expandHome };
