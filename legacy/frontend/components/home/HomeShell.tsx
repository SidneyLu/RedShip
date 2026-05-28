'use client';

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Link2, LoaderCircle, Play, Square } from 'lucide-react';

import {
  ActivityTimelineNode,
  api,
  AttachmentInput,
  ConversationMessage,
  ResearchRun,
  ThreadItem,
  ThreadMessage,
  UploadItem,
  User,
  UserProfile,
} from '@/lib/api';
import { loadAuthState } from '@/lib/auth';
import { CitationPreviewProvider } from '@/components/citations/CitationPreviewProvider';
import { TransitionLink } from '@/components/TransitionLink';
import { HomeSidebar } from '@/components/home/HomeSidebar';
import { PlanCard } from '@/components/home/PlanCard';
import { ProgressStrip } from '@/components/home/ProgressStrip';
import { ReportReader } from '@/components/home/ReportReader';
import { ResearchComposer } from '@/components/home/ResearchComposer';
import { ResearchTimeline } from '@/components/home/ResearchTimeline';
import { SourceDrawer } from '@/components/home/SourceDrawer';
import {
  ComposerMode,
  StageRuntimeState,
  computeStageStatusRows,
  inferAttachment,
  isTerminalResearchStatus,
  mergeActivityTimelineEvent,
  mergeActivityTimelineSnapshot,
  normalizeEditablePlan,
  parseWhitelistInput,
} from '@/components/home/utils';

interface WorkspaceRouteSelection {
  threadId: string | null;
  runId: string | null;
  view: 'workspace' | 'reader' | null;
}

function recentConversation(messages: ThreadMessage[]): ConversationMessage[] {
  return messages
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .slice(-10)
    .map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content }));
}

function latestResearchRunId(messages: ThreadMessage[]): string | null {
  const reversed = [...messages].reverse();
  return reversed.find((item) => item.research_run_id)?.research_run_id ?? null;
}

function isNarrowViewport() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;
}

function normalizeRouteParam(value: string | null): string | null {
  const next = value?.trim();
  return next ? next : null;
}

function readWorkspaceRouteSelection(): WorkspaceRouteSelection {
  if (typeof window === 'undefined') {
    return { threadId: null, runId: null, view: null };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    threadId: normalizeRouteParam(params.get('threadId')),
    runId: normalizeRouteParam(params.get('runId')),
    view: normalizeRouteParam(params.get('view')) === 'reader' ? 'reader' : normalizeRouteParam(params.get('view')) === 'workspace' ? 'workspace' : null,
  };
}

function syncWorkspaceRouteSelection(selection: WorkspaceRouteSelection) {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  const current = `${url.pathname}${url.search}${url.hash}`;

  if (selection.threadId) {
    url.searchParams.set('threadId', selection.threadId);
  } else {
    url.searchParams.delete('threadId');
  }

  if (selection.runId) {
    url.searchParams.set('runId', selection.runId);
  } else {
    url.searchParams.delete('runId');
  }
  if (selection.view && selection.runId) {
    url.searchParams.set('view', selection.view);
  } else {
    url.searchParams.delete('view');
  }

  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== current) {
    window.history.replaceState(window.history.state, '', next);
  }
}

