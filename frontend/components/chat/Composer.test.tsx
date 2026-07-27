import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "@/components/chat/Composer";

vi.mock("@/components/providers/ToastProvider", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

vi.mock("@/components/chat/FileAttachment", () => ({
  FileAttachment: () => null,
  removeSessionFile: vi.fn(),
}));

vi.mock("@/components/chat/SessionDocsPanel", () => ({
  SessionDocsPanel: () => null,
}));

describe("Composer", () => {
  it("toggles mode and send button text; collapses when idle", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    const onSend = vi.fn();
    const { rerender } = render(
      <Composer
        mode="chat"
        onModeChange={onModeChange}
        threadId={null}
        loading={false}
        onSend={onSend}
        onStop={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /问答/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /发送/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("提问…")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /研究/i }));
    expect(onModeChange).toHaveBeenCalledWith("research");

    rerender(
      <Composer
        mode="research"
        onModeChange={onModeChange}
        threadId={null}
        loading={false}
        onSend={onSend}
        onStop={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText("输入研究问题…")).toBeInTheDocument();
    const sendBtns = screen.getAllByRole("button", { name: /研究/ });
    expect(sendBtns.length).toBeGreaterThanOrEqual(1);

    const input = screen.getByPlaceholderText("输入研究问题…");
    await user.click(input);
    expect(screen.getByPlaceholderText("输入深度研究问题…")).toBeInTheDocument();
  });
});
