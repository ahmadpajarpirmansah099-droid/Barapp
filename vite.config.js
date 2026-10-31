import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const pwaFiles = ["manifest.json", "sw.js", "icon-192.png", "icon-512.png"];

export default defineConfig({
  base: "./",
  server: {
    host: "0.0.0.0"
  },
  plugins: [
    {
      name: "copy-barapp-pwa-files",
      closeBundle() {
        const root = process.cwd();
        const output = resolve(root, "dist");
        mkdirSync(output, { recursive: true });

        for (const file of pwaFiles) {
          copyFileSync(resolve(root, file), resolve(output, file));
        }
      }
    }
  ]
});
