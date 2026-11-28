/**
 * Panel Bantuan di dashboard: menjawab pertanyaan staf tentang dashboard itu
 * sendiri ("bisa tidak?", "caranya bagaimana?", "menunya di mana?").
 *
 * Satu-satunya sumber jawaban adalah src/admin/bantuan.md. Berkas itu kecil,
 * jadi seluruhnya masuk prompt sistem (tanpa pencarian), dan prompt sistemnya
 * sama persis tiap panggilan supaya di-cache penyedia. Pertanyaan yang tidak
 * terjawab dari panduan dicatat ke <DATA_DIR>/bantuan-belum-terjawab.jsonl,
 * supaya pengembang tahu bagian mana yang kurang.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cfg } from '../config';
import { askJson } from '../llm/provider';
import { noDash } from '../texts';

/** Kunci halaman yang boleh disebut jawaban (sama dengan ROUTES di routes.ts). */
export const HELP_PAGES: readonly string[] = [
  'beranda', 'percakapan', 'pesanan', 'behavior', 'produk', 'brosur', 'pengaturan', 'whatsapp', 'notifikasi', 'marketplace', 'lanjutan',
];

export interface HelpInput {
  question: string;
  /** Tanya jawab sebelumnya di panel ini, terlama dulu. */
  history: { dir: 'in' | 'out'; text: string }[];
  /** Id proyek yang sedang dibuka, untuk contoh alamat (/gfan/settings). */
  project: string;
  lang: 'id' | 'en';
}

export interface HelpAnswer {
  answer: string;
  /** False = jawabannya tidak ada di panduan (dicatat untuk pengembang). */
  found: boolean;
  /** Halaman yang dibuka tombol di bawah jawaban ('' = tidak ada). */
  page: string;
}

export type Helper = (input: HelpInput) => Promise<HelpAnswer | null>;

/** Berkas panduan: di samping file ini (lokal) atau di akar proyek. */
function guidePath(): string {
  const here = join(__dirname, 'bantuan.md');
  return existsSync(here) ? here : join(process.cwd(), 'src', 'admin', 'bantuan.md');
}

let cached = '';
/** Isi bantuan.md apa adanya (dibaca sekali; dashboard dinyalakan ulang tiap deploy). */
export function helpText(): string {
  if (!cached) cached = readFileSync(guidePath(), 'utf8');
  return cached;
}

export function helpSystemPrompt(): string {
  return (
    'Kamu adalah asisten bantuan untuk DASHBOARD Alice AI, dipakai staf bisnis yang mengelola bot WhatsApp lewat dashboard itu. ' +
    'Kamu BUKAN bot penjualan dan tidak berbicara dengan pelanggan.\n\n' +
    'Jawab HANYA dari PANDUAN di bawah. Jangan mengarang fitur, menu, atau tombol yang tidak tertulis di sana.\n' +
    'Kalau jawabannya tidak ada di PANDUAN, katakan bahwa hal itu belum bisa dilakukan dari dashboard dan pertanyaannya sudah dicatat untuk developer; ' +
    'kalau ada cara lain yang dekat di PANDUAN, sebutkan.\n\n' +
    'Gaya jawaban: bahasa yang sama dengan pertanyaan (Indonesia atau Inggris), sapa dengan "Anda", kalimat pendek dan aktif, langsung ke intinya. ' +
    'Sebut nama menu dan tombol persis seperti di PANDUAN, dengan tanda › untuk jalur menu (contoh: Pengaturan › WhatsApp). ' +
    'Langkah ditulis sebagai daftar bernomor, satu tindakan per baris. Tanpa judul, tanpa markdown selain daftar. Tanpa tanda pisah panjang. ' +
    'Paling panjang sekitar 120 kata.\n\n' +
    'Balas HANYA dengan satu objek JSON: {"answer": "...", "found": true, "page": "..."}\n' +
    '- "answer": jawabanmu untuk staf.\n' +
    '- "found": true kalau jawabannya ada di PANDUAN; false kalau tidak ada (fitur tidak ada, atau PANDUAN tidak membahasnya).\n' +
    `- "page": kunci halaman yang paling tepat dibuka staf untuk melakukan jawabanmu, salah satu dari: ${HELP_PAGES.join(', ')} ` +
    '(behavior = Cara bot bicara, pengaturan = Pengaturan › Umum, marketplace = Pengaturan › Tokopedia & Shop, pesanan = Pesanan). ' +
    'Kosongkan ("") kalau tidak ada halaman yang relevan.\n\n' +
    `PANDUAN\n${helpText()}`
  );
}

/** Baca jawaban model; null kalau bentuknya rusak. */
export function parseHelp(raw: string): HelpAnswer | null {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const obj = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw) as Record<string, unknown>;
    const answer = typeof obj.answer === 'string' ? noDash(obj.answer.trim()).slice(0, 2000) : '';
    if (!answer) return null;
    const page = typeof obj.page === 'string' && HELP_PAGES.includes(obj.page) ? obj.page : '';
    return { answer, found: obj.found !== false, page };
  } catch {
    return null;
  }
}

export const llmHelper: Helper = async (input) => {
  const history = input.history
    .slice(-8)
    .map((t) => `${t.dir === 'in' ? 'Staf' : 'Asisten'}: ${t.text.slice(0, 600)}`)
    .join('\n');
  const user =
    `Proyek yang sedang dibuka: "${input.project}" (alamat halaman diawali /${input.project}/). ` +
    `Bahasa dashboard: ${input.lang === 'en' ? 'Inggris' : 'Indonesia'}.\n\n` +
    (history ? `TANYA JAWAB SEBELUMNYA\n${history}\n\n` : '') +
    `PERTANYAAN STAF\n${input.question}`;
  const raw = await askJson({ system: helpSystemPrompt(), user, maxTokens: 500 });
  return raw ? parseHelp(raw) : null;
};

/** Berkas catatan pertanyaan yang tidak terjawab dari panduan (satu JSON per baris). */
export const unansweredPath = (): string => join(cfg.dataRoot, 'bantuan-belum-terjawab.jsonl');

/** Catat pertanyaan yang tidak terjawab, untuk melengkapi bantuan.md. Tidak pernah melempar. */
export function logUnanswered(project: string, question: string): void {
  const line = JSON.stringify({ at: new Date().toISOString(), project, question });
  console.warn(`[bantuan] belum terjawab (${project}): ${question}`);
  try {
    mkdirSync(cfg.dataRoot, { recursive: true });
    appendFileSync(unansweredPath(), line + '\n');
  } catch (e) {
    console.error(`[bantuan] catatan tidak tersimpan: ${e instanceof Error ? e.message : e}`);
  }
}
