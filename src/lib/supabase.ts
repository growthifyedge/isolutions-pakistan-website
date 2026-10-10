import { createClient } from "@supabase/supabase-js";
import { environmentForSupabaseUrl } from "./supabaseEnvironment";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const hasSupabaseEnvironment = Boolean(
  supabaseUrl && supabasePublishableKey,
);
/** Derived from the project this build is actually connected to; "Unknown" for any unlisted project. */
export const supabaseEnvironmentLabel =
  environmentForSupabaseUrl(supabaseUrl)?.label ?? "Unknown";
export const supabase = hasSupabaseEnvironment
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
