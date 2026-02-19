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
    // Source repo (fallback for development)
    join(homedir(), "GitHub", "Apple-PIM-Agent-Plugin", "swift", ".build", "release"),
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

/**
 * Factory: creates a runCLI function bound to a specific binary directory.
 * @param {string} binDir - Directory containing the Swift CLI binaries.
 * @param {Object} envOverrides - Extra env vars to pass to every spawn call.
 * @returns {{ runCLI: (cli: string, args: string[]) => Promise<object> }}
 */
export function createCLIRunner(binDir, envOverrides = {}) {
  async function runCLI(cli, args) {
    return new Promise((resolve, reject) => {
      const cliPath = join(binDir, cli);
      const proc = spawn(cliPath, args, {
        env: { ...process.env, ...envOverrides },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
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
        reject(new Error(`Failed to run CLI: ${err.message}`));
      });
    });
  }

  return { runCLI };
}
