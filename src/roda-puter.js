import { requireCashier } from './cashier-auth.js';
import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate } from './time.js';
import { prepareVoucherInstanceDistribution } from './voucher.js';

export const RODA_PUTER_TOTAL_WEIGHT_BASIS_POINTS = 10_000;

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);

function actorFromManagement(auth) {
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id };
  return { role: 'LEGACY_PIN', id: 'legacy-pin' };
}

function exactPercent(weightBasisPoints) {
  const whole = Math.floor(weightBasisPoints / 100);
  const fraction = String(weightBasisPoints % 100).padStart(2, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}

function secureRandomUnit() {
  const sample = new Uint32Array(1);
  crypto.getRandomValues(sample);
  return sample[0] / 4_294_967_296;
}

export function selectWeightedReward(rewards, randomValue) {
  if (!Array.isArray(rewards) || !rewards.length) {
    return { ok: false, code: 'RODA_PUTER_REWARDS_EMPTY', error: 'Hadiah Roda Puter belum dikonfigurasi.' };
  }
  const normalized = [];
  let totalWeightBasisPoints = 0;
  for (const reward of rewards) {
    const weightBasisPoints = Number(reward?.weightBasisPoints);
    if (!Number.isSafeInteger(weightBasisPoints) || weightBasisPoints <= 0 || weightBasisPoints > RODA_PUTER_TOTAL_WEIGHT_BASIS_POINTS) {
      return { ok: false, code: 'RODA_PUTER_WEIGHT_INVALID', error: 'Bobot hadiah Roda Puter wajib berupa basis-points positif.' };
    }
    totalWeightBasisPoints += weightBasisPoints;
    if (!Number.isSafeInteger(totalWeightBasisPoints)) {
      return { ok: false, code: 'RODA_PUTER_WEIGHT_INVALID', error: 'Total bobot hadiah Roda Puter tidak valid.' };
    }
    normalized.push({ ...reward, weightBasisPoints });
  }
  if (totalWeightBasisPoints !== RODA_PUTER_TOTAL_WEIGHT_BASIS_POINTS) {
    return {
      ok: false,
      code: 'RODA_PUTER_WEIGHT_TOTAL_UNRESOLVED',
      error: 'Total bobot hadiah belum tepat 100%. Konfigurasi ditahan tanpa normalisasi otomatis.',
      totalWeightBasisPoints
    };
  }
  const sample = Number(randomValue);
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    return { ok: false, code: 'RODA_PUTER_RNG_INVALID', error: 'Sampel acak Roda Puter wajib berada pada rentang 0 sampai kurang dari 1.' };
  }
  const randomBasisPoints = Math.floor(sample * RODA_PUTER_TOTAL_WEIGHT_BASIS_POINTS);
  let boundary = 0;
  for (const reward of normalized) {
    boundary += reward.weightBasisPoints;
    if (randomBasisPoints < boundary) {
      return { ok: true, reward, randomBasisPoints, totalWeightBasisPoints };
    }
  }
  return { ok: false, code: 'RODA_PUTER_WEIGHT_GAP', error: 'Konfigurasi bobot Roda Puter memiliki celah.' };
}

async function selectedStore(db, request, includeInactive = false) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive });
}

function mapReward(row) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    voucherMasterId: row.voucher_master_id,
    voucherMasterName: row.voucher_master_name || '',
    productId: Number(row.product_id),
    productName: row.product_name_snapshot,
    weightBasisPoints: Number(row.weight_basis_points),
    weightPercentExact: exactPercent(Number(row.weight_basis_points)),
    sortOrder: Number(row.sort_order)
  };
}

