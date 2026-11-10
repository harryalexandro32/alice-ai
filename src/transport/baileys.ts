/**
 * Jalur WhatsApp lewat Baileys (tahap 1: demo di nomor tes).
 *
 * Diturunkan dari oxy-wa-bot/src/wa.ts, dan pelajaran lapangannya ikut:
 *   - 440 (sesi direbut) = BERHENTI, bukan balas merebut.
 *   - Nomor generasi socket, supaya socket lama tidak menjadwalkan sambungan.
 *   - Chat pribadi bisa datang sebagai @lid; nomornya ada di key.senderPn.
 *   - Tiap pesan yang dibuang disebut alasannya di log.
 *   - Jeda minimum antar kiriman.
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
import qrcode from 'qrcode-terminal';

import { cfg } from '../config';
import type { Transport, TransportHandlers } from './types';

const MIN_GAP_MS = 1500;
const MAX_RETRY_MS = 60_000;

let sock: WASocket | null = null;
let handlers: TransportHandlers | null = null;
let generation = 0;
let retryDelayMs = 2_000;
let lastSentAt = 0;
let sendChain: Promise<void> = Promise.resolve();

/** Id pesan yang dikirim bot sendiri, buat membedakannya dari balasan manusia. */
const sentIds = new Set<string>();
/** Teks terakhir yang dikirim bot per alamat — pagar kedua untuk hal yang sama. */
const lastSentText = new Map<string, string>();

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
  if (m.ephemeralMessage?.message) return textOf(m.ephemeralMessage.message);
  if (m.viewOnceMessage?.message) return textOf(m.viewOnceMessage.message);
  return null;
}

/** Isi yang bukan percakapan: tidak dibalas, dan tidak dihitung "manusia membalas". */
const NOT_A_MESSAGE = new Set([
  'protocolMessage', 'senderKeyDistributionMessage', 'reactionMessage', 'pollUpdateMessage',
  'keepInChatMessage', 'messageContextInfo',
]);

async function connect(): Promise<void> {
  const myGeneration = ++generation;
  const { state, saveCreds } = await useMultiFileAuthState(cfg.waAuthDir);
  const { version } = await fetchLatestBaileysVersion();

  const s = makeWASocket({
    version,
    auth: state,
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
      console.log(`[wa] tersambung sebagai ${s.user?.id ?? '?'} — SIAP`);
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode;
      s.ev.removeAllListeners('connection.update');
      s.ev.removeAllListeners('messages.upsert');
      s.ev.removeAllListeners('creds.update');
      if (sock === s) sock = null;

      if (code === DisconnectReason.loggedOut) {
        console.error(
          `\n[wa] SESI DICABUT dari HP. Hapus folder ${cfg.waAuthDir} lalu jalankan ulang buat pairing.\n`
        );
        process.exitCode = 1;
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        console.error(
          '\n[wa] SESI DIREBUT (440) — ada sesi lain yang pakai kredensial ini.\n' +
            '     Hampir selalu: ada `npm start` kedua yang masih jalan. Tutup semuanya,\n' +
            '     nyalakan satu saja. Bot sengaja TIDAK menyambung ulang.\n'
        );
        process.exitCode = 1;
        return;
      }

      console.warn(`[wa] terputus (${code ?? 'tanpa kode'}), menyambung lagi dalam ${retryDelayMs / 1000}s`);
      setTimeout(() => void connect(), retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_MS);
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

      console.log(`[wa] diproses: ${phone} ${tag}`);
      handlers.onInbound({ phone, address: jid, text, waId: m.key.id ?? null });
    }
  });
}

async function sendNow(jid: string, text: string): Promise<void> {
  const s = sock;
  if (!s) throw new Error('WhatsApp belum tersambung');

  const wait = Math.max(0, lastSentAt + MIN_GAP_MS - Date.now());
  // "sedang mengetik…" selama jeda: irama balasan jadi wajar, bukan 20 milidetik.
  await s.sendPresenceUpdate('composing', jid).catch(() => {});
  await new Promise((r) => setTimeout(r, Math.max(wait, 800)));
  lastSentAt = Date.now();

  lastSentText.set(jid, text);
  const res = await s.sendMessage(jid, { text });
  if (res?.key.id) {
    sentIds.add(res.key.id);
    if (sentIds.size > 2000) sentIds.delete(sentIds.values().next().value as string);
  }
}

export const baileysTransport: Transport = {
  async start(h) {
    handlers = h;
    await connect();
  },
  send(to, text) {
    const jid = to.address || `${to.phone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    // Satu antrean: dua kiriman bersamaan tidak boleh saling menyalip jedanya.
    const job = sendChain.then(() => sendNow(jid, text));
    sendChain = job.catch(() => {});
    return job;
  },
};
