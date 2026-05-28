"use client";

/**
 * 消费后端 POST /api/chat 的 SSE 流。
 * 按 `\n\n` 分事件，合并多行 `data:` 后 JSON.parse；与 backend chat._sse 对称。
 */

import { getApiBase, getToken } from "@/lib/api";

/** 与 backend chat 路由 data JSON 的 type 字段对应 */
export interface SSEEventBase {
  type: string;
  [key: string]: any;
}

/**
 * 发起 SSE POST 并对每个解析后的事件调用 onEvent。
 * @param path - 如 `/api/chat`
 * @param body - ChatRequest JSON
 * @param onEvent - 每帧 JSON 回调
 * @param options.signal - 用于取消（useChatStream AbortController）
 */
export async function streamSSE(
  path: string,
  body: any,
  onEvent: (ev: SSEEventBase) => void,
  options: { signal?: AbortSignal } = {}
): Promise<void> {
  const base = getApiBase();
  const url = path.startsWith("http") ? path : `${base}${path}`;
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!resp.ok || !resp.body) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`SSE failed: ${resp.status} ${txt}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = chunk.split("\n");
      let dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (!dataLines.length) continue;
      const payload = dataLines.join("\n");
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        onEvent(parsed);
      } catch {
        // 忽略非 JSON ping
      }
    }
  }
}
