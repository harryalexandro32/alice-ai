/**
 * Merangkai alur, follow-up, dan antrean lead ke sebuah transport.
 *
 * Dua hal yang diurus di sini karena keduanya soal cara orang mengetik di
 * WhatsApp, bukan soal isi percakapan:
 *
 *   - Pesan beruntun digabung. Orang mengirim "halo" / "mau tanya" / "exhaust
 *     16 inci ada?" sebagai tiga pesan; dibalas tiga kali itu spam.
 *   - Satu nomor diproses berurutan, supaya dua pesan yang hampir bersamaan
 *     tidak menghasilkan dua salam.
 */

import { cfg, MINUTE } from './config';
import { handleHumanReply, handleInbound, setSender } from './flow';
import { runFollowups } from './followup';
import { deliverOutbox, setOutboxSender } from './sinks/outbox';
import { openDb } from './store';
import type { Transport, TransportInbound } from './transport/types';

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
  setSender((to, text) => transport.send(to, text));
  setOutboxSender((to, text) => transport.send(to, text));

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
