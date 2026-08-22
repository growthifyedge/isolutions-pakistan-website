import { createClient } from "npm:@supabase/supabase-js@2";

export async function requireCatalogAdmin(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) throw new Error("unauthorized");
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    },
  );
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error("unauthorized");
  const { data: isAdmin, error: roleError } =
    await client.rpc("is_catalog_admin");
  if (roleError || !isAdmin) throw new Error("forbidden");
  return { client, user: userData.user };
}

export function requireCloudinaryEnvironment() {
  const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME");
  const apiKey = Deno.env.get("CLOUDINARY_API_KEY");
  const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");
  if (!cloudName || !apiKey || !apiSecret)
    throw new Error("cloudinary_not_configured");
  return { cloudName, apiKey, apiSecret };
}

export async function cloudinarySignature(
  params: Record<string, string | number>,
  secret: string,
) {
  const payload =
    Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("&") + secret;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
