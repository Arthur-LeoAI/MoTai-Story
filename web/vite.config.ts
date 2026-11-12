import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const brand = JSON.parse(readFileSync(new URL("../shared/brand.json", import.meta.url), "utf8"));

// Puts the default brand name into index.html, so the name is defined only in
// shared/brand.json. The app replaces the title per interface language at runtime.
function brandHtml(): Plugin {
  return {
    name: "brand-html",
    transformIndexHtml: (html) => html.replaceAll("%BRAND_NAME%", brand.name.default)
  };
}

export default defineConfig({
  root: webRoot,
  base: "/app/",
  plugins: [react(), brandHtml()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true
  },
  server: {
    port: 5290,
    strictPort: true,
    fs: { allow: [repoRoot] },
    // During `npm run dev:web`, API calls go to the regular server.
    proxy: { "/api": "http://127.0.0.1:5177", "/locales": "http://127.0.0.1:5177" }
  }
});
