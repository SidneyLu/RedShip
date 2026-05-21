"use client";

/**
 * REST API 封装与共享类型；与 backend OpenAPI 路由对齐。
 * 浏览器侧 base 来自 NEXT_PUBLIC_API_BASE_URL（next.config 可代理 /api）。
 */

const TOKEN_KEY = "redship.token";

/** API 根路径；SSR 与客户端均读 NEXT_PUBLIC_API_BASE_URL */
export function getApiBase(): string {
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_API_BASE_URL || "";
  }
  return process.env.NEXT_PUBLIC_API_BASE_URL || "";
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (!token) window.localStorage.removeItem(TOKEN_KEY);
  else window.localStorage.setItem(TOKEN_KEY, token);
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const base = getApiBase();
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const headers = new Headers(init.headers || {});
  const token = getToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(init.json);
    delete (init as any).json;
  }
  const resp = await fetch(url, { ...init, headers });
  let parsed: unknown = null;
  const txt = await resp.text();
  try {
    parsed = txt ? JSON.parse(txt) : null;
  } catch {
    parsed = txt;
  }
  if (!resp.ok) {
    const detail =
      (parsed && typeof parsed === "object" && "detail" in (parsed as any) && (parsed as any).detail) ||
      (typeof parsed === "string" ? parsed : null) ||
      `HTTP ${resp.status}`;
    throw new ApiError(resp.status, String(detail), parsed);
  }
  return parsed as T;
}

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface Thread {
  id: string;
  title: string;
  mode: "chat" | "research";
  pinned: boolean;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

/** 单条引用；id 对应 Markdown 内 /threads/.../citations/{id} */
export interface Citation {
  id: string;
  ordinal: number;
  title?: string | null;
  snippet?: string | null;
  highlight_text?: string | null;
  parent_text?: string | null;
  content?: string | null;
  source_type: "kb" | "web";
  url?: string | null;
  site_name?: string | null;
  heading_path?: string | null;
  era?: string | null;
  series?: string | null;
  relative_path?: string | null;
  doc_id?: string | null;
}

export interface Message {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  mode: "chat" | "research";
  content_markdown: string;
  citations: Citation[] | null;
  research_events?: any[] | null;
  attachments?: any[] | null;
  reasoning?: string | null;
  created_at: string;
}

export interface ThreadWithMessages extends Thread {
  messages: Message[];
}

export interface KnowledgeDoc {
  id: string;
  title: string;
  source: string;
  status: string;
  relative_path: string | null;
  era: string | null;
  series: string | null;
  chunks_count: number;
  size_bytes: number | null;
  error: string | null;
  extra_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeStats {
  total_documents: number;
  indexed_documents: number;
  pending_documents: number;
  failed_documents: number;
  total_chunks: number;
  by_era: { era: string; count: number }[];
  by_series: { series: string; count: number }[];
}

export interface SessionFileItem {
  id: string;
  thread_id: string;
  filename: string;
  mode: "files_api" | "session_rag";
  chunks_count: number;
  status: string;
  size_bytes: number | null;
  mime_type: string | null;
  created_at: string;
}
