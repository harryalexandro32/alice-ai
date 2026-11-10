/**
 * Jalur WhatsApp resmi: Cloud API (Meta Graph API) + webhook.
 *
 * Masuk : Meta memanggil POST /webhook di server ini. Tiap panggilan dicek
 *         tanda tangannya (X-Hub-Signature-256, HMAC dengan App Secret) —
 *         tanpa itu, siapa pun yang tahu URL-nya bisa menyuntik "pesan
 *         pelanggan" palsu dan membuat bot mengirim apa saja ke siapa saja.
 * Keluar: POST {WA_API_BASE}/{WA_PHONE_NUMBER_ID}/messages.
 *
 * Coexistence: pesan yang diketik pemilik dari aplikasi WhatsApp Business
 * datang sebagai webhook `smb_message_echoes`, dan diteruskan sebagai
 * "manusia membalas" supaya bot mundur dari percakapan itu.
 *
 * Dua aturan Cloud API yang membentuk kode ini:
 *   - Teks bebas hanya boleh dalam 24 jam sejak pesan terakhir pelanggan.
 *     Di luar itu wajib template yang disetujui Meta (galat 131047).
 *   - Sebuah nomor tidak bisa mengirimi dirinya sendiri.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { cfg, HOUR, normPhone } from '../config';
import type { Transport, TransportHandlers } from './types';

let handlers: TransportHandlers | null = null;
let server: Server | null = null;
let self: string | null = null;

/** Id pesan yang dikirim bot sendiri, buat membedakannya dari balasan manusia. */
const sentIds = new Set<string>();
const lastSentText = new Map<string, string>();

const digits = (s: string): string => s.replace(/[^0-9]/g, '');

interface WaMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}
interface WaEcho {
  to?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
}
interface WaChange {
  field?: string;
  value?: {
    metadata?: { phone_number_id?: string };
    messages?: WaMessage[];
    message_echoes?: WaEcho[];
    statuses?: { id?: string; status?: string; recipient_id?: string; errors?: { code?: number; title?: string }[] }[];
  };
}

function textOf(m: WaMessage): string | null {
  const t =
    m.type === 'text'
      ? m.text?.body
      : m.type === 'button'
        ? m.button?.text
        : m.type === 'interactive'
          ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title)
          : null;
  return t?.trim() || null;
}

/** Jenis yang bukan isi percakapan: tidak dibalas. */
const NOT_A_MESSAGE = new Set(['reaction', 'system', 'unsupported', 'edit', 'revoke']);

function process_(body: { entry?: { changes?: WaChange[] }[] }): void {
  if (!handlers) return;
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value;
      if (!v) continue;
      const pid = v.metadata?.phone_number_id;
      if (pid && pid !== cfg.waPhoneNumberId) {
        console.log(`[cloud] dilewat: untuk nomor lain (${pid})`);
        continue;
      }

      if (ch.field === 'messages') {
        for (const m of v.messages ?? []) {
          const tag = `dari=${m.from ?? '?'} jenis=${m.type ?? '?'} id=${m.id ?? '?'}`;
          if (!m.from || NOT_A_MESSAGE.has(m.type ?? '')) {
            console.log(`[cloud] dilewat (bukan isi percakapan): ${tag}`);
            continue;
          }
          // Meta mengulang webhook yang gagal sampai berhari-hari. Pesan yang
          // sudah di luar jendela layanan tidak bisa dibalas dengan teks bebas.
          const age = Date.now() - Number(m.timestamp ?? 0) * 1000;
          if (age > 12 * HOUR) {
            console.log(`[cloud] dilewat (pesan lama, ${Math.round(age / HOUR)} jam): ${tag}`);
            continue;
          }
          console.log(`[cloud] diproses: ${tag}`);
          handlers.onInbound({
            phone: `+${digits(m.from)}`,
            address: digits(m.from),
            text: textOf(m),
            waId: m.id ?? null,
          });
        }
        for (const s of v.statuses ?? []) {
          if (s.status === 'failed') {
            const err = s.errors?.[0];
            console.error(`[cloud] GAGAL terkirim ke ${s.recipient_id}: ${err?.code} ${err?.title}`);
          }
        }
      } else if (ch.field === 'smb_message_echoes') {
        for (const e of v.message_echoes ?? []) {
          const text = e.text?.body?.trim() ?? '';
          if (!e.to) {
            console.log(`[cloud] echo tanpa nomor tujuan, dilewat (id=${e.id ?? '?'})`);
            continue;
          }
          const to = digits(e.to);
          if ((e.id && sentIds.has(e.id)) || (text && lastSentText.get(to) === text)) {
            console.log(`[cloud] dilewat (kiriman bot sendiri): ke=${to}`);
            continue;
          }
          console.log(`[cloud] manusia membalas dari aplikasi: ke=${to}`);
          handlers.onHumanReply({ address: to, text });
        }
      }
      // history, smb_app_state_sync, account_update: tidak dipakai.
    }
  }
}

