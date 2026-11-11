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
 */

import { startAdmin } from './admin/server';
import { localStore } from './admin/store-local';
import { initBiz } from './business';
import { cfg, MINUTE } from './config';
import { humanPause } from './pace';
import { waTargets } from './notify';
import { remoteEnabled } from './remote';
import { pullProfile, startSync } from './sync';
import { handleHumanReply, handleInbound, setBeforeTurn, setSender } from './flow';
import { runFollowups } from './followup';
import { deliverOutbox, setSalesNotifier, type SalesNotifier } from './sinks/outbox';
import { raiseAlert, setAlertWhatsApp } from './alerts';
import { installErrorLog } from './errlog';
import { setLlmProblemListener, setUsageRecorder } from './llm/provider';
import { setGuardListener } from './transport/sendguard';
import { addUsage, openDb } from './store';
import type { Transport, TransportInbound } from './transport/types';

/**
 * Kirim teks ke satu nomor penerima notifikasi.
 *
 * Nomornya boleh nomor bot itu sendiri ("self", atau diisi nomor yang sama):
 * staf membalas pelanggan dari aplikasi WhatsApp di nomor itu. Baileys bisa
 * mengirim ke chat "diri sendiri". Cloud API tidak bisa — di sana kabarnya
 * dilewat; catatannya ada di Google Sheet, di dashboard, dan di percakapan itu
 * sendiri. False = sengaja tidak dikirim; melempar = gagal.
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
            'Lead tetap tercatat di Google Sheet; percakapannya terlihat di aplikasi WhatsApp.'
        );
        warned = true;
      }
      return false;
    }
    await transport.send({ phone: target, address: '' }, text, { notify: true });
    return true;
  };
}

/**
 * Ke mana ringkasan lead dan kabar "butuh staf" dikirim lewat WhatsApp: semua
 * nomor penerima jenis kabar itu (Pengaturan > Notifikasi di dashboard, atau
 * SALES_NUMBER selama daftarnya masih kosong).
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
  enqueue(phone, () =>
    handleInbound({
      phone,
      address: p.first.address,
      text: p.texts.length ? p.texts.join('\n') : null,
      waId: p.first.waId,
      ...(p.first.profileName ? { profileName: p.first.profileName } : {}),
      ...(p.media?.media ? { media: p.media.media, fetchMedia: p.media.fetchMedia } : {}),
    })
  );
}

export async function startApp(transport: Transport): Promise<void> {
  openDb(cfg.dbPath);
  // Mulai sekarang semua galat juga tersimpan untuk dashboard.
  installErrorLog();
  initBiz();
  // Tiap panggilan LLM dicatat per hari, supaya biayanya terlihat di dashboard.
  setUsageRecorder(addUsage);

  // Balasan ke pelanggan menunggu dulu dengan irama manusia (lihat pace.ts).
  // Notifikasi ke sales dan follow-up tidak: keduanya bukan balasan.
  setSender(async (to, text, image, fileName) => {
    await humanPause(to.address || to.phone, text.length, async () => transport.typing?.(to));
    await transport.send(to, text, image ? { image, fileName } : undefined);
  });
  const toSales = makeSalesNotifier(transport);
  setSalesNotifier(toSales);

  // Peringatan untuk pemilik. Yang soal WhatsApp-nya sendiri tidak dikirim
  // lewat WhatsApp: saat itu jalurnya justru sedang bermasalah.
  setAlertWhatsApp(makeWaSender(transport));
  setLlmProblemListener((text) => void raiseAlert('llm', text));
  setGuardListener((text) => void raiseAlert('kiriman-dijeda', text, { whatsapp: false }));
  if (transport.name === 'baileys') {
    const { setFatalListener } = await import('./transport/baileys');
    setFatalListener((text) => void raiseAlert('wa-putus', text, { whatsapp: false }));
  }

  if (remoteEnabled()) {
    // Dashboard-nya di-hosting terpisah; bot ini hanya mengikuti apa yang disimpan di sana.
    await startSync();
    setBeforeTurn(() => pullProfile());
  } else if (cfg.adminPassword) {
    await startAdmin(localStore()).catch((e) =>
      console.error(`[dashboard] tidak bisa dinyalakan: ${e instanceof Error ? e.message : e}`)
    );
  } else {
    console.log('[dashboard] mati — isi ADMIN_PASSWORD di .env untuk menyalakannya');
  }

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
      handleHumanReply(m);
    },
  });

  const tick = async () => {
    try {
      await runFollowups((to, text) => transport.send(to, text));
      await deliverOutbox();
    } catch (e) {
      console.error('[app] putaran berkala gagal:', e instanceof Error ? e.message : e);
    }
  };
  setInterval(() => void tick(), 5 * MINUTE);
}
