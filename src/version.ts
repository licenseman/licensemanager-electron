/** Leading `major[.minor]` numbers of a version, ignoring patch and suffixes. */
function parseMajorMinor(
	version: string,
): [major: number, minor: number | undefined] | null {
	const match = /^\s*v?(\d+)(?:\.(\d+))?/.exec(version);
	if (!match) return null;
	return [
		Number(match[1]),
		match[2] === undefined ? undefined : Number(match[2]),
	];
}

/**
 * Whether a license token's `mv` claim allows `version`. `mv` is a major
 * (`"2"`: all 2.x.x and older), a major.minor (`"2.3"`: all 2.3.x and older),
 * or null (every version). A value that can't be parsed allows the version:
 * the server stays the authoritative check.
 */
export function isVersionAllowed(
	version: string,
	maxVersion: string | null | undefined,
): boolean {
	if (maxVersion === null || maxVersion === undefined) return true;
	const max = parseMajorMinor(maxVersion);
	const current = parseMajorMinor(version);
	if (!max || !current) return true;

	const [maxMajor, maxMinor] = max;
	const [major, minor = 0] = current;
	if (major !== maxMajor) return major < maxMajor;
	return maxMinor === undefined || minor <= maxMinor;
}
