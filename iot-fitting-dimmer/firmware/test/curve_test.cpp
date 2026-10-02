// Tes kurva dimmer di PC:  g++ -std=c++17 -I../src curve_test.cpp -o /tmp/ct && /tmp/ct
#include <cassert>
#include <cstdio>
#include <cmath>
#include "curve.h"

int main() {
  // Ujung-ujung kurva daya.
  assert(fabs(curve::powerAtAngle(0) - 1.0) < 1e-9);
  assert(fabs(curve::powerAtAngle(M_PI)) < 1e-9);
  assert(fabs(curve::powerAtAngle(M_PI / 2) - 0.5) < 1e-9);
  // Invers konsisten.
  for (int i = 1; i < 100; i++) {
    double p = i / 100.0;
    assert(fabs(curve::powerAtAngle(curve::angleForPower(p)) - p) < 1e-6);
  }
  // Delay monoton turun saat level naik, dan selalu dalam batas aman.
  uint32_t prev = 0xFFFFFFFF;
  for (int lvl = 1; lvl <= 100; lvl++) {
    uint32_t d = curve::fireDelayUs(lvl, 10, 10000, 350, 900);
    assert(d <= prev);
    assert(d >= 350 && d <= 9100);
    prev = d;
  }
  // Level 100 = tembak secepat mungkin; 60Hz ikut menyesuaikan.
  assert(curve::fireDelayUs(100, 10, 10000, 350, 900) == 350);
  assert(curve::fireDelayUs(1, 0, 8333, 350, 900) == 8333 - 900);
  // Trim bawah: level 1 dengan minLevel 30 masih memberi ~30% daya.
  assert(fabs(curve::levelToPower(1, 30) - 0.30007) < 1e-4);
  assert(curve::levelToPower(0, 30) == 0.0);
  printf("curve_test OK  (50%% -> %u us, 10%% -> %u us)\n",
         curve::fireDelayUs(50, 10, 10000, 350, 900), curve::fireDelayUs(10, 10, 10000, 350, 900));
  return 0;
}
