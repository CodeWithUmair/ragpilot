"""One error shape for the whole API: {"error", "message", "code"}.

The dashboard reads `error` (axios: err.response.data.error); the Better Auth
client the frontend uses reads `message` + `code`. Sending both keeps every
caller happy without per-route special cases.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import get_settings

log = logging.getLogger("ragpilot")


class AppError(Exception):
    def __init__(self, message: str, status_code: int = 400, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


def error_body(message: str, code: str | None = None) -> dict:
    return {"error": message, "message": message, "code": code}


def _validation_message(exc: RequestValidationError) -> str:
    first = exc.errors()[0] if exc.errors() else None
    if not first:
        return "Invalid request"
    field = ".".join(str(p) for p in first.get("loc", ()) if p not in ("body", "query", "path"))
    return f"{field}: {first.get('msg')}" if field else str(first.get("msg"))


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return JSONResponse(error_body(exc.message, exc.code), status_code=exc.status_code)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        return JSONResponse(error_body(str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        # 400 (not FastAPI's default 422) to match the original API contract.
        return JSONResponse(error_body(_validation_message(exc), "VALIDATION_ERROR"), status_code=400)

    @app.exception_handler(IntegrityError)
    async def _integrity_error(_: Request, exc: IntegrityError):
        log.warning("integrity error: %s", exc.orig)
        return JSONResponse(error_body("Resource already exists"), status_code=409)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        log.exception("unhandled error")
        message = str(exc) if not get_settings().is_production else "Internal server error"
        return JSONResponse(error_body(message), status_code=500)
