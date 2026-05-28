from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_current_user_optional
from app.db.models import User
from app.db.schemas import AuthResponse, LoginRequest, Message, RegisterSendCodeRequest, RegisterVerifyRequest, UserProfileOut
from app.db.session import get_db
from app.services.auth import login_user, logout_user, send_register_code, to_user_out, to_user_profile, verify_register_code


router = APIRouter(prefix='/auth', tags=['auth'])


@router.post('/register/send-code', response_model=Message)
def register_send_code(payload: RegisterSendCodeRequest, db: Session = Depends(get_db)):
    send_register_code(db, payload.email, payload.password)
    return Message(message='Verification code sent')


@router.post('/register/verify', response_model=AuthResponse)
def register_verify(payload: RegisterVerifyRequest, db: Session = Depends(get_db)):
    user = verify_register_code(db, payload.email, payload.code)
    from app.core.security import create_access_token

    token = create_access_token(subject=user.id, role=user.role.value)
    return AuthResponse(access_token=token, user=to_user_out(user))


@router.post('/login', response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    token, user = login_user(db, payload.email, payload.password)
    return AuthResponse(access_token=token, user=to_user_out(user))


@router.post('/logout', response_model=Message)
def logout(
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    logout_user(db, user)
    return Message(message='Logged out')


@router.get('/me', response_model=UserProfileOut)
def get_my_profile(user: User = Depends(get_current_user)):
    return to_user_profile(user)
