/**
 * Jalur WhatsApp lewat Baileys (tahap 1: demo di nomor tes).
 *
 * Diturunkan dari oxy-wa-bot/src/wa.ts, dan pelajaran lapangannya ikut:
 *   - 440 (sesi direbut) = BERHENTI, bukan balas merebut.
 *   - Nomor generasi socket, supaya socket lama tidak menjadwalkan sambungan.
 *   - Chat pribadi bisa datang sebagai @lid; nomornya ada di key.senderPn.
 *   - Tiap pesan yang dibuang disebut alasannya di log.
 *   - Jeda minimum antar kiriman.
 *   - Batas kiriman dan jeda setelah tanda bahaya: sendguard.ts.
 *   - Pesan pelanggan ditandai terbaca sebelum "sedang mengetik…" muncul,
 *     seperti orang yang membuka chat dulu baru membalas.
 *
 * Bedanya dengan bot Oxy: bot ini melayani nomor yang TIDAK dikenal, dan
 * pemilik nomor ikut membalas dari HP. Pesan `fromMe` yang bukan kiriman bot
 * berarti manusia sedang mengambil alih percakapan itu.
 *
 * Folder kredensial (WA_AUTH_DIR) setara akses penuh ke nomor tersebut.
 */

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import { readFileSync } from 'node:fs';

import pino from 'pino';

import qrcode from 'qrcode-terminal';

import { cfg } from '../config';
import { recordError } from '../errlog';
import { afterSend, beforeSend, onDisconnect, onOpen, onSendError } from './sendguard';
import type { MediaKind, SendOptions, Transport, TransportHandlers } from './types';

/** Jarak minimum antar kiriman. Jeda "manusiawi" yang panjang diatur di app.ts. */
const MIN_GAP_MS = 1200;
const MAX_RETRY_MS = 60_000;

let sock: WASocket | null = null;
let handlers: TransportHandlers | null = null;
let generation = 0;
let retryDelayMs = 2_000;
let lastSentAt = 0;
let sendChain: Promise<void> = Promise.resolve();
let selfNumber: string | null = null;

/** Id pesan yang dikirim bot sendiri, buat membedakannya dari balasan manusia. */
const sentIds = new Set<string>();
/** Teks terakhir yang dikirim bot per alamat — pagar kedua untuk hal yang sama. */
const lastSentText = new Map<string, string>();
/** Pesan pelanggan yang belum ditandai terbaca, per alamat. */
const unread = new Map<string, NonNullable<Parameters<WASocket['readMessages']>[0]>>();

function jidToE164(jid: string | null | undefined): string | null {
  const m = (jid ?? '').match(/^(\d{7,15})(?::\d+)?@s\.whatsapp\.net$/);
  return m?.[1] ? `+${m[1]}` : null;
}

function textOf(msg: Record<string, unknown> | null | undefined): string | null {
  if (!msg) return null;
  const m = msg as {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    ephemeralMessage?: { message?: Record<string, unknown> };
    viewOnceMessage?: { message?: Record<string, unknown> };
  };
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  for (const inner of unwrap(msg)) return textOf(inner);
  // Keterangan yang diketik bersama foto / video / dokumen.
  const cap = msg as Record<string, { caption?: string } | undefined>;
  return cap.imageMessage?.caption || cap.videoMessage?.caption || cap.documentMessage?.caption || null;
}

/** Pesan yang dibungkus (pesan sementara, sekali lihat, dokumen berketerangan). */
function unwrap(msg: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const k of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']) {
    const inner = (msg[k] as { message?: Record<string, unknown> } | undefined)?.message;
    if (inner) out.push(inner);
  }
  return out;
}

const MEDIA: Record<string, MediaKind> = {
  imageMessage: 'foto', videoMessage: 'video', ptvMessage: 'video', audioMessage: 'suara', documentMessage: 'dokumen',
  stickerMessage: 'stiker', locationMessage: 'lokasi', liveLocationMessage: 'lokasi', contactMessage: 'kontak', contactsArrayMessage: 'kontak',
};

