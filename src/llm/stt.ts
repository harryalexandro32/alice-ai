/**
 * Pesan suara -> teks, lewat layanan speech-to-text yang berbicara format
 * OpenAI (`POST {STT_BASE_URL}/audio/transcriptions`). Penyedia LLM utama
 * (DeepSeek) tidak menerima audio, jadi ini penyedia terpisah dengan kuncinya
 * sendiri; tanpa STT_API_KEY fitur ini mati dan pesan suara diteruskan ke staf
 * seperti biasa.
 */

import { cfg } from '../config';

export const sttEnabled = (): boolean => Boolean(cfg.sttApiKey && cfg.sttBaseUrl);

/** Pesan suara lebih panjang/besar dari ini tidak ditranskripsi. */
export const STT_MAX_BYTES = 8_000_000;

/** Teks dari pesan suara, atau null kalau gagal / kosong. Tidak pernah melempar. */
export async function transcribe(data: Buffer, mime: string): Promise<string | null> {
  if (!sttEnabled() || !data.length || data.length > STT_MAX_BYTES) return null;
  try {
    // WhatsApp mengirim pesan suara sebagai OGG/Opus.
    const type = mime.split(';')[0]?.trim() || 'audio/ogg';
    const ext = type.includes('mpeg') ? 'mp3' : type.includes('mp4') || type.includes('m4a') ? 'm4a' : type.includes('wav') ? 'wav' : 'ogg';
    const form = new FormData();
    form.append('model', cfg.sttModel);
    form.append('language', cfg.sttLanguage);
    form.append('response_format', 'json');
    form.append('file', new Blob([new Uint8Array(data)], { type }), `suara.${ext}`);
    const res = await fetch(`${cfg.sttBaseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.sttApiKey}` },
      body: form,
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      console.error(`[suara] HTTP ${res.status} dari ${cfg.sttModel}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const text = ((await res.json()) as { text?: string }).text?.replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, 1500) : null;
  } catch (e) {
    console.error(`[suara] transkripsi gagal: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
