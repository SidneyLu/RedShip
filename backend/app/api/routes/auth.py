"""用户认证：注册、登录（返回 JWT）、/me 当前用户信息。"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.security import create_access_token, hash_password, verify_password
from app.db.models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class EmailPayload(BaseModel):
    email: str = Field(min_length=3, max_length=255)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        email = value.strip().lower()
        if "@" not in email or email.startswith("@") or email.endswith("@"):
            raise ValueError("Invalid email address")
        return email


class RegisterPayload(EmailPayload):
    password: str = Field(min_length=6, max_length=128)
    display_name: str | None = None


class LoginPayload(EmailPayload):
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(BaseModel):
    id: str
    email: str
    display_name: str | None = None
    is_admin: bool


TokenResponse.model_rebuild()


@router.post("/register", response_model=TokenResponse)
async def register(payload: RegisterPayload, session: DbSession) -> TokenResponse:
    res = await session.execute(select(User).where(User.email == payload.email))
    if res.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
        is_admin=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    token = create_access_token(user.id, extra_claims={"email": user.email, "is_admin": user.is_admin})
    return TokenResponse(
        access_token=token,
        user=UserOut(id=user.id, email=user.email, display_name=user.display_name, is_admin=user.is_admin),
    )


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginPayload, session: DbSession) -> TokenResponse:
    res = await session.execute(select(User).where(User.email == payload.email))
    user = res.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account inactive")
    user.last_login_at = datetime.now(timezone.utc)
    await session.commit()
    token = create_access_token(user.id, extra_claims={"email": user.email, "is_admin": user.is_admin})
    return TokenResponse(
        access_token=token,
        user=UserOut(id=user.id, email=user.email, display_name=user.display_name, is_admin=user.is_admin),
    )


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> UserOut:
    return UserOut(id=user.id, email=user.email, display_name=user.display_name, is_admin=user.is_admin)
