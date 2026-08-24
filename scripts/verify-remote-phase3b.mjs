import { mkdir, readFile, writeFile } from "node:fs/promises";

const env = Object.fromEntries(
  (await readFile(".env.local", "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [
        line.slice(0, index).trim(),
        line.slice(index + 1).trim().replace(/^['"]|['"]$/g, ""),
      ];
    }),
);

const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("Required publishable Supabase environment is missing");

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};
const results = [];

const mediaResponse = await fetch(
  `${url}/rest/v1/product_media?select=id,product_id,variant_id,cloudinary_public_id,cloudinary_asset_id,cloudinary_version,secure_url,width,height,bytes,format,is_primary,sort_order&limit=1`,
  { headers },
);
results.push({
  check: "phase3b_product_media_columns_available",
  passed: mediaResponse.ok,
  status: mediaResponse.status,
});

const primaryRpcResponse = await fetch(`${url}/rest/v1/rpc/set_product_media_primary`, {
  method: "POST",
  headers,
  body: JSON.stringify({ p_media_id: "00000000-0000-0000-0000-000000000000" }),
});
results.push({
  check: "anonymous_primary_rpc_denied",
  passed: [401, 403, 404].includes(primaryRpcResponse.status),
  status: primaryRpcResponse.status,
});

for (const functionName of ["cloudinary-upload-signature", "cloudinary-delete-media"]) {
  const response = await fetch(`${url}/functions/v1/${functionName}`, {
    method: "POST",
    headers,
    body: "{}",
  });
  results.push({
    check: `anonymous_${functionName}_denied`,
    passed: [401, 403].includes(response.status),
    status: response.status,
  });
}

const report = {
  verifiedAt: new Date().toISOString(),
  credentialClass: "publishable_only",
  liveAuthenticatedEvidence:
    "Owner-confirmed in the development Admin Studio; no credentials or tokens stored.",
  passed: results.every((result) => result.passed),
  results,
};

await mkdir("artifacts/phase3b", { recursive: true });
await writeFile(
  "artifacts/phase3b/remote-verification.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
