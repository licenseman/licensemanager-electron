import {randomBytes} from "node:crypto";
import {ClockGuard} from "./clock.js";
import {type MachineFingerprint, resolveMachineFingerprint,} from "./fingerprint.js";
import {SecureStore} from "./secure-store.js";

const INSTALL_ID_KEY = "installId";

export interface LicenseManagerOptions {
	/** Identifies the product. */
	productId: string;
	/** Public key used to validate license keys offline. */
	publicKey: string;
	/**
	 * Machine component of the fingerprint. A string is used verbatim; a
	 * function (sync or async) is awaited. Defaults to the native machine GUID.
	 */
	fingerprint?: MachineFingerprint;
	/** Override persistence locations. Intended for tests. */
	storageDirs?: string[];
}

/**
 * Entry point for the licensemanager.dev Electron SDK.
 *
 * Instantiate once and treat as a singleton. On construction it begins a
 * periodic clock-tamper check; call {@link dispose} to stop it.
 */
export class LicenseManager {
	readonly #productId: string;
	readonly #publicKey: string;
	readonly #fingerprintOption: MachineFingerprint | undefined;
	readonly #store: SecureStore;
	readonly #clock: ClockGuard;

	#fingerprint: string | undefined;

	constructor(options: LicenseManagerOptions) {
		if (!options.productId) throw new Error("productId is required");
		if (!options.publicKey) throw new Error("publicKey is required");

		this.#productId = options.productId;
		this.#publicKey = options.publicKey;
		this.#fingerprintOption = options.fingerprint;
		this.#store = new SecureStore(options.productId, options.storageDirs);
		this.#clock = new ClockGuard(this.#store);
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

	/** True once a backwards clock jump has been observed. */
	isClockTampered(): boolean {
		return this.#clock.isTampered();
	}

	/** Stop the periodic clock check. */
	dispose(): void {
		this.#clock.dispose();
	}

	#getOrCreateInstallId(): string {
		const existing = this.#store.get(INSTALL_ID_KEY);
		if (existing) return existing;
		const created = randomBytes(32).toString("base64");
		this.#store.set(INSTALL_ID_KEY, created);
		return created;
	}
}
