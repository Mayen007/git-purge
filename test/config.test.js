import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readConfig, writeConfig, getToken, setToken, getConfigFilePath } from "../src/config.js";

describe("config module", () => {
  const testDir = path.join(os.tmpdir(), `git-purge-test-${Date.now()}`);
  const testConfigFile = path.join(testDir, "config.json");

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should return empty object if config file does not exist", () => {
    const config = readConfig(testConfigFile);
    expect(config).toEqual({});
  });

  it("should store and retrieve github token", () => {
    setToken("ghp_test_secret_token_12345", testConfigFile);
    expect(getToken(testConfigFile)).toBe("ghp_test_secret_token_12345");
  });

  it("should overwrite existing token when updated", () => {
    setToken("ghp_first_token", testConfigFile);
    expect(getToken(testConfigFile)).toBe("ghp_first_token");

    setToken("ghp_second_token", testConfigFile);
    expect(getToken(testConfigFile)).toBe("ghp_second_token");
  });

  it("should throw error if empty token is provided", () => {
    expect(() => setToken("", testConfigFile)).toThrow("Token cannot be empty.");
    expect(() => setToken("   ", testConfigFile)).toThrow("Token cannot be empty.");
  });

  it("should write and read generic config keys", () => {
    writeConfig({ githubToken: "abc", defaultBranch: "main" }, testConfigFile);
    const config = readConfig(testConfigFile);
    expect(config).toEqual({ githubToken: "abc", defaultBranch: "main" });
  });

  it("should return default config path in ~/.git-purge/config.json when none specified", () => {
    const defaultPath = getConfigFilePath();
    expect(defaultPath).toBe(path.join(os.homedir(), ".git-purge", "config.json"));
  });
});
