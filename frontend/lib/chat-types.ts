/**
 * AI SDK UIMessage types for RedShip chat + DB → UIMessage helpers.
 */

import type { UIMessage } from "ai";
import type { Citation, Message } from "@/lib/api";

/** research_step payload (stream data part + ResearchProgress). */
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
  timestamp?: number;
}

export type RedShipMessageMetadata = {
  threadId?: string;
  mode?: "chat" | "research";
};

export type RedShipDataParts = {
  ack: {
    thread_id: string;
    mode: string;
    user_message_id?: string;
    assistant_message_id?: string;
  };
  stage: {
    name?: string;
    label?: string;
    rewritten_query?: string;
    [key: string]: unknown;
  };
  "research-step": ResearchStep;
  citations: { items: Citation[] };
};

export type RedShipUIMessage = UIMessage<RedShipMessageMetadata, RedShipDataParts>;

export function getMessageText(message: RedShipUIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function getMessageReasoning(message: RedShipUIMessage): string {
  return message.parts
    .filter((p): p is { type: "reasoning"; text: string } => p.type === "reasoning")
    .map((p) => p.text)
    .join("");
}

export function getMessageCitations(message: RedShipUIMessage): Citation[] {
  for (let i = message.parts.length - 1; i >= 0; i--) {
    const part = message.parts[i];
    if (part.type === "data-citations" && Array.isArray(part.data?.items)) {
      return part.data.items;
    }
  }
  return [];
}

export function getResearchStepsFromMessages(messages: RedShipUIMessage[]): ResearchStep[] {
  const steps: ResearchStep[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type === "data-research-step" && part.data?.step) {
        steps.push({ ...part.data, timestamp: part.data.timestamp ?? Date.now() });
      }
    }
  }
  return steps;
}

export function messageMode(message: RedShipUIMessage): "chat" | "research" {
  return message.metadata?.mode === "research" ? "research" : "chat";
}

/** Map a Postgres Message row to a UIMessage for useChat hydration. */
export function dbMessageToUIMessage(m: Message): RedShipUIMessage {
  const parts: RedShipUIMessage["parts"] = [];

  if (m.role === "assistant" && m.reasoning) {
    parts.push({ type: "reasoning", text: m.reasoning, state: "done" });
  }

  parts.push({
    type: "text",
    text: m.content_markdown || "",
    state: "done",
  });

  if (m.role === "assistant" && m.citations && m.citations.length > 0) {
    parts.push({
      type: "data-citations",
      id: "citations",
      data: { items: m.citations },
    });
  }

  if (m.role === "assistant" && Array.isArray(m.research_events)) {
    m.research_events.forEach((ev, idx) => {
      if (!ev || typeof ev !== "object") return;
      const step = String((ev as { step?: string }).step || "");
      if (!step && (ev as { type?: string }).type !== "research_step") return;
      const data = { ...(ev as Record<string, unknown>) };
      delete data.type;
      const iteration = (ev as { iteration?: number }).iteration;
      const partId = iteration != null ? `rs-${step || "step"}-${iteration}` : `rs-${step || "step"}-${idx}`;
      parts.push({
        type: "data-research-step",
        id: partId,
        data: {
          ...(data as unknown as ResearchStep),
          step: step || "research_step",
        },
      });
    });
  }

  return {
    id: m.id,
    role: m.role === "system" ? "system" : m.role,
    metadata: {
      threadId: m.thread_id,
      mode: m.mode,
    },
    parts,
  };
}

export function toUIMessages(messages: Message[]): RedShipUIMessage[] {
  return messages.map(dbMessageToUIMessage);
}
