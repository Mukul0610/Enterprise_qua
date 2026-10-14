import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import fs from "node:fs";

function getWranglerVars(requestedEnv?: string): Record<string, string> {
  try {
    const wranglerUrl = new URL("./wrangler.jsonc", import.meta.url);
    if (!fs.existsSync(wranglerUrl)) return {};
    const raw = fs.readFileSync(wranglerUrl, "utf-8");
    const clean = raw.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, g) => (g ? "" : m));
    const config = JSON.parse(clean);

    const targetEnv =
      requestedEnv ||
      process.env.WRANGLER_ENV ||
      process.env.CF_ENV ||
      (process.env.NODE_ENV === "production" ? "prod" : "dev");

    const envBlock =
      config.env?.[targetEnv] ||
      config.env?.[targetEnv === "prod" ? "production" : targetEnv];

    return {
      ...(config.vars || {}),
      ...(envBlock?.vars || {}),
    };
  } catch {
    return {};
  }
}

const wranglerVars = getWranglerVars();

// Populate process.env so server-side SSR / API routes see it:
if (wranglerVars.NEXT_PUBLIC_BACKEND_URL && !process.env.NEXT_PUBLIC_BACKEND_URL) {
  process.env.NEXT_PUBLIC_BACKEND_URL = wranglerVars.NEXT_PUBLIC_BACKEND_URL;
}
if (wranglerVars.NODE_BACKEND_URL && !process.env.NODE_BACKEND_URL) {
  process.env.NODE_BACKEND_URL = wranglerVars.NODE_BACKEND_URL;
}

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || wranglerVars.NEXT_PUBLIC_BACKEND_URL || "";

export default defineConfig({
  plugins: [
    vinext({
      cache: { cdn: cdnAdapter() },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
  define: {
    "process.env.NEXT_PUBLIC_BACKEND_URL": JSON.stringify(backendUrl),
  },
});
