/**
 * Merangkai alur, follow-up, dan antrean lead ke sebuah transport.
 *
 * Dua hal yang diurus di sini karena keduanya soal cara orang mengetik di
 * WhatsApp, bukan soal isi percakapan:
 *
 *   - Pesan beruntun digabung. Orang mengirim "halo" / "mau tanya" / "yang 16
 *     inci ada?" sebagai tiga pesan; dibalas tiga kali itu spam.
 *   - Satu nomor diproses berurutan, supaya dua pesan yang hampir bersamaan
 *     tidak menghasilkan dua salam.
 *
 * Balasan yang ditunda jam tenang (quiet.ts) juga dijalankan dari sini, lewat
 * antrean per nomor yang sama: putaran 5 menit, ditambah satu timer tepat
 * untuk waktu jatuh tempo berikutnya.
 */

import { refreshBiz } from './business';
import { cfg, HOUR, MINUTE } from './config';
import { now } from './clock';
import { sendPaced, type TypingHooks } from './pace';
import { waTargets } from './notify';
import { handleHumanReply, handleInbound, runDeferredTurn, setBeforeTurn, setSender } from './flow';
import { startHeartbeat, transportConnected } from './heartbeat';
import { runFollowups } from './followup';
import { deliverOutbox, QUICK_KINDS, setReplySender, setSalesNotifier, setTestSender, type SalesNotifier } from './sinks/outbox';
import { raiseAlert, setAlertWhatsApp } from './alerts';
import { installErrorLog } from './errlog';
import { setLlmProblemListener, setUsageRecorder } from './llm/provider';
import { setGuardListener } from './transport/sendguard';
import { addUsage, dueDeferred, nextDeferredAt } from './store';
import { noDash } from './texts';
import type { Transport, TransportInbound } from './transport/types';

/**
 * Kirim teks ke satu nomor penerima notifikasi.
 *
 * Nomornya boleh nomor bot itu sendiri ("self", atau diisi nomor yang sama):
 * staf membalas pelanggan dari aplikasi WhatsApp di nomor itu. Baileys bisa
 * mengirim ke chat "diri sendiri". Cloud API tidak bisa — di sana kabarnya
 * dilewat; catatannya ada di dashboard dan di percakapan itu sendiri. False = sengaja tidak dikirim; melempar = gagal.
 */
export function makeWaSender(transport: Transport): (phone: string, text: string) => Promise<boolean> {
  let warned = false;
  return async (phone, text) => {
    const self = transport.selfPhone();
    const target = phone === 'self' ? self : phone;
    if (!target) throw new Error('nomor bot belum diketahui (belum tersambung)');
    if (target === self && !transport.canMessageSelf) {
      if (!warned) {
        console.log(
          `[lead] nomor penerima = nomor bot, dan jalur ${transport.name} tidak bisa mengirimi diri sendiri. ` +
            'Lead tetap tercatat di dashboard; percakapannya terlihat di aplikasi WhatsApp.'
        );
        warned = true;
      }
      return false;
    }
    // Tanpa mikir dan tanpa mengetik, tapi tetap antre di belakang chat yang sedang diketik.
    await sendPaced(target, text, { mode: 'notify', send: () => transport.send({ phone: target, address: '' }, text, { notify: true }) });
    return true;
  };
}

/**
 * Ke mana ringkasan lead dan kabar "butuh staf" dikirim lewat WhatsApp: semua
 * nomor penerima jenis kabar itu (Pengaturan > Notifikasi di dashboard, atau
 * nomor sales proyek selama daftarnya masih kosong).
 */
export function makeSalesNotifier(transport: Transport): SalesNotifier {
  const sendTo = makeWaSender(transport);
  return async (text, kind = 'lead') => {
    const targets = waTargets(kind);
    if (!targets.length) {
      console.log('[lead] belum ada nomor penerima, notifikasi WA dilewat');
      return false;
    }
    let sent = false;
    let failure: unknown = null;
    for (const phone of targets) {
      try {
        sent = (await sendTo(phone, text)) || sent;
      } catch (e) {
        failure = e;
        console.error(`[lead] WA ke ${phone} gagal: ${e instanceof Error ? e.message : e}`);
      }
    }
    // Tidak ada satu pun yang sampai: lempar supaya antrean mencobanya lagi.
    if (!sent && failure) throw failure;
    return sent;
  };
}

/** Seberapa sering bot memeriksa balasan dari dashboard. */
const REPLY_POLL_MS = 3000;

