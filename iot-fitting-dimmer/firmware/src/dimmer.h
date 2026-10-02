// Kontrol fase TRIAC (leading-edge) berbasis interrupt zero-cross + Timer1.
#pragma once
#include <Arduino.h>

namespace dimmer {

// mode beban
enum LampType : uint8_t {
  LAMP_DIMMABLE = 0,  // pijar / LED "dimmable": kontrol fase penuh
  LAMP_ONOFF = 1,     // LED biasa (non-dimmable): cuma nyala 100% / mati
};

void begin(uint8_t zcPin, uint8_t gatePin);
// level 0..100 (0 = mati). Dipanggil dari loop, bukan ISR.
void apply(int level, int minLevel, LampType type);
// Frekuensi jala-jala terukur (0 bila zero-cross belum terdeteksi).
float mainsHz();
// true bila sinyal zero-cross masuk dalam 100ms terakhir.
bool mainsOk();

}  // namespace dimmer
