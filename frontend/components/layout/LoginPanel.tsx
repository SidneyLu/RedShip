"use client";

/** 未登录时的登录/注册表单。 */

import { FormEvent, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToast } from "@/components/providers/ToastProvider";

export function LoginPanel() {
  const { login, register } = useAuth();
  const { show } = useToast();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      if (mode === "login") {
        await login(email, password);
        show({ title: "登录成功", variant: "success" });
      } else {
        await register(email, password, displayName || undefined);
        show({ title: "注册成功", description: "已自动登录", variant: "success" });
      }
    } catch (err: any) {
      show({ title: "操作失败", description: String(err.message || err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="panel w-full max-w-md p-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-crimson-700 text-base font-bold text-canvas">
            新
          </span>
          <h1 className="text-2xl font-semibold text-crimson-800">日新册</h1>
          <p className="text-xs text-muted">南开大学党史 RAG 智能体</p>
        </div>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          {mode === "register" && (
            <div>
              <label className="label">显示名称</label>
              <input
                className="input mt-1"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例如：李研究"
              />
            </div>
          )}
          <div>
            <label className="label">邮箱</label>
            <input
              className="input mt-1"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@nankai.edu.cn"
              required
            />
          </div>
          <div>
            <label className="label">密码</label>
            <input
              className="input mt-1"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>
          <button
            disabled={loading}
            type="submit"
            className="btn-primary w-full justify-center"
          >
            {loading ? "处理中…" : mode === "login" ? "登录" : "注册"}
          </button>
        </form>
        <div className="mt-4 text-center text-xs text-muted">
          {mode === "login" ? "没有账户？" : "已有账户？"}{" "}
          <button
            type="button"
            className="text-crimson-700 hover:underline"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "立即注册" : "返回登录"}
          </button>
        </div>
        <div className="mt-6 rounded-xl bg-canvas/60 px-3 py-2 text-[11px] leading-5 text-muted">
          首次部署管理员账户由 <code>ADMIN_BOOTSTRAP_EMAIL</code> 与{" "}
          <code>ADMIN_BOOTSTRAP_PASSWORD</code> 环境变量初始化。
        </div>
      </div>
    </div>
  );
}
