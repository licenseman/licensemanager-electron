import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportSPKI, generateKeyPair, type KeyLike, SignJWT } from "jose";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { LicenseError } from "../src/license-errors";
import {
	LicenseManager,
	type LicenseManagerOptions,
} from "../src/license-manager";
import { computeRefreshAt } from "../src/license-token";
import {
	type EntryCtor,
	SecureStore,
	setKeyringLoaderForTests,
} from "../src/secure-store";

const PRODUCT_ID = "x7Kp2QaZ";
const KEY = "7KQ2M-X9ZPA-H4TRC-WN6EY-B3JDF";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const START = Date.UTC(2026, 0, 1);
/** Captured before fake timers are installed. */
const realSetTimeout = globalThis.setTimeout;

let privateKey: KeyLike;
let publicKeyPem: string;
let otherPrivateKey: KeyLike;

let dir: string;
let manager: LicenseManager | undefined;
/** Validate-key handler; receives the parsed request body. */
let validate: (body: {
	key: string;
	fingerprint: string;
}) => Response | Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
	const pair = await generateKeyPair("EdDSA", { crv: "Ed25519" });
	privateKey = pair.privateKey;
	publicKeyPem = await exportSPKI(pair.publicKey);
	otherPrivateKey = (await generateKeyPair("EdDSA", { crv: "Ed25519" }))
		.privateKey;
});

beforeEach(() => {
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
		deletePassword(): boolean {
			return map.delete(this.#key);
		}
	};
	setKeyringLoaderForTests(() => Fake);

	dir = mkdtempSync(join(tmpdir(), "lm-state-"));
	vi.useFakeTimers({ now: START });

	validate = () => Promise.reject(new Error("offline"));
	fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		if (url.includes("/validate-key")) {
			return validate(JSON.parse(String(init?.body)));
		}
		// Clock guard's network time: offline.
		throw new Error("offline");
	});
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	manager?.dispose();
	manager = undefined;
	setKeyringLoaderForTests(null);
	vi.useRealTimers();
	vi.unstubAllGlobals();
	rmSync(dir, { recursive: true, force: true });
});

function make(options: Partial<LicenseManagerOptions> = {}): LicenseManager {
	manager?.dispose();
	const lm = new LicenseManager({
		productId: PRODUCT_ID,
		publicKey: publicKeyPem,
		fingerprint: "fixed-machine",
		version: "2.3.1",
		apiBaseUrl: "https://api.test",
		storageDirs: [dir],
		...options,
	});
	manager = lm;
	return lm;
}

function store(): SecureStore {
	return new SecureStore(PRODUCT_ID, [dir]);
}

/** Fingerprint of this test install, without triggering any validation. */
async function fingerprint(): Promise<string> {
	const lm = make();
	const fp = await lm.getFingerprint();
	lm.dispose();
	manager = undefined;
	return fp;
}

async function sign(
	claims: { sub?: string; fp: string; aud?: string; mv?: string | null },
	lifetimeMs = 3 * WEEK,
	issuedAt = Date.now(),
	signer = privateKey,
): Promise<string> {
	const iat = Math.floor(issuedAt / 1000);
	return new SignJWT({ fp: claims.fp, mv: claims.mv ?? null })
		.setProtectedHeader({ alg: "EdDSA" })
		.setAudience(claims.aud ?? PRODUCT_ID)
		.setSubject(claims.sub ?? KEY)
		.setIssuedAt(iat)
		.setNotBefore(iat - 2 * 60 * 60)
		.setExpirationTime(iat + Math.floor(lifetimeMs / 1000))
		.sign(signer);
}

function ok(token: string): Response {
	return Response.json({ license: token });
}

function fail(
	status: number,
	code: string,
	extra: Record<string, unknown> = {},
): Response {
	return Response.json(
		{ error: { code, message: "nope", ...extra } },
		{ status },
	);
}

/** Server issuing valid tokens for whatever key/fingerprint it gets. */
function serveValid(lifetimeMs = 3 * WEEK): void {
	validate = async (body) =>
		ok(await sign({ sub: body.key, fp: body.fingerprint }, lifetimeMs));
}

async function seed(lifetimeMs = 3 * WEEK, issuedAt = Date.now()) {
	const fp = await fingerprint();
	store().set("licenseKey", KEY);
	store().set("licenseToken", await sign({ fp }, lifetimeMs, issuedAt));
}

/**
 * Advance fake time, then let real async work (token signing and
 * verification) finish so the next timer is armed before time moves again.
 */
