from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.models import Role, User
from app.db.session import get_db


oauth2_scheme = OAuth2PasswordBearer(tokenUrl='/api/auth/login', auto_error=False)


def get_current_user_optional(
    db: Session = Depends(get_db), token: str | None = Depends(oauth2_scheme)
) -> User | None:
    if not token:
        return None

    try:
        payload = decode_access_token(token)
        user_id = payload.get('sub')
        if not user_id:
            return None
    except ValueError:
        return None

    user = db.query(User).filter(User.id == user_id).first()
    if user and not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='User is disabled')
    return user


def get_current_user(user: User | None = Depends(get_current_user_optional)) -> User:
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Authentication required')
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != Role.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Admin permission required')
    return user
