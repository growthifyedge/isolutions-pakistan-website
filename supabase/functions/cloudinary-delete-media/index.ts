import { corsHeaders } from "../_shared/cors.ts";
import {
  cloudinarySignature,
  requireCatalogAdmin,
  requireCloudinaryEnvironment,
} from "../_shared/admin.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  try {
    const { client } = await requireCatalogAdmin(request);
    const { mediaId, bundleId } = await request.json();
    if (Boolean(mediaId) === Boolean(bundleId)) throw new Error("invalid_media_target");
    if (bundleId) {
      if (!/^[0-9a-f-]{36}$/i.test(bundleId)) throw new Error("invalid_bundle_id");
      const { data: bundle, error: bundleError } = await client
        .from("bundles")
        .select("id,bundle_image_public_id")
        .eq("id", bundleId)
        .single();
      if (bundleError || !bundle?.bundle_image_public_id) throw new Error("bundle_image_not_found");
      const { cloudName, apiKey, apiSecret } = requireCloudinaryEnvironment();
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await cloudinarySignature({ public_id: bundle.bundle_image_public_id, timestamp }, apiSecret);
      const form = new FormData();
      form.set("public_id", bundle.bundle_image_public_id);
      form.set("timestamp", String(timestamp));
      form.set("api_key", apiKey);
      form.set("signature", signature);
      const destroy = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, { method: "POST", body: form });
      const result = await destroy.json();
      if (!destroy.ok || !["ok", "not found"].includes(result.result)) throw new Error("cloudinary_delete_failed");
      const { error: clearError } = await client.from("bundles").update({ bundle_image_url: null, bundle_image_public_id: null }).eq("id", bundleId);
      if (clearError) throw new Error("metadata_delete_failed");
      return Response.json({ deleted: true }, { headers: corsHeaders });
    }
    if (!/^[0-9a-f-]{36}$/i.test(mediaId ?? "")) throw new Error("invalid_media_id");
    const { data: media, error: readError } = await client
      .from("product_media")
      .select("id,cloudinary_public_id")
      .eq("id", mediaId)
      .single();
    if (readError || !media?.cloudinary_public_id)
      throw new Error("media_not_found");
    const { cloudName, apiKey, apiSecret } = requireCloudinaryEnvironment();
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await cloudinarySignature(
      { public_id: media.cloudinary_public_id, timestamp },
      apiSecret,
    );
    const form = new FormData();
    form.set("public_id", media.cloudinary_public_id);
    form.set("timestamp", String(timestamp));
    form.set("api_key", apiKey);
    form.set("signature", signature);
    const destroy = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
      { method: "POST", body: form },
    );
    const result = await destroy.json();
    if (!destroy.ok || !["ok", "not found"].includes(result.result))
      throw new Error("cloudinary_delete_failed");
    const { error: deleteError } = await client
      .from("product_media")
      .delete()
      .eq("id", mediaId);
    if (deleteError) throw new Error("metadata_delete_failed");
    return Response.json({ deleted: true }, { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "request_failed";
    const status =
      message === "unauthorized" ? 401 : message === "forbidden" ? 403 : 400;
    return Response.json({ error: message }, { status, headers: corsHeaders });
  }
});
