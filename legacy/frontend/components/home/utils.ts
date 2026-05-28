import { ActivityTimelineChip, ActivityTimelineNode, AttachmentInput, ModelStageTrace, ResearchRun, UploadItem } from '@/lib/api';

export type ComposerMode = 'ask' | 'research';
export type StageUiStatus = 'pending' | 'running' | 'fallback' | 'success' | 'failed';
export type StageRuntimeState = {
  stage: string;
  model: string;
  status: StageUiStatus;
  detail?: string;
  updatedAt?: string;
  durationMs?: number;
  error?: string | null;
};

export const STAGE_ORDER = ['mm_extractor', 'planner', 'writer', 'visualizer'] as const;

export function inferAttachment(upload: UploadItem): AttachmentInput | null {
  const mime = upload.mime_type.toLowerCase();
  const name = upload.original_filename.toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/.test(name)) {
    return { upload_id: upload.id, media_type: 'image' };
  }
  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    return { upload_id: upload.id, media_type: 'pdf_page', page: 1 };
  }
  return null;
}

export function isTerminalResearchStatus(status: string | undefined) {
  return status === 'completed' || status === 'failed' || status === 'refused';
}

export function asModelTraceList(value: unknown): ModelStageTrace[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ModelStageTrace => Boolean(item) && typeof item === 'object');
}

export function extractRunModelTrace(run: ResearchRun | null): ModelStageTrace[] {
  if (!run) return [];
  const verificationTrace = asModelTraceList(run.verification_report?.model_trace);
  if (verificationTrace.length > 0) return verificationTrace;

  const planTrace = asModelTraceList(run.plan?.model_trace);
  if (planTrace.length > 0) return planTrace;

  const journal = Array.isArray(run.round_journal) ? run.round_journal : [];
  const rows: ModelStageTrace[] = [];
  journal.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    rows.push(...asModelTraceList((entry as Record<string, unknown>).model_trace));
  });
  return rows;
}

export function computeStageStatusRows(
  run: ResearchRun | null,
  stageEvents: Record<string, StageRuntimeState>,
): StageRuntimeState[] {
  const map = new Map<string, StageRuntimeState>();
  extractRunModelTrace(run).forEach((trace) => {
    map.set(trace.stage, {
      stage: trace.stage,
      model: trace.model,
      status: trace.status === 'failed' ? 'failed' : 'success',
      detail: trace.error || (trace.fallback_used ? '阶段通过回退模型完成。' : '阶段已完成。'),
      durationMs: trace.duration_ms,
      error: trace.error,
    });
  });
  Object.values(stageEvents).forEach((entry) => {
    if (!entry?.stage) return;
    map.set(entry.stage, entry);
  });
  return STAGE_ORDER.map((stage) => map.get(stage) ?? { stage, model: '', status: 'pending' as const });
}

export function stageLabel(stage: string): string {
  if (stage === 'mm_extractor') return '多模态抽取';
  if (stage === 'planner') return '研究规划';
  if (stage === 'writer') return '报告写作';
  if (stage === 'visualizer') return '可视化';
  return stage;
}

export function stageStatusLabel(status: StageUiStatus): string {
  if (status === 'running') return '进行中';
  if (status === 'fallback') return '已回退';
  if (status === 'success') return '已完成';
  if (status === 'failed') return '失败';
  return '待触发';
}

export function stageStatusTone(status: StageUiStatus): string {
  if (status === 'running') return 'border-sky-200 bg-sky-50 text-sky-700';
  if (status === 'fallback') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-700';
  return 'border-zinc-200 bg-zinc-50 text-zinc-500';
}

export function normalizeEditablePlan(plan: ResearchRun['plan'], fallbackGoal: string) {
  const goal = typeof plan?.goal === 'string' ? plan.goal : fallbackGoal;
  const rawSteps: unknown[] = Array.isArray(plan?.steps) ? (plan.steps as unknown[]) : [];
  const steps = rawSteps
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && typeof (item as { title?: unknown }).title === 'string') {
        return String((item as { title?: unknown }).title).trim();
      }
      return '';
    })
    .filter((item) => item.length > 0);
  return {
    goal: goal.trim() || fallbackGoal,
    steps: steps.length > 0 ? steps : ['界定研究问题与边界', '汇集证据并交叉验证', '输出结论与引用'],
  };
}