export function HomeShell() {
  const initialRouteSelectionRef = useRef<WorkspaceRouteSelection>(readWorkspaceRouteSelection());
  const manualViewOverrideRef = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<Record<string, AttachmentInput>>({});
  const [runIdByThread, setRunIdByThread] = useState<Record<string, string | null>>({});

  const [question, setQuestion] = useState('请基于当前资料生成一份有引用来源的研究报告。');
  const [composerMode, setComposerMode] = useState<ComposerMode>('ask');
  const [composerModeByThread, setComposerModeByThread] = useState<Record<string, ComposerMode>>({});
  const [retrievalEnabled, setRetrievalEnabled] = useState(true);
  const [retrievalScope, setRetrievalScope] = useState<'base' | 'upload' | 'hybrid'>('hybrid');

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ResearchRun | null>(null);
  const [workspaceView, setWorkspaceView] = useState<'workspace' | 'reader'>(initialRouteSelectionRef.current.view ?? 'workspace');
  const [activityTimeline, setActivityTimeline] = useState<ActivityTimelineNode[]>([]);
  const [planGoal, setPlanGoal] = useState('');
  const [planSteps, setPlanSteps] = useState<string[]>([]);
  const [planDirty, setPlanDirty] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [runWatchNonce, setRunWatchNonce] = useState(0);
  const [stageEvents, setStageEvents] = useState<Record<string, StageRuntimeState>>({});

  const [backendReady, setBackendReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const [sourcePolicyBusy, setSourcePolicyBusy] = useState(false);
  const [whitelistInput, setWhitelistInput] = useState('');
  const [webEnabled, setWebEnabled] = useState(true);
  const [threadSearch, setThreadSearch] = useState('');

  const deferredThreadSearch = useDeferredValue(threadSearch);
  const attachmentList = useMemo(() => Object.values(selectedAttachments), [selectedAttachments]);
  const activeThread = useMemo(() => threads.find((item) => item.id === activeThreadId) ?? null, [threads, activeThreadId]);
  const filteredThreads = useMemo(() => {
    const keyword = deferredThreadSearch.trim().toLowerCase();
    if (!keyword) return threads;
    return threads.filter((item) => {
      const haystack = `${item.title} ${item.latest_message_preview ?? ''}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [deferredThreadSearch, threads]);
  const stageStatusRows = useMemo(() => computeStageStatusRows(activeRun, stageEvents), [activeRun, stageEvents]);
  const isAdmin = user?.role === 'admin';
  const canUseUploads = Boolean(user);
  const currentRunAction = activeRun?.pending_user_action?.type ?? null;
  const awaitingPlanReview = activeRun?.status === 'awaiting_confirmation' && activeRun?.phase === 'plan_review';
  const progressSummary = (activeRun?.progress_summary ?? null) as Record<string, unknown> | null;

  const bootstrapThreads = useCallback(
    async (authToken: string) => {
      const rows = await api.listThreads(authToken, { limit: 50 });
      if (rows.length > 0) {
        const routeSelection = initialRouteSelectionRef.current;
        const preferredThreadId =
          routeSelection.threadId && rows.some((item) => item.id === routeSelection.threadId) ? routeSelection.threadId : rows[0].id;
        setThreads(rows);
        setActiveThreadId((prev) => prev ?? preferredThreadId);
        return;
      }
      const created = await api.createThread(
        {
          title: '新会话',
          default_retrieval_scope: retrievalScope,
        },
        authToken,
      );
      setThreads([created]);
      setActiveThreadId(created.id);
    },
    [retrievalScope],
  );

  const refreshMessages = useCallback(async (authToken: string, threadId: string) => {
    const rows = await api.listThreadMessages(threadId, authToken, { limit: 300 });
    setMessages(rows);
    return rows;
  }, []);

  const refreshUploads = useCallback(async (authToken: string, threadId: string) => {
    const rows = await api.listUploads(threadId, authToken);
    setUploads(rows);
    return rows;
  }, []);

  useEffect(() => {
    const auth = loadAuthState();
    setToken(auth.token ?? null);
    setUser(auth.user ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const check = async () => {
      try {
        await api.health();
        if (!cancelled) {
          setBackendReady(true);
          return;
        }
      } catch {}
      if (!cancelled) {
        setBackendReady(false);
        attempt += 1;
        timer = setTimeout(check, Math.min(3000, 600 + attempt * 300));
      }
    };

    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setProfile(null);
      setThreads([]);
      setMessages([]);
      setUploads([]);
      setActiveThreadId(null);
      setActiveRunId(null);
      setActiveRun(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const me = await api.getMe(token);
        if (!cancelled) setProfile(me);
        await bootstrapThreads(token);
      } catch (err: any) {
        if (!cancelled) setError(err.message || '初始化失败');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, bootstrapThreads]);

  useEffect(() => {
    if (!activeThreadId) return;
    setComposerMode(composerModeByThread[activeThreadId] ?? 'ask');
  }, [activeThreadId, composerModeByThread]);

  useEffect(() => {
    syncWorkspaceRouteSelection({
      threadId: activeThreadId,
      runId: activeThreadId ? activeRunId : null,
      view: activeThreadId && activeRunId ? workspaceView : null,
    });
  }, [activeThreadId, activeRunId, workspaceView]);

  useEffect(() => {
    if (!token || !activeThreadId) {
      setMessages([]);
      setUploads([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [messageRows] = await Promise.all([refreshMessages(token, activeThreadId), refreshUploads(token, activeThreadId)]);
        if (cancelled) return;
        const routeSelection = initialRouteSelectionRef.current;
        const rememberedRunId = runIdByThread[activeThreadId];
        const routedRunId = routeSelection.threadId === activeThreadId ? routeSelection.runId : null;
        const inferredRunId = rememberedRunId ?? routedRunId ?? latestResearchRunId(messageRows);
        setActiveRunId(inferredRunId ?? null);
      } catch {
        if (!cancelled) {
          setMessages([]);
          setUploads([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, activeThreadId, refreshMessages, refreshUploads, runIdByThread]);

  useEffect(() => {
    setStageEvents({});
    setActivityTimeline([]);
    manualViewOverrideRef.current = false;
    if (!activeRunId) {
      setWorkspaceView('workspace');
      return;
    }
    const routeSelection = initialRouteSelectionRef.current;
    if (routeSelection.runId === activeRunId && routeSelection.view) {
      setWorkspaceView(routeSelection.view);
      initialRouteSelectionRef.current = { threadId: null, runId: null, view: null };
      return;
    }
    if (routeSelection.runId === activeRunId) {
      initialRouteSelectionRef.current = { threadId: null, runId: null, view: null };
    }
    setWorkspaceView('workspace');
  }, [activeRunId]);

  useEffect(() => {
    if (!token || !activeRunId) {
      setActiveRun(null);
      return;
    }
    const controller = new AbortController();
    const decoder = new TextDecoder();
    let buffer = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let usingPollingFallback = false;

    const refreshRun = async () => {
      const row = await api.getResearchRun(activeRunId, token);
      if (cancelled) return row;
      setActiveRun(row);
      setActivityTimeline((prev) => mergeActivityTimelineSnapshot(prev, row.activity_timeline));
      if (row.final_report && row.view_recommendation === 'reader' && !manualViewOverrideRef.current) {
        setWorkspaceView('reader');
      }
      if (activeThreadId) {
        setRunIdByThread((prev) => ({ ...prev, [activeThreadId]: row.id }));
      }
      if (isTerminalResearchStatus(row.status) && activeThreadId) {
        await refreshMessages(token, activeThreadId);
      }
      return row;
    };

    const tick = async () => {
      try {
        const row = await refreshRun();
        if (!row || cancelled) return;
        if (!isTerminalResearchStatus(row.status)) {
          timer = setTimeout(tick, 1400);
        }
      } catch {
        if (!cancelled) timer = setTimeout(tick, 1800);
      }
    };

    const parseEventBlock = async (block: string) => {
      const lines = block.split('\n').map((line) => line.trim());
      const eventLine = lines.find((line) => line.startsWith('event:'));
      const dataLine = lines.find((line) => line.startsWith('data:'));
      const eventName = eventLine ? eventLine.replace(/^event:\s*/, '') : '';
      const dataRaw = dataLine ? dataLine.replace(/^data:\s*/, '') : '{}';
      let data: any = {};
      try {
        data = JSON.parse(dataRaw);
      } catch {}

      const eventPayload = data?.payload && typeof data.payload === 'object' ? data.payload : {};
      if (eventName === 'model_stage_started') {
        const payload = eventPayload as Record<string, unknown>;
        const stage = String(payload.stage ?? '');
        if (stage) {
          setStageEvents((prev) => ({
            ...prev,
            [stage]: {
              stage,
              model: String(payload.primary_model ?? ''),
              status: 'running',
              detail: Number(payload.timeout_ms ?? 0) > 0 ? `主模型运行中，阶段超时 ${payload.timeout_ms}ms。` : '主模型运行中。',
              updatedAt: String(data?.created_at ?? ''),
            },
          }));
        }
      } else if (eventName === 'model_stage_fallback') {
        const payload = eventPayload as Record<string, unknown>;
        const stage = String(payload.stage ?? '');
        if (stage) {
          const fromModel = String(payload.from_model ?? '');
          const toModel = String(payload.to_model ?? '');
          const fallbackError = String(payload.error ?? '').trim();
          setStageEvents((prev) => ({
            ...prev,
            [stage]: {
              stage,
              model: toModel,
              status: 'fallback',
              detail: fallbackError ? `从 ${fromModel} 回退到 ${toModel}：${fallbackError}` : `从 ${fromModel} 回退到 ${toModel}。`,
              updatedAt: String(data?.created_at ?? ''),
            },
          }));
        }
      } else if (eventName === 'model_stage_completed' || eventName === 'model_stage_failed') {
        const payload = eventPayload as Record<string, unknown>;
        const stage = String(payload.stage ?? '');
        if (stage) {
          setStageEvents((prev) => ({
            ...prev,
            [stage]: {
              stage,
              model: String(payload.model ?? ''),
              status: eventName === 'model_stage_failed' ? 'failed' : 'success',
              detail:
                eventName === 'model_stage_failed'
                  ? String(payload.error ?? '阶段失败')
                  : payload.fallback_used
                    ? '阶段已通过回退模型完成。'
                    : '阶段已完成。',
              durationMs: Number(payload.duration_ms ?? 0),
              error: typeof payload.error === 'string' ? payload.error : null,
              updatedAt: String(data?.created_at ?? ''),
            },
          }));
        }
      }

      if (eventPayload && Object.prototype.hasOwnProperty.call(eventPayload, 'group_id')) {
        setActivityTimeline((prev) =>
          mergeActivityTimelineEvent(
            prev,
            eventName,
            eventPayload as Record<string, unknown>,
            typeof data?.created_at === 'string' ? data.created_at : null,
            data?.id != null ? String(data.id) : null,
          ),
        );
      }

      if (eventName && eventName !== 'heartbeat') {
        await refreshRun();
      }
      if (eventName === 'done' || isTerminalResearchStatus(data?.status)) {
        controller.abort();
      }
    };

    const startSse = async () => {
      try {
        const response = await fetch(`${api.baseUrl}/api/research-runs/${activeRunId}/events`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error('SSE unavailable');

        const reader = response.body.getReader();
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let splitAt = buffer.indexOf('\n\n');
          while (splitAt >= 0) {
            const block = buffer.slice(0, splitAt);
            buffer = buffer.slice(splitAt + 2);
            if (block.trim()) {
              await parseEventBlock(block);
            }
            splitAt = buffer.indexOf('\n\n');
          }
        }
      } catch {
        if (!cancelled && !usingPollingFallback) {
          usingPollingFallback = true;
          tick();
        }
      }
    };

    (async () => {
      try {
        const row = await refreshRun();
        if (!row || cancelled) return;
        if (row.status === 'awaiting_confirmation' && row.phase === 'plan_review') {
          return;
        }
        await startSse();
      } catch {
        if (!cancelled) tick();
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [token, activeRunId, activeThreadId, refreshMessages, runWatchNonce]);

  useEffect(() => {
    if (!activeRun) {
      setPlanGoal('');
      setPlanSteps([]);
      setPlanDirty(false);
      setWhitelistInput('');
      setWebEnabled(true);
      setActivityTimeline([]);
      return;
    }
    const normalized = normalizeEditablePlan(activeRun.plan, activeRun.question);
    setPlanGoal(normalized.goal);
    setPlanSteps(normalized.steps);
    setPlanDirty(false);
    setWhitelistInput((activeRun.source_policy?.site_whitelist ?? []).join(', '));
    setWebEnabled(Boolean(activeRun.source_policy?.web_enabled ?? true));
    setActivityTimeline((prev) => mergeActivityTimelineSnapshot(prev, activeRun.activity_timeline));
  }, [activeRun]);

  async function handleCreateThread(nextMode: ComposerMode) {
    if (!token) {
      setError('请先前往账户页登录后再创建会话。');
      return;
    }
    try {
      setBusy(true);
      const row = await api.createThread(
        {
          title: `新会话 ${new Date().toLocaleTimeString()}`,
          default_retrieval_scope: retrievalScope,
        },
        token,
      );
      setThreads((prev) => [row, ...prev]);
      setActiveThreadId(row.id);
      setMessages([]);
      setUploads([]);
      setSelectedAttachments({});
      setActiveRunId(null);
      setActiveRun(null);
      setComposerMode(nextMode);
      setComposerModeByThread((prev) => ({ ...prev, [row.id]: nextMode }));
      if (isNarrowViewport()) {
        setSidebarOpen(false);
      }
    } catch (err: any) {
      setError(err.message || '创建会话失败');
    } finally {
      setBusy(false);
    }
  }

  function handleSelectThread(threadId: string) {
    startTransition(() => {
      setActiveThreadId(threadId);
      setSelectedAttachments({});
      setActiveRunId(runIdByThread[threadId] ?? null);
      setActiveRun(null);
      if (isNarrowViewport()) {
        setSidebarOpen(false);
      }
    });
  }

  function handleComposerModeChange(nextMode: ComposerMode) {
    setComposerMode(nextMode);
    if (activeThreadId) {
      setComposerModeByThread((prev) => ({ ...prev, [activeThreadId]: nextMode }));
    }
  }

  function handleWorkspaceViewChange(nextView: 'workspace' | 'reader') {
    manualViewOverrideRef.current = true;
    setWorkspaceView(nextView);
  }

  function toggleAttachment(upload: UploadItem) {
    const candidate = inferAttachment(upload);
    if (!candidate) return;
    setSelectedAttachments((prev) => {
      if (prev[upload.id]) {
        const next = { ...prev };
        delete next[upload.id];
        return next;
      }
      return { ...prev, [upload.id]: candidate };
    });
  }

  async function handleUpload(file: File) {
    if (!token || !activeThreadId) return;
    try {
      setBusy(true);
      const row = await api.uploadFile(activeThreadId, file, token);
      setUploads((prev) => [row, ...prev]);
      const candidate = inferAttachment(row);
      if (candidate) {
        setSelectedAttachments((prev) => ({ ...prev, [row.id]: candidate }));
      }
    } catch (err: any) {
      setError(err.message || '上传失败');
    } finally {
      setBusy(false);
    }
  }

  async function submitUpload(uploadId: string) {
    if (!token) return;
    try {
      const row = await api.submitUpload(uploadId, token, '用户申请写入基础知识库');
      setUploads((prev) => prev.map((item) => (item.id === uploadId ? row : item)));
    } catch (err: any) {
      setError(err.message || '提交审核失败');
    }
  }

  async function deleteUpload(uploadId: string) {
    if (!token) return;
    try {
      await api.deleteUpload(uploadId, token);
      setUploads((prev) => prev.filter((item) => item.id !== uploadId));
      setSelectedAttachments((prev) => {
        const next = { ...prev };
        delete next[uploadId];
        return next;
      });
    } catch (err: any) {
      setError(err.message || '删除失败');
    }
  }

  async function runAsk() {
    if (!token || !activeThreadId) {
      setError('请先登录并创建会话。');
      return;
    }
    const prompt = question.trim();
    if (!prompt) return;
    if (!backendReady) {
      setError('后端正在启动，请稍后再试。');
      return;
    }

    try {
      setError('');
      setBusy(true);
      await api.askThread(
        activeThreadId,
        {
          message: prompt,
          retrieval_enabled: retrievalEnabled,
          deep_research_enabled: false,
          retrieval_scope: retrievalScope,
          history: recentConversation(messages),
          attachments: attachmentList,
        },
        token,
      );
      setQuestion('');
      await refreshMessages(token, activeThreadId);
    } catch (err: any) {
      setError(err.message || '问答失败');
    } finally {
      setBusy(false);
    }
  }

  async function runResearch() {
    if (!token || !activeThreadId) {
      setError('请先登录并创建会话。');
      return;
    }
    const prompt = question.trim();
    if (!prompt) return;
    if (!backendReady) {
      setError('后端正在启动，请稍后再试。');
      return;
    }

    try {
      setError('');
      setBusy(true);
      if (activeRun && !isTerminalResearchStatus(activeRun.status)) {
        let nextRun: ResearchRun;
        if (activeRun.status === 'awaiting_confirmation' && activeRun.phase === 'round_review') {
          nextRun = await api.advanceResearchRun(activeRun.id, { action: 'revise', instructions: prompt }, token);
          setRunWatchNonce((prev) => prev + 1);
        } else {
          nextRun = await api.clarifyResearchRun(activeRun.id, { note: prompt }, token);
        }
        setActiveRun(nextRun);
        setQuestion('');
        return;
      }

      const created = await api.createResearchRun(
        activeThreadId,
        {
          question: prompt,
          retrieval_scope: retrievalScope,
          execution_mode: 'auto',
          history: recentConversation(messages),
          attachments: attachmentList,
        },
        token,
      );
      const run = await api.getResearchRun(created.run_id, token);
      setActiveRunId(created.run_id);
      setActiveRun(run);
      setRunIdByThread((prev) => ({ ...prev, [activeThreadId]: created.run_id }));
      setQuestion('');
      await refreshMessages(token, activeThreadId);
    } catch (err: any) {
      setError(err.message || '创建研究任务失败');
    } finally {
      setBusy(false);
    }
  }

  function toPlanPayload() {
    if (!activeRun) return null;
    const cleanedSteps = planSteps.map((item) => item.trim()).filter((item) => item.length > 0);
    const basePlan = activeRun.plan || {
      output_format: 'markdown_report_with_citations',
      evidence_strategy: [],
    };
    return {
      ...basePlan,
      goal: planGoal.trim() || activeRun.question,
      retrieval_scope: activeRun.retrieval_scope,
      steps: cleanedSteps.map((title, index) => ({
        id: `step_${index + 1}`,
        title,
      })),
    };
  }

  async function persistPlan() {
    if (!token || !activeRunId) return false;
    const payload = toPlanPayload();
    if (!payload) return false;
    try {
      setPlanBusy(true);
      const run = await api.updateResearchRunPlan(activeRunId, { plan: payload }, token);
      setActiveRun(run);
      setPlanDirty(false);
      return true;
    } catch (err: any) {
      setError(err.message || '保存计划失败');
      return false;
    } finally {
      setPlanBusy(false);
    }
  }

  async function handleConfirmPlan() {
    if (!token || !activeRunId) return;
    try {
      setPlanBusy(true);
      if (planDirty) {
        const ok = await persistPlan();
        if (!ok) return;
      }
      const run = await api.confirmResearchRunPlan(
        activeRunId,
        {
          execution_mode: 'auto',
          site_whitelist: parseWhitelistInput(whitelistInput),
        },
        token,
      );
      setActiveRun(run);
      setRunWatchNonce((prev) => prev + 1);
    } catch (err: any) {
      setError(err.message || '确认计划失败');
    } finally {
      setPlanBusy(false);
    }
  }

  async function handleClarifySubmit(responses: string[]) {
    if (!token || !activeRunId) return;
    try {
      setPlanBusy(true);
      const run = await api.clarifyResearchRun(activeRunId, { responses }, token);
      setActiveRun(run);
    } catch (err: any) {
      setError(err.message || '提交澄清失败');
    } finally {
      setPlanBusy(false);
    }
  }

  async function handleInterrupt() {
    if (!token || !activeRunId) return;
    try {
      setPlanBusy(true);
      const run = await api.interruptResearchRun(activeRunId, { reason: question.trim() || undefined }, token);
      setActiveRun(run);
      setRunWatchNonce((prev) => prev + 1);
      setQuestion('');
    } catch (err: any) {
      setError(err.message || '停止研究失败');
    } finally {
      setPlanBusy(false);
    }
  }

  async function handleSaveSourcePolicy() {
    if (!token || !activeRunId) return;
    try {
      setSourcePolicyBusy(true);
      const run = await api.updateResearchRunSourcePolicy(
        activeRunId,
        {
          site_whitelist: parseWhitelistInput(whitelistInput),
          web_enabled: webEnabled,
        },
        token,
      );
      setActiveRun(run);
      setSourceDrawerOpen(false);
    } catch (err: any) {
      setError(err.message || '保存来源策略失败');
    } finally {
      setSourcePolicyBusy(false);
    }
  }

  async function handleSubmitComposer() {
    if (composerMode === 'ask') {
      await runAsk();
      return;
    }
    await runResearch();
  }

  const sourceCount = activeRun?.source_board?.length ?? 0;
  const detailHref =
    activeRun && activeThreadId
      ? `/research/${activeRun.id}?threadId=${encodeURIComponent(activeThreadId)}&runId=${encodeURIComponent(activeRun.id)}&view=${workspaceView}`
      : null;
  const reportNode = activeRun?.final_report ? (
    <ReportReader
      title={activeRun.question}
      content={activeRun.final_report}
      transitionName='report-preview-card'
    />
  ) : null;
  const progressNode = activeRun ? (
    <ProgressStrip
      status={typeof progressSummary?.status === 'string' ? progressSummary.status : activeRun.status}
      phase={typeof progressSummary?.phase === 'string' ? progressSummary.phase : activeRun.phase}
      currentRound={typeof progressSummary?.current_round === 'number' ? progressSummary.current_round : activeRun.current_round}
      maxRounds={typeof progressSummary?.max_rounds === 'number' ? progressSummary.max_rounds : activeRun.max_rounds}
      headline={typeof progressSummary?.headline === 'string' ? progressSummary.headline : activeRun.stop_recommendation ?? null}
      reportPhase={typeof progressSummary?.report_phase === 'string' ? progressSummary.report_phase : null}
      sectionCount={typeof progressSummary?.section_count === 'number' ? progressSummary.section_count : 0}
      completedSectionCount={
        typeof progressSummary?.completed_section_count === 'number' ? progressSummary.completed_section_count : 0
      }
      currentSectionTitle={typeof progressSummary?.current_section_title === 'string' ? progressSummary.current_section_title : null}
      stages={stageStatusRows}
    />
  ) : null;
  const planNode = activeRun ? (
    <PlanCard
      awaitingPlanReview={awaitingPlanReview}
      clarificationQuestions={activeRun.clarification_questions}
      planGoal={planGoal}
      planSteps={planSteps}
      planDirty={planDirty}
      busy={planBusy}
      onGoalChange={(value) => {
        setPlanGoal(value);
        setPlanDirty(true);
      }}
      onStepChange={(index, value) => {
        setPlanSteps((prev) => prev.map((item, itemIndex) => (itemIndex === index ? value : item)));
        setPlanDirty(true);
      }}
      onRemoveStep={(index) => {
        setPlanSteps((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
        setPlanDirty(true);
      }}
      onAddStep={() => {
        setPlanSteps((prev) => [...prev, '']);
        setPlanDirty(true);
      }}
      onSavePlan={persistPlan}
      onConfirmPlan={handleConfirmPlan}
      onClarifySubmit={handleClarifySubmit}
    />
  ) : null;

  return (
    <main className='min-h-screen p-2 md:p-3'>
      <div className='flex items-start gap-3'>
        <HomeSidebar
          sidebarOpen={sidebarOpen}
          threadSearch={threadSearch}
          filteredThreads={filteredThreads}
          activeThreadId={activeThreadId}
          canCreate={Boolean(token)}
          isAdmin={isAdmin}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
          onSearchChange={setThreadSearch}
          onSelectThread={handleSelectThread}
          onCreateResearch={() => handleCreateThread('research')}
          onCreateThread={() => handleCreateThread('ask')}
        />

        <section className='flex min-h-[calc(100vh-1rem)] min-w-0 flex-1 flex-col'>
          <div className='panel flex min-h-[calc(100vh-1rem)] flex-col p-3 md:p-4'>
            <header className='rounded-[2rem] border border-crimson-100 bg-white p-4'>
              <div className='flex flex-wrap items-start justify-between gap-4'>
                <div className='min-w-0'>
                  <p className='text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700'>研究工作台</p>
                  <h2 className='mt-1 truncate text-2xl font-semibold text-zinc-900'>{activeRun?.question ?? activeThread?.title ?? '党史 Deep Research'}</h2>
                  <p className='mt-2 text-sm text-zinc-500'>
                    {activeRun
                      ? `状态 ${activeRun.status} · 阶段 ${activeRun.phase} · 轮次 ${activeRun.current_round}/${activeRun.max_rounds}`
                      : token
                        ? '选择会话后即可发起普通问答或深度研究。'
                        : '请先前往账户页登录，再创建研究会话。'}
                  </p>
                </div>

                <div className='flex flex-wrap items-center gap-2'>
                  <button className='btn-outline px-3 py-2 text-xs' onClick={() => setSourceDrawerOpen(true)}>
                    <Link2 className='mr-1 h-4 w-4' /> 来源 {sourceCount > 0 ? `(${sourceCount})` : ''}
                  </button>
                  {activeRun && detailHref ? (
                    <TransitionLink className='btn-outline px-3 py-2 text-xs' href={detailHref} direction='forward'>
                      <FileText className='mr-1 h-4 w-4' /> 详情页
                    </TransitionLink>
                  ) : null}
                  {activeRun && !isTerminalResearchStatus(activeRun.status) ? (
                    <button className='btn-primary px-3 py-2 text-xs' onClick={handleInterrupt} disabled={planBusy}>
                      <Square className='mr-1 h-4 w-4' /> 停止并收敛
                    </button>
                  ) : null}
                  {activeRun && awaitingPlanReview && activeRun.clarification_questions.length === 0 ? (
                    <button className='btn-primary px-3 py-2 text-xs' onClick={handleConfirmPlan} disabled={planBusy}>
                      <Play className='mr-1 h-4 w-4' /> 确认计划
                    </button>
                  ) : null}
                </div>
              </div>

              {error ? <p className='mt-3 text-sm text-red-600'>{error}</p> : null}
              {!backendReady ? (
                <p className='mt-3 inline-flex items-center gap-2 text-sm text-zinc-500'>
                  <LoaderCircle className='h-4 w-4 animate-spin' /> 后端连接中，请稍候…
                </p>
              ) : null}
            </header>

            <div className='mt-4 flex-1 overflow-y-auto pr-1'>
              {!token ? (
                <div className='rounded-[2rem] border border-crimson-100 bg-white p-6 text-sm text-zinc-600'>
                  首页已切换为内容优先研究工作区。登录、注册和个人资料入口已经迁移到
                  <TransitionLink href='/profile' className='mx-1 text-crimson-700 underline' direction='forward'>
                    /profile
                  </TransitionLink>
                  。
                </div>
              ) : null}

              {uploads.length > 0 ? (
                <div className='mb-4 rounded-[2rem] border border-crimson-100 bg-white p-4'>
                  <p className='text-xs font-semibold uppercase tracking-[0.18em] text-crimson-700'>当前线程资料</p>
                  <div className='mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
                    {uploads.map((item) => {
                      const selected = Boolean(selectedAttachments[item.id]);
                      const attachable = inferAttachment(item);
                      return (
                        <article key={item.id} className='rounded-2xl border border-crimson-100 bg-crimson-50/30 p-3 text-sm'>
                          <p className='font-semibold text-zinc-900'>{item.original_filename}</p>
                          <p className='mt-1 text-xs text-zinc-500'>状态：{item.status}</p>
                          <div className='mt-3 flex flex-wrap gap-2'>
                            {attachable ? (
                              <button className='btn-outline px-3 py-2 text-xs' onClick={() => toggleAttachment(item)}>
                                {selected ? '取消引用' : '引用到当前提问'}
                              </button>
                            ) : null}
                            {item.status === 'draft' ? (
                              <>
                                <button className='btn-outline px-3 py-2 text-xs' onClick={() => submitUpload(item.id)}>
                                  提交审核
                                </button>
                                <button className='btn-outline px-3 py-2 text-xs' onClick={() => deleteUpload(item.id)}>
                                  删除
                                </button>
                              </>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <CitationPreviewProvider token={token}>
                <ResearchTimeline
                  messages={messages}
                  activeRun={activeRun}
                  activityTimeline={activityTimeline}
                  artifacts={activeRun?.artifacts ?? []}
                  planNode={planNode}
                  progressNode={progressNode}
                  reportNode={reportNode}
                  workspaceView={workspaceView}
                  busy={busy}
                  onEnterReader={() => handleWorkspaceViewChange('reader')}
                  onExitReader={() => handleWorkspaceViewChange('workspace')}
                />
              </CitationPreviewProvider>
            </div>

            <ResearchComposer
              value={question}
              composerMode={composerMode}
              retrievalEnabled={retrievalEnabled}
              retrievalScope={retrievalScope}
              attachmentCount={attachmentList.length}
              busy={busy}
              backendReady={backendReady}
              canUseUploads={canUseUploads}
              canUpload={Boolean(token && activeThreadId)}
              submitLabel={
                currentRunAction === 'clarify'
                  ? '补充澄清'
                  : currentRunAction === 'review_round'
                    ? '追加研究指令'
                    : activeRun && !isTerminalResearchStatus(activeRun.status)
                      ? '追加说明'
                      : undefined
              }
              onChangeValue={setQuestion}
              onChangeMode={handleComposerModeChange}
              onChangeRetrievalEnabled={setRetrievalEnabled}
              onChangeRetrievalScope={setRetrievalScope}
              onUpload={handleUpload}
              onSubmit={handleSubmitComposer}
            />
          </div>
        </section>
      </div>

      <SourceDrawer
        open={sourceDrawerOpen}
        sources={activeRun?.source_board ?? []}
        sourcePolicy={activeRun?.source_policy ?? null}
        whitelistInput={whitelistInput}
        sourcePolicyBusy={sourcePolicyBusy}
        onClose={() => setSourceDrawerOpen(false)}
        onWhitelistChange={setWhitelistInput}
        onToggleWebEnabled={setWebEnabled}
        onSaveSourcePolicy={handleSaveSourcePolicy}
      />
    </main>
  );
}
