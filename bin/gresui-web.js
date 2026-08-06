#!/usr/bin/env node
// gresui-web launcher — spawns the app's bun runtime (from the @oven/bun-*
// optional dependency, matching this platform) with backend/main.ts.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveBun() {
  const arch = process.arch === "arm64"
    ? "aarch64"
    : process.arch === "x64"
    ? "x64"
    : null;
  if (!arch) return null;
  const tryPkg = (name) => {
    try {
      const root = path.dirname(require.resolve(`${name}/package.json`));
      for (const bin of ["bin/bun.exe", "bin/bun"]) {
        const p = path.join(root, bin);
        if (existsSync(p)) return p;
      }
    } catch {
      // try next candidate
    }
    return null;
  };
  const plat = process.platform;
  if (plat === "win32") return tryPkg(`@oven/bun-windows-${arch}`);
  if (plat === "darwin") return tryPkg(`@oven/bun-darwin-${arch}`);
  if (plat === "linux") {
    // glibc first; musl fallback (npm can't filter on libc).
    return tryPkg(`@oven/bun-linux-${arch}`) ??
      tryPkg(`@oven/bun-linux-${arch}-musl`);
  }
  return null;
}

const bunBin = resolveBun();
if (!bunBin) {
  console.error(
    "gresui-web: no bun runtime for this platform. Reinstall with: npm install -g gresui-web",
  );
  process.exit(1);
}

const entry = path.join(pkgDir, "backend", "main.ts");
const child = spawn(bunBin, ["run", entry, ...process.argv.slice(2)], {
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
