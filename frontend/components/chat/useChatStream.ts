"use client";

import { useCallback, useRef, useState } from "react";
import { streamSSE, type SSEEventBase } from "@/lib/sse";
import type { Citation, Message } from "@/lib/api";

export interface ResearchStep {
  step: string;
  iteration?: number;
  label?: string;
  query?: string;
  sources?: number;
  extracts?: number;
  url?: string;
  title?: string;
  snippet?: string;
  plan_summary?: string;
  sub_questions?: string[];
  follow_ups?: string[];
  gaps?: string[];
  need_more?: boolean;
  new_extracts?: number;
  total_extracts?: number;
  timestamp: number;
}

export interface StreamingState {
  threadId: string | null;
  assistantMessageId: string | null;
  tokens: string;
  reasoning: string;
  citations: Citation[];
  researchSteps: ResearchStep[];
  stage: string | null;
  loading: boolean;
  error: string | null;
}

const INITIAL: StreamingState = {
  threadId: null,
  assistantMessageId: null,
  tokens: "",
  reasoning: "",
  citations: [],
  researchSteps: [],
  stage: null,
  loading: false,
  error: null,
};

export function useChatStream() {
  const [state, setState] = useState<StreamingState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => setState(INITIAL), []);

  const send = useCallback(
    async (params: {
      threadId: string | null;
      query: string;
      mode: "chat" | "research";
      onAck?: (data: SSEEventBase) => void;
      onDone?: (params: { threadId: string; messageId: string; content: string; citations: Citation[]; researchSteps: ResearchStep[] }) => void;
    }) => {
      controllerRef.current?.abort();
      controllerRef.current = new AbortController();
      setState({ ...INITIAL, loading: true });

      let threadId: string | null = params.threadId;
      let assistantMessageId: string | null = null;
      let tokens = "";
      let reasoning = "";
      let citations: Citation[] = [];
      const researchSteps: ResearchStep[] = [];

      try {
        await streamSSE(
          "/api/chat",
          {
            thread_id: params.threadId,
            query: params.query,
            mode: params.mode,
          },
          (event) => {
            switch (event.type) {
              case "ack":
                threadId = event.thread_id;
                assistantMessageId = event.assistant_message_id;
                setState((s) => ({
                  ...s,
                  threadId: event.thread_id,
                  assistantMessageId: event.assistant_message_id,
                }));
                params.onAck?.(event);
                break;
              case "stage":
                setState((s) => ({ ...s, stage: event.label || event.name }));
                break;
              case "analysis":
                researchSteps.push({
                  step: "analysis",
                  query: event.rewritten_query,
                  timestamp: Date.now(),
                });
                break;
              case "citations_ready":
                citations = event.items || [];
                setState((s) => ({ ...s, citations }));
                break;
              case "token":
                tokens += event.content || "";
                setState((s) => ({ ...s, tokens }));
                break;
              case "reasoning":
                reasoning += event.content || "";
                setState((s) => ({ ...s, reasoning }));
                break;
              case "research_step":
                researchSteps.push({ ...event, timestamp: Date.now() });
                setState((s) => ({ ...s, researchSteps: [...researchSteps] }));
                break;
              case "final_state":
                if (event.citations) {
                  citations = event.citations;
                  setState((s) => ({ ...s, citations }));
                }
                break;
              case "error":
                setState((s) => ({ ...s, error: event.message || "unknown error" }));
                break;
              case "done":
                setState((s) => ({ ...s, loading: false, stage: null }));
                if (threadId && assistantMessageId) {
                  params.onDone?.({
                    threadId,
                    messageId: assistantMessageId,
                    content: tokens,
                    citations,
                    researchSteps,
                  });
                }
                break;
            }
          },
          { signal: controllerRef.current.signal }
        );
      } catch (e: any) {
        if (e?.name === "AbortError") {
          setState((s) => ({ ...s, loading: false, stage: null }));
          return;
        }
        setState((s) => ({ ...s, error: e?.message || String(e), loading: false, stage: null }));
      }
    },
    []
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    setState((s) => ({ ...s, loading: false, stage: null }));
  }, []);

  return { state, send, cancel, reset };
}
