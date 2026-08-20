import { readFile, mkdir, writeFile } from "node:fs/promises";

const env = Object.fromEntries(
  (await readFile(".env.local", "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "")];
    }),
);

const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Required publishable Supabase environment is missing");

const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const publicTables = ["brands", "categories", "products", "product_variants", "product_specifications", "product_media"];
const results = [];

for (const table of publicTables) {
  const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers });
  results.push({ check: `public_read_${table}`, passed: response.ok, status: response.status });
}

for (const table of ["profiles", "inventory_movements"]) {
  const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers });
  results.push({ check: `anonymous_private_read_denied_${table}`, passed: response.status === 401 || response.status === 403, status: response.status });
}

const writeResponse = await fetch(`${url}/rest/v1/brands`, { method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ name: "FORBIDDEN TEST", slug: "forbidden-test" }) });
results.push({ check: "anonymous_catalog_write_denied", passed: writeResponse.status === 401 || writeResponse.status === 403, status: writeResponse.status });

const rpcResponse = await fetch(`${url}/rest/v1/rpc/is_catalog_admin`, { method: "POST", headers, body: "{}" });
results.push({ check: "anonymous_admin_rpc_denied", passed: rpcResponse.status === 401 || rpcResponse.status === 403 || rpcResponse.status === 404, status: rpcResponse.status });

const report = { verifiedAt: new Date().toISOString(), credentialClass: "publishable_only", passed: results.every((result) => result.passed), results };
await mkdir("artifacts/phase3a", { recursive: true });
await writeFile("artifacts/phase3a/remote-verification.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
