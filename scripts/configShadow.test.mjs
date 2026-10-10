import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { installUnloadGuard } from "../src/lib/unloadGuard.ts";

test("no vite.config.js / vite.config.d.ts may sit next to vite.config.ts (Vite would load the .js first and skip every environment guard)", () => {
  assert.ok(existsSync("vite.config.ts"));
  assert.equal(existsSync("vite.config.js"), false, "vite.config.js shadows vite.config.ts: bare `vite` commands would bypass the build/serve guards. Delete it.");
  assert.equal(existsSync("vite.config.d.ts"), false, "vite.config.d.ts is a stale artifact of the shadowing vite.config.js. Delete it.");
});

function fakeWindow() {
  const listeners = new Set();
  return {
    listeners,
    addEventListener: (type, listener) => type === "beforeunload" && listeners.add(listener),
    removeEventListener: (type, listener) => type === "beforeunload" && listeners.delete(listener),
  };
}

test("the unload guard is installed on demand, warns, and is removed again; nothing is registered when idle", () => {
  const target = fakeWindow();
  assert.equal(target.listeners.size, 0, "idle: no handler");
  const remove = installUnloadGuard(target);
  assert.equal(target.listeners.size, 1, "active: one handler");
  const event = { defaultPrevented: false, returnValue: undefined, preventDefault() { this.defaultPrevented = true; } };
  [...target.listeners][0](event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.returnValue, "", "browsers show their leave-page prompt");
  remove();
  assert.equal(target.listeners.size, 0, "finished: handler removed");
  remove();
  assert.equal(target.listeners.size, 0, "removing twice is harmless");
  // Two runs in a row never stack handlers.
  const first = installUnloadGuard(target);
  first();
  const second = installUnloadGuard(target);
  assert.equal(target.listeners.size, 1);
  second();
  assert.equal(target.listeners.size, 0);
});

test("the panel installs the guard only while an upload is active, and the wording does not imply upload readiness", async () => {
  const panel = await readFile("src/admin/BulkProductImages.tsx", "utf8");
  assert.match(panel, /useEffect\(\(\) => \{\s*if \(!uploading\) return undefined;\s*return installUnloadGuard\(window\);\s*\}, \[uploading\]\);/);
  assert.match(panel, /const uploading = uploadProgress !== null;/);
  assert.doesNotMatch(panel, /beforeunload/, "the event is only registered through the tested helper");
  assert.match(panel, /Selection review is valid:/);
  assert.match(panel, /ready for preflight on \{environment\.label\}\. The upload panel below is the final check\./);
  assert.doesNotMatch(panel, /Selection is valid/);
  assert.match(panel, /first untick the images that were already saved/);
});
