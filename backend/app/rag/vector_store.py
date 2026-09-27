"""Vector storage behind a Protocol, with pgvector as the implementation.

Everything above this module (ingestion, the chat graph) talks to
`VectorStore`, so moving to Qdrant/Pinecone/etc. means writing one new class —
the namespace (= chatbot embed token) is the tenant boundary every
implementation must enforce.
"""

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Protocol

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import KnowledgeVector


@dataclass
class VectorRecord:
    namespace: str
    type: str
    content: str
    embedding: list[float]
    content_hash: str | None = None
    section_type: str | None = None
    heading_path: str | None = None
    source: str | None = None
    title: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class Match:
    id: str
    type: str
    content: str
    score: float  # cosine similarity (1 = identical); rerank adds boosts on top
    raw_score: float = 0.0  # untouched cosine, kept for the relevance gates
    section_type: str | None = None
    heading_path: str | None = None
    source: str | None = None
    title: str | None = None


class VectorStore(Protocol):
    async def upsert(self, records: list[VectorRecord]) -> None: ...

    async def search(self, embedding: list[float], namespace: str, top_k: int) -> list[Match]: ...

    async def delete_namespace(self, namespace: str) -> None: ...

    async def count(self, namespace: str) -> int: ...


def _literal(embedding: list[float]) -> str:
    return "[" + ",".join(repr(float(x)) for x in embedding) + "]"


_UPSERT = text(
    """
    INSERT INTO "KnowledgeVector"
      (id, namespace, "contentHash", type, "sectionType", "headingPath",
       source, title, content, metadata, embedding, "createdAt")
    VALUES
      (gen_random_uuid()::text, :namespace, :content_hash, :type, :section_type, :heading_path,
       :source, :title, :content, CAST(CAST(:metadata AS text) AS jsonb),
       CAST(CAST(:embedding AS text) AS vector), (now() AT TIME ZONE 'utc'))
    ON CONFLICT (namespace, "contentHash") DO UPDATE SET
      content = EXCLUDED.content,
      metadata = EXCLUDED.metadata,
      embedding = EXCLUDED.embedding,
      "createdAt" = EXCLUDED."createdAt"
    """
)

# `<=>` is pgvector's cosine distance; the HNSW index (vector_cosine_ops)
# serves this ORDER BY. The namespace filter is the tenant isolation.
_SEARCH = text(
    """
    SELECT id, type, "sectionType", "headingPath", source, title, content,
           1 - (embedding <=> CAST(CAST(:embedding AS text) AS vector)) AS score
    FROM "KnowledgeVector"
    WHERE namespace = :namespace AND embedding IS NOT NULL
    ORDER BY embedding <=> CAST(CAST(:embedding AS text) AS vector)
    LIMIT :top_k
    """
)


class PgVectorStore:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def upsert(self, records: list[VectorRecord]) -> None:
        if not records:
            return
        params = [
            {
                "namespace": r.namespace,
                "content_hash": r.content_hash or hashlib.sha256(f"{r.namespace}:{r.content}".encode()).hexdigest(),
                "type": r.type,
                "section_type": r.section_type,
                "heading_path": r.heading_path,
                "source": r.source,
                "title": r.title,
                "content": r.content,
                "metadata": json.dumps(r.metadata, default=str),
                "embedding": _literal(r.embedding),
            }
            for r in records
        ]
        # One executemany round-trip per page instead of one INSERT per chunk.
        await self.session.execute(_UPSERT, params)
        await self.session.commit()

    async def search(self, embedding: list[float], namespace: str, top_k: int) -> list[Match]:
        rows = await self.session.execute(
            _SEARCH, {"embedding": _literal(embedding), "namespace": namespace, "top_k": top_k}
        )
        return [
            Match(
                id=row.id, type=row.type, content=row.content,
                score=float(row.score), raw_score=float(row.score),
                section_type=row.sectionType, heading_path=row.headingPath,
                source=row.source, title=row.title,
            )
            for row in rows
        ]

    async def delete_namespace(self, namespace: str) -> None:
        await self.session.execute(delete(KnowledgeVector).where(KnowledgeVector.namespace == namespace))

    async def count(self, namespace: str) -> int:
        stmt = select(func.count()).select_from(KnowledgeVector).where(KnowledgeVector.namespace == namespace)
        return (await self.session.execute(stmt)).scalar_one()
