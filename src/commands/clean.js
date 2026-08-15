/**
 * Registers the `clean` command on the Commander program.
 * @param {import("commander").Command} program
 */
export function registerCleanCommand(program) {
  program
    .command("clean")
    .description("Safely delete local branches that are merged or closed on GitHub")
    .option("-y, --yes", "Skip individual branch confirmation prompts (final confirmation still required)")
    .action(() => {
      console.log("Clean command will be implemented in Phase 2.");
    });
}
