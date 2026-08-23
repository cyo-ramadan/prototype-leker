// Uang: INTEGER berskala, 1 rupiah = 1_000_000 unit (lihat CLAUDE.md invariant #1).
// Ikan-galeh tidak pernah membagi/rata-rata angka uang -- tidak ada average cost --
// jadi konversi di sini selalu bilangan bulat, tidak butuh pembulatan half-up.

export const SCALE = 1_000_000;

export function rupiahToScaled(rupiah) {
  if (!Number.isInteger(rupiah) || rupiah < 0) {
    throw new RangeError('Nominal rupiah harus bilangan bulat >= 0');
  }
  return rupiah * SCALE;
}

export function scaledToRupiah(scaled) {
  if (!Number.isInteger(scaled) || scaled < 0 || scaled % SCALE !== 0) {
    throw new RangeError('Nominal berskala tidak valid');
  }
  return scaled / SCALE;
}
