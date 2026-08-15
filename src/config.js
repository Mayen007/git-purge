import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Returns the default directory for git-purge storage (~/.git-purge).
 * @returns {string}
 */
export function getDefaultConfigDir() {
  return path.join(os.homedir(), ".git-purge");
}

/**
 * Returns the path to the config file.
 * @param {string} [customPath]
 * @returns {string}
 */
export function getConfigFilePath(customPath) {
  if (customPath) {
    return customPath;
  }
  return path.join(getDefaultConfigDir(), "config.json");
}

/**
 * Reads the config object from disk.
 * @param {string} [customPath]
 * @returns {Record<string, any>}
 */
export function readConfig(customPath) {
  const filePath = getConfigFilePath(customPath);
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
    throw new Error(`Failed to read config from ${filePath}: ${error.message}`);
  }
}

/**
 * Writes the config object to disk.
 * @param {Record<string, any>} config
 * @param {string} [customPath]
 */
export function writeConfig(config, customPath) {
  const filePath = getConfigFilePath(customPath);
  const dirPath = path.dirname(filePath);
  
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
}

/**
 * Gets the GitHub Personal Access Token.
 * @param {string} [customPath]
 * @returns {string | undefined}
 */
export function getToken(customPath) {
  const config = readConfig(customPath);
  return config.githubToken;
}

/**
 * Stores the GitHub Personal Access Token.
 * @param {string} token
 * @param {string} [customPath]
 */
export function setToken(token, customPath) {
  if (!token || typeof token !== "string" || token.trim() === "") {
    throw new Error("Token cannot be empty.");
  }
  const config = readConfig(customPath);
  config.githubToken = token.trim();
  writeConfig(config, customPath);
}
