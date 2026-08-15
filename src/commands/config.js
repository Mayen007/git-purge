import { setToken, getToken } from "../config.js";

/**
 * Registers the `config` command and subcommands on the Commander program.
 * @param {import("commander").Command} program
 */
export function registerConfigCommand(program) {
  const configCmd = program
    .command("config")
    .description("Manage git-purge configuration settings");

  configCmd
    .command("set-token <token>")
    .description("Store GitHub personal access token")
    .action((token) => {
      try {
        setToken(token);
        console.log("GitHub personal access token stored successfully.");
      } catch (err) {
        console.error(`Error saving token: ${err.message}`);
        process.exit(1);
      }
    });

  configCmd
    .command("get-token")
    .description("Check if a GitHub personal access token is configured")
    .action(() => {
      const token = getToken();
      if (token) {
        // Obfuscate token for display
        const visible = token.length > 8 ? `${token.slice(0, 4)}...${token.slice(-4)}` : "****";
        console.log(`GitHub token is configured: ${visible}`);
      } else {
        console.log("No GitHub token configured. Set one with: git-purge config set-token <token>");
      }
    });
}
