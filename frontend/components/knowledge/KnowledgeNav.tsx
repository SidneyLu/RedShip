"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/knowledge", label: "概览", exact: true },
  { href: "/knowledge/documents", label: "文献" },
  { href: "/knowledge/build", label: "构建" },
  { href: "/knowledge/graph", label: "图谱" },
  { href: "/demo/vision-wenshi", label: "VL Demo" },
];

export function KnowledgeNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-4 flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
      {LINKS.map((l) => {
        const active = l.exact
          ? pathname === l.href
          : pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-crimson-50 font-medium text-crimson-800"
                : "text-muted hover:bg-canvas hover:text-ink"
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
