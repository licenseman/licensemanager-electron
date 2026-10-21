import { describe, expect, it } from "vitest";
import { LicenseManager, SDK_NAME } from "../src/index";

describe("public entry point", () => {
	it("exports the SDK name and LicenseManager", () => {
		expect(SDK_NAME).toBe("@licenseman/electron");
		expect(typeof LicenseManager).toBe("function");
	});
});
