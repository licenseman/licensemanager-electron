import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { hostname, release } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { nodeRequire } from "./node-require.js";

const execFileAsync = promisify(execFile);

/**
 * OS name and version shown in the dashboard, e.g. `macOS 26.5.1`,
 * `Windows 11 (10.0.22631)` or `Linux (Ubuntu 24.04.1 LTS)`. Falls back to the
 * bare OS name when the version can't be read.
 */
export function defaultPlatform(): string {
	switch (process.platform) {
		case "darwin": {
			const version = macosVersion();
			return version ? `macOS ${version}` : "macOS";
		}
		case "win32":
			return windowsPlatform(release());
		case "linux": {
			const distro = linuxDistro();
			return distro ? `Linux (${distro})` : `Linux ${release()}`;
		}
		default:
			return `${process.platform} ${release()}`;
	}
}

/** `ProductVersion` from SystemVersion.plist, e.g. `26.5.1`. */
function macosVersion(): string | undefined {
	try {
		const plist = readFileSync(
			"/System/Library/CoreServices/SystemVersion.plist",
			"utf8",
		);
		const match = /<key>ProductVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(
			plist,
		);
		return match?.[1]?.trim() || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Windows 11 still reports itself as NT 10.0; it is told apart by its build
 * number (22000 and up).
 */
export function windowsPlatform(osRelease: string): string {
	const [major, minor, build] = osRelease.split(".").map(Number);
	if (major === 10 && minor === 0 && build !== undefined) {
		return `Windows ${build >= 22000 ? 11 : 10} (${osRelease})`;
	}
	return `Windows ${osRelease}`;
}

/** `PRETTY_NAME` from os-release, e.g. `Ubuntu 24.04.1 LTS`. */
function linuxDistro(): string | undefined {
	for (const path of ["/etc/os-release", "/usr/lib/os-release"]) {
		try {
			const match = /^PRETTY_NAME=(.*)$/m.exec(readFileSync(path, "utf8"));
			const value = match?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2");
			if (value) return value;
		} catch {
			// try next path
		}
	}
	return undefined;
}

/**
 * The user-facing computer name: `ComputerName` on macOS (e.g. "Jane's
 * MacBook Pro", unlike the network hostname), the pretty hostname on Linux,
 * else the hostname. Never throws.
 */
export async function defaultMachineName(): Promise<string> {
	try {
		const command =
			process.platform === "darwin"
				? ["scutil", "--get", "ComputerName"]
				: process.platform === "linux"
					? ["hostnamectl", "--pretty"]
					: undefined;
		if (command) {
			const [file, ...args] = command as [string, ...string[]];
			const { stdout } = await execFileAsync(file, args, {
				windowsHide: true,
				timeout: 2_000,
			});
			const name = stdout.trim();
			if (name) return name;
		}
	} catch {
		// fall back to the hostname
	}
	return hostname();
}

/** Electron's `app.getVersion()`, or undefined outside the main process. */
export function electronAppVersion(): string | undefined {
	try {
		const electron = nodeRequire("electron") as {
			app?: { getVersion(): string };
		};
		return electron.app?.getVersion();
	} catch {
		return undefined;
	}
}

interface ElectronApp {
	isPackaged?: boolean;
}

function electronApp(): ElectronApp | undefined {
	try {
		const electron = nodeRequire("electron") as { app?: ElectronApp };
		return electron.app;
	} catch {
		return undefined;
	}
}

/**
 * Electron's `app.isPackaged`, or undefined outside the main process (plain
 * Node, tests).
 */
export function electronAppIsPackaged(): boolean | undefined {
	return electronApp()?.isPackaged;
}

/**
 * The running app's bundle identifier (`CFBundleIdentifier`), read from the
 * `Info.plist` of the enclosing `.app` bundle. Only macOS has one; undefined
 * elsewhere or when it can't be read.
 */
export function appBundleId(): string | undefined {
	if (process.platform !== "darwin") return undefined;
	try {
		// <Name>.app/Contents/MacOS/<exe> → <Name>.app/Contents/Info.plist
		const plist = readFileSync(
			join(dirname(dirname(process.execPath)), "Info.plist"),
			"utf8",
		);
		const match =
			/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
		return match?.[1]?.trim() || undefined;
	} catch {
		return undefined;
	}
}
