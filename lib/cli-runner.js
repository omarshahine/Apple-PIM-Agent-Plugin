import { spawn } from "child_process";
import { join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";

/**
 * Locate Swift CLI binaries by checking multiple locations in order.
 * @param {string[]} extraLocations - Additional directories to check first.
 * @returns {string} Path to the directory containing CLI binaries.
 */
export function findSwiftBinDir(extraLocations = []) {
  const locations = [
    ...extraLocations,
    // ~/.local/bin (setup.sh --install target)
    join(homedir(), ".local", "bin"),
  ];

  for (const loc of locations) {
    if (existsSync(join(loc, "calendar-cli"))) {
      return loc;
    }
  }

  // Return first location as default (will fail with helpful error)
  return locations[0];
}

/**
 * Helper to calculate relative date string from days offset.
 * @param {number} daysOffset - Number of days to offset from today.
 * @returns {string} Date in YYYY-MM-DD format.
 */
export function relativeDateString(daysOffset) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return date.toISOString().split("T")[0];
}

/** Default timeout for CLI execution (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Factory: creates a runCLI function bound to a specific binary directory.
 * @param {string} binDir - Directory containing the Swift CLI binaries.
 * @param {Object} envOverrides - Extra env vars to pass to every spawn call.
 * @param {{ timeoutMs?: number }} options - Options (e.g. timeout).
 * @returns {{ runCLI: (cli: string, args: string[]) => Promise<object> }}
 */
export function createCLIRunner(binDir, envOverrides = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  async function runCLI(cli, args) {
    return new Promise((resolve, reject) => {
      const cliPath = join(binDir, cli);
      const proc = spawn(cliPath, args, {
        env: { ...process.env, ...envOverrides },
      });

      let stdout = "";
      let stderr = "";
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGTERM");
        reject(new Error(`CLI timed out after ${timeoutMs}ms: ${cli} ${args.join(" ")}`));
      }, timeoutMs);

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (killed) return; // already rejected by timeout
        if (code === 0) {
          try {
            resolve(JSON.parse(stdout));
          } catch {
            resolve({ success: true, output: stdout });
          }
        } else {
          reject(new Error(stderr || `CLI exited with code ${code}`));
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        if (killed) return;
        reject(new Error(`Failed to run CLI: ${err.message}`));
      });
    });
  }

  return { runCLI };
}
