#!/usr/bin/env node
// gresui-web launcher — runs the backend on the Node that started us.
//
// Two entry points, because Node will not strip types under node_modules:
//
//   backend/main.ts   the source — present only in a git checkout
//   server/main.js    compiled at pack time — what an installed copy runs
//
// The source wins when it is there. Checking for it rather than for the
// bundle is what keeps `npm run dev` honest: the bundle also exists in the
// repo once you have run a build, and preferring it would silently ignore
// every later edit to backend/. The published tarball ships no backend/, so
// an installed copy has only the bundle to find.
//
// Node ships SQLite as a built-in and strips types itself, so working in the
// repo still needs no build step. Both landed behind flags before they were
// turned on by default, so probe this Node and pass the flags only when it
// still needs them.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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

const source = path.join(pkgDir, "backend", "main.ts");
const compiled = path.join(pkgDir, "server", "main.js");
const needsTypeStripping = existsSync(source);
const entry = needsTypeStripping ? source : compiled;

if (!needsTypeStripping && !existsSync(compiled)) {
  console.error(
    "gresui-web: no backend found — expected either backend/main.ts (git " +
      "checkout) or server/main.js (installed). Try reinstalling.",
  );
  process.exit(1);
}

const flags = [];

// process.features.typescript: "strip" | "transform" | false (Node 22.10+).
if (needsTypeStripping && !process.features.typescript) {
  flags.push("--experimental-strip-types");
}

// node:sqlite throws ERR_UNKNOWN_BUILTIN_MODULE until it is unflagged.
try {
  require("node:sqlite");
} catch {
  flags.push("--experimental-sqlite");
}

// Type stripping is loud about being experimental; the user did not ask for a
// language-implementation status report on every launch.
flags.push("--disable-warning=ExperimentalWarning");

const child = spawn(
  process.execPath,
  [...flags, entry, ...process.argv.slice(2)],
  {
    stdio: "inherit",
  },
);

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
