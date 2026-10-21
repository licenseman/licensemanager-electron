import type { LockingErrorCode } from "./license-errors.js";

export type LicenseState =
	/** Startup validation in progress. */
	| "LOADING"
	/** No license key stored yet: ask the user for one. */
	| "MISSING_KEY"
	/** Valid license, verified online or with the stored token. */
	| "ACTIVE"
	/** The key does not exist for this product. */
	| "INVALID_KEY"
	/** The license expiration date has passed. */
	| "EXPIRED"
	/** The license doesn't include this app version. See {@link LicenseManager.getLatestAllowedVersion}. */
	| "VERSION_NOT_ALLOWED"
	/** The license is active on its maximum number of machines. */
	| "MACHINE_LIMIT_REACHED"
	/** Server unreachable and no valid stored token. */
	| "OFFLINE_EXPIRED"
	/** Server unreachable and the system clock was rolled back. */
	| "CLOCK_TAMPERED";

export type OfflineState =
	| { mode: "online" }
	| {
			mode: "offline";
			/** Expiry of the stored token, or null when there is no valid token. */
			validUntil: Date | null;
			/** Time left before {@link validUntil}; 0 without a valid token. */
			remainingMs: number;
	  };

export type LicenseStateListener = (state: LicenseState) => void;

/** State the app locks into when the server refuses the license. */
export const LOCKED_STATES: Record<LockingErrorCode, LicenseState> = {
	not_found: "INVALID_KEY",
	license_expired: "EXPIRED",
	version_not_allowed: "VERSION_NOT_ALLOWED",
	machine_limit_reached: "MACHINE_LIMIT_REACHED",
};
