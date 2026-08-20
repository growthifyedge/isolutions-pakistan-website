import { createClient } from "@supabase/supabase-js";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const hasSupabaseEnvironment = Boolean(
  supabaseUrl && supabasePublishableKey,
);
export const supabase = hasSupabaseEnvironment
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
