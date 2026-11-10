/**
 * Daftar bisnis. Satu proses melayani satu bisnis, dipilih lewat env BUSINESS;
 * tiap bisnis punya .env, database, dan nomor WhatsApp sendiri.
 */

import { cfg } from '../config';
import { gfan } from './gfan/profile';
import type { Business } from './types';

const REGISTRY: Record<string, Business> = { gfan };

const picked = REGISTRY[cfg.business];
if (!picked) {
  throw new Error(
    `BUSINESS="${cfg.business}" tidak dikenal. Yang ada: ${Object.keys(REGISTRY).join(', ')}`
  );
}

export const biz: Business = picked;
