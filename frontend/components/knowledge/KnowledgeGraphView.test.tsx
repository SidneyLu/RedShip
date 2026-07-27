import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeGraphView } from "@/components/knowledge/KnowledgeGraphView";

vi.mock("next/dynamic", () => ({
  default: () => {
    const Stub = () => <div data-testid="force-graph-stub" />;
    return Stub;
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: vi.fn(),
  };
});

describe("KnowledgeGraphView", () => {
  it("shows empty hint when controlled empty data", () => {
    render(
      <KnowledgeGraphView
        compact
        data={{ nodes: [], edges: [] }}
        height={200}
        emptyHint="提问后显示相关知识子图"
      />
    );
    expect(screen.getByText("提问后显示相关知识子图")).toBeInTheDocument();
  });
});