export function sourceStatusLabel(status: 'candidate' | 'adopted' | 'rejected'): string {
  if (status === 'adopted') return '采用';
  if (status === 'rejected') return '淘汰';
  return '候选';
}

export function sourceReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '系统筛选';
  if (reason === 'low_trust') return '可信度不足';
  if (reason === 'site_whitelist') return '不在白名单';
  if (reason === 'deduplicated') return '重复来源';
  if (reason === 'kept') return '满足条件';
  return reason;
}

export function trustLevelLabel(level: 'high' | 'medium' | 'low' | null | undefined): string {
  if (level === 'high') return '高可信';
  if (level === 'low') return '低可信';
  return '中可信';
}

export function trustLevelTone(level: 'high' | 'medium' | 'low' | null | undefined): string {
  if (level === 'high') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (level === 'low') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-zinc-50 text-zinc-700 border-zinc-200';
}

export function parseWhitelistInput(raw: string): string[] {
  return raw
    .split(/[\n,;\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const NODE_STATUS_RANK: Record<string, number> = {
  default: 0,
  pending: 0,
  candidate: 1,
  active: 2,
  running: 1,
  adopted: 3,
  read: 4,
  rejected: 5,
  completed: 2,
  failed: 6,
};

function normalizeTimelineChip(raw: unknown, fallbackKind: ActivityTimelineChip['kind']): ActivityTimelineChip | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    const label = raw.trim();
    return label ? { label, kind: fallbackKind, state: 'default' } : null;
  }
  if (typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const label = String(row.label ?? row.domain ?? row.title ?? row.value ?? '').trim();
  if (!label) return null;
  return {
    label,
    kind: (String(row.kind ?? fallbackKind).trim() as ActivityTimelineChip['kind']) || fallbackKind,
    state: String(row.state ?? 'default').trim() || 'default',
    url: typeof row.url === 'string' ? row.url : null,
    metadata: row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : (row as Record<string, unknown>),
  };
}

function mergeTimelineChips(target: ActivityTimelineChip[], rows: unknown[], fallbackKind: ActivityTimelineChip['kind']) {
  const next = [...target];
  rows.forEach((row) => {
    const chip = normalizeTimelineChip(row, fallbackKind);
    if (!chip) return;
    const existingIndex = next.findIndex((item) => item.kind === chip.kind && item.label === chip.label && (item.url ?? '') === (chip.url ?? ''));
    if (existingIndex >= 0) {
      const existing = next[existingIndex];
      const existingRank = NODE_STATUS_RANK[existing.state] ?? 0;
      const nextRank = NODE_STATUS_RANK[chip.state] ?? existingRank;
      next[existingIndex] = nextRank >= existingRank ? { ...existing, ...chip } : existing;
      return;
    }
    next.push(chip);
  });
  return next;
}

function normalizeActivityNode(raw: unknown): ActivityTimelineNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = String(row.id ?? row.group_id ?? '').trim();
  const groupId = String(row.group_id ?? row.id ?? '').trim();
  const title = String(row.title ?? '').trim();
  if (!id || !groupId || !title) return null;
  const eventLog = Array.isArray(row.event_log)
    ? row.event_log
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          id: String(item.id ?? ''),
          event_type: String(item.event_type ?? ''),
          label: String(item.label ?? item.event_type ?? ''),
          summary: typeof item.summary === 'string' ? item.summary : null,
          status: String(item.status ?? 'info'),
          created_at: typeof item.created_at === 'string' ? item.created_at : null,
          metadata: item.metadata && typeof item.metadata === 'object' ? (item.metadata as Record<string, unknown>) : null,
        }))
        .filter((item) => item.id && item.label)
    : [];
  return {
    id,
    group_id: groupId,
    node_type: String(row.node_type ?? 'intent'),
    title,
    summary: typeof row.summary === 'string' ? row.summary : null,
    status: String(row.status ?? 'pending'),
    round: typeof row.round === 'number' ? row.round : null,
    reason: typeof row.reason === 'string' ? row.reason : null,
    queries: mergeTimelineChips([], Array.isArray(row.queries) ? row.queries : [], 'query'),
    domains: mergeTimelineChips([], Array.isArray(row.domains) ? row.domains : [], 'domain'),
    artifacts: mergeTimelineChips([], Array.isArray(row.artifacts) ? row.artifacts : [], 'artifact'),
    event_log: eventLog,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  };
}

