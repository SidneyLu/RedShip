import { describe, expect, it } from "vitest";
import type { Citation } from "@/lib/api";
import {
  CITATION_LABEL_RE,
  citationChipLabel,
  findCitation,
  normalizeCitationMarkdown,
} from "@/lib/citation-labels";

const citations: Citation[] = [
  { id: "k-1", ordinal: 1, source_type: "kb", title: "A" },
  { id: "k-3", ordinal: 3, source_type: "kb", title: "B" },
  { id: "c-2", ordinal: 2, source_type: "kb", title: "C" },
];

describe("citation-labels", () => {
  it("matches id-style labels", () => {
    expect(CITATION_LABEL_RE.test("(k-3)")).toBe(true);
    expect(CITATION_LABEL_RE.test("(1)")).toBe(true);
    expect(CITATION_LABEL_RE.test("k-1")).toBe(true);
    expect(CITATION_LABEL_RE.test("not a cite")).toBe(false);
  });

  it("resolves citation by id and shows ordinal label", () => {
    const c = findCitation(citations, "k-3");
    expect(c?.ordinal).toBe(3);
    expect(citationChipLabel(c, "(k-3)")).toBe("(3)");
    expect(citationChipLabel(undefined, "(k-1)")).toBe("(1)");
  });

  it("normalizes markdown link labels and bare (id) markers", () => {
    const md =
      "事实[(k-3)](/threads/t/messages/m/citations/k-3)。\n\n## 参考资料\n- (k-1) 标题A\n- (k-3) 标题B";
    const out = normalizeCitationMarkdown(md, citations);
    expect(out).toContain("[(3)](/threads/t/messages/m/citations/k-3)");
    expect(out).toContain("- (1) 标题A");
    expect(out).toContain("- (3) 标题B");
    expect(out).not.toMatch(/\(k-\d+\)/);
  });

  it("wraps bare ordinals into chip links when thread/message ids are known", () => {
    const md = "结论见(1)与(3)。已有[(2)](/threads/t/messages/m/citations/c-2)。";
    const out = normalizeCitationMarkdown(md, citations, {
      threadId: "t",
      messageId: "m",
    });
    expect(out).toContain("[(1)](/threads/t/messages/m/citations/k-1)");
    expect(out).toContain("[(3)](/threads/t/messages/m/citations/k-3)");
    expect(out).toContain("[(2)](/threads/t/messages/m/citations/c-2)");
    // existing link not double-wrapped
    expect(out).not.toMatch(/\[\[\(/);
  });

  it("forces free-form citation link labels to ordinal chips", () => {
    const md = "见[文献A](/threads/t/messages/m/citations/k-1)。";
    const out = normalizeCitationMarkdown(md, citations);
    expect(out).toContain("[(1)](/threads/t/messages/m/citations/k-1)");
  });
});
