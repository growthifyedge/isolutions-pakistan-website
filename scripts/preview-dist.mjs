// Approved previews of an already-built dist/.
//   npm run preview:dev   -> dist/ must be a DEVELOPMENT build (npm run build:dev)
//   npm run preview:prod  -> dist/ must be a PRODUCTION build (npm run build:prod)
// The bundle is checked against the requested environment before vite starts, and only this script sets the
// flag that lets vite start in production mode (see serveModeProblem in src/lib/supabaseEnvironment.ts).
// Add --check to only verify dist/ and exit.
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SUPABASE_ENVIRONMENTS, previewDistProblem, supabaseRefsInText } from "../src/lib/supabaseEnvironment.ts";

const target = process.argv[2];
if (target !== "development" && target !== "production") {
  console.error('Usage: node scripts/preview-dist.mjs <development|production> [--check]');
  process.exit(2);
}

const assetsDir = fileURLToPath(new URL("../dist/assets/", import.meta.url));
let files = [];
try {
  files = (await readdir(assetsDir)).filter((name) => name.endsWith(".js"));
} catch {
  // reported by previewDistProblem as "references no Supabase project"
}
const refs = new Set();
for (const name of files) for (const ref of supabaseRefsInText(await readFile(assetsDir + name, "utf8"))) refs.add(ref);

const problem = previewDistProblem(target, [...refs]);
if (problem) {
  console.error(`\n[preview guard] BLOCKED: ${problem}\n`);
  process.exit(1);
}
console.log(`[preview guard] OK: dist/ uses ${target.toUpperCase()} Supabase ${SUPABASE_ENVIRONMENTS[target].supabaseProjectRef}.`);
if (process.argv.includes("--check")) process.exit(0);

const port = target === "production" ? "4174" : "4173";
const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const child = spawn(process.execPath, [vite, "preview", "--config", "vite.config.ts", "--mode", target, "--host", "127.0.0.1", "--port", port, "--strictPort"], {
  stdio: "inherit",
  env: { ...process.env, ...(target === "production" ? { ISOLUTIONS_PROD_PREVIEW: "1" } : {}) },
});
child.on("exit", (code) => process.exit(code ?? 0));