async function advance(ms: number): Promise<void> {
	await vi.advanceTimersByTimeAsync(ms);
	await new Promise((resolve) => realSetTimeout(resolve, 30));
}

/** Await `promise`, advancing fake time so validation retries can run out. */
async function settle<T>(promise: Promise<T>): Promise<T> {
	let done = false;
	const tracked = promise.finally(() => {
		done = true;
	});
	tracked.catch(() => {});
	while (!done) await advance(5000);
	return tracked;
}

function validateCalls(): number {
	return fetchMock.mock.calls.filter(([url]) =>
		String(url).includes("/validate-key"),
	).length;
}

describe("startup", () => {
	it("is MISSING_KEY without a stored key, and makes no request", async () => {
		const lm = make();
		expect(await lm.ready()).toBe("MISSING_KEY");
		expect(validateCalls()).toBe(0);
	});

	it("starts LOADING and always validates online", async () => {
		await seed();
		serveValid();
		const lm = make();
		expect(lm.getState()).toBe("LOADING");
		expect(await lm.ready()).toBe("ACTIVE");
		expect(validateCalls()).toBe(1);
		expect(lm.getOfflineState()).toEqual({ mode: "online" });
	});

	it("resolves from a valid stored token without waiting for the server", async () => {
		await seed();
		validate = () => new Promise(() => {});
		const lm = make();
		expect(await lm.ready()).toBe("ACTIVE");
		expect(validateCalls()).toBe(1);
		expect(lm.getOfflineState()).toEqual({ mode: "online" });
	});

	it("waits for the server without a valid stored token", async () => {
		await seed(WEEK, START - 2 * WEEK);
		let calls = 0;
		validate = async (body) =>
			++calls < 3
				? fail(503, "unavailable")
				: ok(await sign({ sub: body.key, fp: body.fingerprint }));
		const lm = make();
		expect(await settle(lm.ready())).toBe("ACTIVE");
		expect(validateCalls()).toBe(3);
		expect(lm.getOfflineState()).toEqual({ mode: "online" });
	});

	it("sends the documented request", async () => {
		await seed();
		serveValid();
		const lm = make({ machineName: "Jane's MacBook", platform: "macOS" });
		await lm.ready();
		const [url, init] = fetchMock.mock.calls.find(([u]) =>
			String(u).includes("/validate-key"),
		) as [string, RequestInit];
		expect(url).toBe(`https://api.test/v1/products/${PRODUCT_ID}/validate-key`);
		expect(init.method).toBe("POST");
		expect(JSON.parse(String(init.body))).toEqual({
			key: KEY,
			fingerprint: await lm.getFingerprint(),
			version: "2.3.1",
			name: "Jane's MacBook",
			platform: "macOS",
		});
	});

	it.each([
		[404, "not_found", "INVALID_KEY"],
		[403, "license_expired", "EXPIRED"],
		[403, "version_not_allowed", "VERSION_NOT_ALLOWED"],
		[403, "machine_limit_reached", "MACHINE_LIMIT_REACHED"],
	])("locks on %i %s and drops the token", async (status, code, state) => {
		await seed();
		validate = () =>
			fail(
				status,
				code,
				code === "version_not_allowed" ? { latestAllowedVersion: "2.3.1" } : {},
			);
		const lm = make();
		// The stored token is valid: the refusal arrives in the background.
		expect(await lm.ready()).toBe("ACTIVE");
		await advance(0);
		expect(lm.getState()).toBe(state);
		expect(store().get("licenseToken")).toBeNull();
		expect(lm.getLicenseKey()).toBe(KEY);
		if (code === "version_not_allowed") {
			expect(lm.getLatestAllowedVersion()).toBe("2.3.1");
		}
	});

	it.each([
		["network error", () => Promise.reject(new TypeError("fetch failed"))],
		["402 plan_limit_exceeded", () => fail(402, "plan_limit_exceeded")],
		["500 internal_error", () => fail(500, "internal_error")],
		["422 validation_error", () => fail(422, "validation_error")],
		["unknown code", () => fail(418, "teapot")],
	])("falls back to the stored token on %s", async (_, handler) => {
		await seed(3 * WEEK, START - DAY);
		validate = handler as typeof validate;
		const lm = make();
		expect(await lm.ready()).toBe("ACTIVE");
		// Background validation gives up within 5 minutes.
		for (let i = 0; i < 60; i++) await advance(5000);
		expect(lm.getState()).toBe("ACTIVE");
		const expiresAt = START - DAY + 3 * WEEK;
		expect(lm.getOfflineState()).toEqual({
			mode: "offline",
			validUntil: new Date(expiresAt),
			remainingMs: expiresAt - Date.now(),
		});
	});

	it("is OFFLINE_EXPIRED when offline with an expired token", async () => {
		await seed(WEEK, START - 2 * WEEK);
		const lm = make();
		expect(await settle(lm.ready())).toBe("OFFLINE_EXPIRED");
		expect(lm.getOfflineState()).toEqual({
			mode: "offline",
			validUntil: null,
			remainingMs: 0,
		});
	});

	it("is OFFLINE_EXPIRED when offline without a token", async () => {
		await fingerprint();
		store().set("licenseKey", KEY);
		expect(await settle(make().ready())).toBe("OFFLINE_EXPIRED");
	});

	it("is CLOCK_TAMPERED when offline and the clock went back", async () => {
		await seed();
		store().set(
			"lastSeen",
			Buffer.from(String(START + DAY)).toString("base64"),
		);
		expect(await settle(make().ready())).toBe("CLOCK_TAMPERED");
	});

	it("trusts the server over a tampered clock", async () => {
		await seed();
		store().set(
			"lastSeen",
			Buffer.from(String(START + DAY)).toString("base64"),
		);
		serveValid();
		expect(await make().ready()).toBe("ACTIVE");
	});
});

