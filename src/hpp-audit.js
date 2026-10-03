import { json } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { scaledAmountToExactString } from './accounting-ledger.js';
import { getJakartaBusinessDate } from './time.js';

// Audit HPP (Bos Cyo, 2026-10-03): "una bisa beresin hpp anomali dan hitung
// ulang dari september". Una butuh mata untuk MENCARI harga yang janggal dan
// usul harga benar BERBUKTI -- persis yang selama ini Hana kerjakan manual
// (KOREKSI-HPP-2026-10-02.md). Endpoint ini hanya membaca; menerapkan koreksi
// tetap lewat Hitung Ulang HPP (src/hpp-recalculation.js) -- jalur yang sama
// dengan yang dipakai orang, jadi jurnal koreksinya ikut otomatis.
//
// Uang tidak pernah float: semua harga satuan scaled INTEGER (1 rupiah =
// 1.000.000 unit), pembagian half-up lewat BigInt, teks harga dibentuk dari
// integer scaled (scaledAmountToExactString).
//
// Jenis kejanggalan yang terbukti di produksi:
//   1. Jumlah beli diisi dalam kemasan (qty 2 untuk 32.000 ml; qty 1 untuk 1.000 g)
//      atau nominal salah ketik (Rp19.000.000 untuk 1.000 g) -> harga satuan
//      ribuan kali lipat, lalu meracuni produksi larutan.
//   2. HPP nol padahal dipakai resep.
//   3. HPP barang olahan (larutan) tidak sesuai resep x harga bahan benar.
//   4. Barang bahan bertipe Barang Jadi / satuan beda dari gerai lain (hanya ditandai).

export const HPP_AUDIT_CONTRACT = 'MAXI_HPP_AUDIT_V1';

const SCALE = 1_000_000n;
// Satu pembelian dianggap janggal kalau harga satuannya >= 10x atau <= 1/10 acuan.
// Salah kemasan nyata selalu jauh lebih besar (16.000x, 1.000x); fluktuasi harga
// wajar tidak pernah mendekati 10x.
export const OUTLIER_FACTOR = 10;
// Harga rata-rata tercatat dianggap menyimpang kalau >= 3x atau <= 1/3 harga benar.
export const DRIFT_FACTOR = 3;
// Barang olahan: selisih dari harga resep di atas ini (persen) dianggap menyimpang.
export const DERIVED_TOLERANCE_PERCENT = 10;
// Acuan lintas gerai butuh minimal sekian gerai supaya satu gerai yang keracunan tidak menarik median.
export const MIN_SIBLINGS = 3;
const MAX_EVIDENCE = 12;
const SIBLING_LINES_LIMIT = 6000;

const roundDiv = (numerator, denominator) => (numerator * 2n + denominator) / (denominator * 2n);
const unitScaled = (total, qty) => Number(roundDiv(BigInt(total) * SCALE, BigInt(qty)));
const rupiahText = scaled => scaledAmountToExactString(scaled) ?? '0';
const outOfBand = (value, reference, factor) => value > reference * factor || value * factor < reference;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
}

function weightedUnit(lines) {
  const total = lines.reduce((sum, line) => sum + BigInt(line.total), 0n);
  const quantity = lines.reduce((sum, line) => sum + BigInt(line.quantity), 0n);
  return Number(roundDiv(total * SCALE, quantity));
}

function defaultFrom(today) {
  const [year, month] = today.split('-').map(Number);
  const previous = month === 1 ? [year - 1, 12] : [year, month - 1];
  return `${previous[0]}-${String(previous[1]).padStart(2, '0')}-01`;
}

/**
 * Inti analisis, murni (tanpa database) supaya bisa diuji.
 * @param {object} input
 * @param {Array<{id:number,name:string,averageCostScaled:number,typeCode:string,unit:string}>} input.products
 * @param {Array<{productId:number,quantity:number,total:number,date:string}>} input.lines pembelian aktif (bukan batal)
 * @param {Array<{outputId:number,outputQty:number,componentId:number,qty:number}>} input.recipes resep ACTIVE
 * @param {Array<{name:string,averageCostScaled:number,unit:string}>} input.siblings barang bahan baku bernama sama di gerai lain (cost>0)
 * @param {Array<{storeKey:string,name:string,quantity:number,total:number}>} [input.siblingLines] pembelian terbaru bahan bernama sama di gerai lain (bukti lebih bersih daripada HPP rata-rata mereka)
 * @param {string} input.from tanggal mulai koreksi YYYY-MM-DD
 */
