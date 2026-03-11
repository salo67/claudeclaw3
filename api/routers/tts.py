"""Text-to-Speech endpoint using ElevenLabs API."""

from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech"


class TTSRequest(BaseModel):
    text: str
    voice_id: str


@router.post("/tts/speak")
async def speak(body: TTSRequest):
    """Generate speech audio from text using ElevenLabs."""
    if not ELEVENLABS_API_KEY:
        raise HTTPException(status_code=500, detail="ELEVENLABS_API_KEY not configured")

    if not body.voice_id:
        raise HTTPException(status_code=400, detail="voice_id is required")

    # Truncate to ~5000 chars to avoid excessive API usage
    text = body.text[:5000]

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{ELEVENLABS_URL}/{body.voice_id}",
            headers={
                "xi-api-key": ELEVENLABS_API_KEY,
                "Content-Type": "application/json",
            },
            json={
                "text": text,
                "model_id": "eleven_multilingual_v2",
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.75,
                },
            },
        )

        if resp.status_code != 200:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"ElevenLabs error: {resp.text[:200]}",
            )

        return StreamingResponse(
            iter([resp.content]),
            media_type="audio/mpeg",
            headers={"Content-Disposition": "inline"},
        )