describe("max version (mv) offline", () => {
	async function seedMaxVersion(mv: string | null) {
		const fp = await fingerprint();
		store().set("licenseKey", KEY);
		store().set("licenseToken", await sign({ fp, mv }));
	}

	it.each([
		["2", "2.3.1"],
		["2.3", "2.3.1"],
		["3", "2.3.1"],
		[null, "9.0.0"],
	])("mv %s allows %s", async (mv, version) => {
		await seedMaxVersion(mv);
		expect(await settle(make({ version }).ready())).toBe("ACTIVE");
	});

	it.each([
		["2", "3.0.0"],
		["2.3", "2.4.0"],
	])("mv %s refuses %s and keeps the token", async (mv, version) => {
		await seedMaxVersion(mv);
		const lm = make({ version });
		expect(await settle(lm.ready())).toBe("VERSION_NOT_ALLOWED");
		expect(lm.getLatestAllowedVersion()).toBeUndefined();
		expect(store().get("licenseToken")).toBeTruthy();
	});

	it("lets the server override mv once reachable", async () => {
		await seedMaxVersion("2");
		const lm = make({ version: "3.0.0" });
		expect(await settle(lm.ready())).toBe("VERSION_NOT_ALLOWED");

		// Time-limited updates: the server allows 3.0.0 although an old token said "2".
		serveValid();
		await advance(5 * 60 * 1000);
		expect(lm.getState()).toBe("ACTIVE");
	});
});

describe("token verification", () => {
	async function serveToken(makeToken: (fp: string) => Promise<string>) {
		validate = async (body) => ok(await makeToken(body.fingerprint));
	}

	it.each([
		["another product", (fp: string) => sign({ fp, aud: "other" })],
		["another key", (fp: string) => sign({ fp, sub: "OTHER-KEY" })],
		["another machine", () => sign({ fp: "other-machine" })],
		[
			"another signing key",
			(fp: string) => sign({ fp }, 3 * WEEK, Date.now(), otherPrivateKey),
		],
		["an expired token", (fp: string) => sign({ fp }, HOUR, START - DAY)],
		[
			"an unsigned token",
			async (fp: string) =>
				`${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(
					JSON.stringify({ aud: PRODUCT_ID, sub: KEY, fp }),
				).toString("base64url")}.`,
		],
	])("rejects a token for %s", async (_, makeToken) => {
		await serveToken(makeToken);
		const lm = make();
		await lm.ready();
		const error = await lm.setLicenseKey(KEY).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(LicenseError);
		expect((error as LicenseError).code).toBe("invalid_response");
		expect(lm.getState()).toBe("MISSING_KEY");
		expect(store().get("licenseToken")).toBeNull();
	});
});