interface Pending {
  first: TransportInbound;
  texts: string[];
  /** Foto/suara terakhir di rentetan pesan ini (teksnya sudah masuk `texts`). */
  media?: TransportInbound;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();
const chains = new Map<string, Promise<void>>();

function enqueue(phone: string, job: () => Promise<void>): void {
  const next = (chains.get(phone) ?? Promise.resolve())
    .then(job)
    .catch((e) => console.error(`[app] ${phone}: ${e instanceof Error ? e.stack : e}`))
    .finally(() => {
      if (chains.get(phone) === next) chains.delete(phone);
    });
  chains.set(phone, next);
}

function flush(phone: string): void {
  const p = pending.get(phone);
  if (!p) return;
  pending.delete(phone);
  enqueue(phone, async () => {
    await handleInbound({
      phone,
      address: p.first.address,
      text: p.texts.length ? p.texts.join('\n') : null,
      waId: p.first.waId,
      ...(p.first.profileName ? { profileName: p.first.profileName } : {}),
      ...(p.media?.media ? { media: p.media.media, fetchMedia: p.media.fetchMedia } : {}),
    });
    // Pesan ini mungkin baru ditunda jam tenang: timernya disesuaikan.
    void scheduleDeferred().catch((e) => console.error('[jam tenang] jadwal gagal:', e instanceof Error ? e.message : e));
  });
}

/** Nomor yang balasan tertundanya sedang diantre atau dijalankan. */
const deferring = new Set<string>();
let deferTimer: NodeJS.Timeout | null = null;
/** Selama belum tersambung (atau masih ada yang diantre), dicoba lagi sesudah selang ini. */
const DEFER_RETRY_MS = MINUTE;

/**
 * Jalankan balasan tertunda yang sudah jatuh tempo, lewat antrean per nomor
 * (berurutan dengan pesan baru dari nomor yang sama), lalu pasang timer untuk
 * yang berikutnya. Selama WhatsApp belum tersambung tidak ada yang dijalankan:
 * balasan yang gagal terkirim tidak dicoba lagi, jadi lebih baik menunggu.
 */
async function runDueDeferred(): Promise<void> {
  if (deferConnected()) {
    for (const c of await dueDeferred(now())) {
      if (deferring.has(c.phone)) continue;
      deferring.add(c.phone);
      enqueue(c.phone, () => runDeferredTurn(c.phone).finally(() => deferring.delete(c.phone)));
    }
  }
  await scheduleDeferred();
}

/** WhatsApp sedang tersambung (dipasang startApp). */
let deferConnected: () => boolean = () => true;
/** Pasang (ulang) satu timer untuk balasan tertunda yang paling dekat. */
async function scheduleDeferred(): Promise<void> {
  const next = await nextDeferredAt();
  if (deferTimer) clearTimeout(deferTimer);
  deferTimer = null;
  if (next === null) return;
  // Satu detik lewat dari jatuh temponya, supaya timer yang sedikit terlalu cepat tidak meleset.
  const wait = next > now() && deferConnected() ? Math.min(next - now() + 1000, 6 * HOUR) : DEFER_RETRY_MS;
  deferTimer = setTimeout(() => {
    void runDueDeferred().catch((e) => console.error('[jam tenang] putaran gagal:', e instanceof Error ? e.message : e));
  }, wait);
  deferTimer.unref();
}

/** "sedang mengetik…" ke satu lawan bicara, kalau jalurnya bisa (Cloud API tidak). */
function typingHooks(transport: Transport, to: { phone: string; address: string }): TypingHooks | undefined {
  const { typing, typingStop } = transport;
  if (!typing) return undefined;
  return {
    start: () => typing.call(transport, to),
    ...(typingStop ? { stop: () => typingStop.call(transport, to) } : {}),
  };
}

/** Pagar terakhir: tidak ada teks yang keluar lewat WhatsApp membawa tanda pisah panjang. */
function withoutDashes(transport: Transport): Transport {
  const send = transport.send.bind(transport);
  transport.send = (to, text, opts) => send(to, noDash(text), opts);
  return transport;
}

/**
 * Jalankan bot untuk proyek proses ini. Database dan proyeknya sudah dimuat
 * (lihat index.ts: openDb lalu initBiz).
 */
export async function startApp(raw: Transport): Promise<void> {
  const transport = withoutDashes(raw);
  deferConnected = transportConnected;
  // Mulai sekarang semua error juga tersimpan untuk dashboard.
  installErrorLog();
  // Tiap panggilan LLM dicatat per hari, supaya biayanya terlihat di dashboard.
  setUsageRecorder(addUsage);
  // Muat ulang profil dan baris proyek kalau pemilik baru menyimpan di dashboard.
  // Jalur WhatsApp yang diganti baru berlaku setelah bot dinyalakan ulang:
  // keluar, dan pengawas (systemd / npm start) menyalakannya lagi.
  const startedOn = cfg.transport;
  const reload = async (force: boolean) => {
    try {
      if ((await refreshBiz(force)) && cfg.transport !== startedOn) {
        console.log(`[bot] jalur WhatsApp diganti ke ${cfg.transport} dari dashboard; bot dinyalakan ulang`);
        process.exit(0);
      }
    } catch (e) {
      console.error(`[profil] gagal memeriksa perubahan: ${e instanceof Error ? e.message : e}`);
    }
  };
  // Sebelum tiap giliran (paling sering tiap 5 detik).
  setBeforeTurn(() => reload(false));

  // Semua kiriman lewat irama manusia (lihat pace.ts): satu lawan bicara pada
  // satu waktu, dan "sedang mengetik…" selama panjang pesannya. Jeda yang
  // sudah ditunggu ikut diberitahukan ke transport, supaya jeda pengaman
  // (antiban) tidak ditambahkan lagi di atasnya.
  setSender((to, text, image, fileName) =>
    sendPaced(to.address || to.phone, text, {
      mode: 'reply',
      typing: typingHooks(transport, to),
      send: (pacedMs) => transport.send(to, text, { ...(image ? { image, fileName } : {}), pacedMs }),
    }).then(() => {})
  );
  // Notifikasi ke sales dan kabar "butuh staf": hanya antre (lihat makeWaSender).
  const toSales = makeSalesNotifier(transport);
  setSalesNotifier(toSales);
  // Pesan tes dari Pengaturan > Notifikasi: ke satu nomor, seperti kabar lain.
  setTestSender(makeWaSender(transport));
  // Balasan staf dari dashboard: isinya apa adanya; mikir singkat lalu mengetik
  // sesuai panjangnya, lalu lewat pengaman nomor di transport.
  setReplySender(
    (to, text) =>
      sendPaced(to.address || to.phone, text, {
        mode: 'dashboard',
        typing: typingHooks(transport, to),
        send: (pacedMs) => transport.send(to, text, { pacedMs }),
      }).then(() => {}),
    transportConnected
  );

  // Warning untuk pemilik. Yang soal WhatsApp-nya sendiri tidak dikirim
  // lewat WhatsApp: saat itu jalurnya justru sedang bermasalah.
  setAlertWhatsApp(makeWaSender(transport));
  setLlmProblemListener((text) => void raiseAlert('llm', text));
  setGuardListener((text) => void raiseAlert('kiriman-dijeda', text, { whatsapp: false }));
  if (transport.name === 'baileys') {
    const { setFatalListener } = await import('./transport/baileys');
    setFatalListener((text) => void raiseAlert('wa-putus', text, { whatsapp: false }));
  }

  // Laporan berkala untuk dashboard (keadaan WhatsApp, QR, kode pairing), dan
  // permintaan dari dashboard (kode pairing, tautkan ulang).
  startHeartbeat(transport);

  await transport.start({
    onInbound(m) {
      const p = pending.get(m.phone);
      if (p) {
        clearTimeout(p.timer);
        if (m.text) p.texts.push(m.text);
        // Stiker tidak menimpa foto yang sudah menunggu di rentetan yang sama.
        if (m.media && (m.media !== 'stiker' || !p.media)) p.media = m;
        p.timer = setTimeout(() => flush(m.phone), cfg.debounceMs);
        return;
      }
      pending.set(m.phone, {
        first: m,
        texts: m.text ? [m.text] : [],
        ...(m.media ? { media: m } : {}),
        timer: setTimeout(() => flush(m.phone), cfg.debounceMs),
      });
    },
    onHumanReply(m) {
      void handleHumanReply(m).catch((e) => console.error(`[app] balasan manusia tidak tercatat: ${e instanceof Error ? e.message : e}`));
    },
  });

  // Perubahan dari dashboard juga dimuat walau tidak ada pesan masuk.
  setInterval(() => void reload(true), 30_000);

  // Balasan yang diketik staf di dashboard: diperiksa tiap 3 detik (satu kueri
  // ringan), supaya terasa seperti membalas langsung. Sisanya ikut putaran 5 menit.
  let replying = false;
  setInterval(() => {
    if (replying) return;
    replying = true;
    void deliverOutbox(QUICK_KINDS)
      .catch((e) => console.error('[outbox] balasan dashboard:', e instanceof Error ? e.message : e))
      .finally(() => (replying = false));
  }, REPLY_POLL_MS);

  const tick = async () => {
    try {
      await reload(true);
      await runFollowups((to, text) =>
        sendPaced(to.address || to.phone, text, {
          mode: 'followup',
          typing: typingHooks(transport, to),
          send: (pacedMs) => transport.send(to, text, { pacedMs }),
        }).then(() => {})
      );
      await deliverOutbox();
      await runDueDeferred();
    } catch (e) {
      console.error('[app] putaran berkala gagal:', e instanceof Error ? e.message : e);
    }
  };
  setInterval(() => void tick(), 5 * MINUTE);
  // Balasan yang tertunda sebelum bot dinyalakan ulang juga dijadwalkan.
  void scheduleDeferred().catch((e) => console.error('[jam tenang] jadwal gagal:', e instanceof Error ? e.message : e));
}
