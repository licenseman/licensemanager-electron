import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { nodeRequire } from "./node-require.js";

export function defaultPlatform(): string {
	switch (process.platform) {
		case "darwin":
			return "macOS";
		case "win32":
			return "Windows";
		case "linux":
			return "Linux";
		default:
			return process.platform;
	}
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