async function activeCampaign(db, storeId) {
  const campaign = await db.prepare(`
    SELECT id, store_id, version, total_weight_basis_points, created_by_role,
           created_by_id, created_at
    FROM roda_puter_campaigns
    WHERE store_id = ? AND is_active = 1
    LIMIT 1
  `).bind(storeId).first();
  if (!campaign) return null;
  const rows = await db.prepare(`
    SELECT reward.id, reward.campaign_id, reward.voucher_master_id,
           reward.product_id, reward.product_name_snapshot,
           reward.weight_basis_points, reward.sort_order,
           voucher.name AS voucher_master_name
    FROM roda_puter_rewards reward
    JOIN voucher_masters voucher
      ON voucher.id = reward.voucher_master_id
     AND voucher.store_id = reward.store_id
    WHERE reward.store_id = ? AND reward.campaign_id = ?
    ORDER BY reward.sort_order, reward.id
  `).bind(storeId, campaign.id).all();
  return {
    id: campaign.id,
    storeId: campaign.store_id,
    version: Number(campaign.version),
    totalWeightBasisPoints: Number(campaign.total_weight_basis_points),
    createdByRole: campaign.created_by_role,
    createdById: campaign.created_by_id,
    createdAt: campaign.created_at,
    rewards: (rows.results ?? []).map(mapReward)
  };
}

async function rewardOptions(db, storeId) {
  const rows = await db.prepare(`
    SELECT voucher.id AS voucher_master_id, voucher.name AS voucher_master_name,
           product.id AS product_id, product.name AS product_name,
           unit.symbol AS unit_symbol
    FROM voucher_master_products allowed
    JOIN voucher_masters voucher
      ON voucher.id = allowed.voucher_master_id
     AND voucher.store_id = allowed.store_id
    JOIN products product
      ON product.id = allowed.product_id
     AND product.store_id = allowed.store_id
    LEFT JOIN units unit
      ON unit.id = product.base_unit_id
     AND unit.store_id = product.store_id
    WHERE allowed.store_id = ?
      AND voucher.is_active = 1
      AND product.is_active = 1
    ORDER BY voucher.name COLLATE NOCASE, allowed.sort_order,
             product.name COLLATE NOCASE, product.id
  `).bind(storeId).all();
  return (rows.results ?? []).map(row => ({
    voucherMasterId: row.voucher_master_id,
    voucherMasterName: row.voucher_master_name,
    productId: Number(row.product_id),
    productName: row.product_name,
    unitSymbol: row.unit_symbol || ''
  }));
}

function normalizeRewards(rawRewards, options) {
  if (!Array.isArray(rawRewards) || rawRewards.length < 1 || rawRewards.length > 50) {
    return { ok: false, status: 400, error: 'Daftar hadiah Roda Puter wajib berisi 1–50 barang.' };
  }
  const available = new Map(options.map(option => [`${option.voucherMasterId}:${option.productId}`, option]));
  const seenProducts = new Set();
  const rewards = [];
  let totalWeightBasisPoints = 0;
  for (const raw of rawRewards) {
    const voucherMasterId = text(raw?.voucherMasterId, 180);
    const productId = Number(raw?.productId);
    const weightBasisPoints = Number(raw?.weightBasisPoints);
    const option = available.get(`${voucherMasterId}:${productId}`);
    if (!option) {
      return { ok: false, status: 400, code: 'RODA_PUTER_REWARD_OUT_OF_SCOPE', error: 'Hadiah wajib berasal dari barang yang diizinkan Master Voucher aktif pada gerai ini.' };
    }
    if (seenProducts.has(productId)) {
      return { ok: false, status: 400, code: 'RODA_PUTER_REWARD_DUPLICATE', error: 'Satu barang hanya boleh muncul sekali dalam Roda Puter.' };
    }
    if (!Number.isSafeInteger(weightBasisPoints) || weightBasisPoints <= 0 || weightBasisPoints > RODA_PUTER_TOTAL_WEIGHT_BASIS_POINTS) {
      return { ok: false, status: 400, code: 'RODA_PUTER_WEIGHT_INVALID', error: 'Bobot tiap hadiah wajib lebih dari 0% dan maksimal 100%.' };
    }
    seenProducts.add(productId);
    totalWeightBasisPoints += weightBasisPoints;
    rewards.push({ ...option, weightBasisPoints });
  }
  if (totalWeightBasisPoints !== RODA_PUTER_TOTAL_WEIGHT_BASIS_POINTS) {
    return {
      ok: false,
      status: 409,
      code: 'RODA_PUTER_WEIGHT_TOTAL_UNRESOLVED',
      error: 'Total persentase harus tepat 100%. Konfigurasi ditolak tanpa normalisasi otomatis.',
      totalWeightBasisPoints
    };
  }
  return { ok: true, rewards, totalWeightBasisPoints };
}

