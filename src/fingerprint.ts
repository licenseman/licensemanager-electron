import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { hostname, networkInterfaces } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * User-supplied machine fingerprint source.
 *
 * - A plain string is used verbatim as the machine component.
 * - A function (sync or async) is awaited and its result used instead.
 * - When omitted, {@link readMachineId} derives a value from the native
 *   machine GUID.
 */
export type MachineFingerprint = string | (() => string | Promise<string>);

/** Hash a raw machine value into a stable, opaque base64 digest. */
export function hashMachineValue(raw: string): string {
	return createHash("sha256").update(raw).digest("base64");
}

/**
 * Read the OS-native machine GUID and normalise it to a stable lowercase
 * string. The per-OS strategy is adapted from the `node-machine-id` package;
 * on failure it falls back to a hardware MAC address and finally the hostname,
 * so this never throws.
 */
export async function readMachineId(): Promise<string> {
	try {
		switch (process.platform) {
			case "darwin":
				return parseDarwin(
					await run("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]),
				);
			case "win32":
				return parseWin32(
					await run(
						`${process.env.windir ?? "C:\\Windows"}\\System32\\REG.exe`,
						[
							"QUERY",
							"HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography",
							"/v",
							"MachineGuid",
						],
					),
				);
			default:
				return await readLinuxMachineId();
		}
	} catch {
		return fallbackMachineId();
	}
}

async function run(file: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync(file, args, {
		windowsHide: true,
		timeout: 5_000,
	});
	return stdout;
}

function parseDarwin(output: string): string {
	const after = output.split("IOPlatformUUID")[1];
	if (!after) throw new Error("IOPlatformUUID not found");
	const value = after
		.split("\n")[0]
		?.replace(/=|\s+|"/g, "")
		.toLowerCase();
	if (!value) throw new Error("IOPlatformUUID empty");
	return value;
}

function parseWin32(output: string): string {
	const after = output.split("REG_SZ")[1];
	if (!after) throw new Error("MachineGuid not found");
	const value = after.replace(/\r+|\n+|\s+/g, "").toLowerCase();
	if (!value) throw new Error("MachineGuid empty");
	return value;
}

async function readLinuxMachineId(): Promise<string> {
	for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
		try {
			const value = (await readFile(path, "utf8"))
				.replace(/\r+|\n+|\s+/g, "")
				.toLowerCase();
			if (value) return value;
		} catch {
			// try next path
		}
	}
	throw new Error("no machine-id file");
}

/** First non-internal MAC address, else the hostname. Never throws. */
function fallbackMachineId(): string {
	try {
		for (const addrs of Object.values(networkInterfaces())) {
			for (const addr of addrs ?? []) {
				if (!addr.internal && addr.mac && addr.mac !== "00:00:00:00:00:00") {
					return addr.mac.toLowerCase();
				}
			}
		}
	} catch {
		// fall through to hostname
	}
	return hostname().toLowerCase();
}

/**
 * Resolve the machine component of the fingerprint from the user option,
 * returning its base64 sha256 digest.
 */
export async function resolveMachineFingerprint(
	option?: MachineFingerprint,
): Promise<string> {
	let raw: string;
	if (typeof option === "function") {
		raw = await option();
	} else if (typeof option === "string") {
		raw = option;
	} else {
		raw = await readMachineId();
	}
	return hashMachineValue(raw);
}
