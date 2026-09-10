// Compile the TypeScript backend to JavaScript for the published package.
//
// Node strips types on the fly, which is why `npm run dev` needs no build
// step — but it refuses to do so for files under node_modules, and that is
// exactly where an installed package lives. There is no flag to override it
// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so anything we publish has
// to be JavaScript already.
//
// Output goes to server/, not dist/: dist/ is wiped by `vite build` and then
// served to the browser over HTTP, and the backend belongs in neither.
// server/main.js sits one level below the package root, the same as
// backend/main.ts, so main.ts's ROOT (dirname + "..") still lands on the
// package root.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [path.join(root, "backend", "main.ts")],
  outfile: path.join(root, "server", "main.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  // Matches the engines field. Anything older cannot run this anyway.
  target: "node22",
  // Bundle our own modules (which import each other with .ts extensions Node
  // would reject) but leave dependencies to be resolved from node_modules at
  // runtime, so they are installed once rather than inlined here.
  packages: "external",
  sourcemap: true,
  logLevel: "info",
});