describe("setLicenseKey", () => {
	it("activates and persists key and token", async () => {
		serveValid();
		const lm = make();
		await lm.ready();
		const states: string[] = [];
		lm.onStateChange((s) => states.push(s));

		expect(await lm.setLicenseKey(`  ${KEY}\n`)).toBe("ACTIVE");
		expect(states).toEqual(["ACTIVE"]);
		expect(lm.getLicenseKey()).toBe(KEY);
		expect(store().get("licenseKey")).toBe(KEY);
		expect(store().get("licenseToken")).toBeTruthy();
	});

	it("keeps the key's case", async () => {
		serveValid();
		const lm = make();
		await lm.ready();
		await lm.setLicenseKey("abc-def");
		expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).key).toBe(
			"abc-def",
		);
	});

	it("throws on a refused key and leaves the current license alone", async () => {
		await seed();
		serveValid();
		const lm = make();
		await lm.ready();
		const token = store().get("licenseToken");

		validate = () => fail(404, "not_found");
		await expect(lm.setLicenseKey("TYPO")).rejects.toMatchObject({
			code: "not_found",
			status: 404,
		});
		expect(lm.getState()).toBe("ACTIVE");
		expect(lm.getLicenseKey()).toBe(KEY);
		expect(store().get("licenseToken")).toBe(token);
	});

	it("throws network_error when offline", async () => {
		const lm = make();
		await lm.ready();
		await expect(settle(lm.setLicenseKey(KEY))).rejects.toMatchObject({
			code: "network_error",
		});
		expect(lm.getState()).toBe("MISSING_KEY");
		expect(store().get("licenseKey")).toBeNull();
	});

	it("reports latestAllowedVersion", async () => {
		validate = () =>
			fail(403, "version_not_allowed", { latestAllowedVersion: null });
		const lm = make();
		await lm.ready();
		await expect(lm.setLicenseKey(KEY)).rejects.toMatchObject({
			code: "version_not_allowed",
			latestAllowedVersion: null,
		});
	});

	it("rejects an empty key without a request", async () => {
		const lm = make();
		await lm.ready();
		await expect(lm.setLicenseKey("   ")).rejects.toMatchObject({
			code: "validation_error",
		});
		expect(validateCalls()).toBe(0);
	});
});

describe("retries", () => {
	it("retries transient failures on setLicenseKey", async () => {
		const lm = make();
		await lm.ready();
		let calls = 0;
		validate = async (body) =>
			++calls < 3
				? fail(503, "unavailable")
				: ok(await sign({ sub: body.key, fp: body.fingerprint }));
		expect(await settle(lm.setLicenseKey(KEY))).toBe("ACTIVE");
		expect(validateCalls()).toBe(3);
	});

	it.each([
		[404, "not_found"],
		[402, "plan_limit_exceeded"],
		[422, "validation_error"],
	])("does not retry %i %s", async (status, code) => {
		const lm = make();
		await lm.ready();
		validate = () => fail(status, code);
		await expect(settle(lm.setLicenseKey(KEY))).rejects.toMatchObject({
			code,
		});
		expect(validateCalls()).toBe(1);
	});

	it("gives up on setLicenseKey within 30 seconds", async () => {
		const lm = make();
		await lm.ready();
		const startedAt = Date.now();
		let failedAt = 0;
		const result = lm.setLicenseKey(KEY).catch((e: unknown) => {
			failedAt = Date.now();
			throw e;
		});
		await expect(settle(result)).rejects.toMatchObject({
			code: "network_error",
		});
		expect(validateCalls()).toBeGreaterThan(1);
		expect(failedAt - startedAt).toBeLessThanOrEqual(30 * 1000);
	});

	it("retries longer in the background", async () => {
		serveValid();
		const lm = make();
		await lm.ready();
		await lm.setLicenseKey(KEY);

		let calls = 0;
		validate = async (body) =>
			++calls < 8
				? Promise.reject(new TypeError("fetch failed"))
				: ok(await sign({ sub: body.key, fp: body.fingerprint }));
		await advance(2 * WEEK);
		for (let i = 0; i < 60 && calls < 8; i++) await advance(5000);
		await advance(0);
		expect(calls).toBe(8);
		expect(lm.getOfflineState()).toEqual({ mode: "online" });
	});

	it("stops retrying after dispose", async () => {
		const lm = make();
		await lm.ready();
		const result = lm.setLicenseKey(KEY);
		await advance(0);
		lm.dispose();
		await expect(settle(result)).rejects.toMatchObject({
			code: "network_error",
		});
		expect(validateCalls()).toBe(1);
	});
});

