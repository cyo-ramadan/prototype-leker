// Fitting Lampu Pintar — firmware ESP8285/ESP8266.
// Dimmer TRIAC 220V + kontrol lewat WiFi (web lokal, API JSON, discovery UDP).
// Rancangan lengkap & skema: ../RANCANGAN.md

#include <Arduino.h>
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <ESP8266HTTPUpdateServer.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <ESP8266mDNS.h>
#include <WiFiUdp.h>
#include <time.h>

#include "config.h"
#include "dimmer.h"
#include "web_ui.h"

#ifndef FW_VERSION
#define FW_VERSION "dev"
#endif

// ---- Pin (ESP8285, lihat skema) ----
static const uint8_t PIN_ZC = 4;    // GPIO4: keluaran optocoupler zero-cross (LTV-354T + pull-up)
static const uint8_t PIN_GATE = 5;  // GPIO5: basis NPN penggerak LED optotriac (aktif HIGH)

static const uint16_t UDP_PORT = 4210;
static const char *UDP_PROBE = "LEKER_LAMPU?";
static const uint8_t RESET_BOOT_COUNT = 5;      // 5x nyala-mati cepat = reset WiFi
static const uint32_t BOOT_COUNT_CLEAR_MS = 5000;
static const uint32_t SAVE_DELAY_MS = 5000;
static const uint32_t WIFI_FALLBACK_MS = 30000; // gagal konek 30 dtk -> buka AP setup
static const uint32_t AP_FALLBACK_LIFETIME_MS = 10UL * 60UL * 1000UL;

ESP8266WebServer server(80);
ESP8266HTTPUpdateServer updater;
DNSServer dns;
WiFiUDP udp;

using config::cfg;

// ---- State lampu ----
static float g_level = 0;          // level aktual (0..100) yang sedang dikirim ke TRIAC
static int g_target = 0;           // target level (0 = mati)
static float g_fadeFrom = 0;
static uint32_t g_fadeStart = 0;
static uint32_t g_fadeMs = 0;
static int g_appliedLevel = -1;
static uint32_t g_offTimerAt = 0;  // millis() saat sleep-timer mematikan lampu, 0 = nonaktif
static uint32_t g_dirtyAt = 0;     // 0 = tidak ada perubahan yang belum disimpan
static bool g_bootCountCleared = false;
static bool g_apActive = false;
static uint32_t g_apStartedAt = 0;
static bool g_setupMode = false;   // belum ada WiFi tersimpan
static uint32_t g_wifiBeginAt = 0;
static int g_lastScheduleMinute = -1;
static uint32_t g_awayNextToggleAt = 0;

static void markDirty() { g_dirtyAt = millis() | 1; }

static void setTarget(int level, uint32_t fadeMs) {
  if (level < 0) level = 0;
  if (level > 100) level = 100;
  g_fadeFrom = g_level;
  g_fadeStart = millis();
  g_fadeMs = fadeMs;
  g_target = level;
  if (level > 0) cfg.lastLevel = level;
  cfg.lastOn = level > 0;
  markDirty();
}

static void turnOn(uint32_t fadeMs) { setTarget(cfg.lastLevel ? cfg.lastLevel : 100, fadeMs); }
static void turnOff(uint32_t fadeMs) {
  g_fadeFrom = g_level;
  g_fadeStart = millis();
  g_fadeMs = fadeMs;
  g_target = 0;
  cfg.lastOn = 0;
  g_offTimerAt = 0;
  markDirty();
}

static void updateFade() {
  float lvl;
  uint32_t elapsed = millis() - g_fadeStart;
  if (g_fadeMs == 0 || elapsed >= g_fadeMs) {
    lvl = g_target;
  } else {
    float t = (float)elapsed / (float)g_fadeMs;
    lvl = g_fadeFrom + (g_target - g_fadeFrom) * t;
  }
  g_level = lvl;
  int rounded = (int)(lvl + 0.5f);
  if (lvl > 0 && rounded == 0) rounded = 1;
  if (rounded != g_appliedLevel) {
    g_appliedLevel = rounded;
    dimmer::apply(rounded, cfg.minLevel, (dimmer::LampType)cfg.lampType);
  }
}

