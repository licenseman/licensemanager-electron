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
