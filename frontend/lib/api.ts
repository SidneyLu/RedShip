"use client";

/**
 * REST API 封装与共享类型；与 backend OpenAPI 路由对齐。
 * 浏览器侧 base 来自 NEXT_PUBLIC_API_BASE_URL；留空则走同源 `/api`
 *（由 app/api/[...path] 流式代理到 backend）。
 */

const TOKEN_KEY = "redship.token";

/**
 * API 根路径。
 * 留空则走同源 `/api/*`（Next Route Handler 流式代理，适合只穿透前端 / ngrok）。
 */
export function getApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  return raw.replace(/\/$/, "");
}

/** Extra browser headers: skip ngrok free interstitial HTML that breaks fetch/SSE. */
export function apiClientHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init || {});
  // Harmless elsewhere; required on ngrok free to avoid HTML interstitial → Network Error.
  if (!headers.has("ngrok-skip-browser-warning")) {
    headers.set("ngrok-skip-browser-warning", "true");
  }
  return headers;
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
  const headers = apiClientHeaders(init.headers || {});
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
  source_type: "kb" | "web" | "session" | "bibliography" | string;
  url?: string | null;
  site_name?: string | null;
  heading_path?: string | null;
  era?: string | null;
  series?: string | null;
  relative_path?: string | null;
  doc_id?: string | null;
  parent_index?: number | null;
  locator_label?: string | null;
  previewable?: boolean | null;
  preview_mode?: "text" | "pdf" | "image" | "web" | string | null;
  media_url?: string | null;
  score?: number | null;
  pdf_page?: number | null;
  bboxes?: Array<{ page?: number; bbox?: number[]; type?: string }> | null;
  page_range?: string | null;
}

export interface CitationPreviewCard {
  citation_id: string;
  title: string;
  subtitle?: string | null;
  locator_label?: string | null;
  excerpt?: string | null;
  score?: number | null;
  trust_score: number;
  href: string;
  external_url?: string | null;
  previewable: boolean;
  preview_mode?: "text" | "pdf" | "image" | "web" | null;
  media_url?: string | null;
}

export interface CitationPreviewPage {
  citation_id: string;
  title: string;
  subtitle?: string | null;
  locator_label?: string | null;
  excerpt?: string | null;
  content?: string | null;
  highlight_text?: string | null;
  score?: number | null;
  trust_score: number;
  preview_mode: "text" | "pdf" | "image" | "web";
  page_hint?: number | null;
  external_url?: string | null;
  metadata?: Record<string, unknown> | null;
  media_url?: string | null;
  pdf_page?: number | null;
  bboxes?: Array<{ page?: number; bbox?: number[]; type?: string }> | null;
  file_url?: string | null;
}

export function getThreadMessageCitationPreview(
  threadId: string,
  messageId: string,
  citationId: string,
  detail: "card" | "page"
) {
  return api<CitationPreviewCard | CitationPreviewPage>(
    `/api/threads/${threadId}/messages/${messageId}/citations/${citationId}/preview?detail=${detail}`
  );
}

export interface MessageAttachment {
  id?: string;
  filename: string;
  mode?: "files_api" | "session_rag" | string;
  chunks_count?: number;
}

export type VizKind = "echarts" | "timeline" | "network";

export interface VizSpec {
  title?: string;
  kind: VizKind;
  option?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
  nodes?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
}

export interface MessageArtifact {
  id: string;
  title: string;
  language: "html" | "json";
  format?: "html" | "viz";
  code: string;
  viz?: VizSpec | null;
  status?: "streaming" | "done";
}

export interface Message {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system";
  mode: "chat" | "research";
  content_markdown: string;
  citations: Citation[] | null;
  research_events?: any[] | null;
  attachments?: MessageAttachment[] | null;
  artifacts?: MessageArtifact[] | null;
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

/** Probe result for MD → original PDF (reserved; no pdf.js UI yet). */
export interface KnowledgeDocumentSource {
  available: boolean;
  document_id: string;
  mime_type?: string | null;
  filename?: string | null;
  relative_path?: string | null;
  /** How the PDF was resolved: metadata | sibling | self */
  resolution?: "metadata" | "sibling" | "self" | string | null;
  download_path?: string | null;
}

export function knowledgeDocumentSourcePath(documentId: string): string {
  return `/api/knowledge/documents/${documentId}/source`;
}

export function knowledgeDocumentSourceFilePath(documentId: string): string {
  return `/api/knowledge/documents/${documentId}/source/file`;
}

/** JSON probe — `{ available: false }` when no PDF is paired (HTTP 200). */
export async function getKnowledgeDocumentSource(
  documentId: string
): Promise<KnowledgeDocumentSource> {
  return api<KnowledgeDocumentSource>(knowledgeDocumentSourcePath(documentId));
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

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  size: number;
  canonical_key?: string | null;
  metadata?: Record<string, unknown> | null;
  seed?: boolean | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  document_id?: string | null;
  weight?: number;
  evidence?: string | null;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
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
