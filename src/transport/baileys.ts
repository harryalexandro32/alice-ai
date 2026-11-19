/**
 * Jalur WhatsApp lewat Baileys (tahap 1: demo di nomor tes).
 *
 * Diturunkan dari oxy-wa-bot/src/wa.ts, dan pelajaran lapangannya ikut:
 *   - 440 (sesi direbut) = BERHENTI, bukan balas merebut.
 *   - Nomor generasi socket, supaya socket lama tidak menjadwalkan sambungan.
 *   - Chat pribadi bisa datang sebagai @lid; nomornya ada di key.senderPn.
 *   - Tiap pesan yang dibuang disebut alasannya di log.
 *   - Jeda minimum antar kiriman.
 *   - Batas kiriman dan jeda setelah tanda bahaya: sendguard.ts, ditambah
 *     kelas AntiBan dari pustaka baileys-antiban (lihat syncAntiBan).
 *   - Pesan pelanggan ditandai terbaca sebelum "sedang mengetik…" muncul,
 *     seperti orang yang membuka chat dulu baru membalas.
 *
 * Bedanya dengan bot Oxy: bot ini melayani nomor yang TIDAK dikenal, dan
 * pemilik nomor ikut membalas dari HP. Pesan `fromMe` yang bukan kiriman bot
 * berarti manusia sedang mengambil alih percakapan itu.
 *
 * Menautkan nomor dilakukan dari dashboard: QR dan kode pairing dilaporkan
 * lewat onState (lalu heartbeat.ts menulisnya ke database), dan dashboard bisa
 * meminta kode pairing atau memutus sesi untuk ditautkan ulang.
 *
 * Folder kredensial (auth/<proyek>/) setara akses penuh ke nomor tersebut.
 */

import type { WASocket } from '@whiskeysockets/baileys';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { AntiBan } from 'baileys-antiban';
import pino from 'pino';

import qrcode from 'qrcode-terminal';

import { cfg } from '../config';
import { recordError } from '../errlog';
import { antibanPaused, guardedSend, onDisconnect, onOpen, setAntiBan } from './sendguard';
import type { SendOptions, Transport, TransportHandlers, TransportState } from './types';
import { mediaOf, quoteOf, textOf, unwrap } from './wamessage';

/** Jarak minimum antar kiriman. Jeda "manusiawi" yang panjang diatur di app.ts. */
const MIN_GAP_MS = 1200;
const MAX_RETRY_MS = 60_000;

/**
 * Baileys 7 hanya tersedia sebagai modul ESM. Proyek ini CommonJS, jadi
 * pustakanya dimuat lewat import() dinamis; import statis akan gagal saat
 * Node mencari dependensinya (whatsapp-rust-bridge) dengan aturan require.
 */
type Baileys = typeof import('@whiskeysockets/baileys');
let baileysModule: Promise<Baileys> | null = null;
function baileys(): Promise<Baileys> {
  return (baileysModule ??= import('@whiskeysockets/baileys'));
}

let sock: WASocket | null = null;
let handlers: TransportHandlers | null = null;
let generation = 0;
let retryDelayMs = 2_000;
let lastSentAt = 0;
let sendChain: Promise<void> = Promise.resolve();
let selfNumber: string | null = null;
/** Kredensial sesi yang sedang dipakai (untuk tahu sudah tertaut atau belum). */
let creds: { registered?: boolean } | null = null;
/** Kode pairing sudah diminta untuk socket ini: QR berikutnya tidak menimpanya. */
let pairing = false;

let current: TransportState = { state: 'starting' };
let stateListener: ((s: TransportState) => void) | null = null;
function setState(s: TransportState): void {
  current = s;
  stateListener?.(s);
}

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
 * Log Baileys tetap tampil di terminal seperti biasa; baris error (level 50+)
 * dan warning (40) juga disalin ke catatan error untuk dashboard.
 */
const waLogger = pino(
  // WA_LOG_LEVEL=trace menulis setiap stanza XML yang masuk dan keluar: untuk
  // menelusuri pesan yang tidak sampai ke bot. Jangan dibiarkan menyala.
  { level: process.env.WA_LOG_LEVEL?.trim() || 'info' },
  {
    write(line: string) {
      process.stdout.write(line);
      try {
        const j = JSON.parse(line) as { level?: number; msg?: string; err?: { message?: string }; trace?: string };
        if ((j.level ?? 0) >= 40) {
          const detail = j.err?.message ?? j.trace?.split('\n')[0] ?? '';
          recordError(j.level! >= 50 ? 'error' : 'warning', `[baileys] ${j.msg ?? ''}${detail ? ` — ${detail}` : ''}`);
        }
      } catch {
        // bukan baris JSON
      }
    },
  }
).child({ class: 'baileys' });

