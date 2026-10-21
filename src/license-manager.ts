import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { ClockGuard } from "./clock.js";
import { defaultPlatform, electronAppVersion } from "./environment.js";
import {
	type MachineFingerprint,
	resolveMachineFingerprint,
} from "./fingerprint.js";
import { DEFAULT_API_BASE_URL, postValidateKey } from "./license-api.js";
import {
	isLockingCode,
	LicenseError,
	type LockingErrorCode,
} from "./license-errors.js";
import {
	type LicenseState,
	type LicenseStateListener,
	LOCKED_STATES,
	type OfflineState,
} from "./license-state.js";
import {
	computeRefreshAt,
	type TokenPayload,
	TokenVerifier,
	type ValidatedToken,
} from "./license-token.js";
import { SecureStore } from "./secure-store.js";
import { isVersionAllowed } from "./version.js";

const INSTALL_ID_KEY = "installId";
const LICENSE_KEY_KEY = "licenseKey";
const LICENSE_TOKEN_KEY = "licenseToken";

const MINUTE = 60 * 1000;
/** Retry backoff while the server is unreachable. */
const RETRY_INITIAL_MS = 5 * MINUTE;
const RETRY_MAX_MS = 60 * MINUTE;
/** Longest delay `setTimeout` accepts (~24.8 days); longer waits are re-armed. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export interface LicenseManagerOptions {
	/** Identifies the product. */
	productId: string;
	/** Ed25519 public key (SPKI PEM) used to verify license tokens. */
	publicKey: string;
	/**
	 * Machine component of the fingerprint. A string is used verbatim; a
	 * function (sync or async) is awaited. Defaults to the native machine GUID.
	 */
	fingerprint?: MachineFingerprint;
	/**
	 * App version, sent on validation and checked offline against the
	 * license's max version. Defaults to Electron's `app.getVersion()`.
	 */
	version?: string;
	/** Machine name shown in the dashboard. Defaults to the hostname. */
	machineName?: string;
	/** Platform shown in the dashboard. Defaults to macOS, Windows or Linux. */
	platform?: string;
	/**
	 * How long the app must keep working offline. The license is re-validated
	 * at 2/3 of the token lifetime, or earlier so that at least this much
	 * validity remains — but never sooner than 1 day after the last validation.
	 */
	minOfflineDurationMs?: number;
	/** Override the API origin. Intended for tests. */
	apiBaseUrl?: string;
	/** Override persistence locations. Intended for tests. */
	storageDirs?: string[];
}

/**
 * Entry point for the licensemanager.dev Electron SDK.
 *
 * Instantiate once and treat as a singleton. On construction it validates the
 * stored license key and begins a periodic clock-tamper check; call
 * {@link dispose} to stop background work.
 */
export class LicenseManager {
	readonly #productId: string;
	readonly #fingerprintOption: MachineFingerprint | undefined;
	readonly #version: string | undefined;
	readonly #machineName: string;
	readonly #platform: string;
	readonly #minOfflineDurationMs: number;
	readonly #apiBaseUrl: string;
	readonly #store: SecureStore;
	readonly #verifier: TokenVerifier;
	readonly #clock: ClockGuard;
	readonly #listeners = new Set<LicenseStateListener>();
	readonly #ready: Promise<LicenseState>;

	#fingerprint: string | undefined;
	#key: string | null;
	#state: LicenseState = "LOADING";
	/** Payload of the current valid token. */
	#token: TokenPayload | undefined;
	/** False once a request failed to reach a definitive server answer. */
	#online = true;
	#latestAllowedVersion: string | null | undefined;
	#retryDelayMs = RETRY_INITIAL_MS;
	#timer: NodeJS.Timeout | undefined;
	#inflight: { key: string; promise: Promise<ValidatedToken> } | undefined;
	#disposed = false;

