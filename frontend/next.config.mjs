/**
 * Next.js 配置：
 * - standalone：Docker 多阶段最小运行时
 * - /api 由 app/api/[...path]/route.ts 流式代理到 BACKEND_INTERNAL_URL
 *   （不用 rewrites，避免 SSE 被缓冲/超时 → ngrok 下 Network Error）
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    serverActions: { allowedOrigins: ["*"] },
  },
};

export default nextConfig;
