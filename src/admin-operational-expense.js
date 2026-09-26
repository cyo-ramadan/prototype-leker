import { json, readJson } from './http.js';
import { requireManagement } from './owner-auth.js';
import { DEFAULT_STORE_CODE, resolveStore } from './stores.js';
import { getJakartaBusinessDate } from './time.js';
import { invalidateDailyProfitSnapshot } from './net-profit-report.js';
import { recordBeaGajiAdjustment, voidLedgerEntryBySource, WAGE_SCALE } from './payroll-ledger.js';
import { operationalExpensePayableStatement } from './operational-expense-payables.js';

// Bea Operasional dari panel Admin Gerai (migration 0100) -- Bos Cyo,
// 2026-09-17. Uang keluar yang dibayar Admin, bukan lewat laci kasir:
// Bea Gaji, Bea Lapak, Bea Lainnya.
//
// Ini sumber Beban KEDUA untuk Laporan Net Profit (yang pertama tabel
// `expenses`/Pengeluaran Kasir). Sudah didaftarkan di
// src/net-profit-report.js -- jangan tambah jenis bea baru di sini tanpa
// memastikan pendaftaran itu masih mencakupnya.
//
// Bos Cyo, 2026-09-24 (koreksi atas Penyesuaian Gaji): "harusnya entry gaji
// cukup yang di operasional itu kan bisa, engga usa bikin yang baru ...
// apabila menyentuh itu harus cek juga employ dan nama karyawan itu." Bea
// Gaji sekarang WAJIB memilih Karyawan, dan setiap baris Bea Gaji dimirror
// ke src/payroll-ledger.js (Akun Gaji per orang, debit/kredit Hutang Gaji +
// Beban Gaji) -- lihat migration 0116. Bea Gaji juga satu-satunya kategori
// yang boleh nominal NEGATIF (potongan/pinalti gaji); Bea Lapak/Bea Lainnya
// tetap wajib positif seperti semula.
//
// Bos Cyo, 2026-09-26: "bea operasional itu kita bikin tombol kusus untuk
// membuat hutang, jadi pembayaran pilihannya adalah hutang pak azis
// (suplier) hutang mang darus(suplier) adiva(karyawan) dsb." + "bikin hutang
// dan bebannya itu di tombol bea operasional itu. untuk pembayarannya beda
// lagi". Jadi tombol ini = satu-satunya pintu MEMBUAT Hutang + mengakui
// Beban, untuk semua jenis:
//   - Bea Gaji   -> Hutang Gaji karyawan (payroll-ledger.js). Nominal minus
//                   tetap = potongan/pinalti (mengurangi beban & hutang),
//                   BUKAN pembayaran.
//   - Bea Lapak / Bea Lainnya -> Hutang ke pihak yang dipilih: Supplier
//                   (Master Supplier), Karyawan (Master Karyawan), atau nama
//                   bebas (operational-expense-payables.js).
// Pelunasan SEMUA Hutang itu lewat tombol Pembayaran Hutang/Piutang
// (src/hutang-piutang.js), bukan di sini. Beban yang langsung dibayar tanpa
// Hutang = tombol Pembayaran Lainnya (juga src/hutang-piutang.js).

export const BEA_CATEGORIES = Object.freeze([
  { code: 'BEA_GAJI', label: 'Bea Gaji' },
  { code: 'BEA_LAPAK', label: 'Bea Lapak' },
  { code: 'BEA_LAINNYA', label: 'Bea Lainnya' }
]);

const CATEGORY_CODES = new Set(BEA_CATEGORIES.map(item => item.code));
const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);

// Batas atas sekadar pagar salah ketik (mis. kelebihan nol), bukan aturan
// bisnis. Rupiah bulat -- bukan skala 1.000.000, itu khusus HPP/jurnal.
const MAX_AMOUNT_RUPIAH = 1_000_000_000;

function amountInput(value, { allowNegative = false } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || Math.abs(number) > MAX_AMOUNT_RUPIAH) return null;
  if (!allowNegative && number < 0) return null;
  return number;
}

