# Server TTS Studio SCORM (file main.py & requirements.txt ada di root repo) — siap untuk Render, Railway, Fly.io, Hugging Face Spaces (Docker), atau VPS.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
# Render/Railway mengisi $PORT otomatis; Hugging Face Spaces memakai 7860.
ENV PORT=8000 TRUST_PROXY=1 CACHE_DIR=/tmp/tts-cache
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
