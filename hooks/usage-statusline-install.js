#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { resolveNodeBin } = require("./server-config");
const { writeJsonAtomic, asarUnpackedPath } = require("./json-utils");

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".claude", "settings.json");

function quote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function getStatuslineScriptPath() {
  return asarUnpackedPath(path.join(__dirname, "usage-statusline.js"));
}

function buildStatusLineCommand(options = {}) {
  const nodeBin = options.nodeBin || resolveNodeBin() || "node";
  return `${quote(nodeBin)} ${quote(getStatuslineScriptPath())}`;
}

function readSettings(configPath = DEFAULT_CONFIG_PATH) {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function installUsageStatusLine(options = {}) {
  const configPath = options.configPath || DEFAULT_CONFIG_PATH;
  const force = options.force === true;
  const settings = readSettings(configPath);
  const command = options.command || buildStatusLineCommand(options);
  const existing = settings.statusLine;

  if (existing && existing.command && existing.command !== command && !force) {
    return {
      status: "skipped",
      reason: "existing-status-line",
      existing,
      command,
    };
  }

  settings.statusLine = {
    type: "command",
    command,
    refreshInterval: Number.isFinite(options.refreshInterval)
      ? options.refreshInterval
      : 10000,
  };

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  writeJsonAtomic(configPath, settings);
  return { status: "ok", command };
}

function main() {
  try {
    const force = process.argv.includes("--force");
    const result = installUsageStatusLine({ force });
    if (result.status === "skipped") {
      console.error("Skipped: ~/.claude/settings.json already has a different statusLine. Re-run with --force to replace it.");
      process.exitCode = 2;
      return;
    }
    console.log(`Installed Claude Code usage statusLine: ${result.command}`);
  } catch (err) {
    console.error(`Failed to install Claude Code usage statusLine: ${err && err.message ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  buildStatusLineCommand,
  installUsageStatusLine,
};
