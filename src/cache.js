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
 * Path format: ~/.git-purge/<repo>.json
 *
 * @param {string} repoName - e.g. "git-purge" or "owner/repo"
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
 * @returns {Record<string, { sha: string, prNumber: number | null, status: import("./types.js").BranchStatus, lastCheckedAt: string }>}
 */
export function readCache(repoName, customDir) {
  const filePath = getCacheFilePath(repoName, customDir);
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    console.warn(`Warning: Failed to read cache from ${filePath}: ${error.message}`);
    return {};
  }
}

/**
 * Writes the cache file for a repository.
 *
 * @param {string} repoName
 * @param {Record<string, { sha: string, prNumber: number | null, status: import("./types.js").BranchStatus, lastCheckedAt: string }>} cacheData
 * @param {string} [customDir]
 */
export function writeCache(repoName, cacheData, customDir) {
  const filePath = getCacheFilePath(repoName, customDir);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(cacheData, null, 2), "utf8");
}
