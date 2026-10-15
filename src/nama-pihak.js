// Master nama pihak yang fleksibel (Bos Cyo, 2026-10-14): "satu orang tidak terpecah dua nama".
// Saldo hutang/piutang per nama dibaca dari buku, dikelompokkan per nama -- "Spbu Beji" dan
// "SPBU  beji" akan jadi dua orang. Maka setiap form yang meminta nama pihak:
//   - nama yang sama persis (abaikan huruf besar/kecil, spasi, tanda baca) -> otomatis dipakai nama yang sudah ada;
//   - nama yang MIRIP -> UI bertanya "Maksudnya '<X>'?"; kalau ya, X dipakai dan tulisan aslinya masuk keterangan;
//   - nama baru -> UI bertanya "Tambahkan '<nama>' sebagai pemasok/nama baru?".
// Daftar nama = Master Supplier gerai + nama bebas yang sudah pernah dipakai (label atas nama di buku dan
// pihak hutang/deposit Operasional). Tidak ada tabel baru: nama bebas "masuk master" begitu dipakai.

const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);

export function normalizeName(value) {
  return String(value ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

// Mirip = salah ketik kecil (kemiripan huruf >= 75%, tanpa spasi), atau satu nama memuat nama lain
// (mis. "Beji" vs "Spbu Beji"), atau semua kata nama yang lebih pendek ada di nama lain.
export function namesSimilar(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const compactX = x.replace(/ /g, '');
  const compactY = y.replace(/ /g, '');
  if (compactX === compactY) return true;
  const longest = Math.max(compactX.length, compactY.length);
  if (longest >= 4 && 1 - levenshtein(compactX, compactY) / longest >= 0.75) return true;
  const [shorter, longer] = compactX.length <= compactY.length ? [x, y] : [y, x];
  if (shorter.replace(/ /g, '').length >= 4 && longer.replace(/ /g, '').includes(shorter.replace(/ /g, ''))) return true;
  const shortWords = shorter.split(' ').filter(word => word.length >= 3);
  const longWords = new Set(longer.split(' '));
  return shortWords.length > 0 && shortWords.every(word => longWords.has(word));
}

// Nama yang dikenal gerai ini, satu per nama ternormalisasi. Supplier didahulukan (punya id master).
export async function listKnownNames(db, store) {
  const [suppliers, bookNames, operationalNames] = await Promise.all([
    db.prepare(`SELECT id, name FROM suppliers WHERE store_id = ? AND is_active = 1 ORDER BY name COLLATE NOCASE`).bind(store.id).all(),
    db.prepare(`
      SELECT party_name AS name, MAX(created_at) AS last_used FROM accounting_party_entries
      WHERE store_id = ? AND party_type = 'OTHER' GROUP BY party_name
    `).bind(store.id).all(),
    db.prepare(`
      SELECT counterparty_name_snapshot AS name, MAX(created_at) AS last_used FROM operational_receivables_payables
      WHERE store_id = ? AND counterparty_type = 'OTHER' AND TRIM(COALESCE(counterparty_name_snapshot, '')) <> ''
      GROUP BY counterparty_name_snapshot
    `).bind(store.id).all()
  ]);
  const byKey = new Map();
  for (const row of suppliers.results ?? []) {
    const key = normalizeName(row.name);
    if (key && !byKey.has(key)) byKey.set(key, { kind: 'SUPPLIER', id: row.id, name: row.name });
  }
  // Nama bebas yang sama ditulis beda (mis. huruf besar) -> pakai yang terakhir dipakai di buku.
  const freeNames = [...(bookNames.results ?? []), ...(operationalNames.results ?? [])]
    .sort((a, b) => String(b.last_used || '').localeCompare(String(a.last_used || '')));
  for (const row of freeNames) {
    const name = text(row.name, 120);
    const key = normalizeName(name);
    if (name.length >= 2 && key && !byKey.has(key)) byKey.set(key, { kind: 'NAME', id: null, name });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

// Hasil pemeriksaan satu nama yang diketik: `exact` = nama yang sama (otomatis dipakai), `similar` =
// calon "Maksudnya ...?" (paling banyak 5).
export async function checkPartyName(db, store, typed) {
  const name = text(typed, 120);
  const key = normalizeName(name);
  if (!key) return { name, exact: null, similar: [] };
  const known = await listKnownNames(db, store);
  const exact = known.find(item => normalizeName(item.name) === key) || null;
  const similar = exact ? [] : known.filter(item => namesSimilar(item.name, name)).slice(0, 5);
  return { name, exact, similar };
}