/**
 * Pengaman dari pustaka baileys-antiban. Yang dipakai hanya kelas AntiBan
 * (beforeSend/afterSend di guardedSend), bukan wrapSocket, supaya tidak ada
 * yang terpasang diam-diam ke socket.
 *
 * Pilihan setelannya:
 *   - preset "conservative", dengan batas per menit/jam/hari dari Pengaturan
 *     proyek (waMaxPer*), jadi angka di dashboard tetap satu-satunya sumber;
 *   - pemanasan 7 hari mulai 20 kiriman di hari pertama (bisa dimatikan per
 *     proyek lewat waWarmup, untuk nomor yang sudah lama dipakai normal);
 *     jeda otomatis begitu risikonya "tinggi"; pesan yang persis sama paling
 *     banyak 40 kali sejam (lihat catatan di syncAntiBan);
 *   - keadaannya disimpan per proyek di <folder sesi>/antiban-state.json;
 *   - log pustakanya dimatikan (keadaannya tampil di dashboard).
 * Yang SENGAJA tidak dipakai (bagian pustaka itu yang menyamarkan atau
 * berpura-pura): sinyal "legitimasi" dan salah ketik buatan, penjaga grup,
 * proxy, webhook, dan layanan "human entropy". Semuanya kelas terpisah yang
 * tidak dibuat di sini; profil grup juga dimatikan (bot hanya chat pribadi).
 */
let antiban: AntiBan | null = null;
let antibanKey = '';

/** Buat AntiBan (lagi) kalau belum ada, atau kalau batas di Pengaturan berubah. */
function syncAntiBan(): void {
  const key = [cfg.waMaxPerMinute, cfg.waMaxPerHour, cfg.waMaxPerDay, cfg.waWarmup, cfg.waAuthDir].join('/');
  if (antiban && key === antibanKey) return;
  const old = antiban;
  mkdirSync(cfg.waAuthDir, { recursive: true });
  const next = new AntiBan({
    preset: 'conservative',
    maxPerMinute: cfg.waMaxPerMinute,
    maxPerHour: cfg.waMaxPerHour,
    maxPerDay: cfg.waMaxPerDay,
    // 0 hari = pemanasan mati: pustaka langsung menganggap nomornya "lulus"
    // (getDailyLimit di warmup.js), jadi tidak ada batas harian tambahan.
    warmupDays: cfg.waWarmup ? 7 : 0,
    day1Limit: 20,
    autoPauseAt: 'high',
    // Isi salam dan kalimat tetap (kiriman diterima, minta data, kata berhenti)
    // memang sengaja berulang ke banyak pelanggan; salamnya sudah divariasikan,
    // tapi isinya tetap sama. Batas 8 dulu membuat kiriman yang sah ikut
    // diblokir di jam ramai. Pesan yang benar-benar sama ke 40 orang dalam
    // satu jam tetap ditahan.
    maxIdenticalMessages: 40,
    identicalMessageWindowMs: 3600_000,
    groupProfiles: false,
    persist: join(cfg.waAuthDir, 'antiban-state.json'),
    logging: false,
    onAtRisk: (s) => antibanPaused(`risiko ${s.risk}: ${s.recommendation}`),
  });
  // Batas berubah: hitungan yang sudah berjalan dibawa ke yang baru.
  if (old) {
    try {
      next.importState(old.exportState());
    } catch (e) {
      console.error(`[pengaman] keadaan antiban tidak terbawa: ${e instanceof Error ? e.message : e}`);
    }
    old.destroy();
  }
  antiban = next;
  antibanKey = key;
  setAntiBan(next);
}

let onFatal: ((text: string) => void) | null = null;
/** Dipasang app.ts: sambungan yang tidak akan pulih sendiri harus sampai ke pemilik. */
export function setFatalListener(fn: ((text: string) => void) | null): void {
  onFatal = fn;
}

