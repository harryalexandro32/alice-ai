// Dashboard pemilik. Semua teks dari server dipasang lewat textContent, tidak
// pernah innerHTML: data produk dan nama pelanggan diketik orang.
'use strict';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k !== null && k !== undefined) n.append(k);
  return n;
};

let profile = null;
let dirty = false;
// Hanya kunci yang benar-benar diubah yang dikirim: yang tidak disentuh tetap
// mengikuti bawaan, jadi perbaikan bawaan di kemudian hari tetap sampai.
const changed = new Set();
let chat = [];
let known = {};

const PAGES = {
  identitas: ['Identitas', 'Siapa yang membalas chat, dan salam pembukanya. Perubahan berlaku pada pesan berikutnya setelah disimpan.'],
  perilaku: ['Perilaku', 'Irama balasan bot dan keadaan bot saat ini.'],
  rekomendasi: ['Rekomendasi', 'Cara bot menghitung kebutuhan pelanggan dan memilih produk.'],
  produk: ['Data produk', 'Satu-satunya sumber jawaban bot. Yang tidak tertulis di sini tidak akan dijawabnya. Satu baris = satu produk; kolom pertama = kode/modelnya.'],
  foto: ['Foto', 'Foto yang boleh dikirim bot ke pelanggan.'],
  data: ['Data pelanggan', 'Data yang diminta bot dari tiap calon pelanggan.'],
  lead: ['Lead', 'Calon pelanggan yang sudah chat dengan bot.'],
  biaya: ['Pemakaian & biaya', 'Token LLM yang dipakai bot dan perkiraan biayanya.'],
  uji: ['Uji coba', 'Coba bicara dengan bot tanpa mengirim apa pun ke WhatsApp.'],
};

function toast(text, err = false) {
  const t = $('toast');
  t.textContent = text;
  t.className = 'toast on' + (err ? ' err' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = 'toast'), err ? 5000 : 2600);
}

