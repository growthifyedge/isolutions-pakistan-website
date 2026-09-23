export type StorefrontWishlistItem = {
  productId: string;
  productSlug: string;
  productTitle: string;
  imageUrl: string | null;
};

const WISHLIST_STORAGE_KEY = "isolutions-storefront-wishlist";

function readWishlist() {
  try {
    const parsed = JSON.parse(localStorage.getItem(WISHLIST_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed as StorefrontWishlistItem[] : [];
  } catch {
    return [];
  }
}

export function storefrontWishlistItems() {
  return readWishlist();
}

export function storefrontWishlistTotal() {
  return readWishlist().length;
}

export function hasStorefrontWishlistItem(productId: string) {
  return readWishlist().some((item) => item.productId === productId);
}

export function toggleStorefrontWishlistItem(item: StorefrontWishlistItem) {
  const wishlist = readWishlist();
  const exists = wishlist.some((entry) => entry.productId === item.productId);
  const nextWishlist = exists
    ? wishlist.filter((entry) => entry.productId !== item.productId)
    : [...wishlist, item];
  localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(nextWishlist));
  window.dispatchEvent(new CustomEvent("isolutions:wishlist-updated", { detail: nextWishlist }));
  return !exists;
}

export function removeStorefrontWishlistItem(productId: string) {
  const wishlist = readWishlist();
  const nextWishlist = wishlist.filter((entry) => entry.productId !== productId);
  if (nextWishlist.length === wishlist.length) return false;
  localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(nextWishlist));
  window.dispatchEvent(new CustomEvent("isolutions:wishlist-updated", { detail: nextWishlist }));
  return true;
}
