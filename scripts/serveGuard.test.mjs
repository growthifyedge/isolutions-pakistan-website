import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SUPABASE_ENVIRONMENTS, previewDistProblem, serveModeProblem } from "../src/lib/supabaseEnvironment.ts";

const DEV_REF = SUPABASE_ENVIRONMENTS.development.supabaseProjectRef;
const PROD_REF = SUPABASE_ENVIRONMENTS.production.supabaseProjectRef;

test("serveModeProblem blocks production-mode servers/previews unless the approved script set the flag", () => {
  assert.match(serveModeProblem("production", {}), /Refusing to start a dev server in production mode.*npm run preview:prod/);
  assert.match(serveModeProblem("production", {}, true), /Refusing to start a preview in production mode/);
  assert.match(serveModeProblem("production", { ISOLUTIONS_PROD_PREVIEW: "0" }), /Refusing/);
  assert.match(serveModeProblem("production", { ISOLUTIONS_PROD_PREVIEW: "true" }), /Refusing/);
  assert.equal(serveModeProblem("production", { ISOLUTIONS_PROD_PREVIEW: "1" }), null);
  assert.equal(serveModeProblem("development", {}), null);
  assert.equal(serveModeProblem("development", {}, true), null);
});

test("23. a real `vite --mode production` (dev server and preview) is refused at config load", () => {
  for (const args of [["--mode", "production"], ["preview", "--mode", "production"]]) {
    const run = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", ...args, "--config", "vite.config.ts", "--port", "5998", "--strictPort"], {
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, ISOLUTIONS_PROD_PREVIEW: "" },
    });
    assert.notEqual(run.status, 0, args.join(" "));
    assert.match(`${run.stdout}${run.stderr}`, /\[environment guard\] Refusing to start/, args.join(" "));
  }
});

test("24. the approved production-preview path: only scripts/preview-dist.mjs sets the flag, after verifying dist/", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(pkg.scripts["preview:prod"], "node scripts/preview-dist.mjs production");
  assert.equal(pkg.scripts["preview:dev"], "node scripts/preview-dist.mjs development");
  assert.equal(pkg.scripts.preview, "npm run preview:dev");
  assert.doesNotMatch(pkg.scripts.dev, /production/);
  const script = await readFile("scripts/preview-dist.mjs", "utf8");
  assert.match(script, /previewDistProblem\(target, \[\.\.\.refs\]\)/);
  assert.match(script, /ISOLUTIONS_PROD_PREVIEW: "1"/);
  const config = await readFile("vite.config.ts", "utf8");
  assert.match(config, /serveModeProblem\(mode, process\.env, Boolean\(isPreview\)\)/);
  assert.match(config, /buildEnvironmentProblem\(mode, env, otherModeKey\)/, "the existing build guard is untouched");
  // The flag is honoured when set (this is what preview:prod passes to vite).
  assert.equal(serveModeProblem("production", { ISOLUTIONS_PROD_PREVIEW: "1" }, true), null);
});

test("previewDistProblem accepts only a dist wired to the requested environment", () => {
  assert.equal(previewDistProblem("development", [DEV_REF]), null);
  assert.equal(previewDistProblem("production", [PROD_REF]), null);
  assert.match(previewDistProblem("production", [DEV_REF]), /needs nlxfwppywxumymbjkvwt.*build:prod/);
  assert.match(previewDistProblem("development", [PROD_REF]), /needs acwatgxkcyrdxpcljxjb.*build:dev/);
  assert.match(previewDistProblem("production", [DEV_REF, PROD_REF]), /wired to/);
  assert.match(previewDistProblem("production", []), /no Supabase project/);
});

test("the preview script refuses a mismatched dist/ before starting vite", () => {
  const run = spawnSync(process.execPath, ["scripts/preview-dist.mjs", "staging", "--check"], { encoding: "utf8" });
  assert.equal(run.status, 2);
  const missing = spawnSync(process.execPath, ["scripts/preview-dist.mjs", "production", "--check"], { encoding: "utf8", env: { ...process.env } });
  // dist/ may legitimately be a PROD build when this runs; the guard must either pass or block, never start vite.
  assert.ok([0, 1].includes(missing.status));
  assert.match(`${missing.stdout}${missing.stderr}`, /\[preview guard\]/);
});
