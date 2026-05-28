from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, auth, chat, documents, research, uploads
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.db.migrations import run_schema_migrations
from app.db.models import Base
from app.db.session import SessionLocal, engine
from app.services.auth import bootstrap_admin_user
from app.services.base_corpus import ensure_base_corpus_seeded


settings = get_settings()
app = FastAPI(title=settings.app_name)
register_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


@app.on_event('startup')
def startup_event() -> None:
    settings.upload_root.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    run_schema_migrations(engine)
    db = SessionLocal()
    try:
        bootstrap_admin_user(db)
        ensure_base_corpus_seeded(db, zip_path=settings.downloads_zip_path)
    finally:
        db.close()


@app.get('/api/health')
def health():
    return {'status': 'ok', 'app': settings.app_name}


app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(uploads.router, prefix=settings.api_prefix)
app.include_router(admin.router, prefix=settings.api_prefix)
app.include_router(documents.router, prefix=settings.api_prefix)
app.include_router(chat.router, prefix=settings.api_prefix)
app.include_router(research.router, prefix=settings.api_prefix)