function businessDateInput(value) {
  const trimmed = text(value, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return trimmed;
}

function actorFrom(auth) {
  if (auth.owner) return { role: 'OWNER', id: auth.owner.id };
  if (auth.entityAdmin) return { role: 'ENTITY_ADMIN', id: auth.entityAdmin.id };
  if (auth.admin) return { role: 'ADMIN', id: auth.admin.id };
  return { role: 'LEGACY_PIN', id: '' };
}

function mapExpense(row) {
  return {
    id: row.id,
    category: row.category,
    categoryLabel: BEA_CATEGORIES.find(item => item.code === row.category)?.label || row.category,
    description: row.description,
    amount: Number(row.amount || 0),
    businessDate: row.business_date,
    note: row.note || '',
    employeeId: row.employee_id || null,
    employeeName: row.employee_name || '',
    createdAt: row.created_at,
    createdByRole: row.created_by_role || '',
    voidedAt: row.voided_at || null,
    voidReason: row.void_reason || '',
    settlement: row.settlement || 'LANGSUNG',
    counterpartyName: row.counterparty_name || row.payable_counterparty || '',
    paymentMethod: row.payment_method || '',
    adminPaymentId: row.admin_payment_id || null
  };
}

async function listExpenses(db, storeId, { from, to, limit = 200 } = {}) {
  const clauses = ['e.store_id = ?'];
  const values = [storeId];
  if (from) { clauses.push('e.business_date >= ?'); values.push(from); }
  if (to) { clauses.push('e.business_date <= ?'); values.push(to); }
  const rows = await db.prepare(`
    SELECT e.id, e.category, e.description, e.amount, e.business_date, e.note, e.created_at,
           e.created_by_role, e.voided_at, e.void_reason, e.employee_id, e.settlement,
           e.counterparty_name, e.payment_method,
           emp.full_name AS employee_name,
           (SELECT r.counterparty_name_snapshot FROM operational_receivables_payables r
             WHERE r.source_id = e.id AND r.store_id = e.store_id AND r.source_type IN ('BEA_LAPAK', 'BEA_LAINNYA') LIMIT 1) AS payable_counterparty,
           (SELECT ap.id FROM admin_payments ap WHERE ap.expense_id = e.id LIMIT 1) AS admin_payment_id
    FROM admin_operational_expenses e
    LEFT JOIN employees emp ON emp.id = e.employee_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY e.business_date DESC, e.created_at DESC
    LIMIT ?
  `).bind(...values, limit).all();
  return (rows.results ?? []).map(mapExpense);
}

async function selectedStore(db, request) {
  const token = new URL(request.url).searchParams.get('store') || DEFAULT_STORE_CODE;
  return resolveStore(db, token, { includeInactive: true });
}

export async function handleAdminOperationalExpenseApi(request, env, pathname) {
  if (!pathname.startsWith('/api/admin/operational-expenses')) return null;
  const db = env.DB;
  const auth = await requireManagement(request, db, env);
  if (!auth.ok) return auth.response;
  const store = await selectedStore(db, request);
  if (!store) return json({ error: 'Gerai tidak ditemukan.' }, 404);
  const actor = actorFrom(auth);
  const url = new URL(request.url);

  if (request.method === 'GET' && pathname === '/api/admin/operational-expenses') {
    // Dipakai dropdown Karyawan waktu kategori Bea Gaji dipilih -- lihat
    // koreksi Bos Cyo di atas. Kosong (bukan error) kalau gerai belum
    // terhubung Entity, sama seperti bagian lain repo ini yang mensyaratkan
    // entity_id.
    const employees = store.entityId
      ? (await db.prepare(`
          SELECT id, full_name FROM employees
          WHERE entity_id = ? AND status = 'ACTIVE'
          ORDER BY full_name COLLATE NOCASE
        `).bind(store.entityId).all()).results ?? []
      : [];
    return json({
      store,
      categories: BEA_CATEGORIES,
      today: getJakartaBusinessDate(),
      employees: employees.map(row => ({ id: row.id, fullName: row.full_name })),
      expenses: await listExpenses(db, store.id, {
        from: businessDateInput(url.searchParams.get('from')),
        to: businessDateInput(url.searchParams.get('to'))
      }),
      // Pilihan pihak Hutang untuk Bea Lapak/Lainnya -- Master Supplier gerai
      // ini (sudah dipakai form Pembelian kasir).
      suppliers: ((await db.prepare(`
        SELECT id, name FROM suppliers WHERE store_id = ? AND is_active = 1 ORDER BY name COLLATE NOCASE
      `).bind(store.id).all()).results ?? []).map(row => ({ id: row.id, name: row.name }))
    });
  }

  if (request.method === 'POST' && pathname === '/api/admin/operational-expenses') {
    const body = await readJson(request);
    if (!body.ok) return json({ error: 'Payload Bea Operasional tidak valid.' }, 400);

    const category = text(body.value?.category, 20).toUpperCase();
    if (!CATEGORY_CODES.has(category)) return json({ error: 'Jenis bea tidak dikenal.', code: 'UNKNOWN_BEA_CATEGORY' }, 400);
    const isBeaGaji = category === 'BEA_GAJI';

    const description = text(body.value?.description, 220);
    if (!description) return json({ error: 'Keterangan bea wajib diisi.' }, 400);

    const amount = amountInput(body.value?.amount, { allowNegative: isBeaGaji });
    if (amount === null) return json({ error: 'Nominal bea harus bilangan bulat rupiah yang wajar.' }, 400);
    if (amount === 0) return json({ error: 'Nominal bea tidak boleh nol.' }, 400);

    // Bos Cyo: "apabila menyentuh itu harus cek juga employ dan nama
    // karyawan itu." Bea Gaji wajib menunjuk satu Karyawan nyata (Master
    // Karyawan, bukan sekadar teks bebas) -- itu yang membuat baris ini bisa
    // masuk Riwayat Gaji per nama orang, bukan cuma catatan pengeluaran lepas.
    let employeeId = null;
    if (isBeaGaji) {
      employeeId = text(body.value?.employeeId, 60);
      if (!employeeId) return json({ error: 'Bea Gaji wajib memilih Karyawan.', code: 'BEA_GAJI_REQUIRES_EMPLOYEE' }, 400);
      const employee = await db.prepare('SELECT id FROM employees WHERE id = ? AND entity_id = ? AND status = ?')
        .bind(employeeId, store.entityId, 'ACTIVE').first();
      if (!employee) return json({ error: 'Karyawan tidak ditemukan di entity gerai ini.', code: 'EMPLOYEE_OUT_OF_SCOPE' }, 404);
    }

    // Bea Lapak / Bea Lainnya: WAJIB menunjuk pihak yang dihutangi -- itu
    // yang membuatnya bisa direkap per orang di Laporan Hutang Piutang dan
    // dipilih di Pembayaran Hutang/Piutang.
    let party = null;
    if (!isBeaGaji) {
      if (!store.entityId) return json({ error: 'Gerai ini belum terhubung Entity, Hutang butuh itu.', code: 'STORE_WITHOUT_ENTITY' }, 409);
      const counterpartyType = text(body.value?.counterpartyType, 20).toUpperCase() || 'OTHER';
      if (counterpartyType === 'SUPPLIER') {
        const supplier = await db.prepare('SELECT id, name FROM suppliers WHERE id = ? AND store_id = ? AND is_active = 1')
          .bind(text(body.value?.counterpartyId, 120), store.id).first();
        if (!supplier) return json({ error: 'Pilih Supplier gerai ini yang masih aktif.', code: 'SUPPLIER_OUT_OF_SCOPE' }, 400);
        party = { type: 'SUPPLIER', id: supplier.id, name: supplier.name };
      } else if (counterpartyType === 'EMPLOYEE') {
        const employee = await db.prepare('SELECT id, full_name FROM employees WHERE id = ? AND entity_id = ? AND status = ?')
          .bind(text(body.value?.counterpartyId, 60), store.entityId, 'ACTIVE').first();
        if (!employee) return json({ error: 'Pilih Karyawan entity ini yang masih aktif.', code: 'EMPLOYEE_OUT_OF_SCOPE' }, 400);
        party = { type: 'EMPLOYEE', id: employee.id, name: employee.full_name };
      } else if (counterpartyType === 'OTHER') {
        const name = text(body.value?.counterpartyName, 200);
        if (!name) return json({ error: 'Tulis nama pihak yang dihutangi (mis. pemilik lapak).', code: 'COUNTERPARTY_REQUIRED' }, 400);
        party = { type: 'OTHER', id: null, name };
      } else {
        return json({ error: 'Jenis pihak tidak dikenal.', code: 'COUNTERPARTY_TYPE_INVALID' }, 400);
      }
    }

    // Default hari ini kalau tidak diisi -- Admin tetap boleh mundur (gaji
    // tanggal 5 untuk periode bulan lalu).
    const businessDate = businessDateInput(body.value?.businessDate) || getJakartaBusinessDate();

    const id = `beaops_${crypto.randomUUID()}`;
    const expenseStatement = db.prepare(`
      INSERT INTO admin_operational_expenses (
        id, store_id, category, employee_id, description, amount, business_date, note,
        created_by_role, created_by_id, created_at, settlement, counterparty_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'HUTANG', ?)
    `).bind(id, store.id, category, employeeId, description, amount, businessDate, text(body.value?.note, 500), actor.role, actor.id, party?.name || '');

    if (isBeaGaji) {
      await expenseStatement.run();
      await recordBeaGajiAdjustment(db, {
        employeeId,
        storeId: store.id,
        businessDate,
        amountScaled: Math.round(amount * WAGE_SCALE),
        expenseId: id,
        description,
        createdByRole: actor.role,
        createdById: actor.id
      });
    } else {
      // Beban (baris di atas) dan Hutangnya lahir dalam satu batch -- dua-
      // duanya atau tidak sama sekali.
      await db.batch([
        expenseStatement,
        operationalExpensePayableStatement(db, {
          storeId: store.id,
          entityId: store.entityId,
          category,
          expenseId: id,
          counterpartyType: party.type,
          counterpartyId: party.id,
          counterpartyName: party.name,
          description,
          amountRupiah: amount,
          businessDate
        })
      ]);
    }

    // Hari yang sudah ditutup-buku mungkin sudah tersimpan di cache laporan
    // dengan angka lama -- buang cache tanggal itu supaya dihitung ulang.
    await invalidateDailyProfitSnapshot(db, store.id, businessDate);

    return json({ ok: true, id, expenses: await listExpenses(db, store.id) }, 201);
  }

  const voidMatch = pathname.match(/^\/api\/admin\/operational-expenses\/([^/]+)\/void$/);
  if (request.method === 'POST' && voidMatch) {
    const id = decodeURIComponent(voidMatch[1]);
    const current = await db.prepare('SELECT id, category, business_date, voided_at FROM admin_operational_expenses WHERE id = ? AND store_id = ?')
      .bind(id, store.id).first();
    if (!current) return json({ error: 'Bea tidak ditemukan di gerai ini.' }, 404);
    if (current.voided_at) return json({ error: 'Bea ini sudah dibatalkan sebelumnya.', code: 'ALREADY_VOIDED' }, 409);
    // Bea dari "Pembayaran Lainnya" punya uang keluar (mungkin lewat Rekening
    // Bersama) -- pembatalannya wajib lewat Pembayaran supaya uangnya ikut
    // dibalik, bukan cuma Beban-nya.
    const linkedPayment = await db.prepare('SELECT id FROM admin_payments WHERE expense_id = ? AND store_id = ? LIMIT 1').bind(id, store.id).first();
    if (linkedPayment) return json({ error: 'Bea ini dicatat lewat Pembayaran Lainnya -- batalkan dari riwayat Pembayaran supaya uangnya ikut dibalik.', code: 'VOID_VIA_PAYMENT' }, 409);

    const body = await readJson(request);
    const reason = body.ok ? text(body.value?.reason, 200) : '';
    const result = await db.prepare(`
      UPDATE admin_operational_expenses
      SET voided_at = CURRENT_TIMESTAMP, voided_by_role = ?, voided_by_id = ?, void_reason = ?
      WHERE id = ? AND store_id = ? AND voided_at IS NULL
    `).bind(actor.role, actor.id, reason, id, store.id).run();
    if (!result.success || Number(result.meta?.changes ?? 0) !== 1) {
      return json({ error: 'Bea sudah berubah di request lain.' }, 409);
    }

    // Mirror Akun Gaji-nya (kalau ada) ikut dibatalkan -- bukan DELETE,
    // append-only sama seperti baris aslinya. Hutang Lapak/Lainnya tidak
    // perlu disentuh: saldonya dihitung saat dibaca dan Bea yang dibatalkan
    // membuat hutangnya bernilai 0 (src/hutang-piutang.js loadOrpItems).
    await voidLedgerEntryBySource(db, {
      sourceType: 'BEA_OPERASIONAL', sourceId: id,
      voidedByRole: actor.role, voidedById: actor.id, reason
    });

    await invalidateDailyProfitSnapshot(db, store.id, current.business_date);
    return json({ ok: true, expenses: await listExpenses(db, store.id) });
  }

  return json({ error: 'Route Bea Operasional tidak ditemukan.' }, 404);
}
