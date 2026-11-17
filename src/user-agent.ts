declare const __SDK_VERSION__: string;

/** Version of this package, injected at build time. */
export const SDK_VERSION =
	typeof __SDK_VERSION__ === "string" ? __SDK_VERSION__ : "0.0.0";

/**
 * User agent sent to the license server, telling which SDK, runtime and OS the
 * validation comes from, e.g.
 * `licensemanager-electron/1.4.0 (electron/33.0.0; node/22.11.0; darwin arm64)`.
 */
export function userAgent(): string {
	const runtime = [
		process.versions.electron && `electron/${process.versions.electron}`,
		`node/${process.versions.node}`,
		`${process.platform} ${process.arch}`,
	].filter(Boolean);
	return `licensemanager-electron/${SDK_VERSION} (${runtime.join("; ")})`;
}
