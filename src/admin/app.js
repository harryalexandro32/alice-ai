// Dashboard pemilik. Semua teks dari server dipasang lewat textContent, tidak
// pernah innerHTML: data produk dan nama pelanggan diketik orang.
'use strict';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) if (k !== null && k !== undefined) n.append(k);
  return n;
};

// ---------- bahasa tampilan (hanya dashboard; bot tetap berbahasa Indonesia) ----------
let lang = 'id';
try { if (localStorage.getItem('lang') === 'en') lang = 'en'; } catch { /* penyimpanan peramban diblokir */ }
const T = (id, en) => (lang === 'en' ? en : id);
const locale = () => T('id-ID', 'en-GB');

function applyLang() {
  document.documentElement.lang = lang;
  // data-en hanya berisi teks yang ditulis di page.html (bukan dari pengguna),
  // jadi aman dipasang sebagai HTML.
  for (const n of document.querySelectorAll('[data-en]')) {
    if (n.dataset.id === undefined) n.dataset.id = n.innerHTML;
    n.innerHTML = lang === 'en' ? n.dataset.en : n.dataset.id;
  }
  for (const n of document.querySelectorAll('[data-en-ph]')) {
    if (n.dataset.idPh === undefined) n.dataset.idPh = n.placeholder;
    n.placeholder = lang === 'en' ? n.dataset.enPh : n.dataset.idPh;
  }
  for (const b of $('lang').children) b.classList.toggle('on', b.dataset.lang === lang);
}

let profile = null;
let state = null;
let tab = 'identitas';
let dirty = false;
// Hanya kunci yang benar-benar diubah yang dikirim: yang tidak disentuh tetap
// mengikuti bawaan, jadi perbaikan bawaan di kemudian hari tetap sampai.
const changed = new Set();
let chat = [];
let known = {};

const PAGES = {
  identitas: () => [T('Identitas', 'Identity'), T('Siapa yang membalas chat, logonya, dan salam pembukanya. Perubahan berlaku pada pesan berikutnya setelah disimpan.', 'Who replies to chats, the logo, and the greeting. Changes apply to the next message after you save.')],
  perilaku: () => [T('Perilaku', 'Behaviour'), T('Irama balasan bot dan keadaan bot saat ini.', 'The rhythm of the bot\'s replies and its current state.')],
  rekomendasi: () => [T('Rekomendasi', 'Recommendations'), T('Apa yang ditanyakan bot ke pelanggan, dan cara ia memilih produk.', 'What the bot asks the customer, and how it picks a product.')],
  produk: () => [T('Produk', 'Products'), T('Satu-satunya sumber jawaban bot. Yang tidak tertulis di sini tidak akan dijawabnya.', 'The bot\'s only source of answers. Anything not written here, it will not answer.')],
  data: () => [T('Data pelanggan', 'Customer data'), T('Data yang diminta bot dari tiap calon pelanggan.', 'What the bot asks every prospective customer for.')],
  lead: () => ['Lead', T('Calon pelanggan yang sudah chat dengan bot.', 'Prospective customers who have chatted with the bot.')],
  biaya: () => [T('Pemakaian & biaya', 'Usage & cost'), T('Token LLM yang dipakai bot dan perkiraan biayanya.', 'LLM tokens used by the bot and their estimated cost.')],
  uji: () => [T('Uji coba', 'Test chat'), T('Coba bicara dengan bot tanpa mengirim apa pun ke WhatsApp.', 'Talk to the bot without sending anything to WhatsApp.')],
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
    throw new Error(T('Belum masuk.', 'Not signed in.'));
  }
  if (!res.ok) throw new Error(data.error || T('Gagal', 'Failed') + ' (' + res.status + ').');
  return data;
}

function setDirty(v, key) {
  dirty = v;
  if (v && key) changed.add(key);
  if (!v) changed.clear();
  $('save').disabled = !v;
  $('save').textContent = v ? T('Simpan & terapkan', 'Save & apply') : T('Tersimpan', 'Saved');
  $('save').style.display = ['lead', 'biaya', 'uji'].includes(tab) && !v ? 'none' : '';
}

// ---------- isian sederhana ----------
function fillInputs() {
  for (const input of document.querySelectorAll('[data-key]')) {
    const v = profile[input.dataset.key];
    if (input.type === 'checkbox') input.checked = Boolean(v);
    else input.value = v ?? '';
  }
}

