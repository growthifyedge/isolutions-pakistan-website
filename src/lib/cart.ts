import { MAX_ORDER_LINE_QUANTITY, cartLineLimit } from "./orderRules.ts";

export type StorefrontCartItem = {
  productId: string;
  productSlug: string;
  productTitle: string;
  variantId: string;
  sku: string;
  quantity: number;
  priceMinor: number;
  imageUrl: string | null;
};

const CART_STORAGE_KEY = "isolutions-storefront-cart";

function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? "[]");
    // Carts saved before the per-line maximum existed are capped on read.
    return Array.isArray(parsed)
      ? (parsed as StorefrontCartItem[]).map((entry) =>
          entry.quantity > MAX_ORDER_LINE_QUANTITY ? { ...entry, quantity: MAX_ORDER_LINE_QUANTITY } : entry)
      : [];
  } catch {
    return [];
  }
}

export function storefrontCartItems() {
  return readCart();
}

export function storefrontCartItemQuantity(variantId: string) {
  return readCart().find((entry) => entry.variantId === variantId)?.quantity ?? 0;
}

export function storefrontCartTotalQuantity() {
  return readCart().reduce((total, entry) => total + entry.quantity, 0);
}

export function clearStorefrontCart() {
  localStorage.removeItem(CART_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("isolutions:cart-updated", { detail: [] }));
}

export function addStorefrontCartItem(item: StorefrontCartItem, inventoryLimit: number) {
  const cart = readCart();
  const existing = cart.find((entry) => entry.variantId === item.variantId);
  // Never above stock or the server's per-line maximum (create_storefront_order rejects more).
  const nextQuantity = Math.min((existing?.quantity ?? 0) + item.quantity, cartLineLimit(inventoryLimit));
  const nextItem = { ...item, quantity: nextQuantity };
  const nextCart = existing
    ? cart.map((entry) => entry.variantId === item.variantId ? nextItem : entry)
    : [...cart, nextItem];
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextCart));
  window.dispatchEvent(new CustomEvent("isolutions:cart-updated", { detail: nextCart }));
  return nextQuantity;
}

export function decrementStorefrontCartItem(variantId: string) {
  const cart = readCart();
  const existing = cart.find((entry) => entry.variantId === variantId);
  if (!existing) return false;
  const nextCart = existing.quantity > 1
    ? cart.map((entry) => entry.variantId === variantId ? { ...entry, quantity: entry.quantity - 1 } : entry)
    : cart.filter((entry) => entry.variantId !== variantId);
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextCart));
  window.dispatchEvent(new CustomEvent("isolutions:cart-updated", { detail: nextCart }));
  return true;
}

export function removeStorefrontCartItem(variantId: string) {
  const cart = readCart();
  const nextCart = cart.filter((entry) => entry.variantId !== variantId);
  if (nextCart.length === cart.length) return false;
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextCart));
  window.dispatchEvent(new CustomEvent("isolutions:cart-updated", { detail: nextCart }));
  return true;
}
