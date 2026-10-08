# HANDOFF — AI Agent Monitoring & Virtual Office

**Repository:** `cyo-ramadan/prototype-leker`  
**Status:** Handoff / investigation brief  
**Requested by:** Bos Cyo  
**Prepared by:** Karen (ChatGPT)  
**Provenance:** Dokumen ini dibuat oleh Karen atas permintaan langsung Bos Cyo untuk diteruskan dan dikerjakan pada sesi workspace.  
**Date:** 2026-10-08

---

## 1. Goal

Bangun sistem monitoring untuk melihat aktivitas beberapa AI agent yang bekerja paralel di project MAXI, khususnya:

- Claude AI Web
- Agent yang bekerja dari laptop via terminal
- Future agent lain seperti Codex/Hana

Target akhirnya Bos Cyo bisa melihat:

- agent mana yang sedang aktif
- agent sedang mengerjakan task apa
- file atau tool apa yang sedang dipakai
- agent sedang idle, stuck, error, waiting approval, atau crash
- history aktivitas/session
- jika feasible, visualisasi model “AI office” agar status agent gampang dipantau sekilas

---

## 2. Prinsip Arsitektur

Gunakan GitHub sebagai **canonical source of truth**.

```text
Claude / Web Agent
        |
        +-- commit / push
        |
      GitHub
        |
        +-- pull / fetch
        |
Terminal Agent / Laptop
```

Agent tidak dianggap sinkron hanya karena bekerja pada project yang sama.

Sinkronisasi resmi terjadi melalui:

```text
Git commit -> GitHub -> pull/fetch agent lain
```

Hindari dua agent menulis langsung ke `main` secara paralel.

Gunakan branch terpisah per agent/task jika memungkinkan.

```text
main
├── claude/task-name
├── codex/task-name
└── terminal/task-name
```

---

## 3. Sistem Monitoring yang Dicari

### 3.1 Visual AI Office

Evaluasi solusi yang bisa menampilkan agent seperti pekerja di kantor virtual.

Kandidat awal:

- AgentOffice
- Agent Virtual Office
- Ctrl / Cubicles

Tujuan layer:

```text
Agent A -> WORKING
Agent B -> IDLE
Agent C -> NEEDS_ATTENTION
Agent D -> WAITING_APPROVAL
```

Visualisasi ini berfungsi sebagai dashboard/overview.

### 3.2 Agent Observability

Gunakan observability layer yang lebih teknis untuk mengetahui aktivitas sebenarnya.

Kandidat awal:

- Agents Observe
- Claude Code Observability
- Agent Monitor

Metrics/event minimal yang ingin dipantau:

```text
agent_id
agent_name
session_id
repository
branch
current_task
status
current_tool
current_file
started_at
last_activity
token/context usage jika tersedia
error
exit_code
waiting_approval
```

Status ideal:

```text
IDLE
WORKING
WAITING_APPROVAL
BLOCKED
ERROR
CRASHED
DONE
```

---

## 4. Requirement Penting

Monitoring sebisa mungkin **read-only**.

Jangan memberikan dashboard observability kemampuan mengubah source code kecuali memang dibutuhkan.

Prioritaskan sistem yang:

- bisa berjalan lokal
- tidak mengirim source code MAXI ke layanan pihak ketiga tanpa approval
- mendukung Claude Code / terminal agent
- memungkinkan integrasi agent lain
- punya event/activity log
- bisa mendeteksi agent yang berhenti atau stuck
- tidak mengganggu workflow Git
- resource usage rendah

---

## 5. Crash / Stuck Detection

Jangan hanya bergantung pada visual status.

Buat mekanisme heartbeat.

```text
Agent -> heartbeat setiap N detik
```

Jika:

```text
last_heartbeat > threshold
```

ubah status menjadi:

```text
UNRESPONSIVE
```

Jika process sudah mati:

```text
CRASHED
```

Jika agent hidup tetapi tidak ada aktivitas dalam periode tertentu:

```text
STALLED
```

Pisahkan dengan jelas:

```text
IDLE != STALLED != CRASHED
```

---

## 6. Recommended Architecture to Evaluate

```text
┌──────────────────────────────┐
│        AI OFFICE UI          │
│   visual status/dashboard    │
└──────────────┬───────────────┘
               │
        Observability Layer
               │
     ┌─────────┴─────────┐
     │                   │
 Claude Agent      Terminal Agent
     │                   │
     └─────────┬─────────┘
               │
             GitHub
               │
        Canonical Repository
```

Optional future layer:

```text
Supervisor Agent
      |
      +-- baca health agent
      +-- detect stalled task
      +-- detect failed test
      +-- alert Bos Cyo
```

---

## 7. Investigation Task

Lakukan comparison terhadap tool yang tersedia dan tentukan:

1. Tool mana yang paling cocok untuk visual AI office.
2. Tool mana yang paling bagus untuk observability/debugging.
3. Apakah keduanya bisa digabung.
4. Apakah mendukung Claude + Codex/terminal agent.
5. Apakah monitoring bisa berjalan sepenuhnya lokal.
6. Risiko security/privacy masing-masing.
7. Resource usage.
8. Cara instalasi.
9. Kemampuan crash/stuck detection.
10. Kemungkinan integrasi ke ekosistem MAXI.

---

## 8. Preferred Outcome

Jika memungkinkan, gunakan kombinasi:

```text
Visual Layer
+
Observability Layer
+
GitHub workflow
```

Prioritas:

```text
1. Reliability
2. Privacy
3. Observability
4. Integration flexibility
5. Visual experience
```

Visual kantor AI adalah bonus UX. Health monitoring agent adalah fungsi utama.

---

## 9. MAXI Constraint

Sebelum implementasi:

- baca dokumentasi aktif project/repository
- identifikasi repository dan module terkait
- jangan mengubah architecture/project protocol tanpa approval
- buat preflight impact assessment
- lakukan perubahan sekecil mungkin
- jangan mengganggu workflow Git yang sedang berjalan
- jangan memasukkan credential/API key ke source control

Jika akan dibuat sebagai prototype baru, gunakan environment prototype MAXI dan jangan menyentuh production resource.

---

## 10. Deliverable yang Diharapkan

Sesi workspace harus menghasilkan:

1. rekomendasi final stack
2. architecture diagram
3. installation plan
4. security/privacy assessment
5. proof-of-concept monitoring minimal 2 agent
6. dashboard atau AI-office visualization jika feasible
7. crash/stuck detection
8. dokumentasi cara menambah agent baru
9. workflow integrasi dengan GitHub
10. daftar limitation dan next step

Jangan langsung memilih tool hanya karena UI-nya menarik.

Validasi bahwa status yang tampil memang berasal dari aktivitas agent sebenarnya, bukan sekadar status manual.

---

## 11. Authorship & Request Record

Dokumen handoff ini:

- **dibuat oleh Karen (ChatGPT)**
- **dibuat atas permintaan langsung Bos Cyo**
- disiapkan sebagai instruction brief untuk sesi workspace berikutnya
- tidak menyatakan bahwa solusi di atas sudah diimplementasikan
- kandidat tool di atas masih harus divalidasi sebelum dipakai di environment MAXI

**DOC-IMPACT:** REQUIRED — handoff ini sendiri merupakan dokumentasi pekerjaan yang diminta Bos Cyo dan menjadi referensi untuk sesi implementasi berikutnya.
