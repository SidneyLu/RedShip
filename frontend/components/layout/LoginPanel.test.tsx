import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginPanel } from "@/components/layout/LoginPanel";

vi.mock("@/components/providers/AuthProvider", () => ({
  useAuth: () => ({
    login: vi.fn(async () => undefined),
    register: vi.fn(async () => undefined),
  }),
}));

vi.mock("@/components/providers/ToastProvider", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

describe("LoginPanel", () => {
  it("renders login form and can switch to register", async () => {
    const user = userEvent.setup();
    render(<LoginPanel />);
    expect(screen.getByRole("heading", { name: "日新册" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "立即注册" }));
    expect(screen.getByRole("button", { name: "注册" })).toBeInTheDocument();
  });
});
