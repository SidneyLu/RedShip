from sqlalchemy.orm import Session

from app.db.models import AuditLog, User


def log_action(
    db: Session,
    action: str,
    target_type: str,
    target_id: str | None = None,
    actor: User | None = None,
    details: dict | None = None,
) -> None:
    entry = AuditLog(
        actor_id=actor.id if actor else None,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=details,
    )
    db.add(entry)
    db.commit()
