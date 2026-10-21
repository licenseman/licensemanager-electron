import { describe, expect, it } from "vitest";
import { SDK_NAME } from "../src/index";

describe("@licenseman/electron", () => {
	it("exports the SDK name", () => {
		expect(SDK_NAME).toBe("@licenseman/electron");
	});
});
