import type { NextConfig } from "next";

const staticExport = process.env.SITES_STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  output: staticExport ? "export" : undefined,
  trailingSlash: staticExport,
  ...(staticExport
    ? {}
    : {
        async rewrites() {
          return [
            {
              source: "/backend/:path*",
              destination: "http://127.0.0.1:8000/:path*",
            },
          ];
        },
      }),
};
export default nextConfig;
