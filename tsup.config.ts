import { defineConfig } from "tsup";

import pkg from "./package.json" with { type: "json" };

export default defineConfig({
	define: { __SDK_VERSION__: JSON.stringify(pkg.version) },
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: true,
	sourcemap: true,
	clean: true,
	target: "node18",
	platform: "node",
	external: ["electron"],
	// The CJS build never evaluates the `import.meta.url` branch (it uses the
	// global `require`), so esbuild's empty-import-meta warning is a false alarm.
	esbuildOptions(options) {
		options.logOverride = {
			...options.logOverride,
			"empty-import-meta": "silent",
		};
	},
});
