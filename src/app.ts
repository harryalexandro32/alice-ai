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
import { remoteEnabled } from './remote';
import { pullProfile, startSync } from './sync';
import { handleHumanReply, handleInbound, setBeforeTurn, setSender } from './flow';
import { runFollowups } from './followup';
import { deliverOutbox, setSalesNotifier, type SalesNotifier } from './sinks/outbox';
import { openDb } from './store';
import type { Transport, TransportInbound } from './transport/types';

/**
 * Ke mana ringkasan lead dikirim.
 *
 * Nomor sales boleh nomor bot itu sendiri (SALES_NUMBER=self, atau diisi nomor
 * yang sama): sales membalas pelanggan dari aplikasi WhatsApp di nomor itu.
 * Baileys bisa mengirim ke chat "diri sendiri". Cloud API tidak bisa — di sana
 * notifikasinya dilewat, dan catatan lead-nya ada di Google Sheet serta di
 * percakapan itu sendiri, yang memang tampil di aplikasi sales.
 */
export function makeSalesNotifier(transport: Transport): SalesNotifier {
  let warned = false;
  return async (text) => {
    if (!cfg.salesNumber) {
      console.log('[lead] SALES_NUMBER kosong, notifikasi WA dilewat');
      return false;
    }
    const self = transport.selfPhone();
    const target = cfg.salesNumber === 'self' ? self : cfg.salesNumber;
    if (!target) throw new Error('nomor bot belum diketahui (belum tersambung)');

    if (target === self && !transport.canMessageSelf) {
      if (!warned) {
        console.log(
          `[lead] nomor sales = nomor bot, dan jalur ${transport.name} tidak bisa mengirimi diri sendiri. ` +
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

interface Pending {
  first: TransportInbound;
  texts: string[];
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
    })
  );
}

export async function startApp(transport: Transport): Promise<void> {
  openDb(cfg.dbPath);
  initBiz();

  // Balasan ke pelanggan menunggu dulu dengan irama manusia (lihat pace.ts).
  // Notifikasi ke sales dan follow-up tidak: keduanya bukan balasan.
  setSender(async (to, text, image) => {
    await humanPause(to.address || to.phone, text.length, async () => transport.typing?.(to));
    await transport.send(to, text, image ? { image } : undefined);
  });
  setSalesNotifier(makeSalesNotifier(transport));

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
        p.timer = setTimeout(() => flush(m.phone), cfg.debounceMs);
        return;
      }
      pending.set(m.phone, {
        first: m,
        texts: m.text ? [m.text] : [],
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
