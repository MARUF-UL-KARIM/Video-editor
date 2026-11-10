import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Writes dist/precache.json so the service worker can make the editor (and, on request, the bundled models) available offline. */
function offlineManifest() {
  return {
    name: 'offcut-offline-manifest',
    apply: 'build' as const,
    closeBundle() {
      const root = join(process.cwd(), 'dist');
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((f) => {
          const p = join(dir, f);
          return statSync(p).isDirectory() ? walk(p) : [p];
        });
      let files: string[] = [];
      try {
        files = walk(root);
      } catch {
        return;
      }
      const shell: string[] = ['/'];
      const heavy: { url: string; size: number }[] = [];
      for (const abs of files) {
        const url = abs.slice(root.length).replace(/\\/g, '/');
        const size = statSync(abs).size;
        if (/\.(map|woff)$/.test(url) || /^\/(sw\.js|precache\.json|index\.html)$/.test(url) || url.startsWith('/sample/') || url.startsWith('/uploads/')) continue;
        if (/^\/assets\/.*\.wasm$/.test(url)) continue; // duplicate of /ort/, never requested
        if (/^\/(ort|mediapipe)\//.test(url) || /^\/assets\/(kokoro|ai\.worker|vision_bundle|mediabunny-aac|denoise)/.test(url) || size > 1_500_000) heavy.push({ url, size });
        else shell.push(url);
      }
      writeFileSync(join(root, 'precache.json'), JSON.stringify({ shell, heavy }));
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const plugins = [react(), tailwindcss(), offlineManifest()];
  try {
    // @ts-ignore
    const m = await import('./.vite-source-tags.js');
    plugins.push(m.sourceTags());
  } catch {}

  const env = loadEnv(mode, process.cwd(), ['VITE_', 'NEXT_PUBLIC_']);
  const processEnvDefines: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    processEnvDefines[`process.env.${key}`] = JSON.stringify(value);
  }

  return {
    plugins,
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: processEnvDefines,
    worker: { format: 'es' as const },
    // Same isolation headers as production (vercel.json) so WASM threads are available locally too.
    server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
    preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
    build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
    optimizeDeps: { exclude: ['@huggingface/transformers', 'kokoro-js'] },
  };
})