// Kedip 3x sebagai konfirmasi (reset WiFi). Blocking, hanya dipakai saat boot.
static void blinkConfirm() {
  for (int i = 0; i < 3; i++) {
    dimmer::apply(100, cfg.minLevel, (dimmer::LampType)cfg.lampType);
    delay(400);
    dimmer::apply(0, cfg.minLevel, (dimmer::LampType)cfg.lampType);
    delay(400);
  }
  g_appliedLevel = -1;
}

// ---- Waktu ----
static bool timeValid() { return time(nullptr) > 1700000000; }

static String hostName() {
  String id = config::deviceId();
  id.toLowerCase();
  return "lampu-" + id;
}

// ---- WiFi ----
static void startAp() {
  if (g_apActive) return;
  WiFi.mode(g_setupMode ? WIFI_AP : WIFI_AP_STA);
  String apName = "Lampu-" + config::deviceId();
  WiFi.softAP(apName.c_str());  // terbuka: hanya aktif saat setup / gagal konek
  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", WiFi.softAPIP());
  g_apActive = true;
  g_apStartedAt = millis();
}

static void stopAp() {
  if (!g_apActive) return;
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  g_apActive = false;
}

static void startWifi() {
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.hostname(hostName());
  // Daya pancar 15 dBm (maks 20.5) memangkas lonjakan arus saat TX ke ±170mA —
  // elco tandon catu kapasitor sengaja kecil (470uF) supaya muat di fitting.
  WiFi.setOutputPower(15.0f);
  if (cfg.ssid[0] == 0) {
    g_setupMode = true;
    startAp();
    return;
  }
  WiFi.mode(WIFI_STA);
  WiFi.setSleepMode(WIFI_MODEM_SLEEP);  // CPU tetap jalan (timer TRIAC butuh), radio tidur
  WiFi.begin(cfg.ssid, cfg.pass);
  g_wifiBeginAt = millis();
}

static void wifiLoop() {
  if (g_setupMode) return;
  bool connected = WiFi.status() == WL_CONNECTED;
  if (!connected && !g_apActive && millis() - g_wifiBeginAt > WIFI_FALLBACK_MS) startAp();
  if (g_apActive && WiFi.softAPgetStationNum() == 0 &&
      (connected || millis() - g_apStartedAt > AP_FALLBACK_LIFETIME_MS)) {
    stopAp();
  }
}

// ---- Jadwal & mode rumah berpenghuni ----
static void scheduleLoop() {
  if (!timeValid()) return;
  time_t now = time(nullptr);
  struct tm t;
  localtime_r(&now, &t);
  int minuteKey = t.tm_hour * 60 + t.tm_min;
  if (minuteKey != g_lastScheduleMinute) {
    g_lastScheduleMinute = minuteKey;
    for (uint8_t i = 0; i < MAX_SCHEDULES; i++) {
      const Schedule &s = cfg.schedules[i];
      if (!s.enabled || !(s.days & (1 << t.tm_wday))) continue;
      if (s.hour != t.tm_hour || s.minute != t.tm_min) continue;
      setTarget(s.level, (uint32_t)s.fadeSec * 1000UL);
    }
  }

  if (cfg.awayMode) {
    // 18:00-23:30: nyala/mati acak tiap 15-45 menit supaya rumah terlihat berpenghuni.
    bool window = (t.tm_hour >= 18) && (t.tm_hour < 23 || (t.tm_hour == 23 && t.tm_min < 30));
    uint32_t ms = millis();
    if (window && (g_awayNextToggleAt == 0 || (int32_t)(ms - g_awayNextToggleAt) >= 0)) {
      if (g_target > 0 && random(100) < 40) turnOff(2000);
      else if (g_target == 0) turnOn(2000);
      g_awayNextToggleAt = ms + (uint32_t)random(15, 46) * 60000UL;
    } else if (!window && g_awayNextToggleAt != 0) {
      turnOff(3000);
      g_awayNextToggleAt = 0;
    }
  }
}

// ---- HTTP API ----
static void cors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

