import { describe, expect, it } from "vitest";
import {
  getMessageArtifacts,
  getMessageCitations,
  getMessageText,
  normalizeArtifactPart,
  toUIMessages,
} from "@/lib/chat-types";
import type { Message } from "@/lib/api";
import type { RedShipUIMessage } from "@/lib/chat-types";

describe("chat-types", () => {
  it("getMessageText joins text parts", () => {
    const msg = {
      id: "1",
      role: "assistant",
      parts: [
        { type: "text", text: "你好" },
        { type: "text", text: "世界" },
      ],
    } as RedShipUIMessage;
    expect(getMessageText(msg)).toBe("你好世界");
  });

  it("getMessageCitations reads data-citations", () => {
    const msg = {
      id: "1",
      role: "assistant",
      parts: [
        {
          type: "data-citations",
          id: "citations",
          data: { items: [{ id: "c-1", ordinal: 1, source_type: "kb" }] },
        },
      ],
    } as RedShipUIMessage;
    expect(getMessageCitations(msg)).toHaveLength(1);
    expect(getMessageCitations(msg)[0].id).toBe("c-1");
  });

  it("normalizeArtifactPart marks viz format", () => {
    const art = normalizeArtifactPart({
      id: "a1",
      title: "对比",
      language: "json",
      format: "viz",
      code: "{}",
      viz: { kind: "echarts", option: { series: [] } },
      status: "done",
    });
    expect(art.format).toBe("viz");
    expect(art.language).toBe("json");
  });

  it("toUIMessages hydrates viz artifacts", () => {
    const rows: Message[] = [
      {
        id: "m1",
        thread_id: "t1",
        role: "assistant",
        mode: "research",
        content_markdown: "报告",
        reasoning: null,
        citations: null,
        research_events: null,
        attachments: null,
        artifacts: [
          {
            id: "art-1",
            title: "附图",
            language: "json",
            format: "viz",
            code: '{"kind":"echarts","option":{"xAxis":{}}}',
            viz: { kind: "echarts", option: { xAxis: {} } },
            status: "done",
          },
        ],
        created_at: new Date().toISOString(),
      },
    ];
    const ui = toUIMessages(rows);
    const arts = getMessageArtifacts(ui[0]);
    expect(arts).toHaveLength(1);
    expect(arts[0].format).toBe("viz");
    expect(arts[0].viz?.kind).toBe("echarts");
  });

  it("toUIMessages maps DB messages", () => {
    const rows: Message[] = [
      {
        id: "m1",
        thread_id: "t1",
        role: "user",
        mode: "chat",
        content_markdown: "问",
        reasoning: null,
        citations: null,
        research_events: null,
        attachments: null,
        artifacts: null,
        created_at: new Date().toISOString(),
      },
    ];
    const ui = toUIMessages(rows);
    expect(ui).toHaveLength(1);
    expect(getMessageText(ui[0])).toBe("问");
  });
});