async function connect(): Promise<void> {
  const myGeneration = ++generation;
  pairing = false;
  if (current.state !== 'starting') setState({ state: 'starting', ...(current.detail ? { detail: current.detail } : {}) });
  const wa = await baileys();
  const { state, saveCreds } = await wa.useMultiFileAuthState(cfg.waAuthDir);
  creds = state.creds;
  syncAntiBan();
  const { version } = await wa.fetchLatestBaileysVersion();

  const s = wa.makeWASocket({
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

  s.ev.on('connection.update', (u) => {
    if (myGeneration !== generation) return;
    const { connection, lastDisconnect, qr } = u;

    // Setelah kode pairing diminta, QR baru tidak ditampilkan: yang berlaku kodenya.
    if (qr && !pairing) {
      console.log('\n  Scan QR ini dari WhatsApp > Perangkat Tertaut (atau dari dashboard, Pengaturan > WhatsApp):\n');
      qrcode.generate(qr, { small: true });
      setState({ state: 'qr', qr });
    }

    if (connection === 'open') {
      retryDelayMs = 2_000;
      pairing = false;
      onOpen();
      selfNumber = jidToE164(s.user?.id);
      console.log(`[wa] tersambung sebagai ${s.user?.id ?? '?'} — SIAP`);
      setState({ state: 'connected', ...(selfNumber ? { selfPhone: selfNumber } : {}) });
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode;
      s.ev.removeAllListeners('connection.update');
      s.ev.removeAllListeners('messages.upsert');
      s.ev.removeAllListeners('messages.update');
      s.ev.removeAllListeners('creds.update');
      if (sock === s) sock = null;

      if (code === wa.DisconnectReason.loggedOut) {
        onFatal?.('Sesi WhatsApp dicabut dari HP. Bot tidak bisa menerima maupun membalas pesan sampai ditautkan ulang.');
        console.error(
          `\n[wa] SESI DICABUT dari HP. Tautkan ulang dari dashboard (Pengaturan > WhatsApp > Putuskan & tautkan ulang).\n`
        );
        setState({ state: 'logged_out', detail: 'Sesi dicabut dari HP. Tekan "Putuskan & tautkan ulang" untuk menautkan lagi.' });
        process.exitCode = 1;
        return;
      }
      if (code === wa.DisconnectReason.connectionReplaced) {
        onFatal?.('Sesi WhatsApp direbut sesi lain (440). Bot berhenti dan tidak menyambung ulang sendiri.');
        setState({ state: 'conflict', detail: 'Ada sesi lain yang memakai kredensial ini (440). Pastikan hanya satu bot yang jalan, lalu nyalakan ulang bot.' });
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
      // Selama belum tertaut, sambungan memang ditutup tiap kali QR habis; itu bukan gangguan.
      if (creds?.registered) setState({ state: 'disconnected', detail: `Terputus (${code ?? 'tanpa kode'}), menyambung lagi` });
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
        // Catat bentuknya: pesan yang gagal didekripsi datang sebagai stub
        // CIPHERTEXT tanpa isi, dan tanpa catatan ini tidak bisa dibedakan
        // dari notifikasi biasa.
        const stub = m.messageStubType ? ` stub=${m.messageStubType}` : '';
        const params = m.messageStubParameters?.length ? ` param=${m.messageStubParameters.join('|')}` : '';
        const keys = Object.keys(m.message ?? {});
        console.log(`[wa] dilewat (bukan isi percakapan): ${tag}${stub}${params}${keys.length ? ` kunci=${keys.join(',')}` : ''}`);
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

      // Baileys 7 menaruh nomor telepon di remoteJidAlt/participantAlt;
      // senderPn/participantPn adalah nama lamanya (Baileys 6).
      const key = m.key as { remoteJidAlt?: string; participantAlt?: string; senderPn?: string; participantPn?: string };
      const phone =
        jidToE164(key.remoteJidAlt) ??
        jidToE164(key.participantAlt) ??
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
      const media = mediaOf(m.message as Record<string, unknown> | null);
      const quote = quoteOf(m.message as Record<string, unknown> | null, [sock?.user?.id, sock?.user?.lid], sentIds);
      handlers.onInbound({
        phone, address: jid, text, waId: m.key.id ?? null,
        ...(m.pushName ? { profileName: m.pushName } : {}),
        ...(media ? { media } : {}),
        ...(quote ? { quote } : {}),
        ...(media === 'foto' || media === 'suara'
          ? {
              fetchMedia: async () => {
                const data = await (await baileys()).downloadMediaMessage(m, 'buffer', {});
                const inner = [m.message as Record<string, unknown>, ...unwrap((m.message ?? {}) as Record<string, unknown>)];
                const mime =
                  inner.map((x) => ((x.imageMessage ?? x.audioMessage) as { mimetype?: string } | undefined)?.mimetype).find(Boolean) ??
                  (media === 'suara' ? 'audio/ogg' : 'image/jpeg');
                return { data: data as Buffer, mime };
              },
            }
          : {}),
      });
    }
  });
}

async function sendNow(jid: string, text: string, opts?: SendOptions): Promise<void> {
  const s = sock;
  if (!s) throw new Error('WhatsApp belum tersambung');

  // Melempar kalau kiriman sedang dijeda atau batasnya tercapai: pemanggil
  // mencatatnya sebagai gagal kirim, dan bot diam untuk pesan ini.
  syncAntiBan();
  const res = await guardedSend(jid, text, { minWaitMs: lastSentAt + MIN_GAP_MS - Date.now(), pacedMs: opts?.pacedMs }, async () => {
    lastSentAt = Date.now();
    lastSentText.set(jid, text);
    await markRead(jid);
    return s.sendMessage(
      jid,
      !opts?.image
        ? { text }
        : opts.image.toLowerCase().endsWith('.pdf')
          ? { document: readFileSync(opts.image), mimetype: 'application/pdf', fileName: opts.fileName ?? 'dokumen.pdf', caption: text }
          : { image: readFileSync(opts.image), caption: text }
    );
  });
  if (opts?.image && res?.key.id) {
    const id = res.key.id;
    const what = `lampiran "${opts.fileName ?? text.slice(0, 40)}" ke ${jid}`;
    const timer = setTimeout(() => {
      if (tracked.delete(id)) console.error(`[wa] WARNING: ${what} belum ada tanda sampai setelah 2 menit`);
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
  onState(cb) {
    stateListener = cb;
    cb(current);
  },
  async requestPairingCode(number) {
    const s = sock;
    if (!s) throw new Error('WhatsApp belum siap; coba lagi sebentar lagi');
    if (creds?.registered) throw new Error('Nomor sudah tertaut. Putuskan dulu untuk menautkan nomor lain.');
    const code = await s.requestPairingCode(number.replace(/[^0-9]/g, ''));
    pairing = true;
    console.log(`\n  KODE PAIRING: ${code}`);
    console.log('  WhatsApp di HP > Perangkat Tertaut > Tautkan dengan nomor telepon\n');
    setState({ state: 'pairing', pairingCode: code, detail: `Ketik kode ini di HP nomor +${number.replace(/[^0-9]/g, '')}` });
    return code;
  },
  async relink() {
    const old = sock;
    // Socket lama tidak boleh lagi menulis kredensial atau menjadwalkan sambungan.
    generation += 1;
    sock = null;
    if (old) {
      old.ev.removeAllListeners('creds.update');
      old.ev.removeAllListeners('connection.update');
      old.ev.removeAllListeners('messages.upsert');
      old.ev.removeAllListeners('messages.update');
      if (creds?.registered) await old.logout().catch(() => {});
      old.end(undefined);
    }
    rmSync(cfg.waAuthDir, { recursive: true, force: true });
    // Tautan baru bisa berarti nomor baru: pemanasan antiban mulai dari awal.
    antiban?.destroy();
    antiban = null;
    setAntiBan(null);
    selfNumber = null;
    creds = null;
    retryDelayMs = 2_000;
    console.log(`[wa] sesi lama diputus dan ${cfg.waAuthDir} dihapus; menautkan dari awal`);
    setState({ state: 'starting', detail: 'Sesi lama diputus; QR baru sedang disiapkan' });
    await connect();
  },
  async typing(to) {
    const jid = to.address || `${to.phone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    await markRead(jid);
    await sock?.sendPresenceUpdate('composing', jid).catch(() => {});
  },
  async typingStop(to) {
    const jid = to.address || `${to.phone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    await sock?.sendPresenceUpdate('paused', jid).catch(() => {});
  },
  send(to, text, opts) {
    // WA_REPLY_VIA_PN=1: balas ke alamat nomor telepon, bukan alamat LID
    // tempat pesannya masuk. Percobaan untuk akun bisnis yang juga terdaftar
    // di Cloud API: HP pelanggan menolak kiriman ke alamat LID dari bot.
    const digits = to.phone.replace(/[^0-9]/g, '');
    const viaPn = process.env.WA_REPLY_VIA_PN === '1' && digits && !to.phone.startsWith('lid:');
    const jid = viaPn ? `${digits}@s.whatsapp.net` : to.address || `${digits}@s.whatsapp.net`;
    // Satu antrean: dua kiriman bersamaan tidak boleh saling menyalip jedanya.
    const job = sendChain.then(() => sendNow(jid, text, opts));
    sendChain = job.catch(() => {});
    return job;
  },
};
