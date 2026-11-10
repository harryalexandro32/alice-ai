/**
 * Jalur LLM sungguhan (fetch -> parse -> hasil) terhadap server tiruan yang
 * berbicara format OpenAI/DeepSeek. Tidak butuh API key, tidak ada biaya.
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { llmBrain } from './brain';
import { cfg } from './config';
import { llmUsageToday, setUsageRecorder, type UsageDelta } from './llm/provider';

let seen: { auth?: string; body?: any } = {};
let status = 200;
let content = '';

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    seen = { auth: req.headers.authorization, body: JSON.parse(raw) };
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 2100, completion_tokens: 60, prompt_cache_hit_tokens: 2000 },
      })
    );
  });
});

server.listen(0, '127.0.0.1', async () => {
  cfg.llmBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cfg.llmApiKey = 'kunci-tes';
  cfg.llmModel = 'deepseek-chat';
  const input = {
    text: 'GFAF-40A berapa watt? saya Budi dari Bekasi',
    known: {},
    history: [],
    justGreeted: false,
  };

  const recorded: UsageDelta[] = [];
  setUsageRecorder((d) => recorded.push(d));

  try {
    content = '{"reply":"GFAF-40A dayanya 130 W.","fields":{"name":"Budi","city":"Bekasi","need":null},"intent":"info"}';
    const r = await llmBrain(input);
    assert.deepEqual(r, { reply: 'GFAF-40A dayanya 130 W.', fields: { name: 'Budi', city: 'Bekasi' }, intent: 'info', photos: [], docs: [] });
    assert.equal(seen.auth, 'Bearer kunci-tes');
    assert.equal(seen.body.model, 'deepseek-chat');
    assert.deepEqual(seen.body.response_format, { type: 'json_object' });
    assert.equal(seen.body.messages[0].role, 'system');
    // Seluruh katalog ikut di prompt sistem, dan kata "json" wajib ada untuk mode JSON DeepSeek.
    assert.match(seen.body.messages[0].content, /GFAF-60A \| 24" \| 220\/380/);
    assert.match(seen.body.messages[0].content, /json/);
    assert.match(seen.body.messages[1].content, /PESAN TERBARU PELANGGAN\nGFAF-40A berapa watt/);
    assert.equal(llmUsageToday().cachedTokens, 2000);
    assert.deepEqual({ ...recorded[0], day: '' }, { day: '', calls: 1, promptTokens: 2100, cachedTokens: 2000, completionTokens: 60 });
    assert.match(recorded[0]!.day, /^\d{4}-\d\d-\d\d$/);

    content = 'maaf, saya tidak bisa';
    assert.equal(await llmBrain(input), null, 'keluaran bukan JSON = null');

    status = 500;
    assert.equal(await llmBrain(input), null, 'HTTP gagal = null, bukan lemparan');

    cfg.llmApiKey = '';
    status = 200;
    seen = {};
    assert.equal(await llmBrain(input), null);
    assert.equal(seen.body, undefined, 'tanpa key tidak ada panggilan keluar');

    console.log('penyedia LLM: OK');
  } catch (e) {
    console.error('penyedia LLM: GAGAL\n', e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
