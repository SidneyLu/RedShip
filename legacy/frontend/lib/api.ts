export type UserRole = 'guest' | 'user' | 'admin';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  is_super_admin?: boolean;
  is_active?: boolean;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  is_super_admin: boolean;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
}

export interface UploadItem {
  id: string;
  owner_id: string;
  owner_email?: string | null;
  session_id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected';
  review_reason?: string | null;
  is_deleted: boolean;
  created_at: string;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  deleted_at?: string | null;
  extracted_text?: string | null;
}

export interface Citation {
  source_domain: 'base' | 'upload' | 'web';
  title: string;
  location?: string | null;
  excerpt?: string | null;
  score?: number | null;
}

export interface CitationItem {
  citation_id: string;
  url?: string | null;
  title: string;
  domain?: string | null;
  source_type: 'base' | 'upload' | 'web';
  published_at?: string | null;
  location?: string | null;
  excerpt?: string | null;
  trust_score: number;
  evidence_hash: string;
  score?: number | null;
  preview_ref?: CitationPreviewRef | null;
}

export interface CitationPreviewRef {
  source_kind: 'upload' | 'base' | 'web';
  document_id?: string | null;
  session_id?: string | null;
  source_path?: string | null;
  chunk_index?: number | null;
  page_hint?: number | null;
  highlight_text?: string | null;
  previewable: boolean;
}

export interface CitationPreviewCard {
  citation_id: string;
  title: string;
  subtitle?: string | null;
  locator_label?: string | null;
  excerpt?: string | null;
  score?: number | null;
  trust_score: number;
  href: string;
  external_url?: string | null;
  previewable: boolean;
}

