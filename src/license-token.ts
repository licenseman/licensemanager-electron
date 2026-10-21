import { importSPKI, type JWTPayload, jwtVerify, type KeyLike } from "jose";

const DAY = 24 * 60 * 60 * 1000;
/** Never re-validate sooner than this after a validation because of `minOfflineDurationMs`. */
const MIN_REFRESH_INTERVAL_MS = DAY;

/** Claims of a verified license token. */
export interface TokenPayload extends JWTPayload {
	iat: number;
	exp: number;
	/** Max app version the license allows (`"2"`, `"2.3"`), or null for all. */
	mv?: string | null;
}

export interface ValidatedToken {
	token: string;
	payload: TokenPayload;
}

/** Verifies license tokens against the product's public key. */
export class TokenVerifier {
	readonly #publicKey: string;
	readonly #productId: string;
	readonly #getFingerprint: () => Promise<string>;
	#verificationKey: Promise<KeyLike> | undefined;

	constructor(
		publicKey: string,
		productId: string,
		getFingerprint: () => Promise<string>,
	) {
		this.#publicKey = publicKey;
		this.#productId = productId;
		this.#getFingerprint = getFingerprint;
	}

	/** Verify signature and claims, as documented for offline validation. */
	async verify(token: string, key: string): Promise<TokenPayload> {
		this.#verificationKey ??= importSPKI(this.#publicKey, "EdDSA");
		const { payload } = await jwtVerify(token, await this.#verificationKey, {
			algorithms: ["EdDSA"],
			audience: this.#productId,
			subject: key,
		});
		if (payload.fp !== (await this.#getFingerprint())) {
			throw new Error("Token of another machine");
		}
		if (typeof payload.iat !== "number" || typeof payload.exp !== "number") {
			throw new Error("Token without iat or exp");
		}
		return payload as TokenPayload;
	}
}

/**
 * When to re-validate a token: at 2/3 of its lifetime, or earlier to keep
 * `minOfflineDurationMs` of validity, though `minOfflineDurationMs` never
 * pulls it within 1 day of issue.
 */
export function computeRefreshAt(
	payload: { iat: number; exp: number },
	minOfflineDurationMs: number,
): number {
	const issuedAt = payload.iat * 1000;
	const expiresAt = payload.exp * 1000;
	const twoThirds = issuedAt + ((expiresAt - issuedAt) * 2) / 3;
	const keepOffline = Math.max(
		expiresAt - minOfflineDurationMs,
		issuedAt + MIN_REFRESH_INTERVAL_MS,
	);
	return Math.min(twoThirds, keepOffline);
}