function validSignature(raw: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', cfg.waAppSecret).update(raw).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function onRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  const end = (code: number, body = '') => {
    res.writeHead(code, { 'content-type': 'text/plain' });
    res.end(body);
  };

  if (url.pathname === '/health') return end(200, 'ok');
  if (url.pathname !== '/webhook') return end(404);

  // Verifikasi sekali waktu URL didaftarkan di dasbor Meta.
  if (req.method === 'GET') {
    const ok =
      url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === cfg.waVerifyToken;
    return ok ? end(200, url.searchParams.get('hub.challenge') ?? '') : end(403);
  }
  if (req.method !== 'POST') return end(405);

  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > 1_000_000) req.destroy();
    else chunks.push(c);
  });
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    if (!validSignature(raw, req.headers['x-hub-signature-256'] as string | undefined)) {
      console.error('[cloud] webhook DITOLAK: tanda tangan tidak cocok');
      return end(401);
    }
    // Jawab dulu, proses kemudian: Meta menganggap gagal kalau lambat dijawab,
    // lalu mengirim ulang.
    end(200);
    try {
      process_(JSON.parse(raw.toString('utf8')));
    } catch (e) {
      console.error('[cloud] webhook tidak terbaca:', e instanceof Error ? e.message : e);
    }
  });
}

async function graph(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${cfg.waApiBase}/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${cfg.waToken}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const err = data?.error ?? {};
    const hint =
      err.code === 131047
        ? ' — di luar jendela 24 jam, butuh template yang disetujui'
        : err.code === 190
          ? ' — token tidak berlaku'
          : '';
    throw new Error(`Cloud API ${res.status} (${err.code ?? '?'}): ${err.message ?? 'tanpa pesan'}${hint}`);
  }
  return data;
}

export function cloudPort(): number | null {
  const a = server?.address();
  return a && typeof a === 'object' ? (a as AddressInfo).port : null;
}

export async function stopCloud(): Promise<void> {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
}

export const cloudTransport: Transport = {
  name: 'cloud',
  canMessageSelf: false,
  selfPhone: () => self,

  async start(h) {
    const missing = (
      [
        ['WA_PHONE_NUMBER_ID', cfg.waPhoneNumberId],
        ['WA_TOKEN', cfg.waToken],
        ['WA_APP_SECRET', cfg.waAppSecret],
        ['WA_VERIFY_TOKEN', cfg.waVerifyToken],
      ] as const
    ).filter(([, v]) => !v);
    if (missing.length) throw new Error(`env belum diisi: ${missing.map(([k]) => k).join(', ')}`);

    handlers = h;

    // Sekaligus memastikan token dan id nomornya benar sebelum menerima pesan.
    try {
      const info = await graph(`${cfg.waPhoneNumberId}?fields=display_phone_number,verified_name`);
      self = normPhone(String(info.display_phone_number ?? ''));
      console.log(`[cloud] nomor: ${info.display_phone_number} (${info.verified_name ?? '-'})`);
    } catch (e) {
      console.error(`[cloud] PERINGATAN: tidak bisa membaca info nomor: ${e instanceof Error ? e.message : e}`);
    }

    server = createServer(onRequest);
    await new Promise<void>((resolve) => server!.listen(cfg.port, resolve));
    console.log(`[cloud] webhook mendengarkan di port ${cloudPort()} (/webhook) — SIAP`);
  },

  async send(to, text, opts) {
    const number = digits(to.address || to.phone);
    const body =
      opts?.notify && cfg.waLeadTemplate
        ? {
            messaging_product: 'whatsapp',
            to: number,
            type: 'template',
            template: {
              name: cfg.waLeadTemplate,
              language: { code: cfg.waLeadTemplateLang },
              // Parameter template tidak boleh memuat baris baru.
              components: [
                {
                  type: 'body',
                  parameters: [{ type: 'text', text: text.replace(/\s*\n\s*/g, ' | ').slice(0, 1000) }],
                },
              ],
            },
          }
        : {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: number,
            type: 'text',
            text: { preview_url: false, body: text },
          };

    lastSentText.set(number, text);
    const data = await graph(`${cfg.waPhoneNumberId}/messages`, { method: 'POST', body: JSON.stringify(body) });
    const id = data?.messages?.[0]?.id as string | undefined;
    if (id) {
      sentIds.add(id);
      if (sentIds.size > 2000) sentIds.delete(sentIds.values().next().value as string);
    }
  },
};
