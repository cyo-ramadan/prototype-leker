// Penyimpanan pengaturan di EEPROM (sektor flash), dengan checksum.
#pragma once
#include <Arduino.h>

static const uint8_t MAX_SCHEDULES = 8;

enum PowerOnMode : uint8_t {
  POWER_ON_LAST = 0,  // kembali ke kondisi terakhir sebelum listrik mati
  POWER_ON_FULL = 1,  // selalu nyala 100% (saklar tembok = saklar biasa)
  POWER_ON_OFF = 2,   // selalu mati, tunggu perintah dari HP
};

struct Schedule {
  uint8_t enabled;  // 0/1
  uint8_t days;     // bit0 = Minggu ... bit6 = Sabtu
  uint8_t hour;
  uint8_t minute;
  uint8_t level;    // 0 = matikan, 1..100 = nyalakan dengan level ini
  uint8_t fadeSec;  // durasi transisi (0..255 detik)
};

struct Config {
  uint32_t magic;
  uint16_t version;
  char ssid[33];
  char pass[65];
  char name[32];
  uint8_t lampType;    // dimmer::LampType
  uint8_t minLevel;    // trim bawah 0..60 (%)
  uint8_t powerOnMode; // PowerOnMode
  uint8_t lastLevel;   // 1..100 (level terakhir saat nyala)
  uint8_t lastOn;      // 0/1
  uint8_t bootCount;   // hitung nyala-mati cepat untuk reset
  uint8_t awayMode;    // simulasi rumah berpenghuni
  Schedule schedules[MAX_SCHEDULES];
  uint32_t checksum;
};

namespace config {
extern Config cfg;
void load();
void save();          // tulis hanya bila isi berubah (hemat umur flash)
void factoryReset();  // hapus WiFi + jadwal, nama tetap default
String deviceId();    // 6 heksa terakhir chip ID, mis. "A1B2C3"
String pin();         // PIN 6 digit untuk OTA, dicetak di stiker kemasan
}  // namespace config