describe("computeRefreshAt", () => {
	const at = (lifetimeMs: number, minOffline: number) =>
		computeRefreshAt({ iat: 0, exp: lifetimeMs / 1000 }, minOffline);

	it("refreshes at 2/3 of the lifetime", () => {
		expect(at(3 * WEEK, 0)).toBe(2 * WEEK);
	});

	it("keeps minOfflineDurationMs of validity", () => {
		expect(at(3 * WEEK, 1.5 * WEEK)).toBe(1.5 * WEEK);
	});

	it("ignores minOfflineDurationMs below the 2/3 margin", () => {
		expect(at(3 * WEEK, 2 * DAY)).toBe(2 * WEEK);
	});

	it("never refreshes within a day because of minOfflineDurationMs", () => {
		expect(at(3 * WEEK, 10 * WEEK)).toBe(DAY);
	});

	it("still refreshes short tokens at 2/3", () => {
		expect(at(HOUR, 10 * WEEK)).toBe((2 * HOUR) / 3);
	});
});

describe("automatic refresh", () => {
	it("re-validates at 2/3 of the token lifetime", async () => {
		serveValid();
		const lm = make();
		await lm.ready();
		await lm.setLicenseKey(KEY);
		expect(validateCalls()).toBe(1);

		await vi.advanceTimersByTimeAsync(2 * WEEK - 1000);
		expect(validateCalls()).toBe(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(validateCalls()).toBe(2);
		expect(lm.getState()).toBe("ACTIVE");
	});

	it("honours minOfflineDurationMs", async () => {
		serveValid();
		const lm = make({ minOfflineDurationMs: 1.5 * WEEK });
		await lm.ready();
		await lm.setLicenseKey(KEY);

		await vi.advanceTimersByTimeAsync(1.5 * WEEK - 1000);
		expect(validateCalls()).toBe(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(validateCalls()).toBe(2);
	});

	it("goes offline on failure, retries with backoff, then expires", async () => {
		serveValid(3 * DAY);
		const lm = make();
		await lm.ready();
		await lm.setLicenseKey(KEY);

		validate = () => fail(500, "internal_error");
		await advance(2 * DAY - 1000);
		expect(validateCalls()).toBe(1);
		// Retried for up to 5 min before giving up.
		for (let i = 0; i < 60; i++) await advance(5000);
		const afterFirstRound = validateCalls();
		expect(afterFirstRound).toBeGreaterThan(2);
		expect(lm.getState()).toBe("ACTIVE");
		expect(lm.getOfflineState()).toMatchObject({ mode: "offline" });

		// Then 5 min until the next round.
		await advance(4 * 60 * 1000);
		expect(validateCalls()).toBe(afterFirstRound);
		await advance(2 * 60 * 1000);
		expect(validateCalls()).toBeGreaterThan(afterFirstRound);

		await advance(DAY);
		expect(lm.getState()).toBe("OFFLINE_EXPIRED");

		serveValid(3 * DAY);
		await advance(HOUR);
		expect(lm.getState()).toBe("ACTIVE");
		expect(lm.getOfflineState()).toEqual({ mode: "online" });
	});

	it("locks when the license is refused at refresh", async () => {
		serveValid();
		const lm = make();
		await lm.ready();
		await lm.setLicenseKey(KEY);

		validate = () => fail(403, "license_expired");
		await vi.advanceTimersByTimeAsync(2 * WEEK);
		expect(lm.getState()).toBe("EXPIRED");

		// No more scheduled validations once locked.
		await vi.advanceTimersByTimeAsync(10 * WEEK);
		expect(validateCalls()).toBe(2);

		serveValid();
		expect(await lm.refresh()).toBe("ACTIVE");
	});

	it("handles lifetimes longer than the max timer step", async () => {
		serveValid(90 * DAY);
		const lm = make();
		await lm.ready();
		await lm.setLicenseKey(KEY);

		await vi.advanceTimersByTimeAsync(60 * DAY - 1000);
		expect(validateCalls()).toBe(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(validateCalls()).toBe(2);
	});

	it("catches up within an hour when the wall clock jumps ahead", async () => {
		serveValid();
		const lm = make();
		await lm.ready();
		await lm.setLicenseKey(KEY);

		// Simulates system sleep: wall time moves past the refresh point without timers firing.
		vi.setSystemTime(Date.now() + 2 * WEEK);
		await vi.advanceTimersByTimeAsync(HOUR);
		expect(validateCalls()).toBe(2);
	});

	it("stops after dispose", async () => {
		serveValid();
		const lm = make();
		await lm.ready();
		await lm.setLicenseKey(KEY);
		lm.dispose();
		await vi.advanceTimersByTimeAsync(3 * WEEK);
		expect(validateCalls()).toBe(1);
	});
});