function mediaOf(msg: Record<string, unknown> | null | undefined): MediaKind | undefined {
  if (!msg) return undefined;
  for (const k of Object.keys(msg)) if (MEDIA[k]) return MEDIA[k];
  for (const inner of unwrap(msg)) {
    const found = mediaOf(inner);
    if (found) return found;
  }
  return undefined;
}

/** Isi yang bukan percakapan: tidak dibalas, dan tidak dihitung "manusia membalas". */
const NOT_A_MESSAGE = new Set([
  'protocolMessage', 'senderKeyDistributionMessage', 'reactionMessage', 'pollUpdateMessage',
  'keepInChatMessage', 'messageContextInfo',
]);

/**
 * Bentuk pesan yang hanya bisa dikirim akun bisnis lewat API: promo, OTP,
 * notifikasi bertombol. Pengirimnya mesin, bukan calon pelanggan — membalasnya
 * dengan salam (lalu follow-up) berarti bot mengobrol dengan bot lain.
 */
const AUTOMATED = new Set([
  'templateMessage', 'highlyStructuredMessage', 'buttonsMessage', 'listMessage', 'interactiveMessage',
  'productMessage', 'orderMessage', 'invoiceMessage', 'newsletterAdminInviteMessage',
]);

/** Lampiran yang baru dikirim, untuk mencatat apakah WhatsApp benar-benar menyampaikannya. */
const tracked = new Map<string, { what: string; timer: NodeJS.Timeout }>();
const STATUS = ['gagal', 'menunggu', 'diterima server', 'sampai di HP pelanggan', 'dibaca', 'diputar'];

/**
 * Log Baileys tetap tampil di terminal seperti biasa; baris galat (level 50+)
 * dan peringatan (40) juga disalin ke catatan galat untuk dashboard.
 */
const waLogger = pino(
  { level: 'info' },
  {
    write(line: string) {
      process.stdout.write(line);
      try {
        const j = JSON.parse(line) as { level?: number; msg?: string; err?: { message?: string }; trace?: string };
        if ((j.level ?? 0) >= 40) {
          const detail = j.err?.message ?? j.trace?.split('\n')[0] ?? '';
          recordError(j.level! >= 50 ? 'galat' : 'peringatan', `[baileys] ${j.msg ?? ''}${detail ? ` — ${detail}` : ''}`);
        }
      } catch {
        // bukan baris JSON
      }
    },
  }
).child({ class: 'baileys' });

let onFatal: ((text: string) => void) | null = null;
/** Dipasang app.ts: sambungan yang tidak akan pulih sendiri harus sampai ke pemilik. */
export function setFatalListener(fn: ((text: string) => void) | null): void {
  onFatal = fn;
}

