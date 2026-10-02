#include "config.h"

#include <EEPROM.h>

namespace config {

Config cfg;
static const uint32_t MAGIC = 0x4C4B4C31;  // "LKL1"
static const uint16_t VERSION = 1;

static uint32_t calcChecksum(const Config &c) {
  // FNV-1a atas seluruh struct kecuali field checksum.
  const uint8_t *p = reinterpret_cast<const uint8_t *>(&c);
  size_t n = offsetof(Config, checksum);
  uint32_t h = 2166136261u;
  for (size_t i = 0; i < n; i++) {
    h ^= p[i];
    h *= 16777619u;
  }
  return h;
}

String deviceId() {
  char buf[7];
  snprintf(buf, sizeof(buf), "%06X", ESP.getChipId() & 0xFFFFFF);
  return String(buf);
}

String pin() {
  // Turunan deterministik dari chip ID: sama setiap kali, bisa dicetak di
  // stiker saat produksi (lihat tools/pin-label di RANCANGAN.md).
  uint32_t x = ESP.getChipId() ^ 0x5A17C3E9u;
  x ^= x << 13;
  x ^= x >> 17;
  x ^= x << 5;
  char buf[7];
  snprintf(buf, sizeof(buf), "%06u", (unsigned)(x % 1000000u));
  return String(buf);
}

static void setDefaults() {
  memset(&cfg, 0, sizeof(cfg));
  cfg.magic = MAGIC;
  cfg.version = VERSION;
  snprintf(cfg.name, sizeof(cfg.name), "Lampu %s", deviceId().substring(2).c_str());
  cfg.lampType = 0;
  cfg.minLevel = 10;
  cfg.powerOnMode = POWER_ON_LAST;
  cfg.lastLevel = 100;
  cfg.lastOn = 1;  // lampu baru dipasang = langsung nyala, seperti fitting biasa
}

void load() {
  EEPROM.begin(sizeof(Config));
  EEPROM.get(0, cfg);
  if (cfg.magic != MAGIC || cfg.version != VERSION || cfg.checksum != calcChecksum(cfg)) {
    setDefaults();
    save();
  }
  cfg.ssid[sizeof(cfg.ssid) - 1] = 0;
  cfg.pass[sizeof(cfg.pass) - 1] = 0;
  cfg.name[sizeof(cfg.name) - 1] = 0;
}

void save() {
  cfg.checksum = calcChecksum(cfg);
  Config stored;
  EEPROM.get(0, stored);
  if (memcmp(&stored, &cfg, sizeof(Config)) == 0) return;
  EEPROM.put(0, cfg);
  EEPROM.commit();
}

void factoryReset() {
  setDefaults();
  save();
}

}  // namespace config
