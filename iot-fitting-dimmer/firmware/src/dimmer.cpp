#include "dimmer.h"

#include "curve.h"

namespace dimmer {

// Timer1 dengan TIM_DIV16 @80MHz = 5 tick per mikrodetik.
static const uint32_t TICKS_PER_US = 5;
static const uint32_t GATE_PULSE_US = 250;   // cukup untuk latch beban LED kecil
static const uint32_t MIN_DELAY_US = 350;    // sedikit sesudah ZC: arus sudah mulai naik
static const uint32_t END_MARGIN_US = 900;   // jangan menembak terlalu dekat ZC berikut
static const uint32_t ZC_DEBOUNCE_US = 6000; // abaikan noise (60Hz = 8333us)
static const uint32_t ZC_OFFSET_US = 40;     // detektor NPN telat ~40us dari ZC sejati

static uint8_t s_gate = 255;
static volatile uint32_t s_lastZcUs = 0;
static volatile uint32_t s_halfPeriodUs = 10000;
// 0 = jangan menembak; selain itu delay dalam tick timer.
static volatile uint32_t s_fireTicks = 0;
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

static void IRAM_ATTR onZeroCross() {
  uint32_t now = micros();
  uint32_t dt = now - s_lastZcUs;
  if (dt < ZC_DEBOUNCE_US) return;
  s_lastZcUs = now;
  // Filter halus periode setengah gelombang (50/60Hz otomatis).
  if (dt < 12000) s_halfPeriodUs = (s_halfPeriodUs * 7 + dt) / 8;

  digitalWrite(s_gate, LOW);  // pengaman: gate selalu dilepas di awal siklus
  uint32_t ticks = s_fireTicks;
  if (ticks == 0) {
    s_phase = 0;
    timer1_disable();
    return;
  }
  s_phase = 1;
  timer1_enable(TIM_DIV16, TIM_EDGE, TIM_SINGLE);
  timer1_write(ticks);
}

void begin(uint8_t zcPin, uint8_t gatePin) {
  s_gate = gatePin;
  pinMode(s_gate, OUTPUT);
  digitalWrite(s_gate, LOW);
  pinMode(zcPin, INPUT);  // pull-up 10k eksternal di PCB
  timer1_attachInterrupt(onTimer);
  // Detektor NPN berganti level tiap zero-cross -> CHANGE = 100 interrupt/detik.
  attachInterrupt(digitalPinToInterrupt(zcPin), onZeroCross, CHANGE);
}

void apply(int level, int minLevel, LampType type) {
  uint32_t ticks = 0;
  if (level > 0 && mainsOk()) {
    int effective = (type == LAMP_ONOFF) ? 100 : level;
    uint32_t us = curve::fireDelayUs(effective, minLevel, s_halfPeriodUs,
                                     MIN_DELAY_US, END_MARGIN_US);
    if (us > ZC_OFFSET_US + MIN_DELAY_US) us -= ZC_OFFSET_US;
    ticks = us * TICKS_PER_US;
  }
  s_fireTicks = ticks;
}

float mainsHz() {
  if (!mainsOk()) return 0;
  return 500000.0f / (float)s_halfPeriodUs;
}

bool mainsOk() { return (micros() - s_lastZcUs) < 100000; }

}  // namespace dimmer
