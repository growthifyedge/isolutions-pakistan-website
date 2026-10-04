import { createClient } from "@supabase/supabase-js";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const hasSupabaseEnvironment = Boolean(
  supabaseUrl && supabasePublishableKey,
);
const PRODUCTION_PROJECT_REF = "nlxfwppywxumymbjkvwt";
/** "Production" only when this build is connected to the production Supabase project. */
export const supabaseEnvironmentLabel =
  supabaseUrl && new URL(supabaseUrl).hostname.split(".")[0] === PRODUCTION_PROJECT_REF
    ? "Production"
    : "Development";
export const supabase = hasSupabaseEnvironment
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
