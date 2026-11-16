import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "sharp", "ffmpeg-static"],
  // The registries, the fonts and the video encoder are read from disk at run time, so a deployment must carry them.
  outputFileTracingIncludes: { "/**": ["./registry/**/*", "./assets/**/*", "./node_modules/ffmpeg-static/ffmpeg"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
