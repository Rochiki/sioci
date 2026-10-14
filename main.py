"""
Server TTS Studio SCORM  —  FastAPI + edge-tts
=============================================

Mengubah teks menjadi file MP3 bersuara natural (suara "Neural" Microsoft Edge),
GRATIS dan TANPA API key. Cocok untuk voiceover materi e-learning.

Fitur:
  * Teks panjang  -> dipotong otomatis per paragraf/kalimat, disintesis satu per satu
                     (dengan percobaan ulang), lalu digabung jadi satu MP3.
  * Cache disk     -> teks + suara yang sama tidak disintesis dua kali.
  * Rate limit     -> mencegah server Anda disalahgunakan bila dibuka publik.
  * CORS           -> atur domain yang boleh memanggil (mis. GitHub Pages Anda).

Jalankan lokal:
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
Lalu buka http://localhost:8000/docs untuk mencoba.

PENTING: edge-tts memakai layanan "Read Aloud" Microsoft Edge yang TIDAK resmi.
Gratis dan bagus, tetapi tanpa jaminan (bisa berubah/terblokir sewaktu-waktu).
Lihat README bagian "Batasan TTS" untuk alternatif resmi.
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import re
import time
from collections import defaultdict, deque
from pathlib import Path

import edge_tts
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

# ------------------------------------------------------------------ konfigurasi (via environment variable)
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
MAX_CHARS = int(os.getenv("MAX_CHARS", "20000"))            # batas panjang teks per permintaan
CHUNK_CHARS = int(os.getenv("CHUNK_CHARS", "2500"))         # ukuran potongan yang dikirim ke edge-tts
CACHE_DIR = Path(os.getenv("CACHE_DIR", "./cache"))
CACHE_MAX_MB = int(os.getenv("CACHE_MAX_MB", "500"))
RATE_LIMIT_PER_MIN = int(os.getenv("RATE_LIMIT_PER_MIN", "30"))
MAX_PARALLEL = int(os.getenv("MAX_PARALLEL", "3"))          # sintesis bersamaan maksimal
TRUST_PROXY = os.getenv("TRUST_PROXY", "0") == "1"           # set 1 bila di belakang Render/HF/Nginx
DEFAULT_VOICE = os.getenv("DEFAULT_VOICE", "id-ID-GadisNeural")

CACHE_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Studio SCORM — TTS", version="1.0.0",
              description="Text-to-Speech gratis berbasis edge-tts untuk voiceover e-learning.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    expose_headers=["X-Cache", "X-Chunks"],
)

_semaphore = asyncio.Semaphore(MAX_PARALLEL)
_hits: dict[str, deque] = defaultdict(deque)
_voices_cache: dict = {"at": 0.0, "data": []}


# ------------------------------------------------------------------ model permintaan
class TTSRequest(BaseModel):
    text: str = Field(..., description="Teks yang akan dibacakan")
    voice: str = Field(DEFAULT_VOICE, description="Nama suara, mis. id-ID-GadisNeural / id-ID-ArdiNeural")
    rate: str = Field("+0%", description="Kecepatan, mis. -10% atau +15%")
    pitch: str = Field("+0Hz", description="Nada, mis. -2Hz atau +5Hz")
    volume: str = Field("+0%", description="Volume, mis. +0%")


VOICE_RE = re.compile(r"^[a-z]{2,3}(-[A-Za-z]{2,4}){1,2}(-[A-Za-z]+)?-[A-Za-z]+Neural$")
RATE_RE = re.compile(r"^[+-]\d{1,3}%$")
PITCH_RE = re.compile(r"^[+-]\d{1,3}Hz$")


# ------------------------------------------------------------------ util
def client_ip(request: Request) -> str:
    if TRUST_PROXY:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def check_rate_limit(ip: str) -> None:
    now = time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= RATE_LIMIT_PER_MIN:
        raise HTTPException(429, f"Terlalu banyak permintaan. Batas {RATE_LIMIT_PER_MIN} per menit — coba lagi sebentar.")
    q.append(now)


def clean_text(text: str) -> str:
    """Rapikan spasi & buang karakter kontrol yang bisa membuat sintesis gagal."""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_text(text: str, limit: int = CHUNK_CHARS) -> list[str]:
    """
    Potong teks panjang di batas alami:  paragraf -> kalimat -> kata.
    Potongan dibuat sebesar mungkin (<= limit) supaya intonasi tetap mulus.
    """
    pieces: list[str] = []
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        if len(para) <= limit:
            pieces.append(para)
            continue
        # Paragraf terlalu panjang: pecah per kalimat.
        sentences = re.split(r"(?<=[.!?…])\s+", para)
        for s in sentences:
            while len(s) > limit:  # kalimat super panjang: pecah per kata
                cut = s.rfind(" ", 0, limit)
                cut = cut if cut > limit // 2 else limit
                pieces.append(s[:cut].strip())
                s = s[cut:].strip()
            if s:
                pieces.append(s)
    # Gabungkan potongan kecil berurutan agar jumlah request minimal.
    merged: list[str] = []
    for p in pieces:
        if merged and len(merged[-1]) + 2 + len(p) <= limit:
            merged[-1] = f"{merged[-1]}\n\n{p}"
        else:
            merged.append(p)
    return merged


async def synthesize_chunk(text: str, voice: str, rate: str, pitch: str, volume: str, retries: int = 3) -> bytes:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            audio = bytearray()
            communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume)
            async for chunk in communicate.stream():
                if chunk.get("type") == "audio":
                    audio.extend(chunk["data"])
            if not audio:
                raise RuntimeError("edge-tts tidak mengembalikan audio")
            return bytes(audio)
        except Exception as err:  # noqa: BLE001 — jaringan/layanan bisa gagal dengan banyak cara
            last_err = err
            await asyncio.sleep(1.5 * (attempt + 1))
    raise HTTPException(502, f"Layanan suara gagal setelah {retries} percobaan: {last_err}")


def prune_cache() -> None:
    """Hapus file cache terlama bila total melebihi CACHE_MAX_MB."""
    files = sorted(CACHE_DIR.glob("*.mp3"), key=lambda p: p.stat().st_mtime)
    total = sum(p.stat().st_size for p in files)
    limit = CACHE_MAX_MB * 1024 * 1024
    while files and total > limit:
        f = files.pop(0)
        total -= f.stat().st_size
        f.unlink(missing_ok=True)


# ------------------------------------------------------------------ endpoint
@app.get("/health")
async def health():
    return {"status": "ok", "engine": "edge-tts", "max_chars": MAX_CHARS, "default_voice": DEFAULT_VOICE}


@app.get("/voices")
async def voices(lang: str = "id"):
    """Daftar suara. ?lang=id untuk Indonesia, ?lang=en untuk Inggris, ?lang=all untuk semua."""
    if time.time() - _voices_cache["at"] > 24 * 3600 or not _voices_cache["data"]:
        try:
            raw = await edge_tts.list_voices()
        except Exception as err:  # noqa: BLE001
            raise HTTPException(502, f"Gagal mengambil daftar suara: {err}") from err
        _voices_cache.update(at=time.time(), data=[
            {
                "name": v.get("ShortName"),
                "locale": v.get("Locale"),
                "gender": "Perempuan" if v.get("Gender") == "Female" else "Laki-laki",
                "multilingual": "Multilingual" in (v.get("ShortName") or ""),
            }
            for v in raw
        ])
    data = _voices_cache["data"]
    if lang != "all":
        # Suara "Multilingual" ikut ditampilkan karena bisa membaca Bahasa Indonesia juga.
        data = [v for v in data if (v["locale"] or "").lower().startswith(lang.lower()) or v["multilingual"]]
    return data


@app.post("/tts")
async def tts(req: TTSRequest, request: Request):
    check_rate_limit(client_ip(request))

    text = clean_text(req.text)
    if not text:
        raise HTTPException(400, "Teks kosong.")
    if len(text) > MAX_CHARS:
        raise HTTPException(413, f"Teks terlalu panjang ({len(text)} karakter). Maksimal {MAX_CHARS} — pecah per slide.")
    if not VOICE_RE.match(req.voice):
        raise HTTPException(400, "Format nama suara tidak valid. Contoh: id-ID-GadisNeural")
    if not RATE_RE.match(req.rate) or not RATE_RE.match(req.volume) or not PITCH_RE.match(req.pitch):
        raise HTTPException(400, "Format rate/volume (contoh +10%) atau pitch (contoh -2Hz) tidak valid.")

    key = hashlib.sha256(f"{req.voice}|{req.rate}|{req.pitch}|{req.volume}|{text}".encode()).hexdigest()
    path = CACHE_DIR / f"{key}.mp3"
    if path.exists() and path.stat().st_size > 0:
        path.touch()
        return FileResponse(path, media_type="audio/mpeg", filename="narasi.mp3",
                            content_disposition_type="inline", headers={"X-Cache": "HIT"})

    chunks = split_text(text)
    async with _semaphore:
        parts = [await synthesize_chunk(c, req.voice, req.rate, req.pitch, req.volume) for c in chunks]

    # MP3 dari edge-tts memakai format yang sama di setiap potongan -> bisa digabung langsung.
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(b"".join(parts))
    tmp.replace(path)
    prune_cache()
    return FileResponse(path, media_type="audio/mpeg", filename="narasi.mp3", content_disposition_type="inline",
                        headers={"X-Cache": "MISS", "X-Chunks": str(len(chunks))})


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})
