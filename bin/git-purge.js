#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { registerConfigCommand } from "../src/commands/config.js";
import { registerScanCommand } from "../src/commands/scan.js";
import { registerCleanCommand } from "../src/commands/clean.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

const program = new Command();

program
  .name("git-purge")
  .description("Find and safely clear local git branches that are dead on the remote.")
  .version(pkg.version);

registerScanCommand(program);
registerCleanCommand(program);
registerConfigCommand(program);

program.parse(process.argv);
