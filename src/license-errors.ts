/**
 * Error codes returned by the validate-key endpoint, plus SDK-side codes for
 * failures that never reached a definitive server answer.
 */
export type LicenseErrorCode =
	| "not_found"
	| "license_expired"
	| "version_not_allowed"
	| "machine_limit_reached"
	| "plan_limit_exceeded"
	| "validation_error"
	| "internal_error"
	/** Server unreachable, timed out, or answered with an unknown error. */
	| "network_error"
	/** Server answered 200 but its token failed verification. */
	| "invalid_response";

/**
 * Codes that say something about the customer's license, and therefore lock
 * the app. Every other failure is treated like the server being unreachable.
 */
export type LockingErrorCode =
	| "not_found"
	| "license_expired"
	| "version_not_allowed"
	| "machine_limit_reached";

const LOCKING_CODES: ReadonlySet<string> = new Set<LockingErrorCode>([
	"not_found",
	"license_expired",
	"version_not_allowed",
	"machine_limit_reached",
]);

export function isLockingCode(code: string): code is LockingErrorCode {
	return LOCKING_CODES.has(code);
}

/** A failed license validation. Branch on {@link code}, never on `message`. */
export class LicenseError extends Error {
	readonly code: LicenseErrorCode;
	/** HTTP status, when the server answered. */
	readonly status: number | undefined;
	/**
	 * For `version_not_allowed`: latest version the license allows, or null
	 * when it allows none.
	 */
	readonly latestAllowedVersion: string | null | undefined;

	constructor(
		code: LicenseErrorCode,
		message: string,
		options: {
			status?: number | undefined;
			latestAllowedVersion?: string | null | undefined;
			cause?: unknown;
		} = {},
	) {
		super(message, { cause: options.cause });
		this.name = "LicenseError";
		this.code = code;
		this.status = options.status;
		this.latestAllowedVersion = options.latestAllowedVersion;
	}

	/** True when the license itself was refused (the app should lock). */
	get isLocking(): boolean {
		return isLockingCode(this.code);
	}
}