async function api(path, opts = {}) {
  const res = await fetch('/admin/api/' + path, {
    credentials: 'same-origin',
    ...opts,
    headers: opts.body && typeof opts.body === 'string' ? { 'content-type': 'application/json' } : opts.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'login') {
    $('login').classList.add('on');
    throw new Error('Belum masuk.');
  }
  if (!res.ok) throw new Error(data.error || 'Gagal (' + res.status + ').');
  return data;
}

function setDirty(v, key) {
  dirty = v;
  if (v && key) changed.add(key);
  if (!v) changed.clear();
  $('save').disabled = !v;
  $('save').textContent = v ? 'Simpan & terapkan' : 'Tersimpan';
}

// ---------- isian sederhana ----------
function fillInputs() {
  for (const input of document.querySelectorAll('[data-key]')) {
    const v = profile[input.dataset.key];
    if (input.type === 'checkbox') input.checked = Boolean(v);
    else input.value = v ?? '';
  }
  updateKnowLen();
}

// Sama dengan rakitan di server (src/business/catalog.ts): ini yang dibaca bot.
function catalogText() {
  return profile.catalog
    .map((s) => {
      const tables = s.tables.map((t) => t.title + ':\n' + t.columns.join(' | ') + '\n' + t.rows.map((r) => r.join(' | ')).join('\n')).join('\n\n');
      return ['### ' + s.name, s.facts.map((f) => '- ' + f).join('\n')].filter(Boolean).join('\n') + (tables ? '\n\n' + tables : '');
    })
    .join('\n\n');
}

function updateKnowLen() {
  const n = catalogText().length + (profile.notes || '').length;
  const models = new Set(profile.catalog.flatMap((s) => s.tables.flatMap((t) => t.rows.map((r) => r[0]).filter(Boolean)))).size;
  $('knowLen').textContent = models + ' produk · ±' + n.toLocaleString('id-ID') +
    ' karakter dibaca bot di tiap balasan. Makin panjang, makin mahal tiap balasan; di atas ±30.000 mulai terasa.';
}

document.addEventListener('input', (e) => {
  const key = e.target.dataset && e.target.dataset.key;
  if (!key || !profile) return;
  profile[key] =
    e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value;
  if (key === 'notes') updateKnowLen();
  setDirty(true, key);
});

// ---------- tabel isian ----------
const cellInput = (value, onInput, placeholder = '') => {
  const input = el('input', { type: 'text', value: value || '', placeholder });
  // Lebar kolom mengikuti isinya, supaya kode dan judul kolom tidak terpotong.
  const fit = () => (input.style.minWidth = Math.min(36, Math.max(4, (input.value || placeholder).length) + 3) + 'ch');
  fit();
  input.addEventListener('input', () => { fit(); onInput(input.value); });
  return input;
};
const xBtn = (title, onClick) => {
  const b = el('button', { className: 'x', type: 'button', textContent: '×', title });
  b.setAttribute('aria-label', title);
  b.addEventListener('click', onClick);
  return b;
};

// ---------- data pelanggan ----------
function renderFields() {
  const head = el('thead', {}, el('tr', {},
    ...['Kunci', 'Sebutan ke pelanggan', 'Petunjuk untuk bot', 'Nama'].map((t) => el('th', { className: 'lbl', textContent: t })),
    el('th', { className: 'act' })));
  const body = el('tbody');
  profile.leadFields.forEach((f, i) => {
    const mk = (prop, ph) => el('td', { className: prop === 'key' ? 'first' : '' },
      cellInput(f[prop], (v) => { f[prop] = v; setDirty(true, 'leadFields'); }, ph));
    const isName = el('input', { type: 'checkbox', checked: Boolean(f.isName), title: 'Dipakai untuk menyapa' });
    isName.addEventListener('change', () => {
      profile.leadFields.forEach((x) => (x.isName = false));
      f.isName = isName.checked;
      setDirty(true, 'leadFields');
      renderFields();
    });
    const del = xBtn('Hapus baris', () => {
      if (profile.leadFields.length <= 1) return toast('Minimal satu baris.', true);
      profile.leadFields.splice(i, 1);
      setDirty(true, 'leadFields');
      renderFields();
    });
    body.append(el('tr', {}, mk('key', 'mis. kota'), mk('label', 'mis. kota/alamat'), mk('hint', 'apa yang dihitung sebagai jawabannya'),
      el('td', { className: 'center' }, isName), el('td', { className: 'act' }, del)));
  });
  $('fields').replaceChildren(head, body);
}

$('addField').addEventListener('click', () => {
  if (profile.leadFields.length >= 8) return toast('Maksimal 8 baris.', true);
  profile.leadFields.push({ key: '', label: '', hint: '', isName: false });
  setDirty(true, 'leadFields');
  renderFields();
});

// ---------- data produk ----------
const norm = (s) => String(s || '').replace(/[\s-]/g, '').toUpperCase();
/** Foto yang kata kuncinya menyebut kode produk ini. */
const photosFor = (code) => {
  const c = norm(code);
  return c ? (profile.photos || []).filter((p) => String(p.tags || '').split(/[,;]/).some((t) => norm(t) === c)) : [];
};
const touchCatalog = () => { setDirty(true, 'catalog'); updateKnowLen(); };
const openSeries = new Set([0]);

function tableNode(s, t, isFirst) {
  const table = el('table', { className: 'grid' });
  const focusCell = (r, c) => {
    const n = table.querySelector('input[data-r="' + r + '"][data-c="' + c + '"]');
    if (n) { n.focus(); n.select(); }
    return Boolean(n);
  };
  const redraw = (r, c) => { draw(); if (r !== undefined) focusCell(r, c); };

  function draw() {
    const head = el('tr', {}, ...t.columns.map((col, ci) => {
      const input = cellInput(col, (v) => { t.columns[ci] = v; touchCatalog(); }, 'judul kolom');
      const del = ci === 0 ? null : xBtn('Hapus kolom "' + col + '"', () => {
        if (t.rows.some((r) => r[ci]) && !confirm('Hapus kolom "' + t.columns[ci] + '" beserta isinya?')) return;
        t.columns.splice(ci, 1);
        t.rows.forEach((r) => r.splice(ci, 1));
        touchCatalog();
        redraw();
      });
      return el('th', {}, el('div', { className: 'hc' }, input, del));
    }), isFirst ? el('th', { className: 'lbl', textContent: 'Foto' }) : null, el('th', { className: 'act' }));

    const body = el('tbody', {}, ...t.rows.map((row, ri) => {
      const cells = t.columns.map((_, ci) => {
        const input = cellInput(row[ci], (v) => { row[ci] = v; touchCatalog(); });
        input.dataset.r = ri;
        input.dataset.c = ci;
        return el('td', { className: ci === 0 ? 'first' : '' }, input);
      });
      let photoCell = null;
      if (isFirst) {
        const add = el('button', { className: 'add', type: 'button', textContent: '+', title: 'Tambah foto produk ini' });
        add.addEventListener('click', () => {
          const code = (row[0] || '').trim();
          if (!code) return toast('Isi ' + t.columns[0] + ' baris ini dulu.', true);
          pickPhoto({ label: (s.name ? s.name + ' — ' : '') + code, tags: code });
        });
        photoCell = el('td', {}, el('div', { className: 'thumbs' },
          ...photosFor(row[0]).map((p) => el('img', { src: '/admin/media/' + p.file, alt: p.label, title: p.label, loading: 'lazy' })), add));
      }
      const del = xBtn('Hapus baris', () => { t.rows.splice(ri, 1); touchCatalog(); redraw(); });
      return el('tr', {}, ...cells, photoCell, el('td', { className: 'act' }, del));
    }));
    table.replaceChildren(el('thead', {}, head), body);
  }

  // Enter = turun satu baris (baris baru di ujung), seperti lembar kerja.
  table.addEventListener('keydown', (e) => {
    const d = e.target.dataset;
    if (e.key !== 'Enter' || d.r === undefined) return;
    e.preventDefault();
    const r = Number(d.r) + 1;
    if (r >= t.rows.length) { t.rows.push(t.columns.map(() => '')); touchCatalog(); redraw(r, Number(d.c)); }
    else focusCell(r, Number(d.c));
  });
  // Tempel dari Excel / Google Sheet: beberapa sel sekaligus.
  table.addEventListener('paste', (e) => {
    const d = e.target.dataset;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (d.r === undefined || !/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    const r0 = Number(d.r);
    const c0 = Number(d.c);
    lines.forEach((cells, i) => {
      if (r0 + i >= 200) return;
      while (t.rows.length <= r0 + i) t.rows.push(t.columns.map(() => ''));
      cells.forEach((v, j) => { if (c0 + j < t.columns.length) t.rows[r0 + i][c0 + j] = v.trim(); });
    });
    touchCatalog();
    redraw(r0, c0);
    toast(lines.length + ' baris ditempel.');
  });

  draw();
  const addRow = el('button', { className: 'btn ghost small', type: 'button', textContent: '+ Baris' });
  addRow.addEventListener('click', () => { t.rows.push(t.columns.map(() => '')); touchCatalog(); redraw(t.rows.length - 1, 0); });
  const addCol = el('button', { className: 'btn ghost small', type: 'button', textContent: '+ Kolom' });
  addCol.addEventListener('click', () => {
    if (t.columns.length >= 16) return toast('Maksimal 16 kolom.', true);
    t.columns.push('Kolom ' + (t.columns.length + 1));
    t.rows.forEach((r) => r.push(''));
    touchCatalog();
    redraw();
  });
  return { table, addRow, addCol };
}

function seriesNode(s, si) {
  const count = el('span', { className: 'count' });
  const title = el('span', { textContent: s.name || '(kelompok baru)' });
  const models = () => new Set(s.tables.flatMap((t) => t.rows.map((r) => r[0]).filter(Boolean))).size;
  count.textContent = models() + ' produk · ' + s.tables.length + ' tabel';

  const name = cellInput(s.name, (v) => { s.name = v; title.textContent = v || '(kelompok baru)'; touchCatalog(); }, 'mis. Exhaust Fan Industri — Seri A');
  const facts = el('textarea', { rows: Math.max(2, s.facts.length + 1), value: s.facts.join('\n'), placeholder: 'Satu kalimat per baris: bahan, pemakaian, rentang ukuran, …' });
  facts.addEventListener('input', () => { s.facts = facts.value.split('\n').map((f) => f.trim()).filter(Boolean); touchCatalog(); });

  const body = el('div', { className: 'series-body' },
    el('div', { className: 'row' },
      el('label', { className: 'f' }, el('span', { textContent: 'Nama kelompok / seri' }), name),
      el('label', { className: 'f' }, el('span', { textContent: 'Keterangan umum' }), facts)));

  s.tables.forEach((t, ti) => {
    const { table, addRow, addCol } = tableNode(s, t, ti === 0);
    const tTitle = cellInput(t.title, (v) => { t.title = v; touchCatalog(); }, 'judul tabel, mis. Spesifikasi teknis');
    const delT = el('button', { className: 'btn danger small', type: 'button', textContent: 'Hapus tabel' });
    delT.addEventListener('click', () => {
      if (t.rows.length && !confirm('Hapus tabel "' + t.title + '" beserta ' + t.rows.length + ' barisnya?')) return;
      s.tables.splice(ti, 1);
      touchCatalog();
      renderCatalog();
    });
    body.append(el('div', { className: 'tblhead' }, tTitle),
      el('div', { className: 'scroll' }, table),
      el('div', { className: 'tblfoot' }, addRow, addCol, delT));
  });

  const addT = el('button', { className: 'btn ghost small', type: 'button', textContent: '+ Tabel' });
  addT.addEventListener('click', () => {
    if (s.tables.length >= 6) return toast('Maksimal 6 tabel per kelompok.', true);
    const first = s.tables[0];
    // Tabel kedua (mis. ukuran pemasangan) mulai dengan daftar produk yang sama.
    s.tables.push({ title: '', columns: [first ? first.columns[0] : 'Model', 'Kolom 2'], rows: first ? first.rows.map((r) => [r[0], '']) : [['', '']] });
    touchCatalog();
    renderCatalog();
  });
  const delS = el('button', { className: 'btn danger small', type: 'button', textContent: 'Hapus kelompok' });
  delS.addEventListener('click', () => {
    if (!confirm('Hapus kelompok "' + (s.name || 'tanpa nama') + '" beserta semua tabelnya?')) return;
    profile.catalog.splice(si, 1);
    openSeries.clear();
    touchCatalog();
    renderCatalog();
  });
  body.append(el('div', { className: 'tblfoot', style: 'margin-top:16px;padding-top:12px;border-top:1px solid var(--line-soft)' }, addT, delS));

  const d = el('details', { className: 'series', open: openSeries.has(si) }, el('summary', {}, title, count), body);
  d.addEventListener('toggle', () => (d.open ? openSeries.add(si) : openSeries.delete(si)));
  return d;
}

function renderCatalog() {
  $('catalog').replaceChildren(...profile.catalog.map(seriesNode));
  const codes = new Set(profile.catalog.flatMap((s) => s.tables.flatMap((t) => t.rows.map((r) => (r[0] || '').trim()).filter(Boolean))));
  $('codes').replaceChildren(...[...codes].map((c) => el('option', { value: c })));
  updateKnowLen();
}

$('addSeries').addEventListener('click', () => {
  if (profile.catalog.length >= 40) return toast('Maksimal 40 kelompok.', true);
  profile.catalog.push({ name: '', facts: [], tables: [{ title: 'Spesifikasi', columns: ['Model', 'Kolom 2'], rows: [['', '']] }] });
  openSeries.add(profile.catalog.length - 1);
  touchCatalog();
  renderCatalog();
  $('catalog').lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------- foto ----------
async function uploadPhoto(file, label, tags) {
  if (file.size > 4000000) throw new Error('Foto terlalu besar (maksimal 4 MB).');
  const q = new URLSearchParams({ label, tags });
  const r = await api('photos?' + q, { method: 'POST', body: file, headers: { 'content-type': file.type } });
  profile.photos = r.photos;
  renderPhotos();
  renderCatalog();
}

// Unggah dari baris produk: keterangan dan kata kuncinya diisi dari baris itu.
let pending = null;
function pickPhoto(meta) {
  pending = meta;
  $('rowFile').value = '';
  $('rowFile').click();
}
$('rowFile').addEventListener('change', async () => {
  const file = $('rowFile').files[0];
  if (!file || !pending) return;
  try {
    await uploadPhoto(file, pending.label.slice(0, 120), pending.tags);
    toast('Foto ' + pending.tags + ' tersimpan dan langsung bisa dipakai bot.');
  } catch (e) { toast(e.message, true); }
  pending = null;
});

function renderPhotos() {
  const list = profile.photos || [];
  $('photoCount').textContent = list.length + ' foto';
  const head = el('thead', {}, el('tr', {},
    ...['Foto', 'Keterangan', 'Produk / kata kunci'].map((t) => el('th', { className: 'lbl', textContent: t })), el('th', { className: 'act' })));

  // Baris pertama: tambah foto baru.
  const file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  const nLabel = el('input', { type: 'text', placeholder: 'mis. GFAF-40A tampak depan' });
  const nTags = el('input', { type: 'text', placeholder: 'kode produk, mis. GFAF-40A' });
  nTags.setAttribute('list', 'codes');
  const up = el('button', { className: 'btn small', type: 'button', textContent: 'Unggah' });
  up.addEventListener('click', async () => {
    if (!file.files[0]) return toast('Pilih berkas fotonya dulu.', true);
    if (!nLabel.value.trim()) return toast('Isi keterangan fotonya dulu.', true);
    up.disabled = true;
    try {
      await uploadPhoto(file.files[0], nLabel.value.trim(), nTags.value.trim());
      toast('Foto tersimpan dan langsung bisa dipakai bot.');
    } catch (e) { toast(e.message, true); up.disabled = false; }
  });
  const newRow = el('tr', { className: 'new' }, el('td', { className: 'pad' }, file), el('td', {}, nLabel), el('td', {}, nTags), el('td', { className: 'act' }, up));

  const rows = list.map((p) => {
    const lab = el('input', { type: 'text', value: p.label });
    const tags = el('input', { type: 'text', value: p.tags || '', placeholder: 'produk / kata kunci' });
    tags.setAttribute('list', 'codes');
    const save = el('button', { className: 'btn ghost small', textContent: 'Simpan', type: 'button', disabled: true });
    for (const i of [lab, tags]) i.addEventListener('input', () => (save.disabled = false));
    save.addEventListener('click', async () => {
      try {
        const r = await api('photos/' + p.id, { method: 'PATCH', body: JSON.stringify({ label: lab.value, tags: tags.value }) });
        profile.photos = r.photos;
        renderPhotos();
        renderCatalog();
        toast('Keterangan foto disimpan.');
      } catch (e) { toast(e.message, true); }
    });
    const del = xBtn('Hapus foto', async () => {
      if (!confirm('Hapus foto "' + p.label + '"? Tidak bisa dibatalkan.')) return;
      try {
        const r = await api('photos/' + p.id, { method: 'DELETE' });
        profile.photos = r.photos;
        renderPhotos();
        renderCatalog();
        toast('Foto dihapus.');
      } catch (e) { toast(e.message, true); }
    });
    return el('tr', {},
      el('td', { className: 'photo' }, el('img', { src: '/admin/media/' + p.file, alt: p.label, loading: 'lazy' })),
      el('td', {}, lab), el('td', {}, tags), el('td', { className: 'act' }, save, del));
  });
  $('photos').replaceChildren(head, el('tbody', {}, newRow, ...rows));
}

// Klik foto kecil = lihat besar.
document.addEventListener('click', (e) => {
  if (e.target.tagName === 'IMG' && e.target.closest('.thumbs, td.photo')) {
    $('viewer').firstElementChild.src = e.target.src;
    $('viewer').classList.add('on');
  }
});
$('viewer').addEventListener('click', () => $('viewer').classList.remove('on'));

// ---------- uji coba ----------
function addMsg(cls, text, photos) {
  const m = el('div', { className: 'msg ' + cls, textContent: text });
  for (const p of photos || []) m.append(el('img', { src: '/admin/media/' + p.file, alt: p.label, title: p.label }));
  $('chat').append(m);
  $('chat').scrollTop = $('chat').scrollHeight;
  return m;
}

$('sendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('sendText').value.trim();
  if (!text) return;
  if (dirty) addMsg('note', 'Ada perubahan yang belum disimpan — jawaban di bawah masih memakai profil lama.');
  $('sendText').value = '';
  addMsg('in', text);
  const wait = addMsg('note', 'sedang mengetik…');
  try {
    const r = await api('test', { method: 'POST', body: JSON.stringify({ text, history: chat, known }) });
    wait.remove();
    if (r.rejected) {
      addMsg('bad', 'Balasan ini TIDAK akan dikirim (' + r.rejected + '):\n\n' + r.reply);
    } else {
      addMsg('out', r.reply, r.photos);
    }
    Object.assign(known, r.fields);
    const got = Object.entries(r.fields).map(([k, v]) => k + ' = ' + v).join(' · ');
    addMsg('note', 'niat: ' + r.intent + (got ? ' · tercatat: ' + got : '') + (r.photos.length ? ' · ' + r.photos.length + ' foto' : ''));
    chat.push({ dir: 'in', text }, { dir: 'out', text: r.reply });
  } catch (err) {
    wait.remove();
    addMsg('bad', err.message);
  }
});

$('resetChat').addEventListener('click', () => {
  chat = [];
  known = {};
  $('chat').replaceChildren(el('div', { className: 'msg note', textContent: 'Ketik seperti calon pelanggan.' }));
});

// ---------- lead ----------
async function loadLeads() {
  const t = $('leads');
  try {
    const r = await api('leads');
    const head = el('tr', {}, el('th', { textContent: 'Nomor' }), ...r.fields.map((f) => el('th', { textContent: f.label })),
      el('th', { textContent: 'Status' }), el('th', { textContent: 'Terakhir chat' }));
    const rows = r.rows.map((c) =>
      el('tr', {}, el('td', { textContent: c.phone }), ...r.fields.map((f) => el('td', { textContent: c.lead[f.key] || '—' })),
        el('td', {}, el('span', { className: 'chip ' + (c.complete ? 'ok' : ''), textContent: c.complete ? 'lengkap' : 'belum lengkap' }),
          c.needsSales ? el('span', { className: 'chip warn', textContent: 'perlu sales', style: 'margin-left:4px' }) : null,
          c.lastDir === 'human' ? el('span', { className: 'chip', textContent: 'ditangani manusia', style: 'margin-left:4px' }) : null),
        el('td', { textContent: new Date(c.lastAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) })));
    t.replaceChildren(el('thead', {}, head), el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colSpan: r.fields.length + 3, textContent: 'Belum ada percakapan.' }))])));
  } catch (e) { toast(e.message, true); }
}

