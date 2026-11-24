  import { corsHeaders } from "../_shared/cors.ts";
  import {
    cloudinarySignature,
    requireCatalogAdmin,
    requireCloudinaryEnvironment,
  } from "../_shared/admin.ts";

  // Per-environment Cloudinary folder root (e.g. "isolutions-production"); unset keeps development.
  const folderRoot =
    Deno.env.get("CLOUDINARY_FOLDER_ROOT")?.trim().replace(/^\/+|\/+$/g, "") ||
    "isolutions-development";

  Deno.serve(async (request) => {
    if (request.method === "OPTIONS")
      return new Response("ok", { headers: corsHeaders });
    try {
      const { client } = await requireCatalogAdmin(request);
      const { productId, bundleId, siteAsset } = await request.json();
      // Website Editor images (homepage banners): Owner only, each upload in its own <root>/site/<uuid> folder.
      if (siteAsset === true) {
        if (productId || bundleId) throw new Error("invalid_media_target");
        const { data: isOwner, error: ownerError } = await client.rpc("is_site_owner");
        if (ownerError || !isOwner) throw new Error("forbidden");
      } else {
        const targetId = productId ?? bundleId;
        if (!/^[0-9a-f-]{36}$/i.test(targetId ?? "") || Boolean(productId) === Boolean(bundleId))
          throw new Error("invalid_media_target");
      }
      if (bundleId) {
        const { data: bundle, error } = await client.from("bundles").select("id").eq("id", bundleId).single();
        if (error || !bundle) throw new Error("bundle_not_found");
      }
      if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(folderRoot))
        throw new Error("invalid_cloudinary_folder_root");
      const { cloudName, apiKey, apiSecret } = requireCloudinaryEnvironment();
      const timestamp = Math.floor(Date.now() / 1000);
      const params = {
        folder: siteAsset === true
          ? `${folderRoot}/site/${crypto.randomUUID()}`
          : bundleId
            ? `${folderRoot}/bundles/${bundleId}`
            : `${folderRoot}/products/${productId}`,
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
