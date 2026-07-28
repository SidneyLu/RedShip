"use client";

/**
 * 深度研究工作台：报告附图 | 证据来源 | 实体关系。
 * 桌面为可拖动/缩放浮动窗；移动端为抽屉。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  LayoutDashboard,
  BarChart3,
  Library,
  Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Citation } from "@/lib/api";
import type { ArtifactPart, ResearchStep } from "@/lib/chat-types";
import { ReportFiguresPanel } from "./research-board/ReportFiguresPanel";
import { EvidencePanel } from "./research-board/EvidencePanel";
import { EntitiesPanel } from "./research-board/EntitiesPanel";

const GEOM_KEY = "redship.canvas.geom";
const MIN_W = 360;
const MIN_H = 320;

type Geom = { x: number; y: number; w: number; h: number };
export type ResearchBoardTab = "figures" | "evidence" | "entities";

function defaultGeom(): Geom {
  if (typeof window === "undefined") {
    return { x: 40, y: 40, w: 480, h: 560 };
  }
  const w = Math.min(520, Math.round(window.innerWidth * 0.42));
  const h = Math.min(680, Math.round(window.innerHeight * 0.75));
  const x = Math.max(8, window.innerWidth - w - 16);
  const y = 16;
  return { x, y, w, h };
}

function loadGeom(): Geom {
  try {
    const raw = window.localStorage.getItem(GEOM_KEY);
    if (!raw) return defaultGeom();
    const parsed = JSON.parse(raw) as Partial<Geom>;
    if (
      typeof parsed.x !== "number" ||
      typeof parsed.y !== "number" ||
      typeof parsed.w !== "number" ||
      typeof parsed.h !== "number"
    ) {
      return defaultGeom();
    }
    return clampGeom(parsed as Geom);
  } catch {
    return defaultGeom();
  }
}

function clampGeom(g: Geom): Geom {
  if (typeof window === "undefined") return g;
  const maxW = Math.max(MIN_W, window.innerWidth - 16);
  const maxH = Math.max(MIN_H, window.innerHeight - 16);
  const w = Math.min(maxW, Math.max(MIN_W, g.w));
  const h = Math.min(maxH, Math.max(MIN_H, g.h));
  const x = Math.min(Math.max(0, g.x), window.innerWidth - w);
  const y = Math.min(Math.max(0, g.y), window.innerHeight - h);
  return { x, y, w, h };
}

function saveGeom(g: Geom) {
  try {
    window.localStorage.setItem(GEOM_KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
}

interface Props {
  artifacts: ArtifactPart[];
  activeArtifactId?: string | null;
  onSelectArtifact?: (id: string) => void;
  researchSteps?: ResearchStep[];
  citations?: Citation[];
  egoNames?: string[];
  egoDocIds?: string[];
  tab?: ResearchBoardTab;
  onTabChange?: (tab: ResearchBoardTab) => void;
  onCitationClick?: (citation: Citation) => void;
  onClose: () => void;
  className?: string;
  variant?: "panel" | "drawer";
  streaming?: boolean;
}

const TABS: { id: ResearchBoardTab; label: string; icon: typeof BarChart3 }[] = [
  { id: "figures", label: "报告附图", icon: BarChart3 },
  { id: "evidence", label: "证据来源", icon: Library },
  { id: "entities", label: "实体关系", icon: Network },
];

export function ResearchCanvas({
  artifacts,
  activeArtifactId,
  onSelectArtifact,
  researchSteps = [],
  citations = [],
  egoNames = [],
  egoDocIds = [],
  tab: controlledTab,
  onTabChange,
  onCitationClick,
  onClose,
  className,
  variant = "panel",
  streaming = false,
}: Props) {
  const [internalTab, setInternalTab] = useState<ResearchBoardTab>("evidence");
  const tab = controlledTab ?? internalTab;
  const setTab = (next: ResearchBoardTab) => {
    onTabChange?.(next);
    if (controlledTab === undefined) setInternalTab(next);
  };

  const [geom, setGeom] = useState<Geom>(() =>
    typeof window === "undefined" ? defaultGeom() : loadGeom()
  );
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    orig: Geom;
  } | null>(null);

  useEffect(() => {
    const onResize = () => setGeom((g) => clampGeom(g));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.mode === "move") {
      setGeom(clampGeom({ ...drag.orig, x: drag.orig.x + dx, y: drag.orig.y + dy }));
    } else {
      setGeom(
        clampGeom({
          ...drag.orig,
          w: drag.orig.w + dx,
          h: drag.orig.h + dy,
        })
      );
    }
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
    setGeom((g) => {
      const next = clampGeom(g);
      saveGeom(next);
      return next;
    });
  }, []);

  const startDrag = (mode: "move" | "resize", e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...geom },
    };
    setDragging(true);
  };

  const subtitle = useMemo(() => {
    if (tab === "figures") {
      const n = artifacts.length;
      return n ? `${n} 个附图` : "等待报告附图";
    }
    if (tab === "evidence") {
      return citations.length
        ? `${citations.length} 条引用`
        : `${researchSteps.length} 个步骤`;
    }
    return egoNames.length || egoDocIds.length
      ? `${egoNames.length} 实体 · ${egoDocIds.length} 文献`
      : "等待实体种子";
  }, [tab, artifacts.length, citations.length, researchSteps.length, egoNames.length, egoDocIds.length]);

  const body = (
    <>
      <header
        className={cn(
          "flex items-start justify-between gap-2 border-b border-border px-4 py-3",
          variant === "panel" && "cursor-grab active:cursor-grabbing select-none"
        )}
        onPointerDown={variant === "panel" ? (e) => startDrag("move", e) : undefined}
        onPointerMove={variant === "panel" ? onPointerMove : undefined}
        onPointerUp={variant === "panel" ? endDrag : undefined}
        onPointerCancel={variant === "panel" ? endDrag : undefined}
      >
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-crimson-700">
            <LayoutDashboard className="h-3 w-3" />
            研究工作台
            {streaming ? " · 进行中" : ""}
            {variant === "panel" ? " · 可拖动" : ""}
          </p>
          <h3 className="mt-1 truncate text-sm font-semibold text-ink">{subtitle}</h3>
        </div>
        <div
          className="flex shrink-0 items-center gap-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-crimson-50 hover:text-crimson-800"
            aria-label="关闭工作台"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <nav
        className="flex shrink-0 gap-0.5 border-b border-border px-2 py-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
              tab === id
                ? "bg-crimson-50 text-crimson-800"
                : "text-muted hover:bg-canvas hover:text-ink"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </nav>

      <div
        className={cn("flex min-h-0 flex-1 flex-col", dragging && "pointer-events-none")}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {tab === "figures" ? (
          <ReportFiguresPanel
            artifacts={artifacts}
            activeId={activeArtifactId}
            onSelect={onSelectArtifact}
          />
        ) : null}
        {tab === "evidence" ? (
          <EvidencePanel
            steps={researchSteps}
            citations={citations}
            onCitationClick={onCitationClick}
          />
        ) : null}
        {tab === "entities" ? (
          <EntitiesPanel names={egoNames} docIds={egoDocIds} />
        ) : null}
      </div>
    </>
  );

  if (variant === "drawer") {
    return (
      <div className="fixed inset-0 z-40 flex justify-end bg-ink/30 lg:hidden" onClick={onClose}>
        <aside
          className={cn(
            "flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-soft",
            className
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {body}
        </aside>
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "panel fixed z-30 hidden flex-col overflow-hidden shadow-soft lg:flex",
        className
      )}
      style={{
        left: geom.x,
        top: geom.y,
        width: geom.w,
        height: geom.h,
      }}
    >
      {body}
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        onPointerDown={(e) => startDrag("resize", e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-hidden
      >
        <span className="absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-crimson-400/80" />
      </div>
    </aside>
  );
}
