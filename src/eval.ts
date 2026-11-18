/**
 * Alat ukur jawaban terhadap LLM SUNGGUHAN (butuh LLM_API_KEY, ada biaya
 * kecil). Pertanyaannya milik profil bisnis (Business.evalCases). Bukan
 * gerbang build: angkanya dibaca orang, lalu prompt atau pengetahuannya
 * diperbaiki. Jalankan sebelum dan sesudah mengubah prompt.
 */

import { checkReply, llmBrain } from './brain';
import { biz, initBiz, seedCtx } from './business';
import { openDb } from './db';
import { llmEnabled, llmUsageToday } from './llm/provider';
import { setDefaultProject } from './project';

(async () => {
  // Yang diukur adalah profil proyek yang sedang dipakai, termasuk perubahan
  // dari dashboard. Tanpa DATABASE_URL: bibitnya saja (PROJECT = nama bibit).
  const id = process.env.PROJECT?.trim() || 'gfan';
  if (process.env.DATABASE_URL?.trim()) {
    await openDb();
    await initBiz(id, { requireEnabled: false });
  } else setDefaultProject(seedCtx(id));
  if (!llmEnabled()) {
    console.error('LLM_API_KEY kosong — eval butuh LLM sungguhan.');
    process.exit(1);
  }
  // EVAL_MATCH=<teks>: hanya kasus yang pertanyaannya memuat teks itu (mis. saat memeriksa satu aturan).
  const only = process.env.EVAL_MATCH?.trim().toLowerCase();
  const cases = only ? biz.evalCases.filter((c) => c.q.toLowerCase().includes(only)) : biz.evalCases;
  let pass = 0;
  for (const c of cases) {
    const r = await llmBrain({ text: c.q, known: {}, history: c.history ?? [], justGreeted: false });
    const problems: string[] = [];
    if (!r) problems.push('tidak ada hasil');
    else {
      const guard = checkReply(r.reply, c.q);
      if (guard) problems.push(`pagar: ${guard}`);
      for (const re of c.has ?? []) if (!re.test(r.reply)) problems.push(`tidak memuat ${re}`);
      if (c.intent && r.intent !== c.intent) problems.push(`intent ${r.intent}, harusnya ${c.intent}`);
      for (const [k, re] of Object.entries(c.fields ?? {})) {
        const v = r.fields[k];
        if (!v || !re.test(v)) problems.push(`${k} = ${v ?? 'null'}`);
      }
    }
    if (!problems.length) pass += 1;
    console.log(`${problems.length ? '✗' : '✓'} ${c.q}`);
    if (problems.length) {
      console.log(`    ${problems.join('; ')}\n    → ${r?.reply.replace(/\n/g, ' ') ?? '(null)'}`);
    }
  }
  console.log(`\neval ${biz.id}: ${pass}/${cases.length}`);
  console.log(llmUsageToday());
})();