document.addEventListener('input', (e) => {
  const key = e.target.dataset && e.target.dataset.key;
  if (!key || !profile) return;
  profile[key] =
    e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value;
  if (key === 'notes') updateKnowLen();
  setDirty(true, key);
});

// ---------- berkas (foto, PDF, logo) ----------
const fileOf = (id) => (profile.files || []).find((f) => f.id === id);
const mediaUrl = (id) => { const f = fileOf(id); return f ? '/admin/media/' + f.file : ''; };

async function uploadFile(file) {
  if (file.size > 4000000) throw new Error(T('Berkas terlalu besar (maksimal 4 MB).', 'File too large (4 MB max).'));
  const r = await api('files?' + new URLSearchParams({ name: file.name }), { method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } });
  profile.files = r.files;
  return r.file;
}

// Satu pemilih berkas untuk semua tombol unggah.
let onPicked = null;
function pick(accept, handler) {
  onPicked = handler;
  $('pickFile').accept = accept;
  $('pickFile').value = '';
  $('pickFile').click();
}
$('pickFile').addEventListener('change', async () => {
  const file = $('pickFile').files[0];
  const handler = onPicked;
  onPicked = null;
  if (!file || !handler) return;
  try {
    handler(await uploadFile(file));
  } catch (e) { toast(e.message, true); }
});
const IMAGES = 'image/jpeg,image/png,image/webp';

// ---------- logo ----------
function renderLogo() {
  const src = mediaUrl(profile.logo);
  document.body.classList.toggle('has-logo', Boolean(src));
  if (src) $('logoTop').src = src;
  $('logoBox').replaceChildren(src ? el('img', { src, alt: 'Logo' }) : T('belum ada logo', 'no logo yet'));
  $('logoClear').style.display = src ? '' : 'none';
}
$('logoPick').addEventListener('click', () => pick(IMAGES, (f) => {
  if (f.file.endsWith('.pdf')) return toast(T('Logo harus berupa gambar.', 'The logo must be an image.'), true);
  profile.logo = f.id;
  setDirty(true, 'logo');
  renderLogo();
}));
$('logoClear').addEventListener('click', () => { profile.logo = ''; setDirty(true, 'logo'); renderLogo(); });

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
const headRow = (labels) => el('thead', {}, el('tr', {}, ...labels.map((t) => el('th', { className: 'lbl', textContent: t })), el('th', { className: 'act' })));

