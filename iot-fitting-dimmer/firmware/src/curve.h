// Kurva kecerahan -> sudut penyalaan TRIAC.
// Pure C++ tanpa Arduino supaya bisa dites di PC (test/curve_test.cpp).
#pragma once
#include <math.h>
#include <stdint.h>

namespace curve {

// Daya relatif beban resistif bila TRIAC dinyalakan pada sudut alpha (0..PI)
// tiap setengah gelombang: P = 1 - a/PI + sin(2a)/(2PI).
inline double powerAtAngle(double alpha) {
  return 1.0 - alpha / M_PI + sin(2.0 * alpha) / (2.0 * M_PI);
}

// Kebalikan powerAtAngle via bisection (fungsi monoton turun).
inline double angleForPower(double p) {
  if (p >= 1.0) return 0.0;
  if (p <= 0.0) return M_PI;
  double lo = 0.0, hi = M_PI;
  for (int i = 0; i < 40; i++) {
    double mid = (lo + hi) / 2.0;
    if (powerAtAngle(mid) > p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2.0;
}

// level 1..100 (persen yang dilihat pengguna) -> fraksi daya 0..1.
// minLevel = trim bawah (persen daya) supaya lampu LED dimmable tidak mati/kedip
// di slider rendah. Gamma 2.0 membuat slider terasa linear di mata.
inline double levelToPower(int level, int minLevel) {
  if (level <= 0) return 0.0;
  if (level >= 100) return 1.0;
  double x = level / 100.0;
  double perceived = x * x;
  double floorP = minLevel / 100.0;
  return floorP + (1.0 - floorP) * perceived;
}

// Delay dari zero-cross sampai pulsa gate, dalam mikrodetik.
// halfPeriodUs: 10000 (50Hz) atau 8333 (60Hz). Dijepit supaya pulsa tidak jatuh
// terlalu dekat dengan zero-cross berikutnya (TRIAC gagal latch -> kedip).
inline uint32_t fireDelayUs(int level, int minLevel, uint32_t halfPeriodUs,
                            uint32_t minDelayUs, uint32_t endMarginUs) {
  double p = levelToPower(level, minLevel);
  double alpha = angleForPower(p);
  double d = alpha / M_PI * (double)halfPeriodUs;
  double maxDelay = (double)halfPeriodUs - (double)endMarginUs;
  if (d < minDelayUs) d = minDelayUs;
  if (d > maxDelay) d = maxDelay;
  return (uint32_t)(d + 0.5);
}

}  // namespace curve
