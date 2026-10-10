/**
 * Browser "leave this page?" warning, installed only while a bulk upload is running.
 * Reloading or closing the tab mid-run would leave a product partially saved and any in-flight
 * Cloudinary asset unreported. The target is injected so this can be tested without a browser.
 */
export type UnloadTarget = {
  addEventListener: (type: "beforeunload", listener: (event: BeforeUnloadEvent) => void) => void;
  removeEventListener: (type: "beforeunload", listener: (event: BeforeUnloadEvent) => void) => void;
};

export function installUnloadGuard(target: UnloadTarget): () => void {
  const listener = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = "";
  };
  target.addEventListener("beforeunload", listener);
  return () => target.removeEventListener("beforeunload", listener);
}