/** Enter = turun satu baris; tempel dari Excel = isi banyak sel. `rows` = daftar baris, `get/set` = akses sel. */
function sheetKeys(table, opts) {
  const focusCell = (r, c) => {
    const n = table.querySelector('input[data-r="' + r + '"][data-c="' + c + '"]');
    if (n) { n.focus(); n.select(); }
  };
  table.addEventListener('keydown', (e) => {
    const d = e.target.dataset;
    if (e.key !== 'Enter' || d.r === undefined) return;
    e.preventDefault();
    const r = Number(d.r) + 1;
    if (r >= opts.count()) { opts.addRow(); opts.redraw(); }
    focusCell(r, Number(d.c));
  });
  table.addEventListener('paste', (e) => {
    const d = e.target.dataset;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (d.r === undefined || !/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    const r0 = Number(d.r);
    const c0 = Number(d.c);
    lines.forEach((cells, i) => {
      if (r0 + i >= opts.max) return;
      while (opts.count() <= r0 + i) opts.addRow();
      cells.forEach((v, j) => { if (c0 + j < opts.cols()) opts.set(r0 + i, c0 + j, v.trim()); });
    });
    opts.redraw();
    focusCell(r0, c0);
    toast(lines.length + T(' baris ditempel.', ' rows pasted.'));
  });
  return focusCell;
}

// ---------- data pelanggan ----------
function renderFields() {
  const body = el('tbody');
  profile.leadFields.forEach((f, i) => {
    const mk = (prop, ph) => el('td', { className: prop === 'key' ? 'first' : '' },
      cellInput(f[prop], (v) => { f[prop] = v; setDirty(true, 'leadFields'); }, ph));
    const isName = el('input', { type: 'checkbox', checked: Boolean(f.isName), title: T('Dipakai untuk menyapa', 'Used to address the customer') });
    isName.addEventListener('change', () => {
      profile.leadFields.forEach((x) => (x.isName = false));
      f.isName = isName.checked;
      setDirty(true, 'leadFields');
      renderFields();
    });
    const del = xBtn(T('Hapus baris', 'Delete row'), () => {
      if (profile.leadFields.length <= 1) return toast(T('Minimal satu baris.', 'At least one row.'), true);
      profile.leadFields.splice(i, 1);
      setDirty(true, 'leadFields');
      renderFields();
    });
    body.append(el('tr', {}, mk('key', T('mis. kota', 'e.g. kota')), mk('label', T('mis. kota/alamat', 'e.g. kota/alamat')), mk('hint', T('apa yang dihitung sebagai jawabannya', 'what counts as the answer')),
      el('td', { className: 'center' }, isName), el('td', { className: 'act' }, del)));
  });
  $('fields').replaceChildren(headRow([T('Kunci', 'Key'), T('Sebutan ke pelanggan', 'What the customer is asked for'), T('Petunjuk untuk bot', 'Hint for the bot'), T('Nama', 'Name')]), body);
}

$('addField').addEventListener('click', () => {
  if (profile.leadFields.length >= 8) return toast(T('Maksimal 8 baris.', '8 rows max.'), true);
  profile.leadFields.push({ key: '', label: '', hint: '', isName: false });
  setDirty(true, 'leadFields');
  renderFields();
});

// ---------- pertanyaan kebutuhan ----------
function renderQuestions() {
  const body = el('tbody', {}, ...profile.questions.map((q, i) => el('tr', {},
    el('td', {}, cellInput(q, (v) => { profile.questions[i] = v; setDirty(true, 'questions'); }, T('mis. Ukuran ruangannya berapa × berapa meter?', 'e.g. Ukuran ruangannya berapa × berapa meter?'))),
    el('td', { className: 'act' }, xBtn(T('Hapus pertanyaan', 'Delete question'), () => { profile.questions.splice(i, 1); setDirty(true, 'questions'); renderQuestions(); })))));
  if (!profile.questions.length) body.append(el('tr', {}, el('td', { colSpan: 2, style: 'padding:10px;color:var(--muted)', textContent: T('Belum ada pertanyaan. Bot akan bertanya seperlunya saja.', 'No questions yet. The bot will only ask when it has to.') })));
  $('questions').replaceChildren(headRow([T('Pertanyaan', 'Question')]), body);
}
$('addQuestion').addEventListener('click', () => {
  if (profile.questions.length >= 12) return toast(T('Maksimal 12 pertanyaan.', '12 questions max.'), true);
  profile.questions.push('');
  setDirty(true, 'questions');
  renderQuestions();
  const inputs = $('questions').querySelectorAll('input');
  inputs[inputs.length - 1].focus();
});

// ---------- daftar produk ----------
const P_COLS = ['name', 'description', 'price', 'stock'];
const blankProduct = () => ({ name: '', description: '', price: '', stock: '', photos: [], pdf: '' });
const touchProducts = () => { setDirty(true, 'products'); updateKnowLen(); };
let focusProduct = () => {};

function renderProducts() {
  const list = profile.products;
  const pdfs = [...new Set(list.map((p) => p.pdf).filter(Boolean))].map(fileOf).filter(Boolean);
  const ph = [T('mis. GFAF-40A', 'e.g. GFAF-40A'), T('jenis, ukuran, kegunaan', 'type, size, use'), T('mis. Rp 450.000', 'e.g. Rp 450.000'), T('mis. ada / 12 unit', 'e.g. ada / 12 unit')];

  const body = el('tbody', {}, ...list.map((p, ri) => {
    const cells = P_COLS.map((k, ci) => {
      const input = cellInput(p[k], (v) => { p[k] = v; touchProducts(); }, ri === 0 || !p.name ? ph[ci] : '');
      input.dataset.r = ri;
      input.dataset.c = ci;
      return el('td', { className: ci === 0 ? 'first' : ci === 1 ? 'wide' : '' }, input);
    });

    const add = el('button', { className: 'add', type: 'button', textContent: '+', title: T('Tambah foto', 'Add photo') });
    add.addEventListener('click', () => {
      if (p.photos.length >= 6) return toast(T('Maksimal 6 foto per produk.', '6 photos per product max.'), true);
      pick(IMAGES, (f) => {
        if (f.file.endsWith('.pdf')) return toast(T('Itu PDF, bukan foto. Pakai kolom PDF.', 'That is a PDF, not a photo. Use the PDF column.'), true);
        p.photos.push(f.id);
        touchProducts();
        renderProducts();
      });
    });
    const thumbs = el('div', { className: 'thumbs' }, ...p.photos.map((id, pi) => {
      const rm = el('button', { type: 'button', textContent: '×', title: T('Lepas foto', 'Remove photo') });
      rm.addEventListener('click', () => { p.photos.splice(pi, 1); touchProducts(); renderProducts(); });
      return el('span', { className: 'th' }, el('img', { src: mediaUrl(id), alt: p.name, loading: 'lazy' }), rm);
    }), add);

    let pdf;
    const cur = fileOf(p.pdf);
    if (cur) {
      pdf = el('div', { className: 'pdf' }, el('a', { href: mediaUrl(p.pdf), target: '_blank', rel: 'noopener', textContent: '📄 ' + cur.name, title: cur.name }),
        xBtn(T('Lepas PDF', 'Remove PDF'), () => { p.pdf = ''; touchProducts(); renderProducts(); }));
    } else {
      const sel = el('select', {}, el('option', { value: '', textContent: T('— tanpa PDF —', '— no PDF —') }),
        el('option', { value: '+', textContent: T('⬆ Unggah PDF…', '⬆ Upload PDF…') }),
        ...pdfs.map((f) => el('option', { value: f.id, textContent: f.name })));
      sel.addEventListener('change', () => {
        if (sel.value === '+') {
          sel.value = '';
          return pick('application/pdf', (f) => {
            if (!f.file.endsWith('.pdf')) return toast(T('Berkas itu bukan PDF.', 'That file is not a PDF.'), true);
            p.pdf = f.id;
            touchProducts();
            renderProducts();
          });
        }
        p.pdf = sel.value;
        touchProducts();
        renderProducts();
      });
      pdf = el('div', { className: 'pdf' }, sel);
    }

    const del = xBtn(T('Hapus produk', 'Delete product'), () => { list.splice(ri, 1); touchProducts(); renderProducts(); });
    return el('tr', {}, ...cells, el('td', {}, thumbs), el('td', {}, pdf), el('td', { className: 'act' }, del));
  }));
  if (!list.length) body.append(el('tr', {}, el('td', { colSpan: 7, style: 'padding:12px;color:var(--muted)', textContent: T('Belum ada produk.', 'No products yet.') })));
  $('products').replaceChildren(headRow([T('Nama', 'Name'), T('Keterangan', 'Description'), T('Harga', 'Price'), T('Stok', 'Stock'), T('Foto', 'Photos'), 'PDF']), body);
  updateKnowLen();
}

focusProduct = sheetKeys($('products'), {
  max: 300,
  count: () => profile.products.length,
  cols: () => P_COLS.length,
  addRow: () => { profile.products.push(blankProduct()); },
  set: (r, c, v) => { profile.products[r][P_COLS[c]] = v; },
  redraw: () => { touchProducts(); renderProducts(); },
});

$('addProduct').addEventListener('click', () => {
  if (profile.products.length >= 300) return toast(T('Maksimal 300 produk.', '300 products max.'), true);
  profile.products.push(blankProduct());
  touchProducts();
  renderProducts();
  focusProduct(profile.products.length - 1, 0);
});

// Sama dengan rakitan di server (src/business/catalog.ts): ini yang dibaca bot.
function knowledgeLength() {
  const v = (s) => s || '-';
  const products = profile.products.map((x) => [x.name, v(x.description), v(x.price), v(x.stock), v(x.photos.join(', ')), v(x.pdf)].join(' | ')).join('\n');
  const catalog = profile.catalog
    .map((s) => {
      const tables = s.tables.map((t) => t.title + ':\n' + t.columns.join(' | ') + '\n' + t.rows.map((r) => r.join(' | ')).join('\n')).join('\n\n');
      return ['### ' + s.name, s.facts.map((f) => '- ' + f).join('\n')].filter(Boolean).join('\n') + (tables ? '\n\n' + tables : '');
    })
    .join('\n\n');
  return products.length + catalog.length + (profile.notes || '').length;
}

function updateKnowLen() {
  const n = knowledgeLength();
  $('knowLen').textContent = profile.products.filter((p) => p.name).length + T(' produk · ±', ' products · ±') + n.toLocaleString(locale()) +
    T(' karakter dibaca bot di tiap balasan. Makin panjang, makin mahal tiap balasan.', ' characters read by the bot on every reply. The longer, the more each reply costs.');
  $('detailCount').textContent = profile.catalog.length ? profile.catalog.length + T(' kelompok', ' groups') : T('kosong', 'empty');
}

// ---------- data teknis rinci ----------
const touchCatalog = () => { setDirty(true, 'catalog'); updateKnowLen(); };
const openSeries = new Set();

function tableNode(t) {
  const table = el('table', { className: 'grid' });
  function draw() {
    const head = el('tr', {}, ...t.columns.map((col, ci) => {
      const input = cellInput(col, (v) => { t.columns[ci] = v; touchCatalog(); }, T('judul kolom', 'column title'));
      const del = ci === 0 ? null : xBtn(T('Hapus kolom', 'Delete column') + ' "' + col + '"', () => {
        if (t.rows.some((r) => r[ci]) && !confirm(T('Hapus kolom "', 'Delete column "') + t.columns[ci] + T('" beserta isinya?', '" and its contents?'))) return;
        t.columns.splice(ci, 1);
        t.rows.forEach((r) => r.splice(ci, 1));
        touchCatalog();
        draw();
      });
      return el('th', {}, el('div', { className: 'hc' }, input, del));
    }), el('th', { className: 'act' }));
    const body = el('tbody', {}, ...t.rows.map((row, ri) => {
      const cells = t.columns.map((_, ci) => {
        const input = cellInput(row[ci], (v) => { row[ci] = v; touchCatalog(); });
        input.dataset.r = ri;
        input.dataset.c = ci;
        return el('td', { className: ci === 0 ? 'first' : '' }, input);
      });
      return el('tr', {}, ...cells, el('td', { className: 'act' }, xBtn(T('Hapus baris', 'Delete row'), () => { t.rows.splice(ri, 1); touchCatalog(); draw(); })));
    }));
    table.replaceChildren(el('thead', {}, head), body);
  }
  const focusCell = sheetKeys(table, {
    max: 200,
    count: () => t.rows.length,
    cols: () => t.columns.length,
    addRow: () => { t.rows.push(t.columns.map(() => '')); },
    set: (r, c, v) => { t.rows[r][c] = v; },
    redraw: () => { touchCatalog(); draw(); },
  });
  draw();
  const addRow = el('button', { className: 'btn ghost small', type: 'button', textContent: T('+ Baris', '+ Row') });
  addRow.addEventListener('click', () => { t.rows.push(t.columns.map(() => '')); touchCatalog(); draw(); focusCell(t.rows.length - 1, 0); });
  const addCol = el('button', { className: 'btn ghost small', type: 'button', textContent: T('+ Kolom', '+ Column') });
  addCol.addEventListener('click', () => {
    if (t.columns.length >= 16) return toast(T('Maksimal 16 kolom.', '16 columns max.'), true);
    t.columns.push(T('Kolom ', 'Column ') + (t.columns.length + 1));
    t.rows.forEach((r) => r.push(''));
    touchCatalog();
    draw();
  });
  return { table, addRow, addCol };
}

function seriesNode(s, si) {
  const blank = T('(kelompok baru)', '(new group)');
  const title = el('span', { textContent: s.name || blank });
  const count = el('span', { className: 'count', textContent: s.tables.length + T(' tabel', ' tables') });
  const name = cellInput(s.name, (v) => { s.name = v; title.textContent = v || blank; touchCatalog(); }, T('mis. Exhaust Fan Industri — Seri A', 'e.g. Exhaust Fan Industri — Seri A'));
  const facts = el('textarea', { rows: Math.max(2, s.facts.length + 1), value: s.facts.join('\n'), placeholder: T('Satu kalimat per baris: bahan, pemakaian, rentang ukuran, …', 'One sentence per line: material, use, size range, …') });
  facts.addEventListener('input', () => { s.facts = facts.value.split('\n').map((f) => f.trim()).filter(Boolean); touchCatalog(); });

  const body = el('div', { className: 'series-body' },
    el('div', { className: 'row' },
      el('label', { className: 'f' }, el('span', { textContent: T('Nama kelompok / seri', 'Group / series name') }), name),
      el('label', { className: 'f' }, el('span', { textContent: T('Keterangan umum', 'General notes') }), facts)));

  s.tables.forEach((t, ti) => {
    const { table, addRow, addCol } = tableNode(t);
    const tTitle = cellInput(t.title, (v) => { t.title = v; touchCatalog(); }, T('judul tabel, mis. Spesifikasi teknis', 'table title, e.g. Spesifikasi teknis'));
    const delT = el('button', { className: 'btn danger small', type: 'button', textContent: T('Hapus tabel', 'Delete table') });
    delT.addEventListener('click', () => {
      if (t.rows.length && !confirm(T('Hapus tabel "', 'Delete table "') + t.title + T('" beserta barisnya?', '" and its rows?'))) return;
      s.tables.splice(ti, 1);
      touchCatalog();
      renderCatalog();
    });
    body.append(el('div', { className: 'tblhead' }, tTitle), el('div', { className: 'scroll' }, table), el('div', { className: 'tblfoot' }, addRow, addCol, delT));
  });

  const addT = el('button', { className: 'btn ghost small', type: 'button', textContent: T('+ Tabel', '+ Table') });
  addT.addEventListener('click', () => {
    if (s.tables.length >= 6) return toast(T('Maksimal 6 tabel per kelompok.', '6 tables per group max.'), true);
    const first = s.tables[0];
    s.tables.push({ title: '', columns: [first ? first.columns[0] : 'Model', T('Kolom 2', 'Column 2')], rows: first ? first.rows.map((r) => [r[0], '']) : [['', '']] });
    touchCatalog();
    renderCatalog();
  });
  const delS = el('button', { className: 'btn danger small', type: 'button', textContent: T('Hapus kelompok', 'Delete group') });
  delS.addEventListener('click', () => {
    if (!confirm(T('Hapus kelompok "', 'Delete group "') + (s.name || blank) + T('" beserta semua tabelnya? Bot tidak akan bisa lagi menjawab spesifikasi di dalamnya.', '" and all its tables? The bot will no longer be able to answer the specifications in it.'))) return;
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
  updateKnowLen();
}

$('addSeries').addEventListener('click', () => {
  if (profile.catalog.length >= 40) return toast(T('Maksimal 40 kelompok.', '40 groups max.'), true);
  profile.catalog.push({ name: '', facts: [], tables: [{ title: T('Spesifikasi', 'Specifications'), columns: ['Model', T('Kolom 2', 'Column 2')], rows: [['', '']] }] });
  openSeries.add(profile.catalog.length - 1);
  touchCatalog();
  renderCatalog();
});

// Klik foto kecil = lihat besar.
document.addEventListener('click', (e) => {
  if (e.target.tagName === 'IMG' && e.target.closest('.thumbs')) {
    $('viewer').firstElementChild.src = e.target.src;
    $('viewer').classList.add('on');
  }
});
$('viewer').addEventListener('click', () => $('viewer').classList.remove('on'));

// ---------- uji coba ----------
const chatHint = () => el('div', { className: 'msg note', textContent: T('Ketik seperti calon pelanggan.', 'Type as a prospective customer would (in Indonesian).') });

function addMsg(cls, text, photos, docs) {
  const m = el('div', { className: 'msg ' + cls, textContent: text });
  for (const p of photos || []) m.append(el('img', { src: '/admin/media/' + p.file, alt: p.name, title: p.name }));
  for (const d of docs || []) m.append(el('a', { className: 'doc', href: '/admin/media/' + d.file, target: '_blank', rel: 'noopener', textContent: '📄 ' + d.name }));
  $('chat').append(m);
  $('chat').scrollTop = $('chat').scrollHeight;
  return m;
}

$('sendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('sendText').value.trim();
  if (!text) return;
  if (dirty) addMsg('note', T('Ada perubahan yang belum disimpan — jawaban di bawah masih memakai profil lama.', 'There are unsaved changes — the answer below still uses the old profile.'));
  $('sendText').value = '';
  addMsg('in', text);
  const wait = addMsg('note', T('sedang mengetik…', 'typing…'));
  try {
    const r = await api('test', { method: 'POST', body: JSON.stringify({ text, history: chat, known }) });
    wait.remove();
    if (r.rejected) {
      addMsg('bad', T('Balasan ini TIDAK akan dikirim (', 'This reply will NOT be sent (') + r.rejected + '):\n\n' + r.reply);
    } else {
      addMsg('out', r.reply, r.photos, r.docs);
    }
    Object.assign(known, r.fields);
    const got = Object.entries(r.fields).map(([k, v]) => k + ' = ' + v).join(' · ');
    const n = r.photos.length + r.docs.length;
    addMsg('note', T('niat: ', 'intent: ') + r.intent + (got ? T(' · tercatat: ', ' · captured: ') + got : '') + (n ? ' · ' + n + T(' lampiran', ' attachments') : ''));
    chat.push({ dir: 'in', text }, { dir: 'out', text: r.reply });
  } catch (err) {
    wait.remove();
    addMsg('bad', err.message);
  }
});

$('resetChat').addEventListener('click', () => {
  chat = [];
  known = {};
  $('chat').replaceChildren(chatHint());
});

// ---------- lead ----------
async function loadLeads() {
  const t = $('leads');
  try {
    const r = await api('leads');
    const head = el('tr', {}, el('th', { textContent: T('Nomor', 'Number') }), ...r.fields.map((f) => el('th', { textContent: f.label })),
      el('th', { textContent: 'Status' }), el('th', { textContent: T('Terakhir chat', 'Last message') }));
    const rows = r.rows.map((c) =>
      el('tr', {}, el('td', { textContent: c.phone }), ...r.fields.map((f) => el('td', { textContent: c.lead[f.key] || '—' })),
        el('td', {}, el('span', { className: 'chip ' + (c.complete ? 'ok' : ''), textContent: c.complete ? T('lengkap', 'complete') : T('belum lengkap', 'incomplete') }),
          c.needsSales ? el('span', { className: 'chip warn', textContent: T('perlu sales', 'needs sales'), style: 'margin-left:4px' }) : null,
          c.lastDir === 'human' ? el('span', { className: 'chip', textContent: T('ditangani manusia', 'handled by a human'), style: 'margin-left:4px' }) : null),
        el('td', { textContent: new Date(c.lastAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) })));
    t.replaceChildren(el('thead', {}, head), el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colSpan: r.fields.length + 3, textContent: T('Belum ada percakapan.', 'No conversations yet.') }))])));
  } catch (e) { toast(e.message, true); }
}

