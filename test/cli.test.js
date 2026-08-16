import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.resolve(__dirname, "../bin/git-purge.js");
const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "../package.json"), "utf8")
);

describe("CLI skeleton", { timeout: 20000 }, () => {
  it("should print the version matching package.json", async () => {
    const { stdout } = await execFileAsync(process.execPath, [binPath, "--version"]);
    expect(stdout.trim()).toBe(pkg.version);
  });

  it("should show help with scan, clean, and config commands", async () => {
    const { stdout } = await execFileAsync(process.execPath, [binPath, "--help"]);
    expect(stdout).toContain("Usage: git-purge [options] [command]");
    expect(stdout).toContain("scan");
    expect(stdout).toContain("clean");
    expect(stdout).toContain("config");
  });

  it("should show help for config command", async () => {
    const { stdout } = await execFileAsync(process.execPath, [binPath, "config", "--help"]);
    expect(stdout).toContain("set-token");
    expect(stdout).toContain("get-token");
  });

  it("should show help for scan command", async () => {
    const { stdout } = await execFileAsync(process.execPath, [binPath, "scan", "--help"]);
    expect(stdout).toContain("--refresh");
  });

  it("should show help for clean command", async () => {
    const { stdout } = await execFileAsync(process.execPath, [binPath, "clean", "--help"]);
    expect(stdout).toContain("--yes");
  });
});
