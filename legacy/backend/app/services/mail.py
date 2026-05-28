from __future__ import annotations

import random
import smtplib
from email.message import EmailMessage

from app.core.config import get_settings


def generate_code(length: int = 6) -> str:
    return ''.join(random.choices('0123456789', k=length))


def send_verification_email(email: str, code: str) -> None:
    settings = get_settings()

    if settings.mail_debug_mode or not settings.smtp_host:
        print(f'[MAIL_DEBUG] Send verification code to {email}: {code}')
        return

    msg = EmailMessage()
    msg['Subject'] = '日新册注册验证码'
    msg['From'] = settings.smtp_from
    msg['To'] = email
    msg.set_content(f'您的验证码是：{code}，10分钟内有效。')

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as server:
        if settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_username and settings.smtp_password:
            server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(msg)
