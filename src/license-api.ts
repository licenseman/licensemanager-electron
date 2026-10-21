import { LicenseError, type LicenseErrorCode } from "./license-errors.js";

export const DEFAULT_API_BASE_URL = "https://api.licensemanager.dev";
const REQUEST_TIMEOUT_MS = 10_000;

/** Server codes that are reported as-is; any other failure is a `network_error`. */
const KNOWN_SERVER_CODES: ReadonlySet<string> = new Set<LicenseErrorCode>([
	"not_found",
	"license_expired",
	"version_not_allowed",
	"machine_limit_reached",
	"plan_limit_exceeded",
	"validation_error",
	"internal_error",
]);

export interface ValidateKeyRequest {
	key: string;
	fingerprint: string;
	version: string;
	name: string;
	platform: string;
}

/**
 * Call validate-key and return the unverified license token.
 *
 * @param timeoutMs Request timeout, capped at 10 seconds.
 * @throws {LicenseError} when the server can't be reached, refuses the key or
 *   returns no token.
 */
export async function postValidateKey(
	apiBaseUrl: string,
	productId: string,
	request: ValidateKeyRequest,
	timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<{ token: string; status: number }> {
	let res: Response;
	try {
		res = await fetch(
			`${apiBaseUrl}/v1/products/${encodeURIComponent(productId)}/validate-key`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(request),
				signal: AbortSignal.timeout(
					Math.max(0, Math.min(timeoutMs, REQUEST_TIMEOUT_MS)),
				),
			},
		);
	} catch (cause) {
		throw new LicenseError(
			"network_error",
			"The license server could not be reached",
			{ cause },
		);
	}

	const json: unknown = await res.json().catch(() => null);
	if (!res.ok) throw parseServerError(res.status, json);

	const token = (json as { license?: unknown } | null)?.license;
	if (typeof token !== "string") {
		throw new LicenseError(
			"invalid_response",
			"The license server returned no token",
			{ status: res.status },
		);
	}
	return { token, status: res.status };
}

/**
 * Whether a failed validate-key call may succeed if repeated: the server was
 * unreachable, overloaded or failing. Answers about the key are final.
 */
export function isTransientError(error: unknown): boolean {
	if (!(error instanceof LicenseError)) return false;
	const { code, status } = error;
	if (status === undefined) return code === "network_error";
	return status >= 500 || status === 408 || status === 429;
}

/** Map an error response to a {@link LicenseError}, branching on `code` only. */
function parseServerError(status: number, json: unknown): LicenseError {
	const error = (json as { error?: Record<string, unknown> } | null)?.error;
	const code = typeof error?.code === "string" ? error.code : "";
	const message =
		typeof error?.message === "string"
			? error.message
			: `License server answered ${status}`;
	const latest = error?.latestAllowedVersion;
	return new LicenseError(
		KNOWN_SERVER_CODES.has(code) ? (code as LicenseErrorCode) : "network_error",
		message,
		{
			status,
			latestAllowedVersion:
				code === "version_not_allowed"
					? typeof latest === "string"
						? latest
						: null
					: undefined,
		},
	);
}
