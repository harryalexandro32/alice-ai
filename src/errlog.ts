/**
 * Catatan error yang ikut tampil di dashboard.
 *
 * Bot bisa jalan di mana saja (PC ini, server klien), dan siapa pun yang
 * memegang dashboard belum tentu bisa melihat terminalnya. Jadi semua yang
 * ditulis ke console.error / console.warn — ditambah error dari pustaka
 * WhatsApp — juga disimpan di database, per proyek, dan tampil di dashboard
 * (dashboard: Pengaturan > Lanjutan > Catatan error).
 */

import { format } from 'node:util';

import { now } from './clock';
import { addError } from './store';

let installed = false;
let last = '';

export function recordError(level: 'error' | 'warning', text: string): void {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 600);
  // Error yang sama berturut-turut (mis. sambungan putus-nyambung) cukup sekali.
  if (!clean || clean === last) return;
  last = clean;
  try {
    // Tidak ditunggu: console.error tidak boleh menunggu database.
    void addError({ at: now(), level, text: clean }).catch(() => {});
  } catch {
    // database belum terbuka / belum ada proyek: catatan di terminal tetap ada
  }
}

/** Mulai menyalin console.error dan console.warn ke catatan error. */
export function installErrorLog(): void {
  if (installed) return;
  installed = true;
  for (const [name, level] of [['error', 'error'], ['warn', 'warning']] as const) {
    const original = console[name].bind(console);
    console[name] = (...args: unknown[]) => {
      original(...args);
      recordError(level, format(...args));
    };
  }
}
