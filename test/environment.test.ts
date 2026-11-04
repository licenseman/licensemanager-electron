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

const readFileSyncMock = vi.fn();
vi.mock("node:fs", () => ({
	readFileSync: (...a: unknown[]) => readFileSyncMock(...a),
}));

vi.mock("node:os", () => ({
	hostname: () => "mac.home",
	release: () => "6.8.0-45-generic",
}));

import {
	defaultMachineName,
	defaultPlatform,
	windowsPlatform,
} from "../src/environment";

function setPlatform(value: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", { value, configurable: true });
}

const realPlatform = process.platform;

afterEach(() => {
	setPlatform(realPlatform);
	execFileMock.mockReset();
	readFileSyncMock.mockReset();
});

function stdout(value: string) {
	execFileMock.mockImplementation((_f, _a, _o, cb) =>
		cb(null, { stdout: value, stderr: "" }),
	);
}

describe("defaultMachineName", () => {
	it("uses the macOS ComputerName", async () => {
		setPlatform("darwin");
		stdout("Jane’s MacBook Pro\n");
		expect(await defaultMachineName()).toBe("Jane’s MacBook Pro");
		expect(execFileMock.mock.calls[0]?.slice(0, 2)).toEqual([
			"scutil",
			["--get", "ComputerName"],
		]);
	});

	it("uses the Linux pretty hostname", async () => {
		setPlatform("linux");
		stdout("Jane's Laptop\n");
		expect(await defaultMachineName()).toBe("Jane's Laptop");
		expect(execFileMock.mock.calls[0]?.[0]).toBe("hostnamectl");
	});

	it("falls back to the hostname on failure or empty output", async () => {
		setPlatform("darwin");
		execFileMock.mockImplementation((_f, _a, _o, cb) => cb(new Error("nope")));
		expect(await defaultMachineName()).toBe("mac.home");
		setPlatform("linux");
		stdout("\n");
		expect(await defaultMachineName()).toBe("mac.home");
	});

	it("uses the hostname on Windows", async () => {
		setPlatform("win32");
		expect(await defaultMachineName()).toBe("mac.home");
		expect(execFileMock).not.toHaveBeenCalled();
	});
});

describe("defaultPlatform", () => {
	it("includes the macOS version", () => {
		setPlatform("darwin");
		readFileSyncMock.mockReturnValue(
			"<dict><key>ProductName</key><string>macOS</string><key>ProductVersion</key>\n\t<string>26.5.1</string></dict>",
		);
		expect(defaultPlatform()).toBe("macOS 26.5.1");
	});

	it("falls back to bare macOS", () => {
		setPlatform("darwin");
		readFileSyncMock.mockImplementation(() => {
			throw new Error("ENOENT");
		});
		expect(defaultPlatform()).toBe("macOS");
	});

	it("includes the Linux distribution", () => {
		setPlatform("linux");
		readFileSyncMock.mockReturnValue(
			'NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\nID=ubuntu\n',
		);
		expect(defaultPlatform()).toBe("Linux (Ubuntu 24.04.1 LTS)");
	});

	it("falls back to the Linux kernel version", () => {
		setPlatform("linux");
		readFileSyncMock.mockImplementation(() => {
			throw new Error("ENOENT");
		});
		expect(defaultPlatform()).toBe("Linux 6.8.0-45-generic");
	});

	it("tells Windows 10 and 11 apart by build", () => {
		expect(windowsPlatform("10.0.22631")).toBe("Windows 11 (10.0.22631)");
		expect(windowsPlatform("10.0.19045")).toBe("Windows 10 (10.0.19045)");
		expect(windowsPlatform("6.3.9600")).toBe("Windows 6.3.9600");
	});
});
