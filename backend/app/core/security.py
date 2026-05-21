"""密码哈希与 JWT 签发/校验。

用于 auth 路由登录注册；`sub`  claim 存用户 id，默认有效期见 `jwt_expire_minutes`。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from passlib.context import CryptContext

from app.core.config import settings

# bcrypt 哈希，verify 失败时返回 False 而非抛错
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """将明文密码转为 bcrypt 哈希，存入 User.password_hash。"""
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """校验登录密码；哈希损坏或算法不匹配时返回 False。"""
    try:
        return pwd_context.verify(plain, hashed)
    except Exception:
        return False


def create_access_token(subject: str, *, extra_claims: dict[str, Any] | None = None) -> str:
    """签发 JWT 访问令牌。

    参数:
        subject: 通常为用户 UUID，写入 `sub`。
        extra_claims: 额外载荷字段（如 is_admin）。

    返回:
        编码后的 JWT 字符串，供前端 Authorization Bearer 使用。
    """
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload: dict[str, Any] = {
        "sub": subject,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "iss": "redship",
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    """解析并校验 JWT；过期或签名无效时由 PyJWT 抛异常。

    参数:
        token: Bearer 去掉前缀后的令牌字符串。

    返回:
        解码后的 claims 字典（含 sub、exp 等）。
    """
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
