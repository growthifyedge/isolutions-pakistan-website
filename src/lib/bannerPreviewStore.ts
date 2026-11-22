/**
 * Browser-local store for images chosen in the Banner Editor's preview-only mode (before uploads are available).
 * Images stay in this browser's IndexedDB only: never uploaded, never sent to the database, invisible to every other
 * visitor and device. A banner refers to one as "local-preview:<key>"; the homepage preview resolves it here.
 */
import { LOCAL_PREVIEW_PREFIX } from "./homepageBanners";

const DB_NAME = "isp-banner-preview";
const STORE = "images";

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openStore().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        transaction.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
      }),
  );
}

export function newLocalPreviewKey() {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random()}`;
  return `img-${random.replace(/[^A-Za-z0-9]/g, "").slice(0, 32)}`;
}

export const localPreviewSrc = (key: string) => `${LOCAL_PREVIEW_PREFIX}${key}`;
export const localPreviewKey = (src: string) => (src.startsWith(LOCAL_PREVIEW_PREFIX) ? src.slice(LOCAL_PREVIEW_PREFIX.length) : null);

export async function putPreviewImage(key: string, image: Blob) {
  await run("readwrite", (store) => store.put(image, key));
}

/** Object URLs for every stored key that exists; missing keys are simply absent from the result. */
export async function loadPreviewImageUrls(keys: readonly string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (const key of new Set(keys)) {
    try {
      const blob = await run<Blob | undefined>("readonly", (store) => store.get(key) as IDBRequest<Blob | undefined>);
      if (blob instanceof Blob) urls.set(key, URL.createObjectURL(blob));
    } catch {
      // Storage unavailable: that image is skipped (the carousel never shows a broken banner).
    }
  }
  return urls;
}
