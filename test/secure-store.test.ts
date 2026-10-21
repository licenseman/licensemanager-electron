import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type EntryCtor,
	SecureStore,
	setKeyringLoaderForTests,
} from "../src/secure-store";

// Force the file-fallback path so tests never touch the real OS keychain.
// Each test gets its own temp storage dirs.
let dirA: string;
let dirB: string;

beforeEach(() => {
	setKeyringLoaderForTests(() => null);
	dirA = mkdtempSync(join(tmpdir(), "lm-a-"));
	dirB = mkdtempSync(join(tmpdir(), "lm-b-"));
});

afterEach(() => {
	setKeyringLoaderForTests(null);
	rmSync(dirA, { recursive: true, force: true });
	rmSync(dirB, { recursive: true, force: true });
});

describe("SecureStore file fallback", () => {
	it("returns null for an unknown key", () => {
		const store = new SecureStore("prod-1", [dirA, dirB]);
		expect(store.get("installId")).toBeNull();
	});

	it("round-trips a value", () => {
		const store = new SecureStore("prod-1", [dirA, dirB]);
		store.set("installId", "secret");
		expect(store.get("installId")).toBe("secret");
	});

	it("mirrors writes so a surviving copy is still readable", () => {
		const store = new SecureStore("prod-1", [dirA, dirB]);
		store.set("installId", "secret");
		// Simulate one location being wiped (e.g. app dir removed on uninstall).
		rmSync(dirA, { recursive: true, force: true });
		expect(store.get("installId")).toBe("secret");
	});

	it("isolates different productIds", () => {
		const a = new SecureStore("prod-a", [dirA]);
		const b = new SecureStore("prod-b", [dirB]);
		a.set("installId", "from-a");
		b.set("installId", "from-b");
		expect(a.get("installId")).toBe("from-a");
		expect(b.get("installId")).toBe("from-b");
	});

	it("never writes a key verbatim in the filename", () => {
		const store = new SecureStore("prod-1", [dirA]);
		store.set("installId", "secret");
		const { readdirSync } = require("node:fs");
		const names: string[] = readdirSync(dirA);
		expect(names.length).toBe(1);
		expect(names[0]).not.toContain("installId");
		expect(names[0]).toMatch(/^[0-9a-f]+\.dat$/);
	});
});

describe("SecureStore keyring backend", () => {
	it("prefers the keyring over files and namespaces by productId", () => {
		const map = new Map<string, string>();
		const Fake: EntryCtor = class {
			#key: string;
			constructor(service: string, account: string) {
				this.#key = `${service}::${account}`;
			}
			getPassword(): string | null {
				return map.get(this.#key) ?? null;
			}
			setPassword(value: string): void {
				map.set(this.#key, value);
			}
		};
		setKeyringLoaderForTests(() => Fake);

		const a = new SecureStore("prod-a", [dirA]);
		const b = new SecureStore("prod-b", [dirB]);
		a.set("installId", "from-a");
		b.set("installId", "from-b");

		expect(a.get("installId")).toBe("from-a");
		expect(b.get("installId")).toBe("from-b");
		// Two distinct keyring entries → no overlap.
		expect(map.size).toBe(2);
	});

	it("falls back to files when the keyring throws", () => {
		const Throwing: EntryCtor = class {
			constructor() {
				throw new Error("no keyring");
			}
			getPassword(): string | null {
				return null;
			}
			setPassword(): void {}
		};
		setKeyringLoaderForTests(() => Throwing);

		const store = new SecureStore("prod-1", [dirA]);
		store.set("installId", "secret");
		expect(store.get("installId")).toBe("secret");
	});

	it("computes OS-appropriate default locations when no dirs are given", () => {
		// Read-only: avoid writing into the real home directory.
		const store = new SecureStore(`prod-${Date.now()}-${Math.random()}`);
		expect(store.get("installId")).toBeNull();
	});
});
