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
      const { productId, bundleId } = await request.json();
      const targetId = productId ?? bundleId;
      if (!/^[0-9a-f-]{36}$/i.test(targetId ?? "") || Boolean(productId) === Boolean(bundleId))
        throw new Error("invalid_media_target");
      if (bundleId) {
        const { data: bundle, error } = await client.from("bundles").select("id").eq("id", bundleId).single();
        if (error || !bundle) throw new Error("bundle_not_found");
      }
      const { cloudName, apiKey, apiSecret } = requireCloudinaryEnvironment();
      const timestamp = Math.floor(Date.now() / 1000);
      const params = {
        folder: bundleId
          ? `isolutions-development/bundles/${bundleId}`
          : `isolutions-development/products/${productId}`,
        timestamp,
        transformation: "c_limit,w_3000,h_3000,q_90,fl_force_strip",
      };
      const signature = await cloudinarySignature(params, apiSecret);
      return Response.json(
        {
          cloudName,
          apiKey,
          signature,
          signedParameters: params,
          expiresAt: timestamp + 300,
        },
        { headers: corsHeaders },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "request_failed";
      const status =
        message === "unauthorized" ? 401 : message === "forbidden" ? 403 : 400;
      return Response.json({ error: message }, { status, headers: corsHeaders });
    }
  });