// ---------- pemakaian & biaya ----------
const int = (n) => Math.round(n).toLocaleString(locale());
const usd = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: n < 1 ? 4 : 2 });
const idr = (n) => 'Rp ' + n.toLocaleString(locale(), { maximumFractionDigits: n < 100 ? 1 : 0 });

async function loadUsage() {
  const tiles = $('usageTiles');
  const table = $('usage');
  try {
    const u = (await api('usage')).usage;
    if (!u) {
      tiles.replaceChildren();
      $('usageRate').textContent = T('Bot belum pernah melapor ke dashboard ini. Nyalakan bot; pemakaiannya muncul di sini dalam ±15 menit.', 'The bot has never reported to this dashboard. Start the bot; its usage appears here within about 15 minutes.');
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
        el('div', { className: 's', textContent: usd(s.usd) + ' · ' + int(s.calls) + T(' balasan · ', ' replies · ') + int(s.promptTokens + s.completionTokens) + ' token' }));
    };
    tiles.replaceChildren(tile(T('Hari ini', 'Today'), since(1)), tile(T('7 hari terakhir', 'Last 7 days'), since(7)), tile(T('30 hari terakhir', 'Last 30 days'), since(30)));

    $('usageRate').textContent = 'Model ' + u.model + T(' · tarif per 1 juta token: masuk ', ' · rates per 1M tokens: input ') + usd(u.price.in) + T(', masuk dari cache ', ', cached input ') + usd(u.price.cached) +
      T(', keluar ', ', output ') + usd(u.price.out) + T(' · kurs Rp ', ' · exchange rate Rp ') + int(u.usdIdr) + T(' per USD. Tarif dan kurs diatur di .env bot.', ' per USD. Rates and exchange rate are set in the bot\'s .env.');

    const th = (t, num) => el('th', { textContent: t, className: num ? 'num' : '' });
    const td = (t, num) => el('td', { textContent: t, className: num ? 'num' : '' });
    const max = Math.max(...u.days.map(cost), 0);
    const line = (label, d, c, bar) => el('tr', {}, td(label), td(int(d.calls), 1), td(int(d.promptTokens), 1), td(int(d.cachedTokens), 1),
      td(int(d.completionTokens), 1), td(usd(c), 1), td(idr(c * u.usdIdr), 1),
      el('td', { style: 'width:120px;vertical-align:middle' }, bar && max ? el('div', { className: 'bar', style: 'width:' + Math.round((c / max) * 100) + '%' }) : null));
    const rows = u.days.map((d) => line(new Date(d.day + 'T00:00:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), d, cost(d), true));
    const total = sum(u.days);
    table.replaceChildren(
      el('thead', {}, el('tr', {}, th(T('Tanggal', 'Date')), th(T('Balasan', 'Replies'), 1), th(T('Token masuk', 'Input tokens'), 1), th(T('…dari cache', '…cached'), 1), th(T('Token keluar', 'Output tokens'), 1), th(T('Biaya (USD)', 'Cost (USD)'), 1), th(T('Biaya (Rp)', 'Cost (Rp)'), 1), th(''))),
      el('tbody', {}, ...(rows.length ? rows : [el('tr', {}, el('td', { colSpan: 8, textContent: T('Belum ada pemakaian yang tercatat.', 'No usage recorded yet.') }))])),
      rows.length ? el('tfoot', {}, line(T('Jumlah (', 'Total (') + u.days.length + T(' hari)', ' days)'), total, total.usd, false)) : null);
  } catch (e) { toast(e.message, true); }
}

// ---------- status bot ----------
function renderStatus() {
  if (!state) return;
  $('brandSub').textContent = profile.brand;
  const st = state.status;
  // Dashboard online hanya tahu keadaan bot dari laporan terakhirnya.
  const mins = st && st.reportedAt ? Math.round((Date.now() - st.reportedAt) / 60000) : null;
  $('chipLlm').textContent = state.testReady ? T('uji coba siap', 'test chat ready') : T('LLM belum diatur', 'LLM not configured');
  $('chipLlm').className = 'chip ' + (state.testReady ? 'ok' : 'warn');
  $('chipWa').textContent = !st ? T('bot belum pernah melapor', 'bot has never reported') : mins === null ? T('jalur: ', 'channel: ') + st.transport
    : T('bot melapor ', 'bot reported ') + (mins < 1 ? T('baru saja', 'just now') : mins + T(' menit lalu', ' min ago'));
  $('chipWa').className = 'chip ' + (!st || (mins !== null && mins > 40) ? 'warn' : 'ok');
  const info = !st
    ? [['Bot', T('Belum pernah melapor ke dashboard ini. Nyalakan bot dengan penyimpanan bersama yang sama.', 'Has never reported to this dashboard. Start the bot with the same shared storage.')]]
    : [[T('Jalur WhatsApp', 'WhatsApp channel'), st.transport], [T('Nomor sales', 'Sales number'), st.sales || T('belum diatur', 'not set')],
        ['Google Sheet', st.sheet ? T('siap', 'ready') : T('belum diatur', 'not set')],
        [T('Yang dibalas', 'Who gets a reply'), st.onlyNumbers ? T('MODE UJI: hanya ', 'TEST MODE: only ') + st.onlyNumbers + T(' nomor', ' numbers') : T('semua nomor', 'every number')],
        [T('Panggilan LLM hari ini', 'LLM calls today'), st.usage.calls + T(' dari batas ', ' of limit ') + st.usage.limit],
        ...(st.guard ? [[T('Pengaman nomor', 'Number safeguard'), st.guard]] : [])];
  $('envInfo').replaceChildren(el('tbody', {}, ...info.map(([k, v]) => el('tr', {}, el('td', { textContent: k, style: 'width:220px;color:var(--muted)' }), el('td', { textContent: v })))));
}

// ---------- navigasi, simpan, masuk ----------
function show(next) {
  tab = next;
  for (const b of $('nav').querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const s of document.querySelectorAll('section')) s.classList.toggle('on', s.id === 'tab-' + tab);
  const [title, desc] = PAGES[tab]();
  $('title').textContent = title;
  $('desc').textContent = desc;
  setDirty(dirty);
  if (tab === 'lead') loadLeads();
  if (tab === 'biaya') loadUsage();
}

function renderAll() {
  applyLang();
  if (!profile) return;
  fillInputs();
  renderLogo();
  renderFields();
  renderQuestions();
  renderProducts();
  renderCatalog();
  renderStatus();
  if (!chat.length) $('chat').replaceChildren(chatHint());
  show(tab);
}

$('nav').addEventListener('click', (e) => {
  const next = e.target.dataset && e.target.dataset.tab;
  if (next) show(next);
});

$('lang').addEventListener('click', (e) => {
  const next = e.target.dataset && e.target.dataset.lang;
  if (!next || next === lang) return;
  lang = next;
  try { localStorage.setItem('lang', lang); } catch { /* tetap berlaku untuk kunjungan ini */ }
  renderAll();
});

$('save').addEventListener('click', async () => {
  $('save').disabled = true;
  try {
    const body = {};
    for (const k of changed) if (k !== 'files') body[k] = profile[k];
    const r = await api('profile', { method: 'PUT', body: JSON.stringify(body) });
    profile = r.profile;
    setDirty(false);
    renderAll();
    toast(T('Tersimpan. Bot memakai pengaturan baru mulai pesan berikutnya.', 'Saved. The bot uses the new settings from the next message.'));
  } catch (e) {
    toast(e.message, true);
    setDirty(true);
  }
});

window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

async function load() {
  state = await api('state');
  profile = state.profile;
  $('login').classList.remove('on');
  dirty = false;
  changed.clear();
  renderAll();
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

applyLang();
load().catch(() => {});
