export const SDK_NAME = "@licenseman/electron";

export type { MachineFingerprint } from "./fingerprint.js";
export type { LicenseErrorCode } from "./license-errors.js";
export { LicenseError } from "./license-errors.js";
export type { LicenseManagerOptions } from "./license-manager.js";
export { LicenseManager } from "./license-manager.js";
export type {
	LicenseState,
	LicenseStateListener,
	OfflineState,
} from "./license-state.js";
