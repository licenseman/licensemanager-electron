import type { SecureStore } from "./secure-store.js";

const MINUTE = 60 * 1000;
/** How often the clock-tamper check runs, after the initial run. */
const CLOCK_CHECK_INTERVAL_MS = 60 * MINUTE;
/** Server whose HTTP `Date` header is the trusted source of current time. */
const TIME_URL = "https://google.com";
const TIME_REQUEST_TIMEOUT_MS = 5000;
/**
 * How far the system clock may drift from network time, in either direction,
 * before it counts as tampering. Covers the `Date` header's 1s precision and request latency.
 */
const CLOCK_SKEW_TOLERANCE_MS = 5 * MINUTE;

const LAST_SEEN_KEY = "lastSeen";

/**
 * Detects system clock rollback. Checks once on construction and then
 * periodically; call {@link dispose} to stop.
 */
export class ClockGuard {
	readonly #store: SecureStore;

	#tampered = false;
	#timer: NodeJS.Timeout | undefined;

	constructor(store: SecureStore) {
		this.#store = store;

		void this.#check();
		this.#timer = setInterval(() => {
			void this.#check();
		}, CLOCK_CHECK_INTERVAL_MS);
		// Don't keep the host app's event loop alive for this.
		this.#timer.unref?.();
	}

	/** True once a backwards clock jump has been observed. */
	isTampered(): boolean {
		return this.#tampered;
	}

	/** Stop the periodic check. */
	dispose(): void {
		if (this.#timer) {
			clearInterval(this.#timer);
			this.#timer = undefined;
		}
	}

	/**
	 * Network time is trusted above all: when reachable, the system clock is
	 * compared against it and the stored last-seen time is reset to it. Only
	 * when offline does the check fall back to the stored maximum, where a time
	 * earlier than it signals clock tampering. Never throws — a failure here
	 * must not crash the host app.
	 */
	async #check(): Promise<void> {
		try {
			const networkNow = await fetchNetworkTime();
			if (networkNow !== null) {
				this.#tampered =
					Math.abs(Date.now() - networkNow) > CLOCK_SKEW_TOLERANCE_MS;
				this.#store.set(LAST_SEEN_KEY, encodeTimestamp(networkNow));
				return;
			}

			const now = Date.now();
			const previous = decodeTimestamp(this.#store.get(LAST_SEEN_KEY));
			if (previous !== null && now < previous) {
				this.#tampered = true;
				return;
			}
			if (previous === null || now > previous) {
				this.#store.set(LAST_SEEN_KEY, encodeTimestamp(now));
			}
		} catch {
			// swallow: detection is best-effort
		}
	}
}

/**
 * Current time according to {@link TIME_URL}'s `Date` header, or null when
 * offline or the header is missing/unparseable.
 */
async function fetchNetworkTime(): Promise<number | null> {
	try {
		const res = await fetch(TIME_URL, {
			method: "HEAD",
			cache: "no-store",
			signal: AbortSignal.timeout(TIME_REQUEST_TIMEOUT_MS),
		});
		const parsed = Date.parse(res.headers.get("date") ?? "");
		return Number.isFinite(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** Store the int as base64 to lightly obscure it. */
function encodeTimestamp(ms: number): string {
	return Buffer.from(String(ms), "utf8").toString("base64");
}

function decodeTimestamp(value: string | null): number | null {
	if (!value) return null;
	const parsed = Number.parseInt(
		Buffer.from(value, "base64").toString("utf8"),
		10,
	);
	return Number.isFinite(parsed) ? parsed : null;
}
