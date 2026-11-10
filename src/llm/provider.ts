/**
 * Sambungan ke LLM lewat antarmuka OpenAI-compatible (bawaan: DeepSeek).
 *
 * Tanpa SDK: satu fetch. Ganti penyedia = ganti LLM_BASE_URL + LLM_MODEL.
 *
 * API yang dipanggil dari WhatsApp adalah API yang bisa dipanggil siapa pun
 * yang bisa mengetik, jadi ada tiga pagar biaya: jatah panggilan per hari,
 * teks masuk dipotong oleh pemanggil, dan tiap panggilan dicatat tokennya.
 * Null = mati / jatah habis / gagal; pemanggil wajib punya jalan tanpa LLM.
 */

import { cfg } from '../config';
import { localDay, now } from '../clock';

const usage = { day: '', calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0 };

export function llmEnabled(): boolean {
  return Boolean(cfg.llmApiKey);
}

function withinBudget(): boolean {
  if (!llmEnabled()) return false;
  const d = localDay(now());
  if (usage.day !== d) {
    usage.day = d;
    usage.calls = usage.promptTokens = usage.cachedTokens = usage.completionTokens = 0;
  }
  return usage.calls < cfg.llmDailyLimit;
}

export function llmUsageToday() {
  return { ...usage, model: cfg.llmModel, limit: cfg.llmDailyLimit };
}

export interface AskOptions {
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
}

/** Satu panggilan, jawaban berupa teks JSON. */
export async function askJson(opts: AskOptions): Promise<string | null> {
  if (!withinBudget()) return null;
  usage.calls += 1;

  try {
    const res = await fetch(`${cfg.llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.llmApiKey}`,
      },
      body: JSON.stringify({
        model: cfg.llmModel,
        // Prompt sistem sama persis tiap panggilan: jadi awalan yang di-cache
        // penyedia, dan itu bagian terbesar dari tiap permintaan.
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
        response_format: { type: 'json_object' },
        max_tokens: opts.maxTokens ?? 600,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      console.error(`[llm] HTTP ${res.status} dari ${cfg.llmModel}: ${body}`);
      return null;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number };
    };
    usage.promptTokens += data.usage?.prompt_tokens ?? 0;
    usage.cachedTokens += data.usage?.prompt_cache_hit_tokens ?? 0;
    usage.completionTokens += data.usage?.completion_tokens ?? 0;

    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error(`[llm] gagal (${cfg.llmModel}): ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