// ---------- pemakaian & biaya ----------
const int = (n) => Math.round(n).toLocaleString('id-ID');
const usd = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: n < 1 ? 4 : 2 });
const idr = (n) => 'Rp ' + n.toLocaleString('id-ID', { maximumFractionDigits: n < 100 ? 1 : 0 });

async function loadUsage() {
  const tiles = $('usageTiles');
  const table = $('usage');
  try {
    const u = (await api('usage')).usage;
    if (!u) {
      tiles.replaceChildren();
      $('usageRate').textContent = 'Bot belum pernah melapor ke dashboard ini. Nyalakan bot; pemakaiannya muncul di sini dalam ±15 menit.';
      table.replaceChildren();
      return;
    }
    // Token masuk yang kena cache jauh lebih murah, jadi dihitung terpisah.
    const cost = (d) => ((d.promptTokens - d.cachedTokens) * u.price.in + d.cachedTokens * u.price.cached + d.completionTokens * u.price.out) / 1e6;
    const sum = (days) => days.reduce((a, d) => ({
      calls: a.calls + d.calls, promptTokens: a.promptTokens + d.promptTokens, cachedTokens: a.cachedTokens + d.cachedTokens,
      completionTokens: a.completionTokens + d.completionTokens, usd: a.usd + cost(d),
    }), { calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, usd: 0 });
    const dayStr = (back) => new Date(Date.now() - back * 86400000).toLocaleDateString('en-CA');
    const since = (n) => u.days.filter((d) => d.day > dayStr(n));

    const tile = (k, days) => {
      const s = sum(days);
      return el('div', { className: 'tile' }, el('div', { className: 'k', textContent: k }),
        el('div', { className: 'v', textContent: idr(s.usd * u.usdIdr) }),
        el('div', { className: 's', textContent: usd(s.usd) + ' · ' + int(s.calls) + ' balasan · ' + int(s.promptTokens + s.completionTokens) + ' token' }));
    };
    tiles.replaceChildren(tile('Hari ini', since(1)), tile('7 hari terakhir', since(7)), tile('30 hari terakhir', since(30)));

    $('usageRate').textContent = 'Model ' + u.model + ' · tarif per 1 juta token: masuk ' + usd(u.price.in) + ', masuk dari cache ' + usd(u.price.cached) +
      ', keluar ' + usd(u.price.out) + ' · kurs Rp ' + int(u.usdIdr) + ' per USD. Tarif dan kurs diatur di .env bot.';

    const th = (t, num) => el('th', { textContent: t, className: num ? 'num' : '' });
    const td = (t, num) => el('td', { textContent: t, className: num ? 'num' : '' });
    const max = Math.max(...u.days.map(cost), 0);
    const line = (label, d, c, bar) => el('tr', {}, td(label), td(int(d.calls), 1), td(int(d.promptTokens), 1), td(int(d.cachedTokens), 1),
      td(int(d.completionTokens), 1), td(usd(c), 1), td(idr(c * u.usdIdr), 1),
      el('td', { style: 'width:120px;vertical-align:middle' }, bar && max ? el('div', { className: 'bar', style: 'width:' + Math.round((c / max) * 100) + '%' }) : null));
    const rows = u.days.map((d) => line(new Date(d.day + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), d, cost(d), true));
    const total = sum(u.days);
    table.replaceChildren(
      el('thead', {}, el('tr', {}, th('Tanggal'), th('Balasan', 1), th('Token masuk', 1), th('…dari cache', 1), th('Token keluar', 1), th('Biaya (USD)', 1), th('Biaya (Rp)', 1), th(''))),
      el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colSpan: 8, textContent: 'Belum ada pemakaian yang tercatat.' }))])),
      rows.length ? el('tfoot', {}, line('Jumlah (' + u.days.length + ' hari)', total, total.usd, false)) : null);
  } catch (e) { toast(e.message, true); }
}

