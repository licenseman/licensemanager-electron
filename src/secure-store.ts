import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { nodeRequire } from "./node-require.js";

/** Keyring service shared by every app embedding the SDK. */
const KEYRING_SERVICE = "dev.licensemanager.sdk";

/** Minimal shape of the lazily-loaded `@napi-rs/keyring` Entry. */
interface KeyringEntry {
	getPassword(): string | null;
	setPassword(password: string): void;
	deletePassword?(): boolean;
}

export type EntryCtor = new (service: string, account: string) => KeyringEntry;

/** Default loader: `@napi-rs/keyring`, or `null` on absent/headless systems. */
function loadKeyring(): EntryCtor | null {
	try {
		const mod = nodeRequire("@napi-rs/keyring") as { Entry: EntryCtor };
		return mod.Entry;
	} catch {
		return null;
	}
}

let keyringLoader: () => EntryCtor | null = loadKeyring;
let entryCtor: EntryCtor | null | undefined;

/** Load the keyring constructor once; cache the result. */
function getEntryCtor(): EntryCtor | null {
	if (entryCtor === undefined) entryCtor = keyringLoader();
	return entryCtor;
}

/**
 * Override the keyring backend. Intended for tests — pass an in-memory fake for
 * isolation, or `null` to force the file fallback. Resets the cache.
 */
export function setKeyringLoaderForTests(
	loader: (() => EntryCtor | null) | null,
): void {
	keyringLoader = loader ?? loadKeyring;
	entryCtor = undefined;
}

/**
 * Per-product persistence for small secret strings (install ID, last-seen
 * timestamp, license key and token).
 *
 * Primary backend is the OS secret store via `@napi-rs/keyring` (macOS
 * Keychain, Windows Credential Manager, Linux Secret Service). When the
 * keyring is unavailable or throws, values are mirrored to redundant,
 * non-obvious files so they survive app uninstall/reinstall.
 *
 * Every entry is namespaced by `productId`, so multiple apps using the SDK
 * never read or overwrite each other's values.
 */
export class SecureStore {
	readonly #productId: string;
	/** GUID-looking per-product id with no "license" marker. */
	readonly #namespace: string;
	readonly #dirs: string[];

	constructor(productId: string, storageDirs?: string[]) {
		this.#productId = productId;
		this.#namespace = createHash("sha256")
			.update(`${KEYRING_SERVICE}:${productId}`)
			.digest("hex")
			.slice(0, 32);
		this.#dirs = storageDirs ?? defaultDirs(this.#namespace);
	}

	get(key: string): string | null {
		const fromKeyring = this.#keyringGet(key);
		if (fromKeyring !== null) return fromKeyring;
		return this.#fileGet(key);
	}

	set(key: string, value: string): void {
		this.#keyringSet(key, value);
		this.#fileSet(key, value);
	}

	delete(key: string): void {
		try {
			this.#entry(key)?.deletePassword?.();
		} catch {
			// best effort; files are still removed
		}
		for (const dir of this.#dirs) {
			try {
				rmSync(join(dir, fileName(key)), { force: true });
			} catch {
				// best effort per location
			}
		}
	}

	#entry(key: string): KeyringEntry | null {
		const Ctor = getEntryCtor();
		if (!Ctor) return null;
		try {
			return new Ctor(KEYRING_SERVICE, `${this.#productId}:${key}`);
		} catch {
			return null;
		}
	}

	#keyringGet(key: string): string | null {
		try {
			return this.#entry(key)?.getPassword() ?? null;
		} catch {
			return null;
		}
	}

	#keyringSet(key: string, value: string): void {
		try {
			this.#entry(key)?.setPassword(value);
		} catch {
			// best effort; file mirror still runs
		}
	}

	#fileGet(key: string): string | null {
		for (const dir of this.#dirs) {
			try {
				const value = readFileSync(join(dir, fileName(key)), "utf8");
				if (value) return value;
			} catch {
				// try next location
			}
		}
		return null;
	}

	#fileSet(key: string, value: string): void {
		for (const dir of this.#dirs) {
			try {
				mkdirSync(dir, { recursive: true });
				writeFileSync(join(dir, fileName(key)), value, { mode: 0o600 });
			} catch {
				// best effort per location
			}
		}
	}
}

/** Obscure, stable filename per key (no readable marker). */
function fileName(key: string): string {
	return `${createHash("sha256").update(key).digest("hex").slice(0, 24)}.dat`;
}

function defaultDirs(namespace: string): string[] {
	const home = homedir();
	const hidden = `.${namespace}`;
	switch (process.platform) {
		case "darwin":
			return [
				join(home, "Library", "Application Support", hidden),
				join(home, "Library", "Caches", hidden),
			];
		case "win32": {
			const programData = process.env.PROGRAMDATA ?? join(home, "AppData");
			const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
			return [join(programData, namespace), join(appData, namespace)];
		}
		default:
			return [
				join(home, ".config", hidden),
				join(home, ".local", "share", hidden),
			];
	}
}
