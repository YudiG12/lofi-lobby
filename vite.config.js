import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "public",
  server: {
    // em dev, /ws/* vai pro wrangler (Worker + Durable Object) na porta 8787
    proxy: { "/ws": { target: "ws://localhost:8787", ws: true } },
  },
});
