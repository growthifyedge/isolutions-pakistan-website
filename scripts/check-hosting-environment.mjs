// Firebase Hosting predeploy guard (see firebase.json "predeploy").
// Firebase sets GCLOUD_PROJECT to the deploy target; refuse to upload a dist/
// whose bundle is wired to the other environment's Supabase project.
// Manual use: GCLOUD_PROJECT=<firebase project id> node scripts/check-hosting-environment.mjs
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { hostingEnvironmentProblem, supabaseRefsInText } from "../src/lib/supabaseEnvironment.ts";

const assetsDir = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const projectId = process.env.GCLOUD_PROJECT;

let files = [];
try {
  files = (await readdir(assetsDir)).filter((name) => name.endsWith(".js"));
} catch {
  // Missing dist/ is reported below as "no Supabase project".
}
const refs = new Set();
for (const name of files) {
  for (const ref of supabaseRefsInText(await readFile(assetsDir + name, "utf8"))) refs.add(ref);
}

const problem = hostingEnvironmentProblem(projectId, [...refs]);
if (problem) {
  console.error(`\n[hosting environment guard] DEPLOY BLOCKED: ${problem}\n`);
  process.exit(1);
}
console.log(`[hosting environment guard] OK: dist/ uses Supabase ${[...refs][0]} for Firebase project ${projectId}.`);
