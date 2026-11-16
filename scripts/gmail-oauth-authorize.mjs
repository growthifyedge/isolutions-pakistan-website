#!/usr/bin/env node
// One-time Gmail API authorization for the vendor order notification sender (ordersisolution@gmail.com).
// Run ONLY on the Owner's own computer, ONLY after Owner approval. It sends no email and touches no database.
//
//   node scripts/gmail-oauth-authorize.mjs --client-file "C:\path\to\client_secret_XXXX.json" [--out "C:\path\file.env"]
//
// What it does
//   * Desktop-app OAuth 2.0 with a loopback redirect (http://127.0.0.1:<random port>) + PKCE (S256) + state check —
//     Google's supported flow for installed apps (no embedded webview, no deprecated out-of-band copy/paste code).
//   * Requests ONLY https://www.googleapis.com/auth/gmail.send (send-only; no mailbox read access).
//   * Writes the client id, client secret and the resulting refresh token to an env file OUTSIDE this repository
//     (default: %USERPROFILE%\isolutions-gmail-secrets.env). Nothing secret is printed to the console.
//   * The file is the input for `supabase secrets set --env-file …` (a separate, Owner-approved step); delete it after.
//
// The client secret is read from the JSON downloaded from Google Cloud Console (or typed at a hidden prompt), never
// from a command-line argument (which would land in shell history).
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline";

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SENDER = "ordersisolution@gmail.com";
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = 5 * 60_000;

const base64Url = (buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function createPkce(random = randomBytes) {
  const verifier = base64Url(random(32));
  return { verifier, challenge: base64Url(createHash("sha256").update(verifier).digest()), method: "S256" };
}

export function buildAuthUrl({ clientId, redirectUri, challenge, state }) {
  const url = new URL(AUTH_URL);
  for (const [key, value] of Object.entries({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: GMAIL_SEND_SCOPE,
    access_type: "offline", prompt: "consent", login_hint: SENDER,
    code_challenge: challenge, code_challenge_method: "S256", state,
  })) url.searchParams.set(key, value);
  return url.toString();
}

/** Accepts Google's downloaded Desktop-client JSON ({ installed: { client_id, client_secret } }). */
export function parseClientFile(text) {
  let json;
  try { json = JSON.parse(text); } catch { throw new Error("client_file_not_json"); }
  const block = json?.installed ?? json?.web ?? json;
  if (json?.web) throw new Error("client_type_not_desktop");
  const clientId = typeof block?.client_id === "string" ? block.client_id.trim() : "";
  const clientSecret = typeof block?.client_secret === "string" ? block.client_secret.trim() : "";
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error("client_id_invalid");
  return { clientId, clientSecret };
}

/** The secrets file must live outside the repository (never committable) and must not overwrite anything. */
export function resolveOutputPath(requested, { repoRoot = REPO_ROOT, home = homedir(), exists = existsSync } = {}) {
  const target = path.resolve(requested || path.join(home, "isolutions-gmail-secrets.env"));
  const relative = path.relative(path.resolve(repoRoot), target);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("output_inside_repository");
  if (exists(target)) throw new Error("output_exists");
  return target;
}

export function formatEnvFile({ clientId, clientSecret, refreshToken }) {
  for (const value of [clientId, clientSecret, refreshToken])
    if (typeof value !== "string" || !value || /[\r\n"]/.test(value)) throw new Error("secret_value_invalid");
  return [
    "# iSolutions Pakistan — Gmail API secrets for the vendor-order-notifications Edge Function.",
    "# PRIVATE. Never commit, paste into chat, or share. Delete this file after `supabase secrets set --env-file`.",
    "VENDOR_EMAIL_PROVIDER=gmail",
    `GMAIL_SENDER_ADDRESS=${SENDER}`,
    `GMAIL_OAUTH_CLIENT_ID=${clientId}`,
    `GMAIL_OAUTH_CLIENT_SECRET=${clientSecret}`,
    `GMAIL_OAUTH_REFRESH_TOKEN=${refreshToken}`,
    "",
  ].join("\n");
}

/** Exchanges the authorization code. Errors carry only Google's short reason code, never a body or a secret. */
export async function exchangeCode({ code, verifier, clientId, clientSecret, redirectUri, fetchImpl = fetch }) {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier,
      client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }).toString(),
  });
  let body = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const reason = typeof body?.error === "string" ? body.error.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60) : "";
    throw new Error(`token_exchange_failed:http_${response.status}${reason ? `:${reason}` : ""}`);
  }
  const scopes = typeof body?.scope === "string" ? body.scope.split(" ") : [];
  if (!scopes.includes(GMAIL_SEND_SCOPE)) throw new Error("gmail_send_scope_not_granted");
  if (typeof body?.refresh_token !== "string" || !body.refresh_token) throw new Error("no_refresh_token_returned");
  return { refreshToken: body.refresh_token, scopes };
}

function hiddenPrompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => { if (text.includes(question)) process.stdout.write(text); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer.trim()); });
  });
}

function openBrowser(url) {
  const [command, args] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  execFile(command, args, () => { /* the URL is printed as well */ });
}

const argValue = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const page = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto"><h2>${title}</h2><p>${text}</p></body>`;

async function main() {
  const clientFile = argValue("--client-file");
  let client;
  if (clientFile) client = parseClientFile(await readFile(clientFile, "utf8"));
  else {
    const clientId = (await hiddenPrompt("OAuth client ID: ")).trim();
    client = parseClientFile(JSON.stringify({ installed: { client_id: clientId, client_secret: "" } }));
  }
  if (!client.clientSecret) client.clientSecret = await hiddenPrompt("OAuth client secret (hidden): ");
  if (!client.clientSecret) throw new Error("client_secret_missing");
  const output = resolveOutputPath(argValue("--out"));

  const pkce = createPkce();
  const state = base64Url(randomBytes(24));
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
  const authUrl = buildAuthUrl({ clientId: client.clientId, redirectUri, challenge: pkce.challenge, state });

  console.log("\nSign in as", SENDER, "ONLY, and allow \"Send email on your behalf\".");
  console.log("If Google shows \"Google hasn't verified this app\", that is expected for this private app:");
  console.log("choose Advanced → Go to (app name) only if the app name and account are yours. If Google shows");
  console.log("\"Access blocked\" / \"This app is blocked\", STOP and report the exact message.\n");
  console.log("Opening:", authUrl, "\n");
  openBrowser(authUrl);

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("authorization_timed_out")), TIMEOUT_MS);
    server.on("request", async (req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      if (url.pathname !== "/oauth2callback") { res.writeHead(404).end(); return; }
      const finish = (status, title, text, outcome) => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" }).end(page(title, text));
        clearTimeout(timer);
        outcome instanceof Error ? reject(outcome) : resolve(outcome);
      };
      if (url.searchParams.get("state") !== state) return finish(400, "Authorization failed", "State mismatch.", new Error("state_mismatch"));
      const denied = url.searchParams.get("error");
      if (denied) return finish(400, "Authorization not completed", "Google returned an error. See the terminal.",
        new Error(`google_error:${denied.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60)}`));
      const code = url.searchParams.get("code");
      if (!code) return finish(400, "Authorization failed", "No authorization code.", new Error("code_missing"));
      try {
        const tokens = await exchangeCode({ code, verifier: pkce.verifier, ...client, redirectUri });
        finish(200, "Authorization complete", "You can close this tab and return to the terminal.", tokens);
      } catch (error) { finish(500, "Authorization failed", "See the terminal.", error); }
    });
  }).finally(() => server.close());

  await writeFile(output, formatEnvFile({ ...client, refreshToken: result.refreshToken }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.log("Authorization complete. Granted scope:", result.scopes.join(" "));
  console.log("Secrets written to:", output);
  console.log("Nothing secret was printed. Keep this file private; do not paste it anywhere. Wait for Owner approval");
  console.log("before `supabase secrets set --env-file`, then delete the file.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error("Gmail authorization stopped:", error instanceof Error ? error.message : "unknown_error");
    process.exitCode = 1;
  });
}
