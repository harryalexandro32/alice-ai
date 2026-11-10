/**
 * Yang harus bisa dilakukan sebuah jalur WhatsApp. Baileys (tahap 1) dan
 * Cloud API (tahap 2) sama-sama memenuhi ini; alur percakapan tidak tahu
 * bedanya.
 */

export interface TransportInbound {
  /** "+62…", atau "lid:…" kalau nomornya tidak diberikan. */
  phone: string;
  /** Alamat balasan (JID di Baileys, nomor di Cloud API). */
  address: string;
  /** Null = bukan teks. */
  text: string | null;
  waId: string | null;
}

export interface TransportHandlers {
  onInbound(m: TransportInbound): void;
  /** Pemilik nomor membalas sendiri dari aplikasi WhatsApp. */
  onHumanReply(m: { address: string; text: string }): void;
}

export interface Transport {
  start(handlers: TransportHandlers): Promise<void>;
  /** `address` kosong = turunkan dari `phone` (dipakai untuk nomor sales). */
  send(to: { phone: string; address: string }, text: string): Promise<void>;
}