async function connect(): Promise<void> {
  const myGeneration = ++generation;
  const { state, saveCreds } = await useMultiFileAuthState(cfg.waAuthDir);
  const { version } = await fetchLatestBaileysVersion();

  const s = makeWASocket({
    version,
    auth: state,
    logger: waLogger,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    // Kiriman bot sendiri tidak dipantulkan balik sebagai event; dengan begitu
    // setiap pesan `fromMe` yang masuk berasal dari perangkat lain = manusia.
    emitOwnEvents: false,
  });
  sock = s;

  s.ev.on('creds.update', saveCreds);

  if (cfg.waPairingNumber && !state.creds.registered) {
    const number = cfg.waPairingNumber.replace(/[^0-9]/g, '');
    setTimeout(async () => {
      try {
        const code = await s.requestPairingCode(number);
        console.log(`\n  KODE PAIRING: ${code}`);
        console.log('  WhatsApp di HP > Perangkat Tertaut > Tautkan dengan nomor telepon\n');
      } catch (e) {
        console.error('Gagal minta kode pairing:', e instanceof Error ? e.message : e);
      }
    }, 3_000);
  }

  s.ev.on('connection.update', (u) => {
    if (myGeneration !== generation) return;
    const { connection, lastDisconnect, qr } = u;

    if (qr && !cfg.waPairingNumber) {
      console.log('\n  Scan QR ini dari WhatsApp > Perangkat Tertaut:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      retryDelayMs = 2_000;
      onOpen();
      selfNumber = jidToE164(s.user?.id);
      console.log(`[wa] tersambung sebagai ${s.user?.id ?? '?'} — SIAP`);
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode;
      s.ev.removeAllListeners('connection.update');
      s.ev.removeAllListeners('messages.upsert');
      s.ev.removeAllListeners('messages.update');
      s.ev.removeAllListeners('creds.update');
      if (sock === s) sock = null;

      if (code === DisconnectReason.loggedOut) {
        onFatal?.('Sesi WhatsApp dicabut dari HP. Bot tidak bisa menerima maupun membalas pesan sampai ditautkan ulang.');
        console.error(
          `\n[wa] SESI DICABUT dari HP. Hapus folder ${cfg.waAuthDir} lalu jalankan ulang buat pairing.\n`
        );
        process.exitCode = 1;
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        onFatal?.('Sesi WhatsApp direbut sesi lain (440). Bot berhenti dan tidak menyambung ulang sendiri.');
        console.error(
          '\n[wa] SESI DIREBUT (440) — ada sesi lain yang pakai kredensial ini.\n' +
            '     Hampir selalu: ada `npm start` kedua yang masih jalan. Tutup semuanya,\n' +
            '     nyalakan satu saja. Bot sengaja TIDAK menyambung ulang.\n'
        );
        process.exitCode = 1;
        return;
      }

      // Pengaman boleh meminta jeda lebih panjang (mis. setelah 403/429).
      const delay = Math.max(retryDelayMs, onDisconnect(code));
      console.warn(`[wa] terputus (${code ?? 'tanpa kode'}), menyambung lagi dalam ${Math.round(delay / 1000)}s`);
      setTimeout(() => void connect(), delay);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_MS);
    }
  });

  // Status kiriman lampiran. "Diterima server" saja belum berarti sampai:
  // tanpa catatan ini, PDF yang tidak pernah muncul di HP pelanggan tidak
  // meninggalkan jejak apa pun di log.
  s.ev.on('messages.update', (updates) => {
    if (myGeneration !== generation) return;
    for (const u of updates) {
      const t = u.key.id ? tracked.get(u.key.id) : undefined;
      const status = u.update?.status;
      if (!t || typeof status !== 'number') continue;
      console.log(`[wa] ${t.what}: ${STATUS[status] ?? `status ${status}`}`);
      if (status >= 3 || status === 0) {
        clearTimeout(t.timer);
        tracked.delete(u.key.id as string);
      }
    }
  });

  s.ev.on('messages.upsert', ({ messages, type }) => {
    if (myGeneration !== generation || !handlers) return;

    for (const m of messages) {
      const jid = m.key.remoteJid ?? '';
      const kind = Object.keys(m.message ?? {}).find((k) => !NOT_A_MESSAGE.has(k)) ?? null;
      const tag = `type=${type} dari=${jid || '(tanpa jid)'} dariSaya=${m.key.fromMe ? 'ya' : 'tidak'} isi=${kind ?? 'kosong'}`;

      const isPrivate = jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid');
      if (!isPrivate) {
        console.log(`[wa] dilewat (bukan chat pribadi): ${tag}`);
        continue;
      }
      if (!kind) {
        console.log(`[wa] dilewat (bukan isi percakapan): ${tag}`);
        continue;
      }
      if (AUTOMATED.has(kind) && !m.key.fromMe) {
        console.log(`[wa] dilewat (pesan otomatis akun bisnis): ${tag}`);
        continue;
      }
      // Sinkronisasi riwayat membawa pesan lama; hanya yang baru yang dilayani.
      const ageSec = Date.now() / 1000 - Number(m.messageTimestamp ?? 0);
      if (ageSec > 120) {
        console.log(`[wa] dilewat (pesan lama, ${Math.round(ageSec)}s): ${tag}`);
        continue;
      }

      const text = textOf(m.message as Record<string, unknown> | null)?.trim() || null;

      if (m.key.fromMe) {
        const mine =
          (m.key.id && sentIds.has(m.key.id)) || (text !== null && lastSentText.get(jid) === text);
        if (mine) {
          console.log(`[wa] dilewat (kiriman bot sendiri): ${tag}`);
        } else {
          console.log(`[wa] manusia membalas: ${tag}`);
          handlers.onHumanReply({ address: jid, text: text ?? '' });
        }
        continue;
      }

      if (type !== 'notify') {
        console.log(`[wa] dilewat (bukan pesan baru): ${tag}`);
        continue;
      }

      const key = m.key as { senderPn?: string; participantPn?: string };
      const phone =
        jidToE164(key.senderPn) ??
        jidToE164(key.participantPn) ??
        jidToE164(jid) ??
        // WhatsApp tidak memberi nomornya. Tetap dilayani — calon pembeli tidak
        // boleh diabaikan — tapi dicatat dengan pengenal LID, bukan nomor tebakan.
        `lid:${jid.split('@')[0]}`;

      const keys = unread.get(jid) ?? [];
      keys.push(m.key);
      unread.set(jid, keys.slice(-20));
      if (unread.size > 500) unread.delete(unread.keys().next().value as string);
      console.log(`[wa] diproses: ${phone} ${tag}`);
      handlers.onInbound({ phone, address: jid, text, waId: m.key.id ?? null, media: mediaOf(m.message as Record<string, unknown> | null) });
    }
  });
}

