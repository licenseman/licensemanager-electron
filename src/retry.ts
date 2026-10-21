export interface RetryPolicy {
	/** Delay before the first retry. Doubles after each failed attempt. */
	initialDelayMs: number;
	/** Cap on a single delay. */
	maxDelayMs: number;
	/** Total time across all attempts and waits. */
	budgetMs: number;
}

/** No attempt is started with less than this left in the budget. */
const MIN_ATTEMPT_MS = 1000;

/**
 * Run `attempt` until it succeeds, a non-retryable error is thrown or the
 * budget runs out, waiting with exponential backoff and jitter in between.
 * Each attempt receives the time left in the budget, to bound its timeout.
 * Aborting `signal` stops retrying; the last error is thrown.
 */
export async function withRetry<T>(
	attempt: (remainingMs: number) => Promise<T>,
	isRetryable: (error: unknown) => boolean,
	policy: RetryPolicy,
	signal?: AbortSignal,
): Promise<T> {
	const deadline = Date.now() + policy.budgetMs;
	let delay = policy.initialDelayMs;
	for (;;) {
		try {
			return await attempt(deadline - Date.now());
		} catch (error) {
			// Equal jitter: half fixed, half random, so retries keep spreading out.
			const wait = delay / 2 + (Math.random() * delay) / 2;
			if (
				!isRetryable(error) ||
				signal?.aborted ||
				Date.now() + wait + MIN_ATTEMPT_MS > deadline
			) {
				throw error;
			}
			if (!(await sleep(wait, signal))) throw error;
			delay = Math.min(delay * 2, policy.maxDelayMs);
		}
	}
}

/** Resolve with true after `ms`, or false as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
	return new Promise((resolve) => {
		const onAbort = () => {
			clearTimeout(timer);
			resolve(false);
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve(true);
		}, ms);
		// Don't keep the host app's event loop alive for this.
		timer.unref?.();
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
