/**
 * Registers the `scan` command on the Commander program.
 * @param {import("commander").Command} program
 */
export function registerScanCommand(program) {
  program
    .command("scan")
    .description("Scan local branches and match against remote GitHub pull requests")
    .option("-r, --refresh", "Ignore cache and re-check every branch against GitHub")
    .action(() => {
      console.log("Scan command will be implemented in Phase 1.");
    });
}
