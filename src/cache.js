import fs from "node:fs";
import path from "node:path";
import { getDefaultConfigDir } from "./config.js";

/**
 * Sanitize a repo name/key to be safe for filenames.
 * E.g. "owner/repo" or "git-purge" -> "owner_repo.json" or "git-purge.json"
 *
 * @param {string} repoName
 * @returns {string}
 */
export function sanitizeRepoKey(repoName) {
  return repoName.replace(/[/\\?%*:|"<>]/g, "_");
}

/**
 * Returns the path to the cache file for a specific repo.
 * Path format: ~/.git-purge/<owner>_<repo>.json
 *
 * @param {string} repoName - e.g. "owner/repo" or "owner_repo"
 * @param {string} [customDir]
 * @returns {string}
 */
export function getCacheFilePath(repoName, customDir) {
  const dir = customDir || getDefaultConfigDir();
  const safeName = sanitizeRepoKey(repoName);
  return path.join(dir, `${safeName}.json`);
}

/**
 * Reads the cache file for a repository.
 *
 * @param {string} repoName
 * @param {string} [customDir]
 * @returns {{ defaultBranch: string | null, branches: Record<string, { sha: string, prNumber: number | null, status: import("./types.js").BranchStatus, lastCheckedAt: string }> }}
 */
export function readCache(repoName, customDir) {
  const filePath = getCacheFilePath(repoName, customDir);
  try {
    if (!fs.existsSync(filePath)) {
      return { defaultBranch: null, branches: {} };
    }
    const content = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === "object") {
      if ("branches" in parsed && typeof parsed.branches === "object") {
        return {
          defaultBranch: parsed.defaultBranch || null,
          branches: parsed.branches || {},
        };
      }
      // Support flat format for backwards-compatibility
      return {
        defaultBranch: parsed.defaultBranch || null,
        branches: parsed,
      };
    }
    return { defaultBranch: null, branches: {} };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { defaultBranch: null, branches: {} };
    }
    console.warn(`Warning: Failed to read cache from ${filePath}: ${error.message}`);
    return { defaultBranch: null, branches: {} };
  }
}

/**
 * Writes the cache file for a repository.
 *
 * @param {string} repoName
 * @param {{ defaultBranch?: string | null, branches: Record<string, { sha: string, prNumber: number | null, status: import("./types.js").BranchStatus, lastCheckedAt: string }> } | Record<string, any>} cacheData
 * @param {string} [customDir]
 */
export function writeCache(repoName, cacheData, customDir) {
  const filePath = getCacheFilePath(repoName, customDir);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const payload =
    cacheData && typeof cacheData === "object" && "branches" in cacheData
      ? {
          defaultBranch: cacheData.defaultBranch || null,
          branches: cacheData.branches || {},
        }
      : {
          defaultBranch: null,
          branches: cacheData || {},
        };

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}
