#include "dimmer.h"

#include "curve.h"

namespace dimmer {

// Timer1 dengan TIM_DIV16 @80MHz = 5 tick per mikrodetik.
static const uint32_t TICKS_PER_US = 5;
static const uint32_t GATE_PULSE_US = 250;   // LED optotriac menyala 250us -> TRIAC latch
static const uint32_t MIN_DELAY_US = 350;    // sedikit sesudah ZC: arus sudah mulai naik
static const uint32_t END_MARGIN_US = 900;   // jangan menembak terlalu dekat ZC berikut
static const uint32_t ZC_DEBOUNCE_US = 6000; // abaikan noise (60Hz = 8333us)
static const uint32_t MIN_PULSE_US = 100;    // pulsa detektor lebih pendek = noise
static const uint32_t MAX_PULSE_US = 4000;
static const uint32_t MIN_TIMER_US = 20;

static uint8_t s_gate = 255;
static uint8_t s_zcPin = 255;
static volatile uint32_t s_riseUs = 0;
static volatile uint32_t s_lastZcUs = 0;
static volatile uint32_t s_halfPeriodUs = 10000;
// 0 = jangan menembak; selain itu delay dari zero-cross sejati, dalam mikrodetik.
static volatile uint32_t s_fireDelayUs = 0;
static volatile uint8_t s_phase = 0;  // 0 idle, 1 menunggu tembak, 2 pulsa aktif

static void IRAM_ATTR onTimer() {
  if (s_phase == 1) {
    digitalWrite(s_gate, HIGH);
    s_phase = 2;
    timer1_write(GATE_PULSE_US * TICKS_PER_US);
  } else {
    digitalWrite(s_gate, LOW);
    s_phase = 0;
  }
}

// Optocoupler input AC (LTV-354T) menarik pin LOW selama tegangan jauh dari nol; dekat
// zero-cross LED-nya padam sehingga pin naik HIGH sesaat (lebar ~0,5-2 ms).
// Zero-cross sejati = titik tengah pulsa HIGH, jadi waktu tembak dihitung dari
// sisi turun pulsa dikurangi setengah lebarnya. Tidak perlu kalibrasi offset.
static void IRAM_ATTR onZeroCross() {
  uint32_t now = micros();
  if (digitalRead(s_zcPin)) {
    s_riseUs = now;
    return;
  }
  uint32_t width = now - s_riseUs;
  if (width < MIN_PULSE_US || width > MAX_PULSE_US) return;
  uint32_t half = width / 2;
  uint32_t zc = now - half;
  uint32_t dt = zc - s_lastZcUs;
  if (dt < ZC_DEBOUNCE_US) return;
  s_lastZcUs = zc;
  // Filter halus periode setengah gelombang (50/60Hz otomatis).
  if (dt < 12000) s_halfPeriodUs = (s_halfPeriodUs * 7 + dt) / 8;

  digitalWrite(s_gate, LOW);  // pengaman: gate selalu dilepas di awal siklus
  uint32_t delayUs = s_fireDelayUs;
  if (delayUs == 0) {
    s_phase = 0;
    timer1_disable();
    return;
  }
  // Sebagian delay sudah lewat (setengah lebar pulsa) sejak zero-cross sejati.
  uint32_t remaining = delayUs > half + MIN_TIMER_US ? delayUs - half : MIN_TIMER_US;
  s_phase = 1;
  timer1_enable(TIM_DIV16, TIM_EDGE, TIM_SINGLE);
  timer1_write(remaining * TICKS_PER_US);
}

void begin(uint8_t zcPin, uint8_t gatePin) {
  s_gate = gatePin;
  pinMode(s_gate, OUTPUT);
  digitalWrite(s_gate, LOW);
  s_zcPin = zcPin;
  pinMode(zcPin, INPUT_PULLUP);  // + pull-up 100k eksternal di PCB
  timer1_attachInterrupt(onTimer);
  // Dua tepi per pulsa zero-cross -> 200 interrupt/detik pada 50Hz.
  attachInterrupt(digitalPinToInterrupt(zcPin), onZeroCross, CHANGE);
}

void apply(int level, int minLevel, LampType type) {
  uint32_t us = 0;
  if (level > 0 && mainsOk()) {
    int effective = (type == LAMP_ONOFF) ? 100 : level;
    us = curve::fireDelayUs(effective, minLevel, s_halfPeriodUs, MIN_DELAY_US, END_MARGIN_US);
  }
  s_fireDelayUs = us;
}

float mainsHz() {
  if (!mainsOk()) return 0;
  return 500000.0f / (float)s_halfPeriodUs;
}

bool mainsOk() { return (micros() - s_lastZcUs) < 100000; }

}  // namespace dimmer
