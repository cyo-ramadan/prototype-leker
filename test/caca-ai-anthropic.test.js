import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { hashCredential } from '../src/owner-auth.js';
import { handleCacaApi } from '../src/caca-chat.js';
import { pilihPenyedia, callStructured as callClient, analisisTerpasang } from '../src/caca-ai-client.js';
import { MODEL, BATAS_SKEMA, skemaUntukClaude, buatPermintaanClaude, ambilJson, cocokSkema, callStructured } from '../src/caca-ai-anthropic.js';
import { AI_MODEL_ANALISIS_KEY, TENANT_POLICY_DEFINITIONS } from '../src/tenant-policy.js';

// Mode Analisis: Claude Sonnet per tenant yang diizinkan Owner (Bos Cyo, 2026-10-21).

const klienPalsu = (balasan, catat = []) => () => ({ beta: { messages: { create: async (body) => { catat.push(body); return balasan; } } } });
const teks = (t, extra = {}) => ({ stop_reason: 'end_turn', model: MODEL, content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: t }], usage: { input_tokens: 10, output_tokens: 5 }, ...extra });
const SKEMA_KECIL = { type: 'object', required: ['jawaban'], properties: { jawaban: { type: 'string', maxLength: 500 } } };
const skemaBesar = () => ({ type: 'object', required: ['alat'], properties: {
  alat: { type: 'string', enum: ['a', 'b', 'tidak_ada'] },
  ...Object.fromEntries(Array.from({ length: BATAS_SKEMA.opsional + 5 }, (_, i) => [`isian_${i}`, { type: 'string' }]))
} });

test('skema netral diubah ke bentuk Claude: additionalProperties:false, batasan tak didukung dibuang, hitung opsional', () => {
  const s = skemaUntukClaude({ type: 'object', required: ['a'], properties: { a: { type: 'string', minLength: 1 }, b: { type: 'array', minItems: 3, items: { type: 'object', properties: { n: { type: 'number', maximum: 9 } } } } } });
  assert.equal(s.schema.additionalProperties, false);
  assert.equal(s.schema.properties.b.items.additionalProperties, false);
  assert.equal(s.schema.properties.a.minLength, undefined);
  assert.equal(s.schema.properties.b.minItems, undefined);
  assert.equal(s.schema.properties.b.items.properties.n.maximum, undefined);
  assert.equal(s.opsional, 2);
  assert.equal(s.muat, true);
  assert.equal(skemaUntukClaude(skemaBesar()).muat, false, 'lebih dari 24 opsional tidak muat structured output');
});

test('permintaan: Sonnet 5.5, effort high, fallback default; skema kecil structured, skema besar lewat instruksi', () => {
  const kecil = buatPermintaanClaude({ system: 'S', content: [{ type: 'image', mediaType: 'image/png', data: 'AAA' }, { type: 'text', text: 'halo' }], schema: SKEMA_KECIL });
  assert.equal(kecil.mode, 'structured');
  assert.equal(kecil.body.model, 'claude-sonnet-5-5');
  assert.equal(kecil.body.output_config.effort, 'high');
  assert.equal(kecil.body.output_config.format.type, 'json_schema');
  assert.equal(kecil.body.fallbacks, 'default');
  assert.deepEqual(kecil.body.betas, ['server-side-fallback-2026-07-01']);
  assert.deepEqual(kecil.body.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } });
  assert.equal(kecil.body.thinking, undefined, 'Sonnet 5.5: adaptive bawaan, tidak dikirim disabled/budget');
  const besar = buatPermintaanClaude({ system: 'S', content: [{ type: 'text', text: 'x' }], schema: skemaBesar() });
  assert.equal(besar.mode, 'instruksi');
  assert.equal(besar.body.output_config.format, undefined);
  assert.match(besar.body.system, /FORMAT JAWABAN: balas HANYA dengan satu objek JSON/);
});

