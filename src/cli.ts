/**
 * Mode latihan: seluruh alur tanpa WhatsApp. Database di memori, jam bisa
 * dimajukan, lead "dikirim" ke layar. `PROJECT=gfan npm run chat`.
 *
 * Profil proyeknya dibaca dari DATABASE_URL (perubahan dari dashboard ikut
 * dipakai), tapi percakapan latihan hanya disimpan di memori: data pelanggan
 * sungguhan tidak tersentuh.
 *
 *   /maju 23j        majukan jam (j = jam, m = menit) lalu jalankan balasan
 *                    yang ditunda jam tenang dan follow-up
 *   /manusia <teks>  pemilik membalas sendiri dari HP
 *   /lead            lihat data kontak ini
 *   /nomor 62812…    pindah jadi nomor lain
 *   /keluar
 */

import { createInterface } from 'node:readline';

import { biz, initBiz, REGISTRY } from './business';
import { advance, localStamp, now } from './clock';
import { cfg, HOUR, MINUTE, normPhone } from './config';
import { handleHumanReply, handleInbound, runDeferred, setSender, type Sender } from './flow';
import { runFollowups } from './followup';
import { llmEnabled, llmUsageToday } from './llm/provider';
import { deliverOutbox, setSalesNotifier } from './sinks/outbox';
import { closeDb, openDb } from './db';
import { ensureProject } from './db/seed';
import { getContact, getProfile, getProject, saveProfile, type Project } from './store';

/** Buka database latihan di memori, berisi salinan proyek ini dari DATABASE_URL (kalau ada). */
async function practiceDb(id: string): Promise<void> {
  const url = process.env.DATABASE_URL?.trim() ?? '';
  let row: Project | undefined;
  let profile: Record<string, unknown> = {};
  if (url && url !== 'memory://' && url !== ':memory:') {
    await openDb(url);
    row = await getProject(id);
    profile = await getProfile(id);
    await closeDb();
    if (!row) throw new Error(`proyek "${id}" tidak ada di ${url.replace(/\/\/[^@]*@/, '//***@')}`);
  }
  await openDb('memory://');
  const template = row?.template ?? (REGISTRY[id] ? id : 'generic');
  await ensureProject(id, template, row?.name ?? id, { wa_number: row?.wa_number, sales_number: row?.sales_number, transport: row?.transport });
  await saveProfile(id, profile);
}

async function main() {
  const id = process.env.PROJECT?.trim() || 'gfan';
  await practiceDb(id);
  await initBiz(id, { requireEnabled: false });

  const send: Sender = async (_to, text, image) =>
    console.log(image ? `\n🤖 BOT [foto ${image}]:\n${text}\n` : `\n🤖 BOT:\n${text}\n`);
  setSender(send);
  setSalesNotifier(async (text) => {
    console.log(`\n📣 KE SALES:\n${text}\n`);
    return true;
  });

  let phone = '+6281200000001';
  console.log(`Mode latihan bot ${biz.brand}. Ketik seperti calon pelanggan. /keluar untuk selesai.`);
  console.log(
    llmEnabled()
      ? `LLM: ${cfg.llmModel}`
      : 'LLM MATI (LLM_API_KEY kosong): salam, data lead, dan follow-up tetap jalan; pertanyaan dioper ke manusia.'
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Masukan lewat pipa bisa habis selagi LLM masih menjawab; baris yang sudah
  // terbaca tetap diproses, tapi prompt tidak boleh ditulis ke rl yang tertutup.
  let closed = false;
  rl.on('close', () => (closed = true));
  const prompt = () => {
    if (closed) return;
    rl.setPrompt(`[${localStamp(now())}] ${phone} > `);
    rl.prompt();
  };
  prompt();

  for await (const raw of rl) {
    const line = raw.trim();
    if (line === '/keluar') break;

    if (line.startsWith('/maju')) {
      const m = line.match(/(\d+(?:[.,]\d+)?)\s*([jm])/i);
      if (m?.[1] && m[2]) {
        advance(Number(m[1].replace(',', '.')) * (m[2].toLowerCase() === 'j' ? HOUR : MINUTE));
        await runDeferred();
        const n = await runFollowups(send);
        if (!n) console.log('(tidak ada follow-up yang jatuh tempo)');
      } else console.log('Contoh: /maju 23j   atau   /maju 30m');
    } else if (line.startsWith('/manusia')) {
      await handleHumanReply({ address: phone, text: line.slice(8).trim() });
    } else if (line === '/lead') {
      console.log((await getContact(phone)) ?? '(belum ada kontak)');
      console.log(llmUsageToday());
    } else if (line.startsWith('/nomor')) {
      phone = normPhone(line.slice(6)) ?? phone;
    } else if (line) {
      console.log(`\n👤 ${line}`);
      await handleInbound({ phone, address: phone, text: line });
      await deliverOutbox();
      const c = await getContact(phone);
      if (c?.deferred_until) console.log(`(jam tenang: dibalas pukul ${localStamp(c.deferred_until).slice(11)}; /maju untuk memajukan jam)`);
    }
    prompt();
  }
  rl.close();
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
