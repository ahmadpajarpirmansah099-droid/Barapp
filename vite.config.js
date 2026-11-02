import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const publicRootFiles = ["manifest.json", "sw.js", "icon-192.png", "icon-512.png"];

const featureFiles = [
  { source: "src/features/closing/closing.js", destination: "closing.js" },
  { source: "src/features/guest-arrival/guest-arrival.js", destination: "guest-arrival.js" },
  { source: "src/features/attendance/attendance-excel.js", destination: "attendance-excel.js" },
  { source: "src/features/attendance/attendance.js", destination: "attendance.js" },
  { source: "src/features/schedule/schedule.js", destination: "schedule.js" },
  { source: "src/features/inventory/unit-conversion.js", destination: "unit-conversion.js" },
  { source: "src/features/overtime/overtime.js", destination: "overtime.js" }
];

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

        for (const file of featureFiles) {
          copyFileSync(resolve(root, file.source), resolve(output, file.destination));
        }
      }
    }
  ]
});
