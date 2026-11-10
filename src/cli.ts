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

import { advance, localStamp, now } from './clock';
import { cfg, HOUR, MINUTE, normPhone } from './config';
import { handleHumanReply, handleInbound, setSender, type Sender } from './flow';
import { runFollowups } from './followup';
import { llmEnabled, llmUsageToday } from './llm/provider';
import { deliverOutbox, setOutboxSender, setSheetWriter } from './sinks/outbox';
import { getContact, openDb } from './store';

const SALES = '+620000000001';

async function main() {
  openDb(':memory:');
  cfg.salesNumbers = [SALES];

  const send: Sender = async (to, text) => {
    const who = to.phone === SALES ? '📣 KE SALES' : '🤖 BOT';
    console.log(`\n${who}:\n${text}\n`);
  };
  setSender(send);
  setOutboxSender(send);
  setSheetWriter(async (row) => console.log(`\n📊 BARIS SHEET: ${row.join(' | ')}\n`));

  let phone = '+6281200000001';
  console.log('Mode latihan bot GFAN. Ketik seperti calon pembeli. /keluar untuk selesai.');
  console.log(
    llmEnabled()
      ? `LLM: ${cfg.llmModel}`
      : 'LLM MATI (LLM_API_KEY kosong): salam, data lead, dan follow-up tetap jalan; tanya-jawab katalog dioper ke sales.'
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => rl.setPrompt(`[${localStamp(now())}] ${phone} > `);
  prompt();
  rl.prompt();

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
      await handleInbound({ phone, address: phone, text: line });
      await deliverOutbox();
    }
    prompt();
    rl.prompt();
  }
  rl.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
