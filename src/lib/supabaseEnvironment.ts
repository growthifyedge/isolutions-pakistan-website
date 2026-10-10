/**
 * Single source of truth for which Supabase project each environment uses.
 * Project refs and Firebase project ids are public identifiers (they appear in
 * every served bundle); no keys or secrets belong here.
 *
 * Used by the browser client (Admin environment badge), the Vite build guard
 * (vite.config.ts) and the Firebase Hosting predeploy check
 * (scripts/check-hosting-environment.mjs).
 */
export type SupabaseEnvironmentName = "development" | "production";

export interface SupabaseEnvironment {
  name: SupabaseEnvironmentName;
  label: "Development" | "Production";
  supabaseProjectRef: string;
  firebaseProjectId: string;
}

export const SUPABASE_ENVIRONMENTS: Record<SupabaseEnvironmentName, SupabaseEnvironment> = {
  development: {
    name: "development",
    label: "Development",
    supabaseProjectRef: "acwatgxkcyrdxpcljxjb",
    firebaseProjectId: "isolutions-development-cb1ea",
  },
  production: {
    name: "production",
    label: "Production",
    supabaseProjectRef: "nlxfwppywxumymbjkvwt",
    firebaseProjectId: "isolutions-pakistan-production",
  },
};

const ENVIRONMENTS = Object.values(SUPABASE_ENVIRONMENTS);

/** `https://<ref>.supabase.co` → `<ref>`; anything else → null. */
export function supabaseProjectRef(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const { protocol, hostname } = new URL(url);
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(hostname);
    return protocol === "https:" && match ? match[1] : null;
  } catch {
    return null;
  }
}

export function environmentForSupabaseUrl(url: string | undefined | null): SupabaseEnvironment | null {
  const ref = supabaseProjectRef(url);
  return ENVIRONMENTS.find((environment) => environment.supabaseProjectRef === ref) ?? null;
}

export function environmentForFirebaseProject(projectId: string | undefined | null): SupabaseEnvironment | null {
  return ENVIRONMENTS.find((environment) => environment.firebaseProjectId === projectId) ?? null;
}

/** Distinct Supabase project refs referenced as `<ref>.supabase.co` in built output. */
export function supabaseRefsInText(text: string): string[] {
  return [...new Set([...text.matchAll(/\b([a-z0-9]{20})\.supabase\.co\b/g)].map((match) => match[1]))];
}

/**
 * Build guard: the Vite mode must be exactly "development" or "production" and
 * the resolved VITE_SUPABASE_URL must point at that environment's project.
 * `otherModeKey` is the publishable key Vite resolves for the other mode; a
 * production build whose key equals the development key is a mixed config.
 * Returns a human-readable problem, or null when the build is safe.
 */
export function buildEnvironmentProblem(
  mode: string,
  env: Record<string, string | undefined>,
  otherModeKey?: string,
): string | null {
  if (mode !== "development" && mode !== "production") {
    return `Unsupported build mode "${mode}". Use "npm run build:dev" (mode development) or "npm run build:prod" (mode production).`;
  }
  const expected = SUPABASE_ENVIRONMENTS[mode];
  const url = env.VITE_SUPABASE_URL;
  const ref = supabaseProjectRef(url);
  if (!ref) {
    return `VITE_SUPABASE_URL is missing or not a https://<ref>.supabase.co URL for the ${expected.name} build. Check .env.${expected.name === "development" ? "local / .env.development.local" : "production.local"}.`;
  }
  if (ref !== expected.supabaseProjectRef) {
    const actual = ENVIRONMENTS.find((environment) => environment.supabaseProjectRef === ref);
    return `The ${expected.name} build resolved VITE_SUPABASE_URL to ${actual ? `the ${actual.name.toUpperCase()}` : "an unknown"} Supabase project (${ref}); expected ${expected.supabaseProjectRef}.`;
  }
  if (!env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    return `VITE_SUPABASE_PUBLISHABLE_KEY is missing for the ${expected.name} build.`;
  }
  if (expected.name === "production" && otherModeKey && otherModeKey === env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    return "The production build resolved the same VITE_SUPABASE_PUBLISHABLE_KEY as the development build (mixed configuration). Set the production key in .env.production.local.";
  }
  return null;
}

/**
 * Serve guard: a dev server or preview in "production" mode connects to the PRODUCTION Supabase project
 * (it loads .env.production.local), so it must never start from a casual `vite --mode production`.
 * Only the approved script (npm run preview:prod -> scripts/preview-dist.mjs) sets ISOLUTIONS_PROD_PREVIEW=1.
 * Returns a human-readable problem, or null when starting is allowed.
 */
export function serveModeProblem(mode: string, env: Record<string, string | undefined>, isPreview = false): string | null {
  if (mode !== "production") return null;
  if (env.ISOLUTIONS_PROD_PREVIEW === "1") return null;
  return `Refusing to start a ${isPreview ? "preview" : "dev server"} in production mode: it would connect to the PRODUCTION Supabase project (${SUPABASE_ENVIRONMENTS.production.supabaseProjectRef}). Use "npm run dev" for development or the approved "npm run preview:prod" for a verified production build.`;
}

/**
 * Preview guard: the dist/ about to be served must reference exactly the Supabase project of the requested environment.
 */
export function previewDistProblem(target: SupabaseEnvironmentName, bundleRefs: string[]): string | null {
  const expected = SUPABASE_ENVIRONMENTS[target];
  const command = target === "development" ? "npm run build:dev" : "npm run build:prod";
  if (bundleRefs.length === 0) return `dist/ references no Supabase project. Run "${command}" first.`;
  if (bundleRefs.length > 1 || bundleRefs[0] !== expected.supabaseProjectRef)
    return `dist/ is wired to ${bundleRefs.join(", ")} but the ${target} preview needs ${expected.supabaseProjectRef}. Run "${command}" first.`;
  return null;
}

/**
 * Deploy guard: the built bundle must reference exactly one Supabase project,
 * and it must be the one paired with the Firebase project being deployed to.
 */
export function hostingEnvironmentProblem(firebaseProjectId: string | undefined, bundleRefs: string[]): string | null {
  const target = environmentForFirebaseProject(firebaseProjectId);
  if (!target) {
    return `Unknown Firebase project "${firebaseProjectId ?? ""}". Known: ${ENVIRONMENTS.map((environment) => environment.firebaseProjectId).join(", ")}.`;
  }
  const buildCommand = target.name === "development" ? "npm run build:dev" : "npm run build:prod";
  if (bundleRefs.length === 0) {
    return `dist/ does not reference any Supabase project. Run "${buildCommand}" before deploying to ${target.firebaseProjectId}.`;
  }
  if (bundleRefs.length > 1) {
    return `dist/ references more than one Supabase project (${bundleRefs.join(", ")}). Rebuild with "${buildCommand}".`;
  }
  if (bundleRefs[0] !== target.supabaseProjectRef) {
    const actual = ENVIRONMENTS.find((environment) => environment.supabaseProjectRef === bundleRefs[0]);
    return `dist/ is wired to ${actual ? `the ${actual.name.toUpperCase()}` : "an unknown"} Supabase project (${bundleRefs[0]}) but the deploy target is ${target.name.toUpperCase()} hosting (${target.firebaseProjectId}). Run "${buildCommand}" and deploy again.`;
  }
  return null;
}