// ---------- navigasi, simpan, masuk ----------
function show(tab) {
  for (const b of $('nav').querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const s of document.querySelectorAll('section')) s.classList.toggle('on', s.id === 'tab-' + tab);
  $('title').textContent = PAGES[tab][0];
  $('desc').textContent = PAGES[tab][1];
  // Halaman yang hanya menampilkan tidak punya apa-apa untuk disimpan.
  $('save').style.display = ['lead', 'biaya', 'uji', 'foto'].includes(tab) && !dirty ? 'none' : '';
  if (tab === 'lead') loadLeads();
  if (tab === 'biaya') loadUsage();
}

$('nav').addEventListener('click', (e) => {
  const tab = e.target.dataset && e.target.dataset.tab;
  if (tab) show(tab);
});

$('save').addEventListener('click', async () => {
  $('save').disabled = true;
  try {
    const body = {};
    for (const k of changed) body[k] = profile[k];
    const r = await api('profile', { method: 'PUT', body: JSON.stringify(body) });
    profile = r.profile;
    fillInputs();
    renderFields();
    renderCatalog();
    setDirty(false);
    $('brandName').textContent = profile.brand;
    toast('Tersimpan. Bot memakai pengaturan baru mulai pesan berikutnya.');
  } catch (e) {
    toast(e.message, true);
    setDirty(true);
  }
});

