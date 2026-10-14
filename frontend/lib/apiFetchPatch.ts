/**
 * Rewrites relative `/api/*` fetch() calls to an absolute backend origin,
 * client-side only, when NEXT_PUBLIC_BACKEND_URL is set.
 *
 * On Node/Render, that env var is unset, so this is a no-op and every call
 * stays relative, going through next.config.mjs's server-side rewrite as
 * before.
 *
 * On Cloudflare, the frontend and backend are two separate Workers on the
 * same zone (workers.dev), and Cloudflare does not let one Worker fetch()
 * another Worker on the same zone without a Service Binding —
 * https://developers.cloudflare.com/workers/configuration/routing/custom-domains/#worker-to-worker-communication.
 * next.config.mjs's rewrite is exactly that kind of same-zone Worker-to-Worker
 * fetch under the hood (vinext's external-rewrite proxy), so it 403s there
 * with Cloudflare's "Direct IP access not allowed" page — confirmed live
 * against the deployed Workers. The browser calling the backend directly is
 * an ordinary cross-origin fetch, not Worker-to-Worker, and isn't subject to
 * that restriction; the backend already sends permissive CORS (see
 * backend/src/app.js's `app.use(cors())`). Patching the one global `fetch`
 * here, once, avoids touching the ~20 call sites across lib/*.ts and
 * app/**\/*.tsx that call `fetch('/api/...')` directly.
 */
export function installApiFetchPatch(): void {
  if (typeof window === 'undefined') return;
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!backendUrl) return;
  const win = window as unknown as { __apiFetchPatched?: boolean };
  if (win.__apiFetchPatched) return;
  win.__apiFetchPatched = true;

  const originalFetch = window.fetch;
  const patchedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      return originalFetch(`${backendUrl}${input}`, init);
    }
    return originalFetch(input, init);
  };
  if (originalFetch) {
    Object.setPrototypeOf(patchedFetch, originalFetch);
    Object.assign(patchedFetch, originalFetch);
  }
  window.fetch = patchedFetch as typeof window.fetch;
}