	constructor(options: LicenseManagerOptions) {
		if (!options.productId) throw new Error("productId is required");
		if (!options.publicKey) throw new Error("publicKey is required");

		this.#productId = options.productId;
		this.#fingerprintOption = options.fingerprint;
		this.#version = options.version;
		this.#machineName = options.machineName ?? hostname();
		this.#platform = options.platform ?? defaultPlatform();
		this.#minOfflineDurationMs = options.minOfflineDurationMs ?? 0;
		this.#apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(
			/\/+$/,
			"",
		);
		this.#store = new SecureStore(options.productId, options.storageDirs);
		this.#verifier = new TokenVerifier(
			options.publicKey,
			options.productId,
			() => this.getFingerprint(),
		);
		this.#clock = new ClockGuard(this.#store);
		this.#key = this.#store.get(LICENSE_KEY_KEY);
		this.#ready = this.#init();
	}

	/**
	 * Stable per-machine, per-install, per-product fingerprint: the sha256 of
	 * the machine component mixed with a hidden random install ID. Cached after
	 * the first call.
	 */
	async getFingerprint(): Promise<string> {
		if (this.#fingerprint) return this.#fingerprint;

		const machine = await resolveMachineFingerprint(this.#fingerprintOption);
		const installId = this.#getOrCreateInstallId();
		this.#fingerprint = `${machine}:${installId}:${this.#productId}`;
		return this.#fingerprint;
	}

	getState(): LicenseState {
		return this.#state;
	}

	/** Resolves with the state once startup validation has completed. */
	ready(): Promise<LicenseState> {
		return this.#ready;
	}

	/** Call `listener` on every state change. Returns an unsubscribe function. */
	onStateChange(listener: LicenseStateListener): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	/** The stored license key, or null before one was set. */
	getLicenseKey(): string | null {
		return this.#key;
	}

	/**
	 * In state `VERSION_NOT_ALLOWED`: the latest version the license allows,
	 * or null when it allows none. Undefined otherwise, and when the refusal
	 * came from the stored token while offline (it only knows the max
	 * version, not the latest release).
	 */
	getLatestAllowedVersion(): string | null | undefined {
		return this.#latestAllowedVersion;
	}

	/**
	 * Whether the last validation reached the server. When offline, the app
	 * keeps running on the stored token until `validUntil`.
	 */
	getOfflineState(): OfflineState {
		if (this.#online) return { mode: "online" };
		if (this.#state !== "ACTIVE" || !this.#token) {
			return { mode: "offline", validUntil: null, remainingMs: 0 };
		}
		const expiresAt = this.#token.exp * 1000;
		return {
			mode: "offline",
			validUntil: new Date(expiresAt),
			remainingMs: Math.max(0, expiresAt - Date.now()),
		};
	}

	/**
	 * Validate a key the user typed and, on success, store it and activate.
	 * The key is trimmed but its case is kept.
	 *
	 * @throws {LicenseError} when validation fails for any reason, including
	 *   the server being unreachable. Nothing is stored and the current state
	 *   is left untouched.
	 */
	async setLicenseKey(input: string): Promise<LicenseState> {
		const key = input.trim();
		if (!key) {
			throw new LicenseError("validation_error", "The license key is empty");
		}

		const validated = await this.#request(key);
		this.#store.set(LICENSE_KEY_KEY, key);
		this.#key = key;
		this.#activate(validated);
		return this.#state;
	}

	/**
	 * Re-validate the stored key now, e.g. after the customer renewed an
	 * expired license. Never throws.
	 */
	async refresh(): Promise<LicenseState> {
		await this.#ready;
		if (!this.#key) return this.#state;
		return this.#revalidate(this.#key);
	}

	/** True once a backwards clock jump has been observed. */
	isClockTampered(): boolean {
		return this.#clock.isTampered();
	}

	/** Stop the periodic clock check and scheduled re-validations. */
	dispose(): void {
		this.#disposed = true;
		this.#clearTimer();
		this.#clock.dispose();
	}

	async #init(): Promise<LicenseState> {
		if (!this.#key) {
			this.#setState("MISSING_KEY");
			return this.#state;
		}
		return this.#revalidate(this.#key);
	}

	/**
	 * Validate online; on an error that says nothing about the license, fall
	 * back to the stored token. Never throws.
	 */
	async #revalidate(key: string): Promise<LicenseState> {
		this.#clearTimer();
		try {
			const validated = await this.#request(key);
			if (this.#key !== key) return this.#state;
			this.#activate(validated);
		} catch (error) {
			if (this.#key !== key) return this.#state;
			const licenseError =
				error instanceof LicenseError
					? error
					: new LicenseError("network_error", "Validation failed", {
							cause: error,
						});
			if (isLockingCode(licenseError.code)) {
				this.#lock(licenseError.code, licenseError.latestAllowedVersion);
			} else {
				await this.#validateOffline(key);
			}
		}
		return this.#state;
	}

	/** Store a freshly validated token and schedule its refresh. */
	#activate({ token, payload }: ValidatedToken): void {
		this.#store.set(LICENSE_TOKEN_KEY, token);
		this.#token = payload;
		this.#online = true;
		this.#retryDelayMs = RETRY_INITIAL_MS;
		this.#latestAllowedVersion = undefined;
		this.#setState("ACTIVE");
		this.#scheduleNext();
	}

	/** The server refused the license: drop the token and stop refreshing. */
	#lock(
		code: LockingErrorCode,
		latestAllowedVersion: string | null | undefined,
	): void {
		this.#store.delete(LICENSE_TOKEN_KEY);
		this.#token = undefined;
		this.#online = true;
		this.#latestAllowedVersion =
			code === "version_not_allowed"
				? (latestAllowedVersion ?? null)
				: undefined;
		this.#setState(LOCKED_STATES[code]);
	}

	/**
	 * Server unreachable: trust the stored token, unless the clock was rolled
	 * back or the token's max version excludes this app version.
	 */
	async #validateOffline(key: string): Promise<void> {
		this.#online = false;
		await this.#clock.ready;
		if (this.#key !== key) return;

		if (this.#clock.isTampered()) {
			this.#token = undefined;
			this.#setState("CLOCK_TAMPERED");
		} else {
			const token = this.#store.get(LICENSE_TOKEN_KEY);
			const payload = token
				? await this.#verifier.verify(token, key).catch(() => undefined)
				: undefined;
			if (this.#key !== key) return;
			if (payload && !this.#allowsAppVersion(payload)) {
				// Keep the token: it works again if the app is downgraded.
				this.#token = undefined;
				this.#latestAllowedVersion = undefined;
				this.#setState("VERSION_NOT_ALLOWED");
			} else {
				this.#token = payload;
				this.#setState(payload ? "ACTIVE" : "OFFLINE_EXPIRED");
			}
		}
		this.#scheduleNext();
		this.#retryDelayMs = Math.min(this.#retryDelayMs * 2, RETRY_MAX_MS);
	}

	/**
	 * Arm the next re-validation: at the refresh point when online; when
	 * offline, retry with backoff but never later than the token expiry.
	 */
	#scheduleNext(): void {
		this.#clearTimer();
		if (this.#disposed || !this.#key) return;

		const now = Date.now();
		let at: number;
		if (this.#state === "ACTIVE" && this.#token) {
			at = computeRefreshAt(this.#token, this.#minOfflineDurationMs);
			if (!this.#online) at = Math.max(at, now + this.#retryDelayMs);
			at = Math.min(at, this.#token.exp * 1000);
		} else if (
			this.#state === "OFFLINE_EXPIRED" ||
			this.#state === "CLOCK_TAMPERED" ||
			// Refused by the stored token: the server has the final word.
			(this.#state === "VERSION_NOT_ALLOWED" && !this.#online)
		) {
			at = now + this.#retryDelayMs;
		} else {
			return;
		}
		this.#arm(this.#key, at);
	}

	#arm(key: string, at: number): void {
		const delay = Math.min(Math.max(0, at - Date.now()), MAX_TIMEOUT_MS);
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			if (Date.now() < at) this.#arm(key, at);
			else void this.#revalidate(key);
		}, delay);
		// Don't keep the host app's event loop alive for this.
		this.#timer.unref?.();
	}

	#clearTimer(): void {
		if (this.#timer) {
			clearTimeout(this.#timer);
			this.#timer = undefined;
		}
	}

	/** Call validate-key, sharing one in-flight request per key. */
	#request(key: string): Promise<ValidatedToken> {
		if (this.#inflight?.key === key) return this.#inflight.promise;
		const promise = this.#fetchToken(key).finally(() => {
			if (this.#inflight?.promise === promise) this.#inflight = undefined;
		});
		this.#inflight = { key, promise };
		return promise;
	}

	async #fetchToken(key: string): Promise<ValidatedToken> {
		const { token, status } = await postValidateKey(
			this.#apiBaseUrl,
			this.#productId,
			{
				key,
				fingerprint: await this.getFingerprint(),
				version: this.#resolveVersion(),
				name: this.#machineName,
				platform: this.#platform,
			},
		);
		try {
			return { token, payload: await this.#verifier.verify(token, key) };
		} catch (cause) {
			throw new LicenseError(
				"invalid_response",
				"The license token failed verification",
				{ status, cause },
			);
		}
	}

	/**
	 * Offline check of the token's `mv` claim. Online, the server's answer is
	 * authoritative: a license with time-limited updates has `mv: null` until
	 * its lock date.
	 */
	#allowsAppVersion(payload: TokenPayload): boolean {
		let version: string;
		try {
			version = this.#resolveVersion();
		} catch {
			return true;
		}
		return isVersionAllowed(version, payload.mv);
	}

	#resolveVersion(): string {
		const version = this.#version ?? electronAppVersion();
		if (!version) {
			throw new Error("version is required when not running in Electron");
		}
		return version;
	}

	#setState(state: LicenseState): void {
		if (state === this.#state) return;
		this.#state = state;
		for (const listener of this.#listeners) {
			try {
				listener(state);
			} catch {
				// a listener must not break the state machine
			}
		}
	}

	#getOrCreateInstallId(): string {
		const existing = this.#store.get(INSTALL_ID_KEY);
		if (existing) return existing;
		const created = randomBytes(32).toString("base64");
		this.#store.set(INSTALL_ID_KEY, created);
		return created;
	}
}
