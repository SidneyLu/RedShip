"""Unit tests for password hashing and JWT."""
from __future__ import annotations

import jwt
import pytest

from app.core.security import create_access_token, decode_access_token, hash_password, verify_password

pytestmark = pytest.mark.unit


def test_hash_and_verify_password_roundtrip():
    try:
        hashed = hash_password("secret-pass")
    except ValueError as exc:
        # passlib + newer bcrypt on some Python builds raises a false 72-byte error
        if "72 bytes" in str(exc):
            pytest.skip(f"bcrypt/passlib backend issue: {exc}")
        raise
    assert hashed != "secret-pass"
    assert verify_password("secret-pass", hashed)
    assert not verify_password("wrong", hashed)


def test_verify_password_bad_hash_returns_false():
    assert verify_password("x", "not-a-valid-bcrypt") is False


def test_jwt_create_and_decode():
    token = create_access_token("user-1", extra_claims={"email": "a@b.c", "is_admin": True})
    payload = decode_access_token(token)
    assert payload["sub"] == "user-1"
    assert payload["email"] == "a@b.c"
    assert payload["is_admin"] is True
    assert payload["iss"] == "redship"


def test_jwt_invalid_signature_raises():
    token = create_access_token("user-1")
    with pytest.raises(jwt.PyJWTError):
        jwt.decode(token, "wrong-secret-key-xxxxxxxxxxxxxxxxxxxx", algorithms=["HS256"])