test('jawaban: JSON structured & instruksi diparse, enum dicek, penolakan dan kepanjangan jadi galat jelas', async () => {
  const env = { ANTHROPIC_API_KEY: 'kunci-uji' };
  const catat = [];
  const ok = await callStructured(env, { system: 'S', content: [{ type: 'text', text: 'q' }], schema: SKEMA_KECIL, buatKlien: klienPalsu(teks('{"jawaban":"siap"}'), catat) });
  assert.deepEqual(ok.value, { jawaban: 'siap' });
  assert.equal(ok.mode, 'structured');
  assert.equal(catat[0].model, MODEL);
  const pagar = await callStructured(env, { system: 'S', content: [], schema: skemaBesar(), buatKlien: klienPalsu(teks('```json\n{"alat":"a","isian_1":"x"}\n```')) });
  assert.equal(pagar.ok, true);
  assert.equal(pagar.value.alat, 'a');
  assert.equal((await callStructured(env, { schema: skemaBesar(), content: [], buatKlien: klienPalsu(teks('{"alat":"ngarang"}')) })).ok, false, 'enum di luar daftar ditolak');
  const tolak = await callStructured(env, { schema: SKEMA_KECIL, content: [], buatKlien: klienPalsu(teks('', { stop_reason: 'refusal' })) });
  assert.equal(tolak.ok, false);
  assert.equal(tolak.status, 422);
  assert.equal((await callStructured(env, { schema: SKEMA_KECIL, content: [], buatKlien: klienPalsu(teks('{"jaw', { stop_reason: 'max_tokens' })) })).ok, false);
  const putus = await callStructured(env, { schema: SKEMA_KECIL, content: [], buatKlien: () => { throw new Error('jaringan'); } });
  assert.equal(putus.ok, false);
  assert.equal((await callStructured({}, { schema: SKEMA_KECIL, content: [] })).status, 503, 'tanpa kunci');
  assert.deepEqual(ambilJson('ini {"a":1} ya'), { a: 1 });
  assert.equal(cocokSkema({}, { required: ['alat'] }), false);
});

test('mesin harian tidak berubah: kunci Claude saja tidak menjadikan Claude bawaan', async () => {
  assert.equal(pilihPenyedia({ ANTHROPIC_API_KEY: 'k' }), null, 'tanpa kunci Gemini/OpenAI tetap tidak ada mesin bawaan');
  assert.equal(pilihPenyedia({ ANTHROPIC_API_KEY: 'k', GEMINI_API_KEY: 'g' }).NAMA, 'gemini');
  assert.equal(analisisTerpasang({ ANTHROPIC_API_KEY: 'k' }), true);
  assert.equal((await callClient({}, { penyedia: 'anthropic', schema: SKEMA_KECIL, content: [] })).status, 503);
  const def = TENANT_POLICY_DEFINITIONS.find(d => d.key === AI_MODEL_ANALISIS_KEY);
  assert.equal(def.defaultValue, false, 'izin Sonnet bawaan mati (berbayar)');
});

class Statement {
  constructor(db, sql, params = []) { Object.assign(this, { db, sql, params }); }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() { return { success: true, meta: { changes: Number(this.db.prepare(this.sql).run(...this.params).changes) } }; }
}

