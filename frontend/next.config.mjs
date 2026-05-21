/**
 * Next.js 配置：
 * - standalone：Docker 多阶段最小运行时
 * - rewrites：浏览器 /api/* 代理到 BACKEND_INTERNAL_URL（容器内 backend:8005）
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    serverActions: { allowedOrigins: ["*"] },
  },
  async rewrites() {
    const backend = process.env.BACKEND_INTERNAL_URL || "http://backend:8005";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
