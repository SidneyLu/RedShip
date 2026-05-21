"use client";

import { getApiBase, getToken } from "@/lib/api";

export interface SSEEventBase {
  type: string;
  [key: string]: any;
}

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
        // swallow non-JSON pings
      }
    }
  }
}