window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

async function load() {
  const s = await api('state');
  profile = s.profile;
  $('login').classList.remove('on');
  $('brandName').textContent = profile.brand;
  $('brandSub').textContent = 'profil: ' + s.business;
  const st = s.status;
  // Dashboard online hanya tahu keadaan bot dari laporan terakhirnya.
  const mins = st && st.reportedAt ? Math.round((Date.now() - st.reportedAt) / 60000) : null;
  $('chipLlm').textContent = s.testReady ? 'uji coba siap' : 'LLM belum diatur';
  $('chipLlm').className = 'chip ' + (s.testReady ? 'ok' : 'warn');
  $('chipWa').textContent = !st ? 'bot belum pernah melapor' : mins === null ? 'jalur: ' + st.transport
    : 'bot melapor ' + (mins < 1 ? 'baru saja' : mins + ' menit lalu');
  $('chipWa').className = 'chip ' + (!st || (mins !== null && mins > 40) ? 'warn' : 'ok');
  const info = !st
    ? [['Bot', 'Belum pernah melapor ke dashboard ini. Nyalakan bot dengan penyimpanan bersama yang sama.']]
    : [['Jalur WhatsApp', st.transport], ['Nomor sales', st.sales || 'belum diatur'], ['Google Sheet', st.sheet ? 'siap' : 'belum diatur'],
        ['Yang dibalas', st.onlyNumbers ? 'MODE UJI: hanya ' + st.onlyNumbers + ' nomor' : 'semua nomor'],
        ['Panggilan LLM hari ini', st.usage.calls + ' dari batas ' + st.usage.limit],
        ...(st.guard ? [['Pengaman nomor', st.guard]] : [])];
  $('envInfo').replaceChildren(el('tbody', {}, ...info.map(([k, v]) => el('tr', {}, el('td', { textContent: k, style: 'width:220px;color:var(--muted)' }), el('td', { textContent: v })))));
  fillInputs();
  renderFields();
  renderCatalog();
  renderPhotos();
  setDirty(false);
  show('identitas');
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginErr').textContent = '';
  try {
    await api('login', { method: 'POST', body: JSON.stringify({ password: $('pw').value }) });
    $('pw').value = '';
    await load();
  } catch (err) { $('loginErr').textContent = err.message; }
});

$('logout').addEventListener('click', async () => {
  await api('logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

load().catch(() => {});