function mergeTimelineNode(prev: ActivityTimelineNode | null, next: ActivityTimelineNode): ActivityTimelineNode {
  if (!prev) return next;
  const prevRank = NODE_STATUS_RANK[prev.status] ?? 0;
  const nextRank = NODE_STATUS_RANK[next.status] ?? prevRank;
  const mergedEventLog = [...prev.event_log];
  next.event_log.forEach((item) => {
    if (!mergedEventLog.some((existing) => existing.id === item.id)) {
      mergedEventLog.push(item);
    }
  });
  return {
    ...prev,
    ...next,
    status: nextRank >= prevRank ? next.status : prev.status,
    summary: next.summary && next.summary.length >= (prev.summary?.length ?? 0) ? next.summary : prev.summary,
    reason: next.reason ?? prev.reason,
    queries: mergeTimelineChips(prev.queries, next.queries, 'query'),
    domains: mergeTimelineChips(prev.domains, next.domains, 'domain'),
    artifacts: mergeTimelineChips(prev.artifacts, next.artifacts, 'artifact'),
    event_log: mergedEventLog.slice(-24),
    created_at: prev.created_at ?? next.created_at,
    updated_at: next.updated_at ?? prev.updated_at,
  };
}

export function mergeActivityTimelineSnapshot(
  current: ActivityTimelineNode[],
  incoming: ActivityTimelineNode[] | null | undefined,
): ActivityTimelineNode[] {
  if (!incoming || incoming.length === 0) return current;
  const map = new Map<string, ActivityTimelineNode>();
  const order: string[] = [];
  current.forEach((item) => {
    map.set(item.group_id, item);
    order.push(item.group_id);
  });
  incoming.forEach((item) => {
    const normalized = normalizeActivityNode(item);
    if (!normalized) return;
    const existing = map.get(normalized.group_id) ?? null;
    map.set(normalized.group_id, mergeTimelineNode(existing, normalized));
    if (!order.includes(normalized.group_id)) {
      order.push(normalized.group_id);
    }
  });
  return order.map((groupId) => map.get(groupId)).filter((item): item is ActivityTimelineNode => Boolean(item));
}

function buildEventNodeFromPayload(
  eventName: string,
  payload: Record<string, unknown>,
  createdAt: string | null,
  eventId: string | null,
): ActivityTimelineNode | null {
  const groupId = String(payload.group_id ?? '').trim();
  const title = String(payload.title ?? '').trim();
  if (!groupId || !title) return null;
  const label = String(payload.label ?? payload.message ?? title).trim() || title;
  return normalizeActivityNode({
    id: groupId,
    group_id: groupId,
    node_type: String(payload.node_type ?? 'intent'),
    title,
    summary: payload.summary,
    status: String(payload.status ?? 'running'),
    round: typeof payload.round === 'number' ? payload.round : null,
    reason: payload.reason,
    queries: Array.isArray(payload.queries) ? payload.queries : [],
    domains: Array.isArray(payload.domains) ? payload.domains : [],
    artifacts: Array.isArray(payload.artifacts) ? payload.artifacts : [],
    event_log: [
      {
        id: eventId ?? `${groupId}-${eventName}-${createdAt ?? 'now'}`,
        event_type: eventName,
        label,
        summary: typeof payload.summary === 'string' ? payload.summary : typeof payload.message === 'string' ? payload.message : null,
        status: String(payload.status ?? 'running'),
        created_at: createdAt,
        metadata: payload,
      },
    ],
    created_at: createdAt,
    updated_at: createdAt,
  });
}

export function mergeActivityTimelineEvent(
  current: ActivityTimelineNode[],
  eventName: string,
  payload: Record<string, unknown>,
  createdAt: string | null,
  eventId: string | null,
): ActivityTimelineNode[] {
  const node = buildEventNodeFromPayload(eventName, payload, createdAt, eventId);
  if (!node) return current;
  return mergeActivityTimelineSnapshot(current, [node]);
}
