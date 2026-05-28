from __future__ import annotations

import os
import uuid
from pathlib import Path

from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.core.config import get_settings


class VectorIndexService:
    def __init__(self) -> None:
        settings = get_settings()
        self.settings = settings
        self.client = QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key, timeout=5)

    def _ensure_collection(self, name: str) -> None:
        try:
            self.client.get_collection(name)
        except Exception:
            self.client.create_collection(
                collection_name=name,
                vectors_config=qmodels.VectorParams(size=384, distance=qmodels.Distance.COSINE),
            )

    def _text_to_vec(self, text: str) -> list[float]:
        # Lightweight deterministic pseudo-vector for scaffolding.
        seed = abs(hash(text))
        vec: list[float] = []
        for idx in range(384):
            val = ((seed >> (idx % 32)) & 0xFF) / 255.0
            vec.append(val)
        return vec

    def index_upload_text(self, session_id: str, upload_id: str, text: str, payload: dict) -> None:
        collection = f"{self.settings.qdrant_session_prefix}{session_id}"
        self._ensure_collection(collection)
        point_id = str(uuid.uuid4())
        self.client.upsert(
            collection_name=collection,
            points=[qmodels.PointStruct(id=point_id, vector=self._text_to_vec(text or upload_id), payload={**payload, 'upload_id': upload_id})],
        )

    def promote_upload_to_base(self, upload_id: str, text: str, payload: dict) -> None:
        collection = self.settings.qdrant_base_collection
        self._ensure_collection(collection)
        self.client.upsert(
            collection_name=collection,
            points=[qmodels.PointStruct(id=upload_id, vector=self._text_to_vec(text or upload_id), payload={**payload, 'upload_id': upload_id})],
        )

    def delete_upload_from_session(self, session_id: str, upload_id: str) -> None:
        collection = f"{self.settings.qdrant_session_prefix}{session_id}"
        try:
            self.client.delete(
                collection_name=collection,
                points_selector=qmodels.FilterSelector(
                    filter=qmodels.Filter(
                        must=[qmodels.FieldCondition(key='upload_id', match=qmodels.MatchValue(value=upload_id))]
                    )
                ),
            )
        except Exception:
            return


vector_index_service: VectorIndexService | None = None


def get_vector_index_service() -> VectorIndexService:
    global vector_index_service
    if vector_index_service is None:
        vector_index_service = VectorIndexService()
    return vector_index_service


def safe_index_upload_text(session_id: str, upload_id: str, text: str, payload: dict) -> None:
    try:
        get_vector_index_service().index_upload_text(session_id, upload_id, text, payload)
    except Exception as exc:
        print(f'[WARN] Qdrant index upload failed: {exc}')


def safe_promote_upload_to_base(upload_id: str, text: str, payload: dict) -> None:
    try:
        get_vector_index_service().promote_upload_to_base(upload_id, text, payload)
    except Exception as exc:
        print(f'[WARN] Qdrant promote failed: {exc}')


def safe_delete_upload_from_session(session_id: str, upload_id: str) -> None:
    try:
        get_vector_index_service().delete_upload_from_session(session_id, upload_id)
    except Exception as exc:
        print(f'[WARN] Qdrant delete failed: {exc}')
