/**
 * Pagar kode produk, diturunkan dari pengetahuan bisnis itu sendiri.
 *
 * Kode produk yang "ada" = kode yang tertulis di `knowledge`. Pemilik yang
 * menambah produk lewat dashboard otomatis memperluas daftar ini; tidak ada
 * daftar kedua di kode yang bisa ketinggalan.
 *
 * Caranya: kumpulkan semua token berbentuk kode (huruf lalu angka, mis.
 * "GFAF-40A", "GFC10-12B4") dari knowledge, ambil awalan hurufnya (GFAF, GFC),
 * lalu di balasan cari apa pun yang berawalan sama dan diikuti angka. Yang
 * tidak ada di knowledge = karangan.
 */

const CODE = /\b[A-Z]{2,}-?\d[0-9A-Z-]*\b/g;
const strip = (s: string): string => s.replace(/[\s-]/g, '');

let cache: { text: string; codes: Set<string>; finder: RegExp | null } | null = null;

function index(knowledge: string) {
  if (cache?.text === knowledge) return cache;
  const found = knowledge.toUpperCase().match(CODE) ?? [];
  const codes = new Set(found.map(strip));
  const prefixes = [...new Set(found.map((c) => c.match(/^[A-Z]+/)?.[0] ?? ''))].filter(Boolean);
  // Awalan terpanjang dulu, supaya "GFAF" tidak terpotong jadi "GF".
  prefixes.sort((a, b) => b.length - a.length);
  const finder = prefixes.length
    ? new RegExp(`\\b(?:${prefixes.join('|')})[-\\s]?\\d[0-9A-Z-]*`, 'g')
    : null;
  cache = { text: knowledge, codes, finder };
  return cache;
}

function mentioned(text: string, finder: RegExp): string[] {
  return (text.toUpperCase().match(finder) ?? []).map((m) => strip(m));
}

/** Kode di `reply` yang tidak ada di `knowledge` dan tidak diketik pelanggan. */
export function unknownCodes(reply: string, knowledge: string, asked = ''): string[] {
  const ix = index(knowledge);
  if (!ix.finder) return [];
  const fromCustomer = new Set(mentioned(asked, ix.finder));
  return [...new Set(mentioned(reply, ix.finder))].filter((c) => !ix.codes.has(c) && !fromCustomer.has(c));
}