async function handleAdminRodaPuterApi(request, env, pathname) {
  if (pathname !== '/api/admin/roda-puter') return null;
  const auth = await requireManagement(request, env.DB);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(env.DB, request, true);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const options = await rewardOptions(env.DB, store.id);

  if (request.method === 'GET') {
    return json({ store, campaign: await activeCampaign(env.DB, store.id), options });
  }
  if (request.method !== 'PUT') return json({ error: 'Method konfigurasi Roda Puter tidak didukung.' }, 405);

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload konfigurasi Roda Puter tidak valid.' }, 400);
  const normalized = normalizeRewards(body.value?.rewards, options);
  if (!normalized.ok) {
    return json({
      error: normalized.error,
      code: normalized.code,
      totalWeightBasisPoints: normalized.totalWeightBasisPoints
    }, normalized.status);
  }

  const versionRow = await env.DB.prepare(`
    SELECT COALESCE(MAX(version), 0) + 1 AS next_version
    FROM roda_puter_campaigns
    WHERE store_id = ?
  `).bind(store.id).first();
  const version = Number(versionRow?.next_version || 1);
  const campaignId = `roda_puter_campaign_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const actor = actorFromManagement(auth);
  const statements = [
    env.DB.prepare(`
      UPDATE roda_puter_campaigns
      SET is_active = 0
      WHERE store_id = ? AND is_active = 1
    `).bind(store.id),
    env.DB.prepare(`
      INSERT INTO roda_puter_campaigns (
        id, store_id, entity_id, version, total_weight_basis_points,
        is_active, created_by_role, created_by_id, created_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).bind(
      campaignId, store.id, store.entityId, version,
      normalized.totalWeightBasisPoints, actor.role, actor.id, now
    )
  ];
  normalized.rewards.forEach((reward, index) => statements.push(env.DB.prepare(`
    INSERT INTO roda_puter_rewards (
      id, campaign_id, store_id, voucher_master_id, product_id,
      product_name_snapshot, weight_basis_points, sort_order, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `roda_puter_reward_${crypto.randomUUID()}`,
    campaignId,
    store.id,
    reward.voucherMasterId,
    reward.productId,
    reward.productName,
    reward.weightBasisPoints,
    index,
    now
  )));

  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('unique')) {
      return json({ error: 'Konfigurasi Roda Puter berubah bersamaan. Muat ulang lalu simpan lagi.', code: 'RODA_PUTER_CONFIG_CONFLICT' }, 409);
    }
    throw error;
  }
  return json({ ok: true, campaign: await activeCampaign(env.DB, store.id), options });
}

async function publicRodaPuterStore(request, env) {
  const store = await selectedStore(env.DB, request);
  if (!store) return { response: json({ error: 'Gerai tidak ditemukan.' }, 404) };
  const campaign = await activeCampaign(env.DB, store.id);
  if (!campaign || !campaign.rewards.length) {
    return { response: json({ error: 'Hadiah Roda Puter belum tersedia di gerai ini.', code: 'RODA_PUTER_NOT_CONFIGURED' }, 409) };
  }
  return { store, campaign };
}

async function handlePublicRodaPuterApi(request, env, pathname, random) {
  if (!pathname.startsWith('/api/roda-puter/')) return null;
  if (request.method === 'GET' && pathname === '/api/roda-puter/rewards') {
    const resolved = await publicRodaPuterStore(request, env);
    if (resolved.response) return resolved.response;
    return json({
      mode: 'DEMO',
      voucherCreated: false,
      disclaimer: 'Mode coba-coba untuk hiburan. Hasil ini bukan Voucher resmi.',
      campaign: resolved.campaign
    });
  }
  if (request.method === 'POST' && pathname === '/api/roda-puter/demo') {
    const resolved = await publicRodaPuterStore(request, env);
    if (resolved.response) return resolved.response;
    const selected = selectWeightedReward(resolved.campaign.rewards, random());
    if (!selected.ok) return json({ error: selected.error, code: selected.code }, 409);
    return json({
      ok: true,
      mode: 'DEMO',
      voucherCreated: false,
      disclaimer: 'Seru-seruan saja. Hadiah resmi hanya diputar sekali di depan CS setelah member baru di-ACC.',
      reward: selected.reward
    });
  }
  return json({ error: 'Route demo Roda Puter tidak ditemukan.' }, 404);
}

async function officialCandidate(db, cashier, customerId) {
  const registration = await db.prepare(`
    SELECT request.id AS registration_request_id, request.store_id,
           request.customer_id, request.reviewed_at, request.reviewed_by,
           customer.store_id AS customer_store_id,
           customer.customer_name, customer.is_active
    FROM customer_registration_requests request
    JOIN customers customer
      ON customer.id = request.customer_id
     AND customer.store_id = request.store_id
    WHERE request.store_id = ?
      AND request.customer_id = ?
      AND request.status = 'APPROVED'
      AND request.reviewed_by = ?
      AND customer.is_active = 1
    ORDER BY request.reviewed_at DESC, request.id DESC
    LIMIT 1
  `).bind(cashier.store.id, customerId, cashier.id).first();
  if (!registration) {
    return {
      ok: false,
      status: 403,
      code: 'RODA_PUTER_CUSTOMER_NOT_APPROVED_BY_CASHIER',
      error: 'Spin resmi hanya tersedia untuk member baru yang di-ACC oleh CS/Kasir ini.'
    };
  }
  const existing = await db.prepare(`
    SELECT id, voucher_instance_id, spun_at
    FROM roda_puter_official_spins
    WHERE customer_id = ?
    LIMIT 1
  `).bind(customerId).first();
  if (existing) {
    return {
      ok: false,
      status: 409,
      code: 'RODA_PUTER_OFFICIAL_ALREADY_USED',
      error: 'Customer ini sudah memakai satu kesempatan spin resmi.',
      existing
    };
  }
  return { ok: true, registration };
}

async function handleOfficialRodaPuterApi(request, env, pathname, random) {
  if (pathname !== '/api/cashier/roda-puter' && pathname !== '/api/cashier/roda-puter/official') return null;
  const auth = await requireCashier(request, env.DB);
  if (!auth.ok) {
    return json({ error: 'Spin resmi wajib dilakukan dalam sesi CS/Kasir yang valid.', code: 'RODA_PUTER_CASHIER_REQUIRED' }, 403);
  }
  const cashier = auth.cashier;
  if (request.method === 'GET' && pathname === '/api/cashier/roda-puter') {
    const customerId = text(new URL(request.url).searchParams.get('customerId'), 180);
    if (!customerId) return json({ error: 'Customer wajib dipilih untuk mengecek spin resmi.' }, 400);
    const candidate = await officialCandidate(env.DB, cashier, customerId);
    if (!candidate.ok) {
      return json({
        eligible: false,
        error: candidate.error,
        code: candidate.code,
        existing: candidate.existing || null
      }, candidate.status);
    }
    const campaign = await activeCampaign(env.DB, cashier.store.id);
    return json({
      eligible: Boolean(campaign?.rewards.length),
      registrationRequestId: candidate.registration.registration_request_id,
      reviewedAt: candidate.registration.reviewed_at,
      rewardCount: campaign?.rewards.length || 0,
      error: campaign?.rewards.length ? '' : 'Hadiah Roda Puter belum dikonfigurasi.',
      code: campaign?.rewards.length ? '' : 'RODA_PUTER_NOT_CONFIGURED'
    });
  }
  if (request.method !== 'POST' || pathname !== '/api/cashier/roda-puter/official') {
    return json({ error: 'Method spin resmi tidak didukung.' }, 405);
  }

  const body = await readJson(request);
  if (!body.ok) return json({ error: 'Payload spin resmi tidak valid.' }, 400);
  const customerId = text(body.value?.customerId, 180);
  if (!customerId) return json({ error: 'Customer wajib dipilih untuk spin resmi.' }, 400);
  const candidate = await officialCandidate(env.DB, cashier, customerId);
  if (!candidate.ok) return json({ error: candidate.error, code: candidate.code }, candidate.status);
  const campaign = await activeCampaign(env.DB, cashier.store.id);
  if (!campaign || !campaign.rewards.length) {
    return json({ error: 'Hadiah Roda Puter belum dikonfigurasi.', code: 'RODA_PUTER_NOT_CONFIGURED' }, 409);
  }
  const selected = selectWeightedReward(campaign.rewards, random());
  if (!selected.ok) return json({ error: selected.error, code: selected.code }, 409);

  const now = new Date().toISOString();
  const prepared = await prepareVoucherInstanceDistribution(env.DB, {
    masterId: selected.reward.voucherMasterId,
    masterStoreId: cashier.store.id,
    customerId,
    distributedStoreId: cashier.store.id,
    distributedStoreCode: cashier.store.code,
    distributedByCashierId: cashier.id,
    businessDate: getJakartaBusinessDate(),
    now
  });
  if (!prepared.ok) return json({ error: prepared.error, code: prepared.code }, prepared.status);

  const spinId = `roda_puter_spin_${crypto.randomUUID()}`;
  try {
    await env.DB.batch([
      prepared.statement,
      env.DB.prepare(`
        INSERT INTO roda_puter_official_spins (
          id, store_id, customer_store_id, entity_id, customer_id,
          registration_request_id, campaign_id, reward_id,
          voucher_instance_id, random_basis_points,
          performed_by_cashier_id, spun_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        spinId,
        cashier.store.id,
        prepared.voucher.customerStoreId,
        prepared.voucher.entityId,
        customerId,
        candidate.registration.registration_request_id,
        campaign.id,
        selected.reward.id,
        prepared.voucher.id,
        selected.randomBasisPoints,
        cashier.id,
        now
      )
    ]);
  } catch (error) {
    const existing = await env.DB.prepare(`
      SELECT id FROM roda_puter_official_spins WHERE customer_id = ? LIMIT 1
    `).bind(customerId).first();
    if (existing || String(error?.message || '').toLowerCase().includes('unique')) {
      return json({ error: 'Customer ini sudah memakai satu kesempatan spin resmi.', code: 'RODA_PUTER_OFFICIAL_ALREADY_USED' }, 409);
    }
    throw error;
  }
  return json({
    ok: true,
    mode: 'OFFICIAL',
    voucherCreated: true,
    spinId,
    reward: selected.reward,
    voucher: prepared.voucher
  }, 201);
}

export async function handleRodaPuterApi(request, env, pathname, { random = secureRandomUnit } = {}) {
  const adminResponse = await handleAdminRodaPuterApi(request, env, pathname);
  if (adminResponse) return adminResponse;
  const officialResponse = await handleOfficialRodaPuterApi(request, env, pathname, random);
  if (officialResponse) return officialResponse;
  return handlePublicRodaPuterApi(request, env, pathname, random);
}
