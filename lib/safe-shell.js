/**
 * Shell wrapper.
 *
 * Centralizes child_process invocations behind a small, auditable surface:
 *   - spawnProcess(cmd, args, opts): spawns a binary with an argv array
 *     (identical contract to child_process.spawn). No shell, no string
 *     interpolation — args cannot inject shell metacharacters.
 *   - whichBinary(name): cross-platform PATH lookup (`which` on POSIX,
 *     `where.exe` on Windows).
 *
 * The rest of the codebase imports only these wrappers; no other module
 * touches child_process directly. Concentrating shell-outs in one file
 * makes them easy to audit.
 */

import { spawn as _spawn, execFileSync as _runFileSync } from "node:child_process";

/** Spawn a process. Identical contract to child_process.spawn. */
export function spawnProcess(cmd, args, opts) {
	return _spawn(cmd, args, opts);
}

/** Cross-platform binary lookup using `which` / `where.exe`. */
export function whichBinary(name) {
	const cmd = process.platform === "win32" ? "where.exe" : "which";
	try {
		const result = _runFileSync(cmd, [name], { encoding: "utf8" }).trim();
		const first = result.split("\n")[0]?.trim();
		return first || null;
	} catch {
		return null;
	}
}
