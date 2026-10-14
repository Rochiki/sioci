"""Tes server TTS tanpa internet: edge-tts diganti tiruan (mock).
Jalankan:  pip install pytest httpx  &&  pytest -q
"""
import os
import tempfile

os.environ["CACHE_DIR"] = tempfile.mkdtemp()
os.environ["CHUNK_CHARS"] = "200"

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

CALLS = []


class FakeCommunicate:
    def __init__(self, text, voice, **kw):
        CALLS.append((text, voice, kw))
        self.text = text

    async def stream(self):
        yield {"type": "WordBoundary", "offset": 0}
        yield {"type": "audio", "data": b"ID3" + self.text[:5].encode()}


async def fake_list_voices():
    return [
        {"ShortName": "id-ID-GadisNeural", "Locale": "id-ID", "Gender": "Female"},
        {"ShortName": "id-ID-ArdiNeural", "Locale": "id-ID", "Gender": "Male"},
        {"ShortName": "en-US-AvaMultilingualNeural", "Locale": "en-US", "Gender": "Female"},
        {"ShortName": "en-US-GuyNeural", "Locale": "en-US", "Gender": "Male"},
    ]


main.edge_tts.Communicate = FakeCommunicate
main.edge_tts.list_voices = fake_list_voices
client = TestClient(main.app)


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_voices_filter_includes_multilingual():
    names = [v["name"] for v in client.get("/voices?lang=id").json()]
    assert names == ["id-ID-GadisNeural", "id-ID-ArdiNeural", "en-US-AvaMultilingualNeural"]


def test_split_long_text_respects_limit_and_order():
    text = ("Kalimat nomor satu tentang APD. " * 20 + "\n\n") * 3
    parts = main.split_text(main.clean_text(text), 200)
    assert all(len(p) <= 200 for p in parts)
    assert "".join(parts).replace("\n", "").replace(" ", "") == main.clean_text(text).replace("\n", "").replace(" ", "")


def test_tts_long_text_chunked_and_cached():
    CALLS.clear()
    text = "Gunakan helm keselamatan di area kerja. " * 30  # ~1200 karakter -> beberapa potongan
    r = client.post("/tts", json={"text": text, "voice": "id-ID-ArdiNeural", "rate": "-5%"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "audio/mpeg"
    assert r.headers["x-cache"] == "MISS" and int(r.headers["x-chunks"]) > 1
    assert len(CALLS) == int(r.headers["x-chunks"])
    assert r.content.startswith(b"ID3")
    r2 = client.post("/tts", json={"text": text, "voice": "id-ID-ArdiNeural", "rate": "-5%"})
    assert r2.headers["x-cache"] == "HIT" and r2.content == r.content


def test_validation():
    assert client.post("/tts", json={"text": "   "}).status_code == 400
    assert client.post("/tts", json={"text": "halo", "voice": "<speak>"}).status_code == 400
    assert client.post("/tts", json={"text": "halo", "rate": "cepat"}).status_code == 400
    r = client.post("/tts", json={"text": "a" * (main.MAX_CHARS + 1)})
    assert r.status_code == 413 and "terlalu panjang" in r.json()["error"]


def test_rate_limit():
    main._hits.clear()
    old = main.RATE_LIMIT_PER_MIN
    main.RATE_LIMIT_PER_MIN = 2
    try:
        codes = [client.post("/tts", json={"text": f"tes {i}"}).status_code for i in range(3)]
        assert codes == [200, 200, 429]
    finally:
        main.RATE_LIMIT_PER_MIN = old
        main._hits.clear()
