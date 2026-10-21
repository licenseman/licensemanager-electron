import { createRequire } from "node:module";

/**
 * `require` that works in both the ESM and CJS builds. In CJS `require` is a
 * global; in ESM it is synthesised from the module URL.
 */
export const nodeRequire =
	typeof require === "function" ? require : createRequire(import.meta.url);
