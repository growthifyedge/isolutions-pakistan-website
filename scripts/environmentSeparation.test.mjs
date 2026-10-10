import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SUPABASE_ENVIRONMENTS,
  buildEnvironmentProblem,
  environmentForFirebaseProject,
  environmentForSupabaseUrl,
  hostingEnvironmentProblem,
  supabaseProjectRef,
  supabaseRefsInText,
} from "../src/lib/supabaseEnvironment.ts";

const DEV_REF = "acwatgxkcyrdxpcljxjb";
const PROD_REF = "nlxfwppywxumymbjkvwt";
const DEV_URL = `https://${DEV_REF}.supabase.co`;
const PROD_URL = `https://${PROD_REF}.supabase.co`;
const DEV_HOSTING = "isolutions-development-cb1ea";
const PROD_HOSTING = "isolutions-pakistan-production";

test("environment map pairs each Firebase project with its own Supabase project", () => {
  assert.equal(SUPABASE_ENVIRONMENTS.development.supabaseProjectRef, DEV_REF);
  assert.equal(SUPABASE_ENVIRONMENTS.development.firebaseProjectId, DEV_HOSTING);
  assert.equal(SUPABASE_ENVIRONMENTS.production.supabaseProjectRef, PROD_REF);
  assert.equal(SUPABASE_ENVIRONMENTS.production.firebaseProjectId, PROD_HOSTING);
  assert.equal(environmentForFirebaseProject(DEV_HOSTING).supabaseProjectRef, DEV_REF);
  assert.equal(environmentForFirebaseProject(PROD_HOSTING).supabaseProjectRef, PROD_REF);
});

test("Admin label follows the actually connected project, unknown projects are not called Development", () => {
  assert.equal(supabaseProjectRef(DEV_URL), DEV_REF);
  assert.equal(environmentForSupabaseUrl(DEV_URL).label, "Development");
  assert.equal(environmentForSupabaseUrl(PROD_URL).label, "Production");
  assert.equal(environmentForSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co"), null);
  assert.equal(environmentForSupabaseUrl(undefined), null);
  assert.equal(environmentForSupabaseUrl("http://" + `${PROD_REF}.supabase.co`), null);
});

test("development build refuses the PRODUCTION Supabase project", () => {
  assert.equal(buildEnvironmentProblem("development", { VITE_SUPABASE_URL: DEV_URL, VITE_SUPABASE_PUBLISHABLE_KEY: "dev" }), null);
  assert.match(
    buildEnvironmentProblem("development", { VITE_SUPABASE_URL: PROD_URL, VITE_SUPABASE_PUBLISHABLE_KEY: "prod" }),
    /development build .* PRODUCTION Supabase project/,
  );
});

test("production build refuses the DEVELOPMENT Supabase project and a reused development key", () => {
  assert.equal(
    buildEnvironmentProblem("production", { VITE_SUPABASE_URL: PROD_URL, VITE_SUPABASE_PUBLISHABLE_KEY: "prod" }, "dev"),
    null,
  );
  // .env.production.local missing → Vite falls back to .env.local (DEV).
  assert.match(
    buildEnvironmentProblem("production", { VITE_SUPABASE_URL: DEV_URL, VITE_SUPABASE_PUBLISHABLE_KEY: "dev" }, "dev"),
    /production build .* DEVELOPMENT Supabase project/,
  );
  assert.match(
    buildEnvironmentProblem("production", { VITE_SUPABASE_URL: PROD_URL, VITE_SUPABASE_PUBLISHABLE_KEY: "dev" }, "dev"),
    /mixed configuration/,
  );
});

test("build guard rejects unsupported modes and missing values", () => {
  assert.match(buildEnvironmentProblem("staging", { VITE_SUPABASE_URL: DEV_URL }), /Unsupported build mode/);
  assert.match(buildEnvironmentProblem("toString", { VITE_SUPABASE_URL: DEV_URL }), /Unsupported build mode/);
  assert.match(buildEnvironmentProblem("development", {}), /VITE_SUPABASE_URL is missing/);
  assert.match(buildEnvironmentProblem("development", { VITE_SUPABASE_URL: DEV_URL }), /PUBLISHABLE_KEY is missing/);
});

test("hosting predeploy guard blocks cross-environment deploys", () => {
  const devBundle = `const u="${DEV_URL}";`;
  const prodBundle = `const u="${PROD_URL}";`;
  assert.deepEqual(supabaseRefsInText(devBundle + devBundle), [DEV_REF]);
  assert.equal(hostingEnvironmentProblem(DEV_HOSTING, supabaseRefsInText(devBundle)), null);
  assert.equal(hostingEnvironmentProblem(PROD_HOSTING, supabaseRefsInText(prodBundle)), null);
  assert.match(hostingEnvironmentProblem(DEV_HOSTING, supabaseRefsInText(prodBundle)), /PRODUCTION Supabase .* DEVELOPMENT hosting/);
  assert.match(hostingEnvironmentProblem(PROD_HOSTING, supabaseRefsInText(devBundle)), /DEVELOPMENT Supabase .* PRODUCTION hosting/);
  assert.match(hostingEnvironmentProblem(DEV_HOSTING, supabaseRefsInText(devBundle + prodBundle)), /more than one/);
  assert.match(hostingEnvironmentProblem(DEV_HOSTING, []), /does not reference any Supabase project/);
  assert.match(hostingEnvironmentProblem("someone-else", [DEV_REF]), /Unknown Firebase project/);
});

test("build scripts select an explicit mode, the TS config and the deploy guard is wired", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(pkg.scripts["build:dev"], /vite build --config vite\.config\.ts --mode development/);
  assert.match(pkg.scripts["build:prod"], /vite build --config vite\.config\.ts --mode production/);
  assert.equal(pkg.scripts.build, "npm run build:prod");
  const firebase = JSON.parse(await readFile("firebase.json", "utf8"));
  assert.deepEqual(firebase.hosting.predeploy, ["node scripts/check-hosting-environment.mjs"]);
  const viteConfig = await readFile("vite.config.ts", "utf8");
  assert.match(viteConfig, /buildEnvironmentProblem\(mode, env, otherModeKey\)/);
  const supabaseClient = await readFile("src/lib/supabase.ts", "utf8");
  assert.match(supabaseClient, /environmentForSupabaseUrl\(supabaseUrl\)/);
  assert.doesNotMatch(supabaseClient, /PRODUCTION_PROJECT_REF/);
});
