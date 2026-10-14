// ============================================================
// tts.js — Text-to-Speech untuk Builder
//
// Dua mesin, dipilih sesuai kebutuhan:
//
// 1. EdgeTTS (direkomendasikan untuk voiceover)
//    Memanggil server kecil kita (folder tts-server/, Python + edge-tts).
//    Hasilnya FILE MP3 -> bisa dimasukkan ke dalam paket SCORM,
//    sehingga suara tetap sama di LMS mana pun & di perangkat apa pun.
//    Gratis, tanpa API key, suara Neural natural (id-ID-GadisNeural, id-ID-ArdiNeural).
//
// 2. BrowserTTS (Web Speech API, cadangan tanpa server)
//    Bawaan browser, 100% gratis & offline-friendly, TETAPI:
//    - tidak bisa direkam menjadi file -> hanya dibacakan langsung,
//    - kualitas & ketersediaan suara tergantung perangkat peserta
//      (Microsoft Edge punya suara "Online (Natural)" yang bagus;
//      Chrome punya "Google Bahasa Indonesia").
// ============================================================

/**
 * Kamus pelafalan: singkatan yang sering salah dibaca mesin TTS.
 * Tambahkan istilah Anda sendiri di sini (kunci = teks asli, nilai = cara baca).
 */
export const PRONUNCIATION = {
  K3: 'K tiga', K3L: 'K tiga L', APD: 'A P D', SOP: 'S O P', LMS: 'L M S', SCORM: 'skorm',
};

/** Buang format markdown sederhana & rapikan teks agar enak dibacakan. */
export function cleanForSpeech(text = '') {
  let t = String(text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')            // gambar markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')          // link -> teksnya saja
    .replace(/[*_`#>]+/g, '')                          // simbol format
    .replace(/^\s*[-•]\s+/gm, '')                      // bullet
    .replace(/[ \t]+/g, ' ');
  for (const [word, say] of Object.entries(PRONUNCIATION)) {
    t = t.replace(new RegExp(`\\b${word}\\b`, 'g'), say);
  }
  return t.trim();
}

/** Pecah teks menjadi potongan pendek di batas kalimat (untuk Web Speech). */
export function splitSentences(text, max = 220) {
  const out = [];
  for (const sentence of text.split(/(?<=[.!?…])\s+|\n+/)) {
    let s = sentence.trim();
    while (s.length > max) {
      let cut = s.lastIndexOf(',', max);
      if (cut < max / 2) cut = s.lastIndexOf(' ', max);
      if (cut < max / 2) cut = max;
      out.push(s.slice(0, cut + 1).trim());
      s = s.slice(cut + 1).trim();
    }
    if (s) out.push(s);
  }
  return out;
}

// ------------------------------------------------------------ 1) Edge TTS via server
export class EdgeTTS {
  /** @param {string} serverUrl mis. "http://localhost:8000" atau "https://tts-anda.onrender.com" */
  constructor(serverUrl) { this.base = String(serverUrl || '').replace(/\/+$/, ''); }

  async #json(path, opt) {
    let res;
    try { res = await fetch(this.base + path, opt); } catch {
      throw new Error(`Server TTS tidak bisa dihubungi di ${this.base}. Pastikan server berjalan & alamatnya benar (lihat README).`);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Server TTS menjawab ${res.status}`);
    }
    return res;
  }

  async health() { return (await this.#json('/health')).json(); }

  /** @returns {Promise<{name:string, locale:string, gender:string, multilingual:boolean}[]>} */
  async voices(lang = 'id') { return (await this.#json(`/voices?lang=${encodeURIComponent(lang)}`)).json(); }

  /**
   * Ubah teks menjadi MP3.
   * @param {string} text  boleh panjang (server memotong otomatis, default maks 20.000 karakter)
   * @param {{voice?:string, rate?:number, pitch?:number}} opt rate & pitch dalam persen/Hz, mis. rate: -10
   * @returns {Promise<Blob>} audio/mpeg
   */
  async synthesize(text, { voice = 'id-ID-GadisNeural', rate = 0, pitch = 0 } = {}) {
    const sign = (n, unit) => `${n >= 0 ? '+' : ''}${Math.round(n)}${unit}`;
    const res = await this.#json('/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanForSpeech(text), voice, rate: sign(rate, '%'), pitch: sign(pitch, 'Hz') }),
    });
    return res.blob();
  }
}

// ------------------------------------------------------------ 2) Web Speech API (di browser)
export class BrowserTTS {
  static get supported() { return typeof window !== 'undefined' && 'speechSynthesis' in window; }

  /** Daftar suara browser (menunggu event voiceschanged, perlu di Chrome). */
  static voices(langPrefix = 'id') {
    if (!BrowserTTS.supported) return Promise.resolve([]);
    const pick = () => speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
    return new Promise((resolve) => {
      const now = pick();
      if (now.length || speechSynthesis.getVoices().length) return resolve(sortVoices(now));
      speechSynthesis.addEventListener('voiceschanged', () => resolve(sortVoices(pick())), { once: true });
      setTimeout(() => resolve(sortVoices(pick())), 1500);
    });
  }

  constructor() { this.queue = []; this.stopped = true; }

  /**
   * Bacakan teks panjang. Teks dipecah per kalimat lalu diputar berurutan —
   * cara ini menghindari bug Chrome yang memotong ucapan panjang (~15 detik).
   */
  speak(text, { voice = null, rate = 1, pitch = 1, onEnd = () => {} } = {}) {
    this.stop();
    if (!BrowserTTS.supported) throw new Error('Browser ini tidak mendukung Web Speech API.');
    this.stopped = false;
    this.queue = splitSentences(cleanForSpeech(text));
    const next = () => {
      if (this.stopped) return;
      const part = this.queue.shift();
      if (!part) { this.stopped = true; onEnd(); return; }
      const u = new SpeechSynthesisUtterance(part);
      u.lang = voice?.lang || 'id-ID';
      if (voice) u.voice = voice;
      u.rate = rate; u.pitch = pitch;
      u.onend = next;
      u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') next(); };
      speechSynthesis.speak(u);
    };
    next();
  }
  pause() { speechSynthesis.pause(); }
  resume() { speechSynthesis.resume(); }
  stop() { this.stopped = true; this.queue = []; if (BrowserTTS.supported) speechSynthesis.cancel(); }
}

/** Urutkan: suara "Natural/Online/Neural" dulu (biasanya paling bagus). */
function sortVoices(list) {
  const score = (v) => (/natural|neural|online/i.test(v.name) ? 0 : /google/i.test(v.name) ? 1 : 2);
  return [...list].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}
