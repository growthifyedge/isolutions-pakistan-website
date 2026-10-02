// Storefront anti-abuse limits are enforced in the database (202610020001): checkout, contact and
// newsletter RPCs raise 'rate_limited' after too many requests. This only maps that to friendly copy.

export const RATE_LIMIT_MESSAGE = "Too many attempts. Please wait a few minutes and try again.";

export function isRateLimitError(error: unknown) {
  const message = typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  return message.includes("rate_limited");
}
