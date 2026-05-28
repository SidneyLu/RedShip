from __future__ import annotations

import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def _request_id_from_request(request: Request) -> str:
    request_id = getattr(request.state, 'request_id', None)
    if not request_id:
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
    return request_id


def _error_payload(
    request: Request,
    code: str,
    message: str,
    details: dict | None = None,
) -> dict:
    request_id = _request_id_from_request(request)
    return {
        'error': {
            'code': code,
            'message': message,
            'details': details,
            'request_id': request_id,
        },
        'detail': message,
    }


def register_error_handlers(app: FastAPI) -> None:
    @app.middleware('http')
    async def request_id_middleware(request: Request, call_next):
        request.state.request_id = request.headers.get('x-request-id', str(uuid.uuid4()))
        response = await call_next(request)
        response.headers['x-request-id'] = request.state.request_id
        return response

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        message = exc.detail if isinstance(exc.detail, str) else 'Request failed'
        details = exc.detail if isinstance(exc.detail, dict) else None
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_payload(
                request=request,
                code=f'http_{exc.status_code}',
                message=message,
                details=details,
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content=_error_payload(
                request=request,
                code='validation_error',
                message='Validation failed',
                details={'errors': exc.errors()},
            ),
        )

    @app.exception_handler(Exception)
    async def internal_exception_handler(request: Request, exc: Exception):
        return JSONResponse(
            status_code=500,
            content=_error_payload(
                request=request,
                code='internal_error',
                message='Internal Server Error',
                details={'exception': str(exc)},
            ),
        )