test('/api/caca/tanya analisis: ditolak tanpa izin tenant, 503 tanpa kunci, jalan dengan izin; pengaturan memberi tahu panel', async (t) => {
  const sqlite = new DatabaseSync(':memory:'); t.after(() => sqlite.close());
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  sqlite.exec("INSERT INTO entity_admins(id,entity_id,username,password_hash,display_name) VALUES('ana-e1','ENT-G001','ana-e1','x','One')");
  sqlite.prepare("INSERT INTO entity_admin_sessions(token_hash,entity_admin_id,created_at,expires_at) VALUES(?,?,'2026-01-01T00:00:00Z','2099-01-01T00:00:00Z')").run(await hashCredential('ana-e1'), 'ana-e1');
  const tenant = sqlite.prepare("SELECT tenant_id FROM entity_tenancy WHERE entity_id='ENT-G001' AND effective_to IS NULL").get().tenant_id;
  const call = async (env, path, method = 'GET', body) => {
    const req = new Request(`https://example.test${path}`, { method, headers: { authorization: 'Bearer ana-e1', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const res = await handleCacaApi(req, env, new URL(req.url).pathname);
    return { status: res.status, body: await res.json() };
  };
  const db = { prepare: (sql) => new Statement(sqlite, sql), batch: async (ss) => ss.map((s) => s.run()) };
  const tanya = { pertanyaan: 'buka Karyawan', analisis: true, conversationId: '18181818-1818-4181-8181-181818181818' };
  const tanpaKunci = { DB: db };
  const denganKunci = { DB: db, ANTHROPIC_API_KEY: 'kunci-uji' };

  const ditolak = await call(denganKunci, '/api/caca/tanya?store=G001', 'POST', tanya);
  assert.equal(ditolak.status, 403);
  assert.equal(ditolak.body.code, 'AI_ANALISIS_TIDAK_DIIZINKAN');
  assert.deepEqual((await call(denganKunci, '/api/caca/pengaturan?store=G001')).body.analisis, { diizinkan: false, tersedia: false, model: MODEL });

  sqlite.prepare("INSERT INTO tenant_policy_settings(tenant_id,setting_key,setting_value) VALUES(?,?,'1')").run(tenant, AI_MODEL_ANALISIS_KEY);
  assert.equal((await call(tanpaKunci, '/api/caca/tanya?store=G001', 'POST', tanya)).status, 503);
  assert.equal((await call(tanpaKunci, '/api/caca/pengaturan?store=G001')).body.analisis.tersedia, false);
  assert.equal((await call(denganKunci, '/api/caca/pengaturan?store=G001')).body.analisis.tersedia, true);
  const jalan = await call(denganKunci, '/api/caca/tanya?store=G001', 'POST', tanya);
  assert.equal(jalan.status, 200, JSON.stringify(jalan.body));
  assert.equal(jalan.body.analisis, true);
  assert.equal(jalan.body.mesin, MODEL);
  const biasa = await call(denganKunci, '/api/caca/tanya?store=G001', 'POST', { ...tanya, analisis: false });
  assert.equal(biasa.body.analisis, undefined, 'pesan biasa tidak ditandai analisis');
});

test('panel: tombol Analisis sekali pakai dan permintaan membawa analisis hanya saat dinyalakan', () => {
  const sumber = readFileSync(new URL('../public/caca-chat.js', import.meta.url), 'utf8');
  assert.match(sumber, /id="cacaAnalisis"[^>]*class="[^"]*hidden/);
  assert.match(sumber, /if \(cacaState\.analisisGiliran\) isi\.analisis = true;/);
  assert.match(sumber, /cacaState\.analisisGiliran = cacaState\.analisis && cacaState\.analisisTersedia;\s*\r?\n\s*cacaAturAnalisis\(false\);/);
});

test('kunci lewat binding Secrets Store (objek .get()) maupun secret biasa', async () => {
  const { terpasang, bacaKunci } = await import('../src/caca-ai-anthropic.js');
  const binding = { get: async () => 'kunci-dari-store' };
  assert.equal(terpasang({ ANTHROPIC_API_KEY: binding }), true);
  assert.equal(await bacaKunci({ ANTHROPIC_API_KEY: binding }), 'kunci-dari-store');
  assert.equal(await bacaKunci({ ANTHROPIC_API_KEY: 'teks' }), 'teks');
  assert.equal(await bacaKunci({ ANTHROPIC_API_KEY: { get: async () => { throw new Error('belum diisi'); } } }), null);
  const catat = [];
  const hasil = await callStructured({ ANTHROPIC_API_KEY: binding }, { schema: SKEMA_KECIL, content: [], buatKlien: (opsi) => { catat.push(opsi.apiKey); return klienPalsu(teks('{"jawaban":"ok"}'))(); } });
  assert.equal(hasil.ok, true);
  assert.deepEqual(catat, ['kunci-dari-store']);
  const kosong = await callStructured({ ANTHROPIC_API_KEY: { get: async () => null } }, { schema: SKEMA_KECIL, content: [] });
  assert.equal(kosong.status, 503);
});

test('400 dari Claude: coba ulang sekali tanpa fallback/cache, dan alasan Anthropic ditampilkan bila tetap gagal', async () => {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const salah = (pesan) => new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: pesan } }, undefined, new Headers());
  const env = { ANTHROPIC_API_KEY: 'kunci-uji' };
  const dikirim = [];
  const sekaliGagal = () => ({ beta: { messages: { create: async (body) => { dikirim.push(body); if (dikirim.length === 1) throw salah('fallbacks: not supported'); return teks('{"jawaban":"ok"}'); } } } });
  const r = await callStructured(env, { schema: SKEMA_KECIL, content: [], buatKlien: sekaliGagal });
  assert.equal(r.ok, true);
  assert.equal(dikirim.length, 2);
  assert.equal(dikirim[1].fallbacks, undefined);
  assert.equal(dikirim[1].betas, undefined);
  assert.equal(dikirim[1].cache_control, undefined);
  assert.equal(dikirim[1].model, MODEL, 'isi lain tetap');
  const selaluGagal = () => ({ beta: { messages: { create: async () => { throw salah('messages.0.content: kosong sk-ant-rahasia123'); } } } });
  const g = await callStructured(env, { schema: SKEMA_KECIL, content: [], buatKlien: selaluGagal });
  assert.equal(g.ok, false);
  assert.match(g.error, /messages\.0\.content: kosong/);
  assert.doesNotMatch(g.error, /sk-ant-rahasia/);
});
