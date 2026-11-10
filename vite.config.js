import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // public/ só existe em dev: lá ficam assets de terceiros (modelos, sprites)
  // que NUNCA podem ir pro build publicado nem pro repositório.
  publicDir: command === "build" ? false : "public",
  server: {
    // em dev, /ws/* vai pro wrangler (Worker + Durable Object) na porta 8787
    proxy: { "/ws": { target: "ws://localhost:8787", ws: true } },
  },
}));
