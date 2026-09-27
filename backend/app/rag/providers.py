"""Model providers behind small Protocols.

The chat graph and the ingestion pipeline depend on these interfaces, not on
the OpenAI SDK — so tests run with fakes, and switching to another
OpenAI-compatible provider (Groq, a local vLLM, …) is a config change.
"""

from collections.abc import AsyncIterator, Sequence
from typing import Protocol

from openai import AsyncOpenAI

from app.core.config import get_settings

Message = dict[str, str]  # {"role": ..., "content": ...}

# The embeddings endpoint accepts up to 2048 inputs per call; 96 keeps each
# request well under the per-request token ceiling for 500-char chunks.
EMBED_BATCH_SIZE = 96


class Embedder(Protocol):
    async def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class ChatModel(Protocol):
    def stream(self, messages: list[Message], *, temperature: float, max_tokens: int) -> AsyncIterator[str]: ...

    async def complete(self, messages: list[Message], *, temperature: float, max_tokens: int) -> str: ...


def _client() -> AsyncOpenAI:
    s = get_settings()
    return AsyncOpenAI(api_key=s.openai_api_key, base_url=s.openai_base_url, timeout=60)


class OpenAIEmbedder:
    def __init__(self, client: AsyncOpenAI | None = None):
        s = get_settings()
        self.client = client or _client()
        self.model = s.openai_embed_model
        self.dimensions = s.openai_embed_dimensions

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        out: list[list[float]] = []
        # Only text-embedding-3-* understands `dimensions`; other providers must
        # natively return the configured size.
        extra = {"dimensions": self.dimensions} if self.model.startswith("text-embedding-3") else {}
        for i in range(0, len(texts), EMBED_BATCH_SIZE):
            batch = [t if t.strip() else " " for t in texts[i : i + EMBED_BATCH_SIZE]]  # API rejects ""
            res = await self.client.embeddings.create(model=self.model, input=batch, **extra)
            if len(res.data) != len(batch):
                raise RuntimeError(f"embed returned {len(res.data)} vectors for {len(batch)} inputs")
            for item in sorted(res.data, key=lambda d: d.index):
                if len(item.embedding) != self.dimensions:
                    raise RuntimeError(
                        f"embedding has {len(item.embedding)} dims, schema expects {self.dimensions} — "
                        "check OPENAI_EMBED_MODEL / OPENAI_EMBED_DIMENSIONS"
                    )
                out.append(item.embedding)
        return out


class OpenAIChatModel:
    def __init__(self, client: AsyncOpenAI | None = None):
        self.client = client or _client()
        self.model = get_settings().openai_chat_model

    async def stream(self, messages: list[Message], *, temperature: float, max_tokens: int) -> AsyncIterator[str]:
        stream = await self.client.chat.completions.create(
            model=self.model, messages=messages, stream=True, temperature=temperature, max_tokens=max_tokens
        )
        async for chunk in stream:
            if chunk.choices and (delta := chunk.choices[0].delta.content):
                yield delta

    async def complete(self, messages: list[Message], *, temperature: float, max_tokens: int) -> str:
        res = await self.client.chat.completions.create(
            model=self.model, messages=messages, temperature=temperature, max_tokens=max_tokens
        )
        return (res.choices[0].message.content or "").strip()
