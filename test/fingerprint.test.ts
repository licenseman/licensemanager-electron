import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: (
		file: string,
		args: string[],
		opts: unknown,
		cb: (err: Error | null, out?: { stdout: string; stderr: string }) => void,
	) => execFileMock(file, args, opts, cb),
}));

const readFileMock = vi.fn();
vi.mock("node:fs/promises", () => ({
	readFile: (...a: unknown[]) => readFileMock(...a),
}));

import {
	hashMachineValue,
	readMachineId,
	resolveMachineFingerprint,
} from "../src/fingerprint";

function setPlatform(value: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", { value, configurable: true });
}

const realPlatform = process.platform;

afterEach(() => {
	setPlatform(realPlatform);
	execFileMock.mockReset();
	readFileMock.mockReset();
	vi.restoreAllMocks();
});

describe("resolveMachineFingerprint option", () => {
	it("hashes a verbatim string", async () => {
		const fp = await resolveMachineFingerprint("my-machine");
		expect(fp).toBe(hashMachineValue("my-machine"));
	});

	it("awaits a sync function", async () => {
		const fp = await resolveMachineFingerprint(() => "sync-value");
		expect(fp).toBe(hashMachineValue("sync-value"));
	});

	it("awaits an async function", async () => {
		const fp = await resolveMachineFingerprint(async () => "async-value");
		expect(fp).toBe(hashMachineValue("async-value"));
	});
});

describe("readMachineId default resolver", () => {
	it("parses the macOS IOPlatformUUID", async () => {
		setPlatform("darwin");
		execFileMock.mockImplementation((_f, _a, _o, cb) =>
			cb(null, {
				stdout: '  "IOPlatformUUID" = "ABCDEF12-3456-7890-ABCD-EF1234567890"\n',
				stderr: "",
			}),
		);
		expect(await readMachineId()).toBe("abcdef12-3456-7890-abcd-ef1234567890");
	});

	it("parses the Windows MachineGuid", async () => {
		setPlatform("win32");
		execFileMock.mockImplementation((_f, _a, _o, cb) =>
			cb(null, {
				stdout:
					"\r\nHKEY_LOCAL_MACHINE\\...\r\n    MachineGuid    REG_SZ    11112222-3333-4444-5555-666677778888\r\n",
				stderr: "",
			}),
		);
		expect(await readMachineId()).toBe("11112222-3333-4444-5555-666677778888");
	});

	it("reads the Linux machine-id file", async () => {
		setPlatform("linux");
		readFileMock.mockResolvedValueOnce("deadbeefdeadbeefdeadbeefdeadbeef\n");
		expect(await readMachineId()).toBe("deadbeefdeadbeefdeadbeefdeadbeef");
	});

	it("falls back without throwing when the native lookup fails", async () => {
		setPlatform("darwin");
		execFileMock.mockImplementation((_f, _a, _o, cb) => cb(new Error("boom")));
		const value = await readMachineId();
		expect(value).toBeTruthy();
		// Fallback is a MAC address or hostname, never the digest form.
		expect(value).not.toMatch(/^[A-Za-z0-9+/]{43}=$/);
	});

	it("falls back when the macOS UUID is present but empty", async () => {
		setPlatform("darwin");
		execFileMock.mockImplementation((_f, _a, _o, cb) =>
			cb(null, { stdout: '"IOPlatformUUID" = ""\n', stderr: "" }),
		);
		expect(await readMachineId()).toBeTruthy();
	});

	it("falls back when no Linux machine-id file is readable", async () => {
		setPlatform("linux");
		readFileMock.mockRejectedValue(new Error("ENOENT"));
		expect(await readMachineId()).toBeTruthy();
	});

	it("tries the dbus path when /etc/machine-id is empty", async () => {
		setPlatform("linux");
		readFileMock
			.mockResolvedValueOnce("   \n")
			.mockResolvedValueOnce("cafecafecafecafecafecafecafecafe\n");
		expect(await readMachineId()).toBe("cafecafecafecafecafecafecafecafe");
	});
});

describe("hashMachineValue", () => {
	it("is a stable base64 sha256 digest", () => {
		expect(hashMachineValue("x")).toBe(
			createHash("sha256").update("x").digest("base64"),
		);
	});
});
