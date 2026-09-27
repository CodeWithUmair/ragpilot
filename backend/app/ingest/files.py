"""Uploaded document → plain text. Synchronous by design; called via
asyncio.to_thread because PDF parsing is CPU-bound."""

import io

from docx import Document
from pypdf import PdfReader

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class UnsupportedFile(Exception):
    pass


def extract_text(data: bytes, filename: str, mime: str | None) -> str:
    name = filename.lower()
    mime = (mime or "").lower()
    if mime == "application/pdf" or name.endswith(".pdf"):
        reader = PdfReader(io.BytesIO(data))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    if mime == DOCX_MIME or name.endswith(".docx"):
        doc = Document(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs)
    if mime in ("text/plain", "text/csv", "text/markdown") or name.endswith((".txt", ".csv", ".md")):
        return data.decode("utf-8", errors="replace")
    raise UnsupportedFile(filename)
