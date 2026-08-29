import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [tailwindcss(), tanstackRouter({}), react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: env.DEV_SERVER_HOST || "127.0.0.1",
      port: 3001,
      allowedHosts: env.DEV_SERVER_ALLOWED_HOSTS
        ? env.DEV_SERVER_ALLOWED_HOSTS.split(",").map((host) => host.trim())
        : undefined,
    },
  };
});
