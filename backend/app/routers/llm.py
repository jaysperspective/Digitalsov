"""LLM router — Ollama model management, settings, and agentic chat."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..services import llm_service

router = APIRouter(prefix="/llm", tags=["llm"])


# ── Request / response models ─────────────────────────────────────────────────

class PullRequest(BaseModel):
    model: str


class LLMSettingsUpdate(BaseModel):
    provider: str = "ollama"
    model: str = "llama3.1:latest"
    fast_model: str = "llama3.2:3b-instruct-q8_0"
    use_fast_mode: bool = False


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    use_fast_mode: Optional[bool] = None


# ── Model management ──────────────────────────────────────────────────────────

@router.get("/ping", summary="Check Ollama availability")
async def ping_ollama():
    return {"available": await llm_service.ping_ollama()}


@router.get("/models", summary="List installed Ollama models")
async def list_models():
    try:
        return {"models": await llm_service.list_models()}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Ollama unavailable: {exc}") from exc


@router.post("/pull", summary="Pull an Ollama model (streams NDJSON progress)")
async def pull_model(body: PullRequest):
    async def _stream():
        try:
            async for chunk in llm_service.pull_model_stream(body.model):
                yield chunk
        except Exception as exc:
            import json
            yield json.dumps({"error": str(exc)}) + "\n"

    return StreamingResponse(_stream(), media_type="application/x-ndjson")


# ── Settings ──────────────────────────────────────────────────────────────────

@router.get("/settings", summary="Get LLM settings")
def get_settings(db: Session = Depends(get_db)):
    return llm_service.get_llm_settings(db)


@router.put("/settings", summary="Update LLM settings")
def update_settings(payload: LLMSettingsUpdate, db: Session = Depends(get_db)):
    llm_service.set_setting(db, "llm_provider", payload.provider)
    llm_service.set_setting(db, "llm_model", payload.model)
    llm_service.set_setting(db, "llm_fast_model", payload.fast_model)
    llm_service.set_setting(db, "llm_use_fast_mode", "true" if payload.use_fast_mode else "false")
    return llm_service.get_llm_settings(db)


# ── Chat (streaming SSE — primary endpoint) ───────────────────────────────────

@router.post(
    "/chat/stream",
    summary="Agentic chat with tool-calling; streams SSE events",
)
async def chat_stream(body: ChatRequest, db: Session = Depends(get_db)):
    settings = llm_service.get_llm_settings(db)
    use_fast = body.use_fast_mode if body.use_fast_mode is not None else settings["use_fast_mode"]
    model = settings["fast_model"] if use_fast else settings["model"]
    messages = [{"role": m.role, "content": m.content} for m in body.messages]

    async def _stream():
        try:
            async for event in llm_service.chat_stream(messages, model, db):
                yield event
        except Exception as exc:
            import json
            yield f"event: error\ndata: {json.dumps({'message': str(exc)})}\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
