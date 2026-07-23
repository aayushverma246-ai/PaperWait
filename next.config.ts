import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "mammoth", "xlsx", "officeparser"],
};

export default nextConfig;
