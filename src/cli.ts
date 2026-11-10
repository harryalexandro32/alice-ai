/**
 * Mode latihan: seluruh alur tanpa WhatsApp. Database di memori, jam bisa
 * dimajukan, lead "dikirim" ke layar.
 *
 *   /maju 23j        majukan jam (j = jam, m = menit) lalu jalankan follow-up
 *   /manusia <teks>  pemilik membalas sendiri dari HP
 *   /lead            lihat data kontak ini
 *   /nomor 62812…    pindah jadi nomor lain
 *   /keluar
 */

import { createInterface } from 'node:readline';

import { biz, initBiz } from './business';
import { advance, localStamp, now } from './clock';
import { cfg, HOUR, MINUTE, normPhone } from './config';
import { handleHumanReply, handleInbound, setSender, type Sender } from './flow';
import { runFollowups } from './followup';
import { llmEnabled, llmUsageToday } from './llm/provider';
import { deliverOutbox, setSalesNotifier, setSheetWriter } from './sinks/outbox';
import { getContact, openDb } from './store';

async function main() {
  openDb(':memory:');
  initBiz();

  const send: Sender = async (_to, text, image) =>
    console.log(image ? `\n🤖 BOT [foto ${image}]:\n${text}\n` : `\n🤖 BOT:\n${text}\n`);
  setSender(send);
  setSalesNotifier(async (text) => {
    console.log(`\n📣 KE SALES:\n${text}\n`);
    return true;
  });
  setSheetWriter(async (row) => console.log(`\n📊 BARIS SHEET: ${row.join(' | ')}\n`));

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
        const n = await runFollowups(send);
        if (!n) console.log('(tidak ada follow-up yang jatuh tempo)');
      } else console.log('Contoh: /maju 23j   atau   /maju 30m');
    } else if (line.startsWith('/manusia')) {
      handleHumanReply({ address: phone, text: line.slice(8).trim() });
    } else if (line === '/lead') {
      console.log(getContact(phone) ?? '(belum ada kontak)');
      console.log(llmUsageToday());
    } else if (line.startsWith('/nomor')) {
      phone = normPhone(line.slice(6)) ?? phone;
    } else if (line) {
      console.log(`\n👤 ${line}`);
      await handleInbound({ phone, address: phone, text: line });
      await deliverOutbox();
    }
    prompt();
  }
  rl.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
