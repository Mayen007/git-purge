#!/usr/bin/env node

import { Command } from "commander";
import { registerConfigCommand } from "../src/commands/config.js";
import { registerScanCommand } from "../src/commands/scan.js";
import { registerCleanCommand } from "../src/commands/clean.js";

const program = new Command();

program
  .name("git-purge")
  .description("Find and safely clear local git branches that are dead on the remote.")
  .version("0.1.0");

registerScanCommand(program);
registerCleanCommand(program);
registerConfigCommand(program);

program.parse(process.argv);
