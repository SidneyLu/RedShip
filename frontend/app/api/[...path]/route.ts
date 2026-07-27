import type { NextRequest } from "next/server";

/**
 * Streaming reverse proxy: browser /api/* → BACKEND_INTERNAL_URL/api/*
 *
 * Prefer this over next.config rewrites for SSE (chat / research). Rewrites can
 * buffer or cut long streams behind ngrok, which surfaces as Network Error.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Allow long research SSE (seconds → minutes). */
export const maxDuration = 1800;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function backendBase(): string {
  return (process.env.BACKEND_INTERNAL_URL || "http://backend:8005").replace(/\/$/, "");
}

async function proxy(req: NextRequest, pathSegments: string[]) {
  const incoming = new URL(req.url);
  const target = `${backendBase()}/api/${pathSegments.map(encodeURIComponent).join("/")}${incoming.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    headers.set(key, value);
  });

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    // Required by Node fetch when forwarding a streaming request body.
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { detail: `Backend unreachable: ${message}` },
      { status: 502 }
    );
  }

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return;
    outHeaders.set(key, value);
  });
  outHeaders.set("Cache-Control", "no-cache, no-transform");
  outHeaders.set("X-Accel-Buffering", "no");
  if (!outHeaders.has("Connection")) {
    outHeaders.set("Connection", "keep-alive");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return proxy(req, path || []);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
