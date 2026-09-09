#!/usr/bin/env node
// gresui-web launcher — runs backend/main.ts on the Node that started us.
//
// Node executes TypeScript directly by stripping types, and ships SQLite as a
// built-in, so there is no runtime to download and no build step. Both landed
// behind flags before they were turned on by default, so probe this Node and
// pass the flags only when it still needs them.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const MIN_NODE = [22, 6, 0];

function versionTooOld() {
  const [maj, min, pat] = process.versions.node.split(".").map(Number);
  const [rMaj, rMin, rPat] = MIN_NODE;
  if (maj !== rMaj) return maj < rMaj;
  if (min !== rMin) return min < rMin;
  return pat < rPat;
}

if (versionTooOld()) {
  console.error(
    `gresui-web: Node ${MIN_NODE.join(".")}+ is required (this is ${process.versions.node}).`,
  );
  process.exit(1);
}

const flags = [];

// process.features.typescript: "strip" | "transform" | false (Node 22.10+).
if (!process.features.typescript) flags.push("--experimental-strip-types");

// node:sqlite throws ERR_UNKNOWN_BUILTIN_MODULE until it is unflagged.
try {
  require("node:sqlite");
} catch {
  flags.push("--experimental-sqlite");
}

// Type stripping is loud about being experimental; the user did not ask for a
// language-implementation status report on every launch.
flags.push("--disable-warning=ExperimentalWarning");

const entry = path.join(pkgDir, "backend", "main.ts");
const child = spawn(process.execPath, [...flags, entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}

child.on("error", (err) => {
  console.error(`gresui-web failed to start: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
