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
    await requireCatalogAdmin(request);
    const { productId } = await request.json();
    if (!/^[0-9a-f-]{36}$/i.test(productId ?? ""))
      throw new Error("invalid_product_id");
    const { cloudName, apiKey, apiSecret } = requireCloudinaryEnvironment();
    const timestamp = Math.floor(Date.now() / 1000);
    const params = {
      folder: `isolutions-development/products/${productId}`,
      timestamp,
      transformation: "c_limit,w_3000,h_3000,q_90,fl_force_strip",
    };
    const signature = await cloudinarySignature(params, apiSecret);
    return Response.json(
      { cloudName, apiKey, signature, ...params, expiresAt: timestamp + 300 },
      { headers: corsHeaders },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "request_failed";
    const status =
      message === "unauthorized" ? 401 : message === "forbidden" ? 403 : 400;
    return Response.json({ error: message }, { status, headers: corsHeaders });
  }
});