static void sendJson(JsonDocument &doc, int code = 200) {
  String out;
  serializeJson(doc, out);
  cors();
  server.send(code, "application/json", out);
}

static void sendError(int code, const char *msg) {
  JsonDocument doc;
  doc["error"] = msg;
  sendJson(doc, code);
}

static void fillState(JsonDocument &doc) {
  doc["id"] = config::deviceId();
  doc["name"] = cfg.name;
  doc["on"] = g_target > 0;
  doc["level"] = g_target > 0 ? g_target : cfg.lastLevel;
  doc["actual"] = (int)(g_level + 0.5f);
  doc["lampType"] = cfg.lampType == 0 ? "dimmable" : "onoff";
  doc["minLevel"] = cfg.minLevel;
  doc["powerOn"] = cfg.powerOnMode;
  doc["away"] = (bool)cfg.awayMode;
  doc["timerLeftSec"] = g_offTimerAt ? (int32_t)(g_offTimerAt - millis()) / 1000 : 0;
  doc["mainsHz"] = dimmer::mainsHz();
  doc["fw"] = FW_VERSION;
  doc["setupMode"] = g_setupMode;
  doc["wifi"] = WiFi.status() == WL_CONNECTED ? WiFi.SSID() : String("");
  doc["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  doc["ip"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : WiFi.softAPIP().toString();
  doc["uptimeSec"] = millis() / 1000;
  if (timeValid()) {
    time_t now = time(nullptr);
    struct tm t;
    localtime_r(&now, &t);
    char buf[6];
    strftime(buf, sizeof(buf), "%H:%M", &t);
    doc["time"] = buf;
  } else {
    doc["time"] = nullptr;
  }
}

static void handleState() {
  JsonDocument doc;
  fillState(doc);
  sendJson(doc);
}

static int argInt(const char *name, int fallback) {
  return server.hasArg(name) ? server.arg(name).toInt() : fallback;
}

// POST /api/set  on=0|1  level=1..100  fade=ms
static void handleSet() {
  uint32_t fade = (uint32_t)constrain(argInt("fade", 400), 0, 600000);
  if (server.hasArg("level")) {
    int level = constrain(argInt("level", 100), 0, 100);
    setTarget(level, fade);
  }
  if (server.hasArg("on")) {
    if (argInt("on", 1)) {
      if (g_target == 0) turnOn(fade);
    } else {
      turnOff(fade);
    }
  }
  handleState();
}

static void handleToggle() {
  uint32_t fade = (uint32_t)constrain(argInt("fade", 400), 0, 600000);
  if (g_target > 0) turnOff(fade); else turnOn(fade);
  handleState();
}

// POST /api/timer  minutes=0..720 (0 = batal). Lampu meredup 30 dtk lalu mati.
static void handleTimer() {
  int minutes = constrain(argInt("minutes", 0), 0, 720);
  g_offTimerAt = minutes ? (millis() + (uint32_t)minutes * 60000UL) | 1 : 0;
  handleState();
}

static void handleAway() {
  cfg.awayMode = argInt("on", 0) ? 1 : 0;
  g_awayNextToggleAt = 0;
  markDirty();
  handleState();
}

// POST /api/config  name, lampType(dimmable|onoff), minLevel, powerOn
static void handleConfig() {
  if (server.hasArg("name")) {
    String n = server.arg("name");
    n.trim();
    if (n.length() == 0 || n.length() >= sizeof(cfg.name)) return sendError(400, "nama 1-31 karakter");
    strncpy(cfg.name, n.c_str(), sizeof(cfg.name) - 1);
  }
  if (server.hasArg("lampType")) cfg.lampType = server.arg("lampType") == "onoff" ? 1 : 0;
  if (server.hasArg("minLevel")) cfg.minLevel = constrain(argInt("minLevel", 10), 0, 60);
  if (server.hasArg("powerOn")) cfg.powerOnMode = constrain(argInt("powerOn", 0), 0, 2);
  g_appliedLevel = -1;  // paksa hitung ulang delay TRIAC dengan pengaturan baru
  markDirty();
  handleState();
}

static void handleSchedulesGet() {
  JsonDocument doc;
  JsonArray arr = doc["schedules"].to<JsonArray>();
  for (uint8_t i = 0; i < MAX_SCHEDULES; i++) {
    const Schedule &s = cfg.schedules[i];
    if (!s.enabled && s.days == 0) continue;  // slot kosong
    JsonObject o = arr.add<JsonObject>();
    o["enabled"] = (bool)s.enabled;
    o["days"] = s.days;
    o["hour"] = s.hour;
    o["minute"] = s.minute;
    o["level"] = s.level;
    o["fadeSec"] = s.fadeSec;
  }
  doc["max"] = MAX_SCHEDULES;
  doc["timeValid"] = timeValid();
  sendJson(doc);
}

// POST /api/schedules  body: {"schedules":[{enabled,days,hour,minute,level,fadeSec},...]}
static void handleSchedulesPost() {
  JsonDocument doc;
  if (deserializeJson(doc, server.arg("plain"))) return sendError(400, "JSON tidak valid");
  JsonArray arr = doc["schedules"].as<JsonArray>();
  if (arr.isNull()) return sendError(400, "schedules wajib array");
  if (arr.size() > MAX_SCHEDULES) return sendError(400, "maksimal 8 jadwal");
  Schedule next[MAX_SCHEDULES];
  memset(next, 0, sizeof(next));
  uint8_t i = 0;
  for (JsonObject o : arr) {
    int hour = o["hour"] | -1, minute = o["minute"] | -1, days = o["days"] | 0;
    int level = o["level"] | -1, fade = o["fadeSec"] | 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || days <= 0 || days > 127 ||
        level < 0 || level > 100 || fade < 0 || fade > 255) {
      return sendError(400, "isi jadwal tidak valid");
    }
    next[i++] = Schedule{(uint8_t)((o["enabled"] | true) ? 1 : 0), (uint8_t)days, (uint8_t)hour,
                         (uint8_t)minute, (uint8_t)level, (uint8_t)fade};
  }
  memcpy(cfg.schedules, next, sizeof(next));
  markDirty();
  handleSchedulesGet();
}

