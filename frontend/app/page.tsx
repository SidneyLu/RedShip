"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ChatInterface } from "@/components/chat/ChatInterface";

function ChatPage() {
  const search = useSearchParams();
  const threadId = search.get("thread");
  return <ChatInterface initialThreadId={threadId} />;
}

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={<div className="text-muted">正在加载对话…</div>}>
        <ChatPage />
      </Suspense>
    </AppShell>
  );
}
