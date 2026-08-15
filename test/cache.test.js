import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readCache, writeCache, getCacheFilePath, sanitizeRepoKey } from "../src/cache.js";

describe("cache module", () => {
  const testDir = path.join(os.tmpdir(), `git-purge-cache-test-${Date.now()}`);

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

  it("sanitizes repo keys for filesystem safety", () => {
    expect(sanitizeRepoKey("Mayen007/git-purge")).toBe("Mayen007_git-purge");
    expect(sanitizeRepoKey("owner/repo:test")).toBe("owner_repo_test");
  });

  it("returns empty object if cache file does not exist", () => {
    const data = readCache("sample-repo", testDir);
    expect(data).toEqual({});
  });

  it("writes and reads branch cache data correctly", () => {
    const mockCache = {
      "feature/login-page": {
        sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        prNumber: 142,
        status: "merged",
        lastCheckedAt: "2026-08-10T09:00:00Z",
      },
    };

    writeCache("sample-repo", mockCache, testDir);
    const loaded = readCache("sample-repo", testDir);
    expect(loaded).toEqual(mockCache);

    const filePath = getCacheFilePath("sample-repo", testDir);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
