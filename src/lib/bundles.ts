import { supabase } from "./supabase";

export type HomepageBundle = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  bundle_price_minor: number;
  bundle_image_url: string | null;
  bundle_image_public_id: string | null;
  items: Array<{
    id: string;
    quantity: number;
    product: {
      id: string;
      title: string;
      slug: string;
      media: {
        id: string;
        publicId: string;
        url: string;
        alt: string;
        width: number;
        height: number;
        format: string;
      } | null;
    };
  }>;
};

export async function fetchHomepageBundles(limit = 4) {
  if (!supabase) throw new Error("Supabase environment is not configured");
  const { data, error } = await supabase.rpc("homepage_bundles", {
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as HomepageBundle[];
}