static void handleScan() {
  int n = WiFi.scanNetworks();
  JsonDocument doc;
  JsonArray arr = doc["networks"].to<JsonArray>();
  for (int i = 0; i < n && i < 20; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["ssid"] = WiFi.SSID(i);
    o["rssi"] = WiFi.RSSI(i);
    o["secure"] = WiFi.encryptionType(i) != ENC_TYPE_NONE;
  }
  WiFi.scanDelete();
  sendJson(doc);
}

// POST /api/wifi  ssid, pass -> simpan lalu restart
static void handleWifi() {
  String ssid = server.arg("ssid"), pass = server.arg("pass");
  if (ssid.length() == 0 || ssid.length() > 32 || pass.length() > 64) {
    return sendError(400, "SSID/password tidak valid");
  }
  strncpy(cfg.ssid, ssid.c_str(), sizeof(cfg.ssid) - 1);
  strncpy(cfg.pass, pass.c_str(), sizeof(cfg.pass) - 1);
  config::save();
  JsonDocument doc;
  doc["ok"] = true;
  doc["host"] = hostName() + ".local";
  sendJson(doc);
  delay(500);
  ESP.restart();
}

static void handleFactoryReset() {
  if (server.arg("confirm") != "RESET") return sendError(400, "kirim confirm=RESET");
  config::factoryReset();
  JsonDocument doc;
  doc["ok"] = true;
  sendJson(doc);
  delay(500);
  ESP.restart();
}

static void handleRoot() {
  server.sendHeader("Cache-Control", "no-cache");
  server.send_P(200, "text/html; charset=utf-8", INDEX_HTML);
}

static void handleNotFound() {
  if (server.method() == HTTP_OPTIONS) {
    cors();
    server.send(204);
    return;
  }
  // Captive portal: HP yang konek ke AP setup diarahkan ke halaman pengaturan.
  if (g_apActive && server.hostHeader() != WiFi.softAPIP().toString()) {
    server.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/", true);
    server.send(302, "text/plain", "");
    return;
  }
  sendError(404, "tidak ditemukan");
}