export function analyzeHpp({ products, lines, recipes, siblings, siblingLines = [], from }) {
  const byId = new Map(products.map(product => [product.id, product]));
  const linesByProduct = new Map();
  for (const line of lines) {
    if (!(line.quantity > 0) || !(line.total > 0)) continue;
    const list = linesByProduct.get(line.productId) || [];
    list.push({ ...line, unit: unitScaled(line.total, line.quantity) });
    linesByProduct.set(line.productId, list);
  }
  const siblingsByName = new Map();
  for (const sibling of siblings) {
    const key = String(sibling.name).trim().toLowerCase();
    const list = siblingsByName.get(key) || [];
    list.push(sibling);
    siblingsByName.set(key, list);
  }

  // Acuan lintas gerai: median per gerai dulu, baru median antar gerai. Satu gerai yang
  // salah catat berkali-kali tetap hanya satu suara.
  const siblingStoreUnits = new Map();
  for (const sibling of siblingLines) {
    if (!(sibling.quantity > 0) || !(sibling.total > 0)) continue;
    const key = String(sibling.name).trim().toLowerCase();
    const byStore = siblingStoreUnits.get(key) || new Map();
    const list = byStore.get(sibling.storeKey) || [];
    list.push(unitScaled(sibling.total, sibling.quantity));
    byStore.set(sibling.storeKey, list);
    siblingStoreUnits.set(key, byStore);
  }
  const siblingPurchaseRef = name => {
    const byStore = siblingStoreUnits.get(name.trim().toLowerCase());
    if (!byStore || byStore.size < MIN_SIBLINGS) return null;
    return median([...byStore.values()].map(median));
  };

  const recipesByOutput = new Map();
  const componentIds = new Set();
  for (const row of recipes) {
    componentIds.add(row.componentId);
    const list = recipesByOutput.get(row.outputId) || new Map();
    const key = row.recipeId ?? `${row.outputId}`;
    const recipe = list.get(key) || { outputQty: row.outputQty, components: [] };
    recipe.components.push({ id: row.componentId, qty: row.qty });
    list.set(key, recipe);
    recipesByOutput.set(row.outputId, list);
  }

  const corrections = new Map();
  const needsPrice = [];
  const typeIssues = [];
  const notes = [];

  // --- 1 & 2: bahan baku (tidak punya resep sendiri) ------------------------
  for (const product of products) {
    if (recipesByOutput.has(product.id)) continue;
    const own = linesByProduct.get(product.id) || [];
    const isComponent = componentIds.has(product.id);
    if (!own.length && !isComponent) continue;

    const siblingList = siblingsByName.get(product.name.trim().toLowerCase()) || [];
    // Bukti pembelian gerai lain lebih bersih daripada HPP rata-rata mereka (yang bisa ikut tercemar).
    const siblingRef = siblingPurchaseRef(product.name)
      ?? (siblingList.length >= MIN_SIBLINGS ? median(siblingList.map(s => s.averageCostScaled)) : null);
    const ownRef = own.length >= 3 ? median(own.map(line => line.unit)) : null;
    const ref = siblingRef ?? ownRef;

    const good = ref === null ? own : own.filter(line => !outOfBand(line.unit, ref, OUTLIER_FACTOR));
    const bad = ref === null ? [] : own.filter(line => outOfBand(line.unit, ref, OUTLIER_FACTOR));

    // Pembelian yang dianggap wajar pun masih berserakan >= 10x: buktinya tidak bisa dipercaya untuk menebak.
    if (good.length >= 2) {
      const goodUnits = good.map(line => line.unit);
      if (Math.max(...goodUnits) > Math.min(...goodUnits) * OUTLIER_FACTOR) {
        needsPrice.push({
          productId: product.id, name: product.name, unit: product.unit,
          reason: 'BUKTI_BERTENTANGAN',
          message: `${product.name}: pembelian saling bertentangan jauh (harga satuan ${rupiahText(Math.min(...goodUnits))} sampai ${rupiahText(Math.max(...goodUnits))}) dan tidak ada acuan gerai lain yang cukup. Tanyakan harga per ${product.unit || 'satuan'} yang benar ke Bos Cyo.`
        });
        continue;
      }
    }

    let proposed = null;
    let source = null;
    if (good.length) { proposed = weightedUnit(good); source = 'PEMBELIAN'; }
    else if (siblingRef !== null) { proposed = siblingRef; source = 'GERAI_LAIN'; }

    if (ref === null && own.length === 2 && outOfBand(own[0].unit, own[1].unit, OUTLIER_FACTOR)) {
      needsPrice.push({
        productId: product.id, name: product.name, unit: product.unit,
        reason: 'BUKTI_BERTENTANGAN',
        message: `${product.name}: dua pembelian harga satuannya berbeda jauh (${rupiahText(own[0].unit)} vs ${rupiahText(own[1].unit)}) dan tidak ada gerai lain sebagai pembanding. Tanyakan harga yang benar ke Bos Cyo.`
      });
      continue;
    }

    if (proposed === null) {
      if (product.averageCostScaled === 0 && isComponent) {
        needsPrice.push({
          productId: product.id, name: product.name, unit: product.unit,
          reason: 'NOL_TANPA_BUKTI',
          message: `${product.name}: HPP nol, dipakai resep, tapi tidak ada pembelian maupun gerai lain sebagai acuan. Tanyakan harga per ${product.unit || 'satuan'} ke Bos Cyo.`
        });
      }
      continue;
    }

    const avg = product.averageCostScaled;
    const anomaly = avg === 0 || outOfBand(avg, proposed, DRIFT_FACTOR);
    if (!anomaly) {
      if (bad.length) notes.push({ productId: product.id, name: product.name, message: `${product.name}: ada ${bad.length} pembelian dengan jumlah/nominal janggal, tetapi HPP rata-rata sudah wajar. Cek jumlah stoknya lewat opname, bukan HPP.` });
      continue;
    }

    const confidence = source === 'PEMBELIAN' && (good.length >= 3 || (siblingRef !== null && !outOfBand(proposed, siblingRef, DRIFT_FACTOR))) ? 'TINGGI' : 'SEDANG';
    const evidence = [...bad, ...good].slice(0, MAX_EVIDENCE).map(line => {
      const janggal = bad.includes(line);
      return {
        date: line.date, quantity: line.quantity, totalRupiah: line.total,
        unitCostRupiah: rupiahText(line.unit), janggal,
        ...(janggal ? { jumlahSeharusnya: Number(roundDiv(BigInt(line.total) * SCALE, BigInt(proposed))) } : {})
      };
    });
    corrections.set(product.id, {
      level: 0, kind: 'BAHAN_BAKU', productId: product.id, name: product.name, unit: product.unit,
      currentRupiah: rupiahText(avg), proposedRupiah: rupiahText(proposed), proposedScaled: proposed,
      from, confidence, source, needsConfirmation: confidence !== 'TINGGI',
      reason: avg === 0
        ? `HPP tercatat nol padahal ${source === 'PEMBELIAN' ? 'ada bukti pembelian' : 'gerai lain punya harga'}.`
        : `HPP tercatat ${rupiahText(avg)} per ${product.unit || 'satuan'}, bukti ${source === 'PEMBELIAN' ? 'pembelian' : 'gerai lain'} menunjuk ${rupiahText(proposed)}.`,
      evidence: { acuanLintasGerai: siblingRef === null ? null : rupiahText(siblingRef), jumlahGeraiPembanding: siblingList.length, pembelianJanggal: bad.length, pembelianWajar: good.length, baris: evidence },
      after: []
    });
  }

  // --- 3: barang olahan = resep x harga bahan (yang sudah dikoreksi) --------
  const levelMemo = new Map();
  const levelOf = (productId, trail = new Set()) => {
    if (levelMemo.has(productId)) return levelMemo.get(productId);
    const recipeMap = recipesByOutput.get(productId);
    if (!recipeMap || recipeMap.size !== 1 || trail.has(productId)) return 0;
    trail.add(productId);
    const [recipe] = recipeMap.values();
    const level = 1 + Math.max(0, ...recipe.components.map(component => levelOf(component.id, trail)));
    trail.delete(productId);
    levelMemo.set(productId, level);
    return level;
  };

  const derived = products
    .filter(product => recipesByOutput.has(product.id) && (componentIds.has(product.id) || product.typeCode === 'SEMI_FINISHED'))
    .sort((a, b) => levelOf(a.id) - levelOf(b.id) || a.name.localeCompare(b.name));
  for (const product of derived) {
    const recipeMap = recipesByOutput.get(product.id);
    if (recipeMap.size !== 1) {
      notes.push({ productId: product.id, name: product.name, message: `${product.name}: punya ${recipeMap.size} resep aktif, tidak diaudit otomatis.` });
      continue;
    }
    const [recipe] = recipeMap.values();
    if (!(recipe.outputQty > 0)) continue;
    const priceOf = id => (corrections.get(id)?.proposedScaled ?? byId.get(id)?.averageCostScaled ?? 0);
    const missing = recipe.components.filter(component => priceOf(component.id) === 0);
    if (missing.length) {
      needsPrice.push({
        productId: product.id, name: product.name, unit: product.unit,
        reason: 'BAHAN_BELUM_ADA_HARGA',
        message: `${product.name}: tidak bisa dihitung dari resep karena bahan ini belum punya harga: ${missing.map(component => byId.get(component.id)?.name ?? `#${component.id}`).join(', ')}.`
      });
      continue;
    }
    const expected = Number(roundDiv(
      recipe.components.reduce((sum, component) => sum + BigInt(component.qty) * BigInt(priceOf(component.id)), 0n),
      BigInt(recipe.outputQty)
    ));
    const avg = product.averageCostScaled;
    const diff = Math.abs(avg - expected);
    const anomaly = avg === 0 ? expected > 0 : diff * 100 > expected * DERIVED_TOLERANCE_PERCENT;
    if (!anomaly) continue;
    const dependsOn = recipe.components.map(component => component.id).filter(id => corrections.has(id));
    corrections.set(product.id, {
      level: levelOf(product.id), kind: 'OLAHAN', productId: product.id, name: product.name, unit: product.unit,
      currentRupiah: rupiahText(avg), proposedRupiah: rupiahText(expected), proposedScaled: expected,
      from, confidence: dependsOn.length ? 'TINGGI_SETELAH_BAHAN_DIKOREKSI' : 'TINGGI', source: 'RESEP',
      needsConfirmation: dependsOn.some(id => corrections.get(id)?.needsConfirmation),
      reason: `HPP tercatat ${rupiahText(avg)} per ${product.unit || 'satuan'}, resep dengan harga bahan yang benar menghasilkan ${rupiahText(expected)}.`,
      evidence: {
        hasilResep: recipe.outputQty,
        bahan: recipe.components.map(component => ({
          name: byId.get(component.id)?.name ?? `#${component.id}`, qty: component.qty,
          hargaRupiah: rupiahText(priceOf(component.id)), dikoreksi: corrections.has(component.id)
        }))
      },
      after: dependsOn
    });
  }

  // --- 4: tipe/satuan yang mencurigakan (hanya ditandai) ---------------------
  const wrongType = products.filter(product => componentIds.has(product.id) && !recipesByOutput.has(product.id) && product.typeCode === 'FINISHED_GOOD');
  if (wrongType.length) {
    typeIssues.push({
      kind: 'TIPE', count: wrongType.length,
      items: wrongType.map(product => ({ productId: product.id, name: product.name, unit: product.unit })),
      message: `${wrongType.length} barang dipakai sebagai bahan di resep tetapi bertipe Barang Jadi (${wrongType.slice(0, 4).map(product => product.name).join(', ')}${wrongType.length > 4 ? ', ...' : ''}). Biasanya Bahan Baku. Betulkan di Master Barang; jangan ganti satuan tanpa konfirmasi karena stok ikut terdampak.`
    });
  }
  for (const product of products) {
    const siblingList = siblingsByName.get(product.name.trim().toLowerCase()) || [];
    if (siblingList.length >= MIN_SIBLINGS && product.unit && !recipesByOutput.has(product.id)) {
      const unitCount = new Map();
      for (const sibling of siblingList) unitCount.set(sibling.unit, (unitCount.get(sibling.unit) || 0) + 1);
      const [commonUnit] = [...unitCount.entries()].sort((a, b) => b[1] - a[1])[0];
      if (commonUnit && commonUnit !== product.unit) {
        typeIssues.push({
          productId: product.id, name: product.name, unit: product.unit, kind: 'SATUAN', count: 1,
          message: `${product.name} bersatuan ${product.unit}, sedangkan gerai lain memakai ${commonUnit}. Harga per ${product.unit} mungkin tercatat dalam satuan yang salah.`
        });
      }
    }
  }

  const ordered = [...corrections.values()]
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    .map((correction, index) => {
      const { proposedScaled, ...rest } = correction;
      return {
        order: index + 1,
        ...rest,
        proposedScaled,
        command: {
          alat: 'hitung_ulang_hpp',
          parameter: { hpp_bahan: correction.name, hpp_harga: correction.proposedRupiah, hpp_dari: correction.from }
        }
      };
    });

  return {
    contract: HPP_AUDIT_CONTRACT,
    from,
    summary: {
      corrections: ordered.length,
      rawMaterial: ordered.filter(item => item.kind === 'BAHAN_BAKU').length,
      derived: ordered.filter(item => item.kind === 'OLAHAN').length,
      needsPrice: needsPrice.length,
      typeIssues: typeIssues.length
    },
    corrections: ordered,
    needsPrice,
    typeIssues,
    notes,
    howTo: ordered.length
      ? ['Terapkan koreksi BERURUTAN dari order 1: bahan baku dulu, baru olahan (harga olahan dihitung dari harga bahan yang sudah benar).', 'Tiap koreksi lewat alat hitung_ulang_hpp (pratinjau dulu, lalu Ya).', 'Sesudahnya jalankan sinkron_akuntansi dan baca jembatan_masalah sampai owing = 0.']
      : []
  };
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function loadHppAuditInput(db, store) {
  const productRows = await db.prepare(`
    SELECT p.id, p.name, p.average_cost, t.code AS type_code, u.symbol AS unit_symbol
    FROM products p
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    LEFT JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    WHERE p.store_id = ? AND p.is_active = 1
  `).bind(store.id).all();
  const lineRows = await db.prepare(`
    SELECT pi.product_id, pi.quantity, pi.line_total, date(pi.created_at, '+7 hours') AS purchase_date
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id AND pu.store_id = pi.store_id
    WHERE pi.store_id = ? AND pu.voided_at IS NULL AND pi.quantity > 0 AND pi.line_total > 0
  `).bind(store.id).all();
  const recipeRows = await db.prepare(`
    SELECT r.id AS recipe_id, r.output_product_id, r.output_quantity, c.component_product_id, c.quantity AS component_quantity
    FROM manufacturing_recipes r
    JOIN manufacturing_recipe_components c ON c.recipe_id = r.id AND c.store_id = r.store_id
    WHERE r.store_id = ? AND r.status = 'ACTIVE'
  `).bind(store.id).all();
  const siblingRows = await db.prepare(`
    SELECT p.name, p.average_cost, u.symbol AS unit_symbol
    FROM products p
    JOIN stores s ON s.id = p.store_id
    JOIN item_types t ON t.id = p.item_type_id AND t.store_id = p.store_id
    LEFT JOIN units u ON u.id = p.base_unit_id AND u.store_id = p.store_id
    WHERE s.entity_id = (SELECT entity_id FROM stores WHERE id = ?)
      AND p.store_id <> ? AND p.is_active = 1 AND p.average_cost > 0 AND t.code = 'RAW_MATERIAL'
  `).bind(store.id, store.id).all();

  const siblingLineRows = await db.prepare(`
    SELECT pi.store_id, pi.product_name AS name, pi.quantity, pi.line_total
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id AND pu.store_id = pi.store_id
    JOIN stores s ON s.id = pi.store_id
    WHERE s.entity_id = (SELECT entity_id FROM stores WHERE id = ?)
      AND pi.store_id <> ? AND pu.voided_at IS NULL AND pi.quantity > 0 AND pi.line_total > 0
      AND date(pi.created_at, '+7 hours') >= date('now', '-75 days')
    LIMIT ${SIBLING_LINES_LIMIT}
  `).bind(store.id, store.id).all();

  return {
    products: (productRows.results ?? []).map(row => ({
      id: Number(row.id), name: row.name, averageCostScaled: Number(row.average_cost || 0), typeCode: row.type_code || '', unit: row.unit_symbol || ''
    })),
    lines: (lineRows.results ?? []).map(row => ({
      productId: Number(row.product_id), quantity: Number(row.quantity), total: Number(row.line_total), date: row.purchase_date
    })),
    recipes: (recipeRows.results ?? []).map(row => ({
      recipeId: row.recipe_id, outputId: Number(row.output_product_id), outputQty: Number(row.output_quantity),
      componentId: Number(row.component_product_id), qty: Number(row.component_quantity)
    })),
    siblings: (siblingRows.results ?? []).map(row => ({
      name: row.name, averageCostScaled: Number(row.average_cost || 0), unit: row.unit_symbol || ''
    })),
    siblingLines: (siblingLineRows.results ?? []).map(row => ({
      storeKey: row.store_id, name: row.name, quantity: Number(row.quantity), total: Number(row.line_total)
    }))
  };
}

export async function handleHppAuditApi(request, env, pathname) {
  if (request.method !== 'GET' || pathname !== '/api/admin/hpp-audit') return null;
  const auth = await requireManagement(request, env.DB, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);

  const fromParam = new URL(request.url).searchParams.get('from') || '';
  const today = getJakartaBusinessDate();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : defaultFrom(today);

  const input = await loadHppAuditInput(env.DB, store);
  return json({ store: { code: store.code, name: store.storeName ?? store.name ?? store.code }, ...analyzeHpp({ ...input, from }) });
}
