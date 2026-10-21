import { describe, expect, it } from "vitest";
import { isVersionAllowed } from "../src/version";

describe("isVersionAllowed", () => {
	it.each([
		["2.3.1", null, true],
		["2.3.1", undefined, true],
		["2.9.9", "2", true],
		["1.0.0", "2", true],
		["3.0.0", "2", false],
		["2.3.9", "2.3", true],
		["2.2.0", "2.3", true],
		["1.9.0", "2.3", true],
		["2.4.0", "2.3", false],
		["3.0.0", "2.3", false],
		["2", "2.3", true],
		["v2.3.1", "2.3", true],
		["2.4.0-beta.1", "2.3", false],
		["2.3.1", "garbage", true],
		["garbage", "2.3", true],
	])("%s with mv %s → %s", (version, mv, expected) => {
		expect(isVersionAllowed(version, mv)).toBe(expected);
	});
});
