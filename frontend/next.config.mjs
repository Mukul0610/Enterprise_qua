import fs from 'node:fs';

function getWranglerVars(requestedEnv) {
  try {
    const wranglerUrl = new URL('./wrangler.jsonc', import.meta.url);
    if (!fs.existsSync(wranglerUrl)) return {};
    const raw = fs.readFileSync(wranglerUrl, 'utf-8');
    const clean = raw.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? '' : m));
    const config = JSON.parse(clean);

    const targetEnv =
      requestedEnv ||
      process.env.WRANGLER_ENV ||
      process.env.CF_ENV ||
      (process.env.NODE_ENV === 'production' ? 'prod' : 'dev');

    const envBlock =
      config.env?.[targetEnv] ||
      config.env?.[targetEnv === 'prod' ? 'production' : targetEnv];

    return {
      ...(config.vars || {}),
      ...(envBlock?.vars || {}),
    };
  } catch {
    return {};
  }
}

const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
const wranglerVars = isTest ? {} : getWranglerVars();
const nodeBackendUrl = process.env.NODE_BACKEND_URL || wranglerVars.NODE_BACKEND_URL;
const nextPublicBackendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || wranglerVars.NEXT_PUBLIC_BACKEND_URL;

if (!isTest) {
  if (nodeBackendUrl && !process.env.NODE_BACKEND_URL) {
    process.env.NODE_BACKEND_URL = nodeBackendUrl;
  }
  if (nextPublicBackendUrl && !process.env.NEXT_PUBLIC_BACKEND_URL) {
    process.env.NEXT_PUBLIC_BACKEND_URL = nextPublicBackendUrl;
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isTest ? {} : {
    env: {
      NEXT_PUBLIC_BACKEND_URL: nextPublicBackendUrl || '',
    },
  }),
  reactStrictMode: true,
  // Allow the build output directory to be overridden so a verification build
  // (e.g. the pre-commit quality gate) can run without colliding with a live
  // `next dev` server, which holds `.next/trace` open and causes EPERM on Windows.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    // Next's client-side Router Cache otherwise keeps a route's last-rendered
    // component instance (and its React state) around for ~30s after you
    // navigate away, and reuses it — not a fresh remount — if you come back
    // within that window. That silently resurrected stale local UI state
    // (e.g. a wizard's last-selected tab) on a plain sidebar revisit, which
    // read as "the code is wrong" since nothing in the component itself was
    // stale. Forcing every navigation to be treated as stale makes each visit
    // to a route always mount fresh, matching what a user actually expects
    // from clicking a sidebar link.
    staleTimes: {
      dynamic: 0,
      static: 0,
    },
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: nodeBackendUrl
          ? `${nodeBackendUrl}/api/:path*`
          : 'http://localhost:4000/api/:path*',
      },
    ];
  },
};

export default nextConfig;
