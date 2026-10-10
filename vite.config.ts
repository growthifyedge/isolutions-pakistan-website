import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { buildEnvironmentProblem, serveModeProblem } from './src/lib/supabaseEnvironment.ts';

declare const process: { env: Record<string, string | undefined> };

export default defineConfig(({ command, mode, isPreview }) => {
  if (command === 'serve') {
    // `vite --mode production` / `vite preview --mode production` would silently talk to PRODUCTION.
    const problem = serveModeProblem(mode, process.env, Boolean(isPreview));
    if (problem) throw new Error(`[environment guard] ${problem}`);
  }
  if (command === 'build') {
    // Vite loads .env.local in every mode and .env.production.local only in
    // production, so the mode alone decides which Supabase project is baked in.
    // Refuse any build whose resolved project does not match its mode.
    const env = loadEnv(mode, '.', 'VITE_');
    const otherModeKey =
      mode === 'production'
        ? loadEnv('development', '.', 'VITE_').VITE_SUPABASE_PUBLISHABLE_KEY
        : undefined;
    const problem = buildEnvironmentProblem(mode, env, otherModeKey);
    if (problem) throw new Error(`[environment guard] ${problem}`);
  }
  return { plugins: [react()] };
});
