import { defineConfig } from "vitest/config";

import pkg from "./package.json" with { type: "json" };

export default defineConfig({
	define: { __SDK_VERSION__: JSON.stringify(pkg.version) },
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			reporter: ["text", "lcov", "json-summary"],
			thresholds: {
				lines: 80,
				functions: 80,
				branches: 80,
				statements: 80,
			},
		},
	},
});
