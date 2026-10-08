#!/usr/bin/env bash
# Jalankan Mesin Agen (Mac/Linux): router model + OpenCode, dari folder repo.
#   bash mesin-agen/mulai.sh            -> layar kerja interaktif
#   bash mesin-agen/mulai.sh run "..."  -> satu perintah lalu selesai
set -euo pipefail

LITELLM_VERSI=1.104.2
OPENCODE_VERSI=1.18.35

MESIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$MESIN_DIR")"
RUMAH="${HOME}/.maxi-mesin"
mkdir -p "$RUMAH"

if [[ ! -f "$MESIN_DIR/.env" ]]; then
  echo "Belum ada mesin-agen/.env. Salin dulu: cp mesin-agen/.env.example mesin-agen/.env, lalu isi kuncinya."
  exit 1
fi
set -a; source "$MESIN_DIR/.env"; set +a
if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "OPENROUTER_API_KEY di mesin-agen/.env masih kosong."
  exit 1
fi
if [[ -z "${MAXI_AGENT_BUS_TOKEN:-}" ]]; then
  echo "Catatan: MAXI_AGENT_BUS_TOKEN kosong -- mesin jalan tanpa papan tugas agen."
fi

# Router (LiteLLM) di lingkungan Python sendiri supaya tidak mengganggu yang lain.
if [[ ! -x "$RUMAH/venv/bin/litellm" ]]; then
  echo "Memasang router (sekali saja)..."
  python3 -m venv "$RUMAH/venv"
  "$RUMAH/venv/bin/pip" install --quiet "litellm[proxy]==${LITELLM_VERSI}"
fi

export MESIN_ROUTER_PORT="${MESIN_ROUTER_PORT:-4000}"
# Kunci lokal mesin<->router, baru setiap kali jalan; tidak disimpan di mana pun.
export LITELLM_MASTER_KEY="sk-lokal-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"

"$RUMAH/venv/bin/litellm" --config "${MESIN_ROUTER_CONFIG:-$MESIN_DIR/router.yaml}" --host 127.0.0.1 --port "$MESIN_ROUTER_PORT" \
  > "$RUMAH/router.log" 2>&1 &
ROUTER_PID=$!
trap 'kill $ROUTER_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -s -m 2 "http://127.0.0.1:${MESIN_ROUTER_PORT}/health/liveliness" > /dev/null; then break; fi
  if ! kill -0 "$ROUTER_PID" 2>/dev/null; then
    echo "Router gagal menyala. Lihat $RUMAH/router.log"; exit 1
  fi
  sleep 1
done

export OPENCODE_CONFIG="$MESIN_DIR/opencode/opencode.json"
export OPENCODE_CONFIG_DIR="$MESIN_DIR/opencode"
cd "$REPO_DIR"
if command -v opencode > /dev/null; then
  opencode "$@"
else
  npx --yes "opencode-ai@${OPENCODE_VERSI}" "$@"
fi