export interface CitationPreviewPage {
  citation_id: string;
  title: string;
  subtitle?: string | null;
  locator_label?: string | null;
  excerpt?: string | null;
  content?: string | null;
  highlight_text?: string | null;
  score?: number | null;
  trust_score: number;
  preview_mode: 'text' | 'pdf' | 'image' | 'web';
  page_hint?: number | null;
  external_url?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ParagraphCitation {
  paragraph_index: number;
  sentence_index: number;
  citation_ids: string[];
}

export interface ReportImage {
  id: string;
  caption: string;
  source_type: 'base' | 'upload' | 'web';
  citation_id?: string | null;
  url?: string | null;
  local_url?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface ResearchPlanStep {
  id: string;
  title: string;
  description?: string;
}

export interface ResearchPlan {
  goal: string;
  retrieval_scope: 'base' | 'upload' | 'hybrid' | string;
  output_format?: string;
  evidence_strategy?: string[];
  steps: ResearchPlanStep[];
  [key: string]: unknown;
}

export interface SourceJournalItem {
  id: string;
  round: number;
  source_type: 'base' | 'upload' | 'web';
  title: string;
  domain?: string | null;
  url?: string | null;
  location?: string | null;
  excerpt?: string | null;
  status: 'candidate' | 'adopted' | 'rejected';
  reason?: string | null;
  trust_level?: 'high' | 'medium' | 'low' | null;
  created_at?: string | null;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  rationale?: string | null;
  required: boolean;
}

export interface ResearchTaskNode {
  id: string;
  parent_id?: string | null;
  title: string;
  stage: string;
  status: string;
  priority: number;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ResearchSourceRecord {
  id: string;
  task_id?: string | null;
  source_type: 'base' | 'upload' | 'web';
  title: string;
  domain?: string | null;
  url?: string | null;
  location?: string | null;
  excerpt?: string | null;
  status: 'candidate' | 'adopted' | 'rejected';
  reject_reason?: string | null;
  trust_level?: 'high' | 'medium' | 'low' | null;
  confidence?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface ResearchArtifactRecord {
  id: string;
  artifact_type: string;
  title: string;
  section?: string | null;
  status: string;
  content?: string | null;
  payload?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface BrowserSnapshotArtifactPayload {
  artifact_key?: string | null;
  snapshot_data_url?: string | null;
  page_url?: string | null;
  page_title?: string | null;
  domain?: string | null;
  excerpt?: string | null;
  hop?: number | null;
  action?: string | null;
  captured_at?: string | null;
  seed_url?: string | null;
  parent_url?: string | null;
  reason?: string | null;
  decision?: string | null;
  round?: number | null;
}

export interface BrowserTraceArtifactPayload {
  artifact_key?: string | null;
  visited_pages?: BrowserSnapshotArtifactPayload[];
  kept_pages?: BrowserSnapshotArtifactPayload[];
  rejected_pages?: BrowserSnapshotArtifactPayload[];
  termination_reason?: string | null;
  budget_used?: number | null;
  round?: number | null;
}

export interface ActivityTimelineChip {
  label: string;
  kind: 'query' | 'domain' | 'artifact';
  state: string;
  url?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ActivityTimelineEvent {
  id: string;
  event_type: string;
  label: string;
  summary?: string | null;
  status: string;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ActivityTimelineNode {
  id: string;
  group_id: string;
  node_type: 'intent' | 'retrieval' | 'decision' | 'generation' | string;
  title: string;
  summary?: string | null;
  status: string;
  round?: number | null;
  reason?: string | null;
  queries: ActivityTimelineChip[];
  domains: ActivityTimelineChip[];
  artifacts: ActivityTimelineChip[];
  event_log: ActivityTimelineEvent[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface PendingUserAction {
  type: 'clarify' | 'confirm_plan' | 'review_round' | 'running' | string;
  title: string;
  description?: string | null;
}

export interface SourcePolicy {
  retrieval_scope: string;
  web_enabled: boolean;
  site_whitelist: string[];
  include_base_corpus: boolean;
  include_uploads: boolean;
}

export interface AttachmentInput {
  upload_id: string;
  media_type: 'image' | 'pdf_page';
  page?: number;
}

export interface VisualizationChart {
  type: 'bar' | 'line' | 'scatter' | 'area';
  title: string;
  x_key: string;
  y_key: string;
  series_key?: string | null;
}

export interface VisualizationSpec {
  engine: 'd3';
  spec_version: 'v1';
  chart: VisualizationChart;
  data: Record<string, unknown>[];
  insights: string[];
}

export interface ModelStageTrace {
  stage: string;
  model: string;
  fallback_used: boolean;
  retry_count: number;
  duration_ms: number;
  status: 'success' | 'failed';
  error?: string | null;
}

export interface ResponseMeta {
  model: string | null;
  route_reason?: 'attachment' | 'deep_research' | 'default_text' | null;
  modalities_used: string[];
  history_turns_used: number;
  retrieval_scope: string;
  retrieval_debug?: Record<string, unknown> | null;
  model_trace?: ModelStageTrace[];
}

export interface ChatResponse {
  mode: string;
  answer: string;
  citations: Citation[];
  visualization?: VisualizationSpec | null;
  meta: ResponseMeta;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ResearchSession {
  id: string;
  question: string;
  retrieval_enabled: boolean;
  deep_research_enabled: boolean;
  retrieval_scope: string;
  status: string;
  plan?: Record<string, unknown> | null;
  result?: string | null;
  visualization?: VisualizationSpec | null;
  meta: ResponseMeta;
  created_at: string;
  updated_at: string;
}

export interface ThreadItem {
  id: string;
  title: string;
  default_retrieval_scope: 'base' | 'upload' | 'hybrid' | string;
  archived: boolean;
  latest_message_preview?: string | null;
  latest_message_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ThreadMessage {
  id: string;
  thread_id: string;
  role: 'system' | 'user' | 'assistant';
  message_type: 'chat' | 'research_report' | 'system';
  content: string;
  citations: CitationItem[];
  paragraph_citations: ParagraphCitation[];
  confidence?: number | null;
  refusal_reason?: string | null;
  research_run_id?: string | null;
  artifacts?: {
    visualizations_count: number;
    images_count: number;
  } | null;
  created_at: string;
}

export interface AskThreadResponse {
  answer: string;
  citations: CitationItem[];
  paragraph_citations: ParagraphCitation[];
  confidence: number;
  refusal_reason?: string | null;
  mode: string;
  meta: ResponseMeta;
  thread_message_id: string;
}

export interface ResearchRun {
  id: string;
  thread_id: string;
  question: string;
  report_message_id?: string | null;
  retrieval_scope: 'base' | 'upload' | 'hybrid' | string;
  execution_mode: 'auto' | 'manual';
  active_task: boolean;
  phase: 'plan_review' | 'round_review' | 'round_running' | 'finalizing';
  current_round: number;
  max_rounds: number;
  status:
    | 'planning'
    | 'awaiting_confirmation'
    | 'queued'
    | 'running'
    | 'verifying'
    | 'visualizing'
    | 'completed'
    | 'failed'
    | 'refused';
  plan?: ResearchPlan | null;
  round_journal: Record<string, unknown>[];
  source_journal: SourceJournalItem[];
  round_card?: Record<string, unknown> | null;
  site_whitelist: string[];
  quality_gate?: Record<string, unknown> | null;
  stop_recommendation?: string | null;
  draft?: string | null;
  final_report?: string | null;
  visualizations: VisualizationSpec[];
  embedded_images: ReportImage[];
  verification_report?: (Record<string, unknown> & { model_trace?: ModelStageTrace[] }) | null;
  refusal_reason?: string | null;
  citations: CitationItem[];
  paragraph_citations: ParagraphCitation[];
  clarification_questions: ClarificationQuestion[];
  plan_summary?: Record<string, unknown> | null;
  task_tree: ResearchTaskNode[];
  progress_summary?: Record<string, unknown> | null;
  source_board: ResearchSourceRecord[];
  artifacts: ResearchArtifactRecord[];
  activity_timeline: ActivityTimelineNode[];
  view_recommendation: 'workspace' | 'reader';
  pending_user_action?: PendingUserAction | null;
  source_policy?: SourcePolicy | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface DocumentChangeRequest {
  id: number;
  document_id: string;
  requester_id: string | null;
  requester_email?: string | null;
  proposed_filename: string | null;
  proposed_extracted_text: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | string;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005';

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const doFetch = () =>
    fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
    });

  const method = (init.method ?? 'GET').toUpperCase();
  const allowRetry = method === 'GET' || method === 'HEAD';

  let response: Response;
  try {
    response = await doFetch();
  } catch (firstError) {
    if (!allowRetry) {
      throw firstError;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    response = await doFetch();
  }

  if (!response.ok && response.status >= 500 && allowRetry) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    response = await doFetch();
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const json = await response.json();
      detail =
        json.error?.message ??
        json.detail ??
        (typeof json.message === 'string' ? json.message : JSON.stringify(json));
    } catch {}
    throw new Error(detail);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

export const api = {
  baseUrl: BASE_URL,

  health: () => request<{ status: string; app: string }>('/api/health'),

  sendCode: (email: string, password: string) =>
    request<{ message: string }>('/api/auth/register/send-code', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  verifyCode: (email: string, code: string) =>
    request<AuthResponse>('/api/auth/register/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: (token?: string) => request<{ message: string }>('/api/auth/logout', { method: 'POST' }, token),

  getMe: (token: string) => request<UserProfile>('/api/auth/me', {}, token),

  chat: (
    payload: {
      message: string;
      session_id?: string;
      retrieval_enabled: boolean;
      deep_research_enabled: boolean;
      retrieval_scope: 'base' | 'upload' | 'hybrid';
      history?: ConversationMessage[];
      attachments?: AttachmentInput[];
    },
    token?: string,
  ) => request<ChatResponse>('/api/chat', { method: 'POST', body: JSON.stringify(payload) }, token),

  createResearchSession: (
    payload: {
      question: string;
      session_id?: string;
      retrieval_enabled: boolean;
      deep_research_enabled: boolean;
      retrieval_scope: 'base' | 'upload' | 'hybrid';
      history?: ConversationMessage[];
      attachments?: AttachmentInput[];
    },
    token?: string,
  ) => request<ResearchSession>('/api/research/sessions', { method: 'POST', body: JSON.stringify(payload) }, token),

  getResearchSession: (id: string, token?: string) => request<ResearchSession>(`/api/research/sessions/${id}`, {}, token),

  createThread: (
    payload: {
      title?: string | null;
      default_retrieval_scope: 'base' | 'upload' | 'hybrid';
    },
    token: string,
  ) => request<ThreadItem>('/api/threads', { method: 'POST', body: JSON.stringify(payload) }, token),

  listThreads: (token: string, params?: { limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<ThreadItem[]>(`/api/threads${suffix}`, {}, token);
  },

  patchThread: (
    threadId: string,
    payload: {
      title?: string | null;
      archived?: boolean | null;
    },
    token: string,
  ) => request<ThreadItem>(`/api/threads/${threadId}`, { method: 'PATCH', body: JSON.stringify(payload) }, token),

  listThreadMessages: (threadId: string, token: string, params?: { limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<ThreadMessage[]>(`/api/threads/${threadId}/messages${suffix}`, {}, token);
  },

  askThread: (
    threadId: string,
    payload: {
      message: string;
      retrieval_enabled: boolean;
      deep_research_enabled: boolean;
      retrieval_scope: 'base' | 'upload' | 'hybrid';
      history?: ConversationMessage[];
      attachments?: AttachmentInput[];
    },
    token: string,
  ) => request<AskThreadResponse>(`/api/threads/${threadId}/ask`, { method: 'POST', body: JSON.stringify(payload) }, token),

  createResearchRun: (
    threadId: string,
    payload: {
      question: string;
      retrieval_scope: 'base' | 'upload' | 'hybrid';
      execution_mode?: 'auto' | 'manual';
      history?: ConversationMessage[];
      attachments?: AttachmentInput[];
    },
    token: string,
  ) =>
    request<{ run_id: string }>(
      `/api/threads/${threadId}/research-runs`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  getResearchRun: (runId: string, token: string) => request<ResearchRun>(`/api/research-runs/${runId}`, {}, token),

  updateResearchRunPlan: (runId: string, payload: { plan: ResearchPlan }, token: string) =>
    request<ResearchRun>(`/api/research-runs/${runId}/plan`, { method: 'PATCH', body: JSON.stringify(payload) }, token),

  clarifyResearchRun: (
    runId: string,
    payload: {
      responses?: string[];
      note?: string | null;
    },
    token: string,
  ) => request<ResearchRun>(`/api/research-runs/${runId}/clarify`, { method: 'POST', body: JSON.stringify(payload) }, token),

  confirmResearchRunPlan: (
    runId: string,
    payload: {
      execution_mode?: 'auto' | 'manual';
      instructions?: string | null;
      site_whitelist?: string[] | null;
    },
    token: string,
  ) => request<ResearchRun>(`/api/research-runs/${runId}/confirm-plan`, { method: 'POST', body: JSON.stringify(payload) }, token),

  advanceResearchRun: (
    runId: string,
    payload: {
      action: 'continue' | 'revise' | 'stop';
      instructions?: string;
      site_whitelist?: string[];
      execution_mode?: 'auto' | 'manual';
    },
    token: string,
  ) => request<ResearchRun>(`/api/research-runs/${runId}/advance`, { method: 'POST', body: JSON.stringify(payload) }, token),

  setResearchRunExecutionMode: (runId: string, execution_mode: 'auto' | 'manual', token: string) =>
    request<ResearchRun>(
      `/api/research-runs/${runId}/execution-mode`,
      { method: 'POST', body: JSON.stringify({ execution_mode }) },
      token,
    ),

  interruptResearchRun: (runId: string, payload: { reason?: string | null }, token: string) =>
    request<ResearchRun>(`/api/research-runs/${runId}/interrupt`, { method: 'POST', body: JSON.stringify(payload) }, token),

  updateResearchRunSourcePolicy: (
    runId: string,
    payload: {
      site_whitelist: string[];
      web_enabled: boolean;
    },
    token: string,
  ) =>
    request<ResearchRun>(
      `/api/research-runs/${runId}/source-policy`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  executeResearchRun: (runId: string, token: string) =>
    request<ResearchRun>(`/api/research-runs/${runId}/execute`, { method: 'POST' }, token),

  getResearchRunCitationPreview: (
    runId: string,
    citationId: string,
    detail: 'card' | 'page',
    token: string,
  ) =>
    request<CitationPreviewCard | CitationPreviewPage>(
      `/api/research-runs/${runId}/citations/${citationId}/preview?detail=${detail}`,
      {},
      token,
    ),

  getThreadMessageCitationPreview: (
    threadId: string,
    messageId: string,
    citationId: string,
    detail: 'card' | 'page',
    token: string,
  ) =>
    request<CitationPreviewCard | CitationPreviewPage>(
      `/api/threads/${threadId}/messages/${messageId}/citations/${citationId}/preview?detail=${detail}`,
      {},
      token,
    ),

  uploadFile: (sessionId: string, file: File, token: string) => {
    const form = new FormData();
    form.set('session_id', sessionId);
    form.set('file', file);
    return request<UploadItem>('/api/uploads', { method: 'POST', body: form }, token);
  },

  listUploads: (sessionId: string, token: string) => request<UploadItem[]>(`/api/uploads/${sessionId}`, {}, token),

  submitUpload: (uploadId: string, token: string, note?: string) =>
    request<UploadItem>(
      `/api/uploads/${uploadId}/submit`,
      { method: 'POST', body: JSON.stringify({ note: note ?? null }) },
      token,
    ),

  deleteUpload: (uploadId: string, token: string) => request<{ message: string }>(`/api/uploads/${uploadId}`, { method: 'DELETE' }, token),

  listMyDocuments: (token: string) => request<UploadItem[]>('/api/documents/me', {}, token),

  listMyDocumentChangeRequests: (token: string) =>
    request<DocumentChangeRequest[]>('/api/documents/me/change-requests', {}, token),

  createDocumentChangeRequest: (
    documentId: string,
    token: string,
    payload: {
      proposed_filename?: string | null;
      proposed_extracted_text?: string | null;
      reason?: string | null;
    },
  ) =>
    request<DocumentChangeRequest>(
      `/api/documents/${documentId}/change-requests`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  listAdminUsers: (token: string) => request<User[]>('/api/admin/users', {}, token),

  updateAdminUserRole: (userId: string, role: 'user' | 'admin', token: string) =>
    request<User>(`/api/admin/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }, token),

  updateAdminUserStatus: (userId: string, is_active: boolean, token: string) =>
    request<User>(`/api/admin/users/${userId}/status`, { method: 'PATCH', body: JSON.stringify({ is_active }) }, token),

  listAdminDocuments: (token: string, params?: { status?: string; owner_id?: string; include_deleted?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.owner_id) query.set('owner_id', params.owner_id);
    if (params?.include_deleted) query.set('include_deleted', 'true');
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<UploadItem[]>(`/api/admin/documents${suffix}`, {}, token);
  },

  getAdminDocument: (id: string, token: string) => request<UploadItem>(`/api/admin/documents/${id}`, {}, token),

  softDeleteAdminDocument: (id: string, token: string) =>
    request<{ message: string }>(`/api/admin/documents/${id}`, { method: 'DELETE' }, token),

  listAdminDocumentChangeRequests: (token: string, status?: string) => {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
    return request<DocumentChangeRequest[]>(`/api/admin/document-change-requests${suffix}`, {}, token);
  },

  approveAdminDocumentChange: (id: number, token: string, review_note?: string) =>
    request<DocumentChangeRequest>(
      `/api/admin/document-change-requests/${id}/approve`,
      { method: 'POST', body: JSON.stringify({ review_note: review_note ?? null }) },
      token,
    ),

  rejectAdminDocumentChange: (id: number, token: string, review_note?: string) =>
    request<DocumentChangeRequest>(
      `/api/admin/document-change-requests/${id}/reject`,
      { method: 'POST', body: JSON.stringify({ review_note: review_note ?? null }) },
      token,
    ),

  // Compatibility APIs
  listPendingSubmissions: (token: string) => request<UploadItem[]>('/api/admin/review/submissions', {}, token),

  approveSubmission: (id: string, token: string, reason?: string) =>
    request<UploadItem>(
      `/api/admin/review/submissions/${id}/approve`,
      { method: 'POST', body: JSON.stringify({ reason: reason ?? null }) },
      token,
    ),

  rejectSubmission: (id: string, token: string, reason?: string) =>
    request<UploadItem>(
      `/api/admin/review/submissions/${id}/reject`,
      { method: 'POST', body: JSON.stringify({ reason: reason ?? null }) },
      token,
    ),
};