async function sendNow(jid: string, text: string, opts?: SendOptions): Promise<void> {
  const s = sock;
  if (!s) throw new Error('WhatsApp belum tersambung');

  // Melempar kalau kiriman sedang dijeda atau batasnya tercapai: pemanggil
  // mencatatnya sebagai gagal kirim, dan bot diam untuk pesan ini.
  const wait = Math.max(beforeSend(), lastSentAt + MIN_GAP_MS - Date.now(), 0);
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastSentAt = Date.now();

  lastSentText.set(jid, text);
  let res;
  try {
    await markRead(jid);
    res = await s.sendMessage(
      jid,
      !opts?.image
        ? { text }
        : opts.image.toLowerCase().endsWith('.pdf')
          ? { document: readFileSync(opts.image), mimetype: 'application/pdf', fileName: opts.fileName ?? 'dokumen.pdf', caption: text }
          : { image: readFileSync(opts.image), caption: text }
    );
  } catch (e) {
    onSendError(e);
    throw e;
  }
  afterSend();
  if (opts?.image && res?.key.id) {
    const id = res.key.id;
    const what = `lampiran "${opts.fileName ?? text.slice(0, 40)}" ke ${jid}`;
    const timer = setTimeout(() => {
      if (tracked.delete(id)) console.error(`[wa] PERINGATAN: ${what} belum ada tanda sampai setelah 2 menit`);
    }, 120_000);
    timer.unref();
    tracked.set(id, { what, timer });
    console.log(`[wa] ${what}: terkirim ke server (id ${id})`);
  }
  if (res?.key.id) {
    sentIds.add(res.key.id);
    if (sentIds.size > 2000) sentIds.delete(sentIds.values().next().value as string);
  }
}

/** Tandai pesan pelanggan di chat ini terbaca. Gagal = tidak apa-apa. */
async function markRead(jid: string): Promise<void> {
  const keys = unread.get(jid);
  if (!keys?.length || !sock) return;
  unread.delete(jid);
  await sock.readMessages(keys).catch(() => {});
}

export const baileysTransport: Transport = {
  name: 'baileys',
  // Chat "pesan ke diri sendiri": notifikasi lead muncul di nomor bot itu sendiri.
  canMessageSelf: true,
  selfPhone: () => selfNumber,
  async start(h) {
    handlers = h;
    await connect();
  },
  async typing(to) {
    const jid = to.address || `${to.phone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    await markRead(jid);
    await sock?.sendPresenceUpdate('composing', jid).catch(() => {});
  },
  send(to, text, opts) {
    const jid = to.address || `${to.phone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    // Satu antrean: dua kiriman bersamaan tidak boleh saling menyalip jedanya.
    const job = sendChain.then(() => sendNow(jid, text, opts));
    sendChain = job.catch(() => {});
    return job;
  },
};
