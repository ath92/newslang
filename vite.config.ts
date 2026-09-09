import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  // The Cloudflare plugin must come after the framework plugin.
  plugins: [react(), cloudflare()],
});
