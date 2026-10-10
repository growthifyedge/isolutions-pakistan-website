import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cloudinaryUploadForm,
  requestProductUploadSignature,
  safeCloudinaryUploadError,
  uploadToCloudinary,
} from "../src/lib/productMediaUpload.ts";

const PRODUCT_ID = "7d1c2b9e-4f1a-4c55-9d1e-0a6b3c2d1e0f";
const signature = {
  cloudName: "demo-cloud",
  apiKey: "public-api-key",
  signature: "abc123signed",
  signedParameters: {
    folder: `isolutions-development/products/${PRODUCT_ID}`,
    timestamp: 1791113359,
    transformation: "c_limit,w_3000,h_3000,q_90,fl_force_strip",
  },
};

function fakeClient(response) {
  const calls = [];
  return {
    calls,
    functions: {
      invoke: async (name, options) => {
        calls.push({ name, options });
        return response;
      },
    },
  };
}

class FakeRequest {
  static last = null;
  constructor() {
    this.upload = {};
    this.sent = null;
    FakeRequest.last = this;
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  send(body) {
    this.sent = body;
  }
  respond(status, responseText) {
    this.status = status;
    this.responseText = responseText;
    this.onload();
  }
}
const createRequest = () => new FakeRequest();

test("signature request calls only the Admin-checked Edge Function for that product", async () => {
  const client = fakeClient({ data: signature, error: null });
  assert.deepEqual(await requestProductUploadSignature(client, PRODUCT_ID), signature);
  assert.deepEqual(client.calls, [{ name: "cloudinary-upload-signature", options: { body: { productId: PRODUCT_ID } } }]);
});

test("signature request failures keep the existing messages", async () => {
  await assert.rejects(requestProductUploadSignature(fakeClient({ data: null, error: { message: "forbidden" } }), PRODUCT_ID), /^Error: forbidden$/);
  await assert.rejects(requestProductUploadSignature(fakeClient({ data: null, error: null }), PRODUCT_ID), /^Error: Upload authorization failed\.$/);
});

test("upload form carries only file, api_key, signature and the signed parameters", async () => {
  const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" });
  const form = cloudinaryUploadForm(file, signature);
  const entries = [...form.entries()];
  assert.deepEqual(entries.map(([key]) => key), ["file", "api_key", "signature", "folder", "timestamp", "transformation"]);
  assert.equal(form.get("api_key"), "public-api-key");
  assert.equal(form.get("signature"), "abc123signed");
  assert.equal(form.get("folder"), `isolutions-development/products/${PRODUCT_ID}`);
  assert.equal(form.get("timestamp"), "1791113359");
  assert.equal(form.get("transformation"), "c_limit,w_3000,h_3000,q_90,fl_force_strip");
  assert.equal((await form.get("file").arrayBuffer()).byteLength, 4);
  // A remote https source (e.g. Shopify CDN) is passed as the file value for Cloudinary to fetch.
  const remote = cloudinaryUploadForm("https://cdn.shopify.com/s/files/1/a07.jpg?v=1", signature);
  assert.equal(remote.get("file"), "https://cdn.shopify.com/s/files/1/a07.jpg?v=1");
  assert.equal([...remote.keys()].length, 6);
});

test("upload posts to the signed cloud's image upload endpoint and resolves the Cloudinary JSON", async () => {
  const progress = [];
  const pending = uploadToCloudinary(signature, "https://cdn.shopify.com/s/files/1/a07.jpg", { createRequest, onProgress: (value) => progress.push(value) });
  const request = FakeRequest.last;
  assert.equal(request.method, "POST");
  assert.equal(request.url, "https://api.cloudinary.com/v1_1/demo-cloud/image/upload");
  assert.equal(request.sent.get("signature"), "abc123signed");
  request.upload.onprogress({ lengthComputable: false, loaded: 1, total: 0 });
  request.upload.onprogress({ lengthComputable: true, loaded: 1, total: 3 });
  request.upload.onprogress({ lengthComputable: true, loaded: 3, total: 3 });
  assert.deepEqual(progress, [33, 100]);
  request.respond(200, JSON.stringify({ public_id: "x/products/y/z", width: 10 }));
  assert.deepEqual(await pending, { public_id: "x/products/y/z", width: 10 });
});

test("upload failures map to the existing safe messages", async () => {
  const run = (status, body) => {
    const pending = uploadToCloudinary(signature, "https://cdn.shopify.com/a.jpg", { createRequest });
    FakeRequest.last.respond(status, body);
    return pending;
  };
  await assert.rejects(run(200, "not json"), /^Error: Cloudinary returned an invalid upload response\.$/);
  await assert.rejects(run(401, JSON.stringify({ error: { message: "Invalid Signature abc" } })), /^Error: Cloudinary rejected the upload signature\.$/);
  await assert.rejects(run(500, "<html>"), /^Error: Cloudinary rejected the upload with an invalid response\.$/);
  const network = uploadToCloudinary(signature, "https://cdn.shopify.com/a.jpg", { createRequest });
  FakeRequest.last.onerror();
  await assert.rejects(network, /^Error: Cloudinary upload failed\.$/);
});

test("Cloudinary error text is never shown raw", () => {
  const message = (text) => safeCloudinaryUploadError(JSON.stringify({ error: { message: text } }));
  assert.equal(message("Invalid transformation component"), "Cloudinary rejected the optimized-master transformation.");
  assert.equal(message("Invalid Signature 123. String to sign - 'secret'"), "Cloudinary rejected the upload signature.");
  assert.equal(message("File size too large. Got 30000000"), "Cloudinary rejected the source file size.");
  assert.equal(message("Unsupported source URL format"), "Cloudinary rejected the image format or file contents.");
  assert.equal(message("Resource not found - https://cdn.shopify.com/x"), "Cloudinary rejected the upload.");
  assert.equal(safeCloudinaryUploadError("{}"), "Cloudinary rejected the upload.");
});

test("helper holds no secrets or environment access; MediaManager keeps its metadata, primary, replace and delete flow", async () => {
  const helper = await readFile("src/lib/productMediaUpload.ts", "utf8");
  assert.doesNotMatch(helper, /CLOUDINARY_API_SECRET|service[_-]?role|import\.meta\.env|from "\.\/supabase"|\.insert\(|\.rpc\(/);
  const manager = await readFile("src/admin/MediaManager.tsx", "utf8");
  assert.match(manager, /const validation = await validateSourceImage\(file\);/);
  assert.match(manager, /requestProductUploadSignature\(supabase, productId\)/);
  assert.match(manager, /uploadToCloudinary\(data, file, \{\s*onProgress: setProgress,\s*\}\)/);
  assert.match(manager, /sort_order: media\.length,\s*is_primary: media\.length === 0,/);
  assert.match(manager, /containsBinaryMediaData\(metadata\)/);
  assert.match(manager, /\.from\("product_media"\)\s*\.insert\(metadata\)/);
  // Replace: new image inherits primary, then the previous asset is deleted via the Edge Function.
  assert.match(manager, /if \(replaced\?\.is_primary\)\s*await supabase\.rpc\("set_product_media_primary"/);
  assert.match(manager, /"cloudinary-delete-media",\s*\{ body: \{ mediaId: replacementId \} \}/);
  assert.match(manager, /"cloudinary-delete-media",\s*\{ body: \{ mediaId: id \} \}/);
  assert.doesNotMatch(manager, /new XMLHttpRequest|api\.cloudinary\.com|functions\.invoke<UploadSignature>/);
});
