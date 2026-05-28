from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field

from app.db.models import Role, UploadStatus


class Message(BaseModel):
    message: str


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None
    request_id: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


class RegisterSendCodeRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class RegisterVerifyRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=12)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: EmailStr
    role: Role
    is_super_admin: bool = False
    is_active: bool = True


class UserProfileOut(BaseModel):
    id: str
    email: EmailStr
    role: Role
    is_super_admin: bool = False
    is_active: bool = True
    is_verified: bool
    created_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user: UserOut


class UploadOut(BaseModel):
    id: str
    owner_id: str
    session_id: str
    original_filename: str
    mime_type: str
    size_bytes: int
    status: UploadStatus
    review_reason: str | None
    is_deleted: bool = False
    created_at: datetime
    submitted_at: datetime | None
    reviewed_at: datetime | None
    deleted_at: datetime | None = None


class UploadSummaryOut(BaseModel):
    id: str
    owner_id: str
    owner_email: EmailStr | None = None
    session_id: str
    original_filename: str
    mime_type: str
    size_bytes: int
    status: UploadStatus
    review_reason: str | None
    is_deleted: bool = False
    created_at: datetime
    submitted_at: datetime | None
    reviewed_at: datetime | None
    deleted_at: datetime | None = None


class UploadDetailOut(UploadSummaryOut):
    extracted_text: str | None = None
    deleted_by: str | None = None


class SubmitUploadRequest(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class ReviewDecisionRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)


class ConversationMessage(BaseModel):
    role: Literal['user', 'assistant']
    content: str = Field(min_length=1, max_length=8000)


class ChatAttachment(BaseModel):
    upload_id: str
    media_type: Literal['image', 'pdf_page']
    page: int | None = Field(default=None, ge=1)


class VisualizationChart(BaseModel):
    type: Literal['bar', 'line', 'scatter', 'area']
    title: str
    x_key: str
    y_key: str
    series_key: str | None = None


class VisualizationSpec(BaseModel):
    engine: Literal['d3'] = 'd3'
    spec_version: Literal['v1'] = 'v1'
    chart: VisualizationChart
    data: list[dict[str, Any]]
    insights: list[str] = Field(default_factory=list)


class ResponseMeta(BaseModel):
    model: str | None = None
    modalities_used: list[str] = Field(default_factory=list)
    history_turns_used: int = 0
    retrieval_scope: str


class Citation(BaseModel):
    source_domain: Literal['base', 'upload', 'web']
    title: str
    location: str | None = None


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    session_id: str | None = Field(default=None, max_length=64)
    retrieval_enabled: bool = False
    deep_research_enabled: bool = False
    retrieval_scope: Literal['base', 'upload', 'hybrid'] = 'base'
    history: list[ConversationMessage] = Field(default_factory=list)
    attachments: list[ChatAttachment] = Field(default_factory=list)


class ChatResponse(BaseModel):
    mode: str
    answer: str
    citations: list[Citation]
    visualization: VisualizationSpec | None = None
    meta: ResponseMeta


class ResearchCreateRequest(BaseModel):
    question: str = Field(min_length=1)
    session_id: str | None = Field(default=None, max_length=64)
    retrieval_enabled: bool = False
    deep_research_enabled: bool = True
    retrieval_scope: Literal['base', 'upload', 'hybrid'] = 'base'
    history: list[ConversationMessage] = Field(default_factory=list)
    attachments: list[ChatAttachment] = Field(default_factory=list)


class ResearchSessionOut(BaseModel):
    id: str
    question: str
    retrieval_enabled: bool
    deep_research_enabled: bool
    retrieval_scope: str
    status: str
    plan: dict | None
    result: str | None
    visualization: VisualizationSpec | None = None
    meta: ResponseMeta
    created_at: datetime
    updated_at: datetime


class ReviewSubmissionOut(BaseModel):
    id: str
    owner_email: EmailStr
    session_id: str
    original_filename: str
    status: UploadStatus
    submitted_at: datetime | None
    created_at: datetime
    review_reason: str | None


class UserRoleUpdateRequest(BaseModel):
    role: Literal['user', 'admin']


class UserStatusUpdateRequest(BaseModel):
    is_active: bool


class DocumentChangeRequestCreate(BaseModel):
    proposed_filename: str | None = Field(default=None, max_length=512)
    proposed_extracted_text: str | None = None
    reason: str | None = Field(default=None, max_length=2000)


class DocumentChangeRequestOut(BaseModel):
    id: int
    document_id: str
    requester_id: str | None
    requester_email: EmailStr | None = None
    proposed_filename: str | None
    proposed_extracted_text: str | None
    reason: str | None
    status: str
    reviewed_by: str | None
    review_note: str | None
    created_at: datetime
    reviewed_at: datetime | None


class DocumentChangeReviewRequest(BaseModel):
    review_note: str | None = Field(default=None, max_length=2000)


AuthResponse.model_rebuild()
