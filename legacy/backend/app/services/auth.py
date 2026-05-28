from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, get_password_hash, verify_password
from app.db.models import EmailVerificationCode, Role, User
from app.db.schemas import UserOut, UserProfileOut
from app.services.audit import log_action
from app.services.mail import generate_code, send_verification_email


def send_register_code(db: Session, email: str, password: str) -> None:
    exists = db.query(User).filter(User.email == email).first()
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Email already registered')

    code = generate_code()
    row = EmailVerificationCode(
        email=email,
        code=code,
        password_hash=get_password_hash(password),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    db.add(row)
    db.commit()

    send_verification_email(email, code)


def verify_register_code(db: Session, email: str, code: str) -> User:
    now = datetime.now(timezone.utc)
    row = (
        db.query(EmailVerificationCode)
        .filter(EmailVerificationCode.email == email)
        .order_by(EmailVerificationCode.created_at.desc())
        .first()
    )

    if not row:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid or expired verification code')

    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if row.consumed_at is not None or expires_at < now or row.code != code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Invalid or expired verification code')

    user = User(email=email, password_hash=row.password_hash, role=Role.user, is_verified=True, is_active=True)
    row.consumed_at = now
    db.add(user)
    db.commit()
    db.refresh(user)

    log_action(db, action='auth.register', target_type='user', target_id=user.id, actor=user, details={'email': email})
    return user


def login_user(db: Session, email: str, password: str) -> tuple[str, User]:
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid credentials')
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='User is disabled')

    token = create_access_token(subject=user.id, role=user.role.value)
    log_action(db, action='auth.login', target_type='user', target_id=user.id, actor=user)
    return token, user


def logout_user(db: Session, user: User | None) -> None:
    log_action(db, action='auth.logout', target_type='user', target_id=user.id if user else None, actor=user)


def bootstrap_admin_user(db: Session) -> None:
    settings = get_settings()
    if settings.super_admin_email and settings.super_admin_password:
        super_admin = db.query(User).filter(User.email == settings.super_admin_email).first()
        if super_admin:
            super_admin.role = Role.admin
            super_admin.is_super_admin = True
            super_admin.is_active = True
            super_admin.is_verified = True
        else:
            super_admin = User(
                email=settings.super_admin_email,
                password_hash=get_password_hash(settings.super_admin_password),
                role=Role.admin,
                is_super_admin=True,
                is_active=True,
                is_verified=True,
            )
            db.add(super_admin)
        db.commit()

    if not settings.admin_email or not settings.admin_password:
        return

    exists = db.query(User).filter(User.email == settings.admin_email).first()
    if exists:
        if exists.role != Role.admin:
            exists.role = Role.admin
        exists.is_active = True
        db.commit()
        return

    admin = User(
        email=settings.admin_email,
        password_hash=get_password_hash(settings.admin_password),
        role=Role.admin,
        is_verified=True,
        is_active=True,
    )
    db.add(admin)
    db.commit()


def to_user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        role=user.role,
        is_super_admin=bool(getattr(user, 'is_super_admin', False)),
        is_active=bool(getattr(user, 'is_active', True)),
    )


def to_user_profile(user: User) -> UserProfileOut:
    return UserProfileOut(
        id=user.id,
        email=user.email,
        role=user.role,
        is_super_admin=bool(getattr(user, 'is_super_admin', False)),
        is_active=bool(getattr(user, 'is_active', True)),
        is_verified=user.is_verified,
        created_at=user.created_at,
    )
