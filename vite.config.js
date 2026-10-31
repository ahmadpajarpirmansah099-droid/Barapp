import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const publicRootFiles = ["manifest.json", "sw.js", "icon-192.png", "icon-512.png", "closing.js", "guest-arrival.js"];

export default defineConfig({
  base: "./",
  server: {
    host: "0.0.0.0"
  },
  plugins: [
    {
      name: "copy-barapp-public-root-files",
      closeBundle() {
        const root = process.cwd();
        const output = resolve(root, "dist");
        mkdirSync(output, { recursive: true });

        for (const file of publicRootFiles) {
          copyFileSync(resolve(root, file), resolve(output, file));
        }
      }
    }
  ]
});
