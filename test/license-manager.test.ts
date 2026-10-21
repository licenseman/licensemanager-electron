import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashMachineValue } from "../src/fingerprint";
import { LicenseManager } from "../src/license-manager";
import {
	type EntryCtor,
	SecureStore,
	setKeyringLoaderForTests,
} from "../src/secure-store";

/** `<base64 sha256 of machine>:<base64 install ID>:<productId>` */
const fingerprintPattern = (productId: string) =>
	new RegExp(`^[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=:${productId}$`);

let dir: string;
let manager: LicenseManager | undefined;

function make(productId = "prod-1"): LicenseManager {
	const lm = new LicenseManager({
		productId,
		publicKey: "pub",
		fingerprint: "fixed-machine",
		storageDirs: [dir],
	});
	manager = lm;
	return lm;
}

beforeEach(() => {
	// Fresh in-memory keyring per test → isolated, never touches the real one.
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

	dir = mkdtempSync(join(tmpdir(), "lm-"));
	vi.useFakeTimers({ now: 1_000_000 });
	// Offline by default so the stored-value fallback is exercised.
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
});

afterEach(() => {
	manager?.dispose();
	manager = undefined;
	setKeyringLoaderForTests(null);
	vi.useRealTimers();
	vi.unstubAllGlobals();
	rmSync(dir, { recursive: true, force: true });
});

describe("constructor validation", () => {
	it("requires productId and publicKey", () => {
		expect(
			() => new LicenseManager({ productId: "", publicKey: "p" }),
		).toThrow();
		expect(
			() => new LicenseManager({ productId: "p", publicKey: "" }),
		).toThrow();
	});
});

describe("getFingerprint", () => {
	it("is stable and mixes machine, install ID and product", async () => {
		const lm = make();
		const fp = await lm.getFingerprint();
		expect(fp).toMatch(fingerprintPattern("prod-1"));
		expect(await lm.getFingerprint()).toBe(fp);
	});

	it("persists the install ID so the fingerprint is stable across instances", async () => {
		const first = await make().getFingerprint();
		manager?.dispose();
		const second = await make().getFingerprint();
		expect(second).toBe(first);
	});

	it("differs per product", async () => {
		const a = await make("prod-a").getFingerprint();
		manager?.dispose();
		const b = await make("prod-b").getFingerprint();
		expect(a).not.toBe(b);
	});

	it("honours a custom async fingerprint function", async () => {
		const lm = new LicenseManager({
			productId: "p",
			publicKey: "pub",
			fingerprint: async () => "custom",
			storageDirs: [dir],
		});
		manager = lm;
		const fp = await lm.getFingerprint();
		expect(fp).toMatch(fingerprintPattern("p"));
		expect(fp.startsWith(`${hashMachineValue("custom")}:`)).toBe(true);
	});
});

/** Let pending clock checks (awaiting fetch) settle. */
async function flush(): Promise<void> {
	await vi.advanceTimersByTimeAsync(0);
}

function readLastSeen(): number {
	const stored = new SecureStore("prod-1", [dir]).get("lastSeen");
	return Number(Buffer.from(stored as string, "base64").toString("utf8"));
}

function seedLastSeen(ms: number): void {
	new SecureStore("prod-1", [dir]).set(
		"lastSeen",
		Buffer.from(String(ms)).toString("base64"),
	);
}

function mockNetworkTime(ms: number): void {
	vi.stubGlobal(
		"fetch",
		vi
			.fn()
			.mockResolvedValue(
				new Response(null, { headers: { date: new Date(ms).toUTCString() } }),
			),
	);
}

describe("clock tamper detection (offline fallback)", () => {
	it("records the current time on construction", async () => {
		make();
		await flush();
		expect(readLastSeen()).toBe(1_000_000);
	});

	it("flags a backwards clock jump", async () => {
		// Seed a last-seen far in the future.
		seedLastSeen(5_000_000);
		const lm = make();
		await flush();
		expect(lm.isClockTampered()).toBe(true);
	});

	it("runs hourly and keeps the stored time monotonic on forward progress", async () => {
		const lm = make();
		await flush();
		expect(lm.isClockTampered()).toBe(false);

		// Advancing fake timers also advances the clock, so the hourly callback
		// observes a later time and must persist it as the new max.
		await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
		expect(lm.isClockTampered()).toBe(false);
		expect(readLastSeen()).toBe(1_000_000 + 60 * 60 * 1000);
	});

	it("flags tampering when a scheduled run sees an earlier time", async () => {
		const lm = make();
		await flush();
		expect(lm.isClockTampered()).toBe(false);

		// Freeze Date.now below the recorded max for the next scheduled run.
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(500_000);
		await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
		expect(lm.isClockTampered()).toBe(true);
		nowSpy.mockRestore();
	});
});

describe("clock tamper detection (network time)", () => {
	const DAY = 24 * 60 * 60 * 1000;

	it("flags a system clock behind network time", async () => {
		mockNetworkTime(1_000_000 + DAY);
		const lm = make();
		await flush();
		expect(lm.isClockTampered()).toBe(true);
	});

	it("flags a system clock ahead of network time", async () => {
		mockNetworkTime(1_000_000 - DAY);
		const lm = make();
		await flush();
		expect(lm.isClockTampered()).toBe(true);
	});

	it("tolerates small skew from network time", async () => {
		mockNetworkTime(1_000_000 + 60_000);
		const lm = make();
		await flush();
		expect(lm.isClockTampered()).toBe(false);
	});

	it("trusts network time over a stored value from the future", async () => {
		seedLastSeen(1_000_000 + DAY);
		mockNetworkTime(1_000_000);
		const lm = make();
		await flush();
		expect(lm.isClockTampered()).toBe(false);
		// Stored value is reset to network time, so going offline later does
		// not false-flag against the bogus future value.
		expect(readLastSeen()).toBe(1_000_000);
	});

	it("falls back to the stored value when the Date header is missing", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
		seedLastSeen(5_000_000);
		const lm = make();
		await flush();
		expect(lm.isClockTampered()).toBe(true);
	});
});

describe("getPortalUrl", () => {
	it("links to the product's portal", () => {
		expect(make("prod-1").getPortalUrl()).toBe(
			"https://app.licensemanager.dev/portal/prod-1",
		);
	});

	it("encodes the product ID", () => {
		expect(make("a/b c").getPortalUrl()).toBe(
			"https://app.licensemanager.dev/portal/a%2Fb%20c",
		);
	});
});

describe("dispose", () => {
	it("stops the interval", () => {
		const lm = make();
		lm.dispose();
		const clearSpy = vi.spyOn(global, "clearInterval");
		lm.dispose(); // idempotent, nothing left to clear
		expect(clearSpy).not.toHaveBeenCalled();
	});
});
