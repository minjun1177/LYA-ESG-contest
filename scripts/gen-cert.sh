#!/usr/bin/env bash
# 자체 서명 인증서 생성 — 휴대폰 브라우저 GPS(Geolocation)는 HTTPS에서만 동작하므로
# 도메인 없이 IP로 접속할 때 사용한다. (브라우저에 '안전하지 않음' 경고가 뜨며, 한 번 허용하면 됨)
#
# 사용법: bash scripts/gen-cert.sh [공인IP 또는 도메인]
set -euo pipefail

cd "$(dirname "$0")/.."
HOST="${1:-localhost}"
OUT_DIR="certs"
mkdir -p "$OUT_DIR"

if [[ "$HOST" =~ ^[0-9.]+$ ]]; then
  SAN="IP:${HOST},DNS:localhost,IP:127.0.0.1"
else
  SAN="DNS:${HOST},DNS:localhost,IP:127.0.0.1"
fi

# 1. 개인키 + 인증서(825일) 생성
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
  -keyout "$OUT_DIR/key.pem" -out "$OUT_DIR/cert.pem" \
  -subj "/CN=${HOST}" -addext "subjectAltName=${SAN}"

chmod 600 "$OUT_DIR/key.pem"
echo "created $OUT_DIR/cert.pem and $OUT_DIR/key.pem for ${HOST}"
echo "add to .env:  TLS_CERT=$OUT_DIR/cert.pem  TLS_KEY=$OUT_DIR/key.pem  TUNNEL_MODE=tcp"