static void setupServer() {
  server.on("/", HTTP_GET, handleRoot);
  server.on("/api/state", HTTP_GET, handleState);
  server.on("/api/set", HTTP_POST, handleSet);
  server.on("/api/toggle", HTTP_POST, handleToggle);
  server.on("/api/timer", HTTP_POST, handleTimer);
  server.on("/api/away", HTTP_POST, handleAway);
  server.on("/api/config", HTTP_POST, handleConfig);
  server.on("/api/schedules", HTTP_GET, handleSchedulesGet);
  server.on("/api/schedules", HTTP_POST, handleSchedulesPost);
  server.on("/api/scan", HTTP_GET, handleScan);
  server.on("/api/wifi", HTTP_POST, handleWifi);
  server.on("/api/reset", HTTP_POST, handleFactoryReset);
  server.onNotFound(handleNotFound);
  updater.setup(&server, "/update", "admin", config::pin().c_str());
  server.begin();
}

// ---- Discovery UDP untuk aplikasi HP ----
static void udpLoop() {
  int size = udp.parsePacket();
  if (size <= 0) return;
  char buf[32];
  int n = udp.read(buf, sizeof(buf) - 1);
  buf[n > 0 ? n : 0] = 0;
  if (strncmp(buf, UDP_PROBE, strlen(UDP_PROBE)) != 0) return;
  JsonDocument doc;
  doc["id"] = config::deviceId();
  doc["name"] = cfg.name;
  doc["ip"] = WiFi.localIP().toString();
  doc["fw"] = FW_VERSION;
  doc["on"] = g_target > 0;
  String out;
  serializeJson(doc, out);
  udp.beginPacket(udp.remoteIP(), udp.remotePort());
  udp.write(out.c_str(), out.length());
  udp.endPacket();
}

// ---- Boot ----
void setup() {
  Serial.begin(115200);
  config::load();
  dimmer::begin(PIN_ZC, PIN_GATE);
  randomSeed(ESP.getChipId() ^ micros());

  // Hitung nyala-mati cepat lewat saklar tembok: 5x berturut-turut = reset WiFi.
  cfg.bootCount++;
  bool wifiReset = cfg.bootCount >= RESET_BOOT_COUNT;
  if (wifiReset) {
    cfg.ssid[0] = 0;
    cfg.pass[0] = 0;
    cfg.bootCount = 0;
  }
  config::save();

  delay(60);  // tunggu zero-cross terukur sebelum menembak TRIAC
  if (wifiReset) blinkConfirm();

  switch (cfg.powerOnMode) {
    case POWER_ON_FULL: setTarget(100, 0); break;
    case POWER_ON_OFF: g_target = 0; break;
    default:
      if (cfg.lastOn) setTarget(cfg.lastLevel ? cfg.lastLevel : 100, 0);
      break;
  }
  updateFade();

  startWifi();
  configTime("WIB-7", "id.pool.ntp.org", "pool.ntp.org", "time.google.com");
  MDNS.begin(hostName());
  MDNS.addService("http", "tcp", 80);
  MDNS.addService("leker-lampu", "tcp", 80);
  udp.begin(UDP_PORT);
  setupServer();
  Serial.printf("\nFitting Lampu %s id=%s pin=%s\n", FW_VERSION, config::deviceId().c_str(),
                config::pin().c_str());
}

void loop() {
  uint32_t ms = millis();
  if (!g_bootCountCleared && ms > BOOT_COUNT_CLEAR_MS) {
    g_bootCountCleared = true;
    cfg.bootCount = 0;
    config::save();
  }
  if (g_offTimerAt && (int32_t)(ms - g_offTimerAt) >= 0) turnOff(30000);
  updateFade();
  if (g_dirtyAt && ms - g_dirtyAt > SAVE_DELAY_MS) {
    g_dirtyAt = 0;
    config::save();
  }
  if (g_apActive) dns.processNextRequest();
  server.handleClient();
  MDNS.update();
  udpLoop();
  wifiLoop();
  scheduleLoop();
  delay(2);  // beri jatah modem-sleep; ISR TRIAC tetap jalan
}
