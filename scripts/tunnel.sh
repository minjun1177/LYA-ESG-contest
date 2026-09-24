#!/usr/bin/env bash
# minitunnel 클라이언트로 로컬 앱을 공인 서버에 공개 (Cloudflare Tunnel 대체)
#
# .env 에서 읽는 값
#   TUNNEL_SERVER       minitunnel 서버 주소 host:port        (필수)
#   TUNNEL_TOKEN        서버 토큰                              (필수)
#   TUNNEL_REMOTE_PORT  서버에서 열 공개 포트                  (기본 8000)
#   TUNNEL_MODE         http = 평문 HTTP, 방문자 IP 헤더 전달 (기본)
#                       tcp  = HTTPS 앱(TLS_CERT 사용)을 그대로 전달 — GPS 사용 가능
#   TUNNEL_BIN          minitunnel 실행 파일                   (기본 ./minitunnel)
#   PORT                로컬 앱 포트                           (기본 3000)
#
# 토큰이 프로세스 목록에 노출되지 않도록 명령줄 대신 설정 파일(.tunnel/client.toml, 권한 600)을 쓴다.
set -euo pipefail

cd "$(dirname "$0")/.."

env_get() {
  # .env 에서 KEY=VALUE 를 읽는다 (따옴표 제거). 쉘 환경변수가 있으면 그것이 우선.
  local key="$1" default="${2:-}" value
  value="${!key:-}"
  if [[ -z "$value" && -f .env ]]; then
    value="$(grep -E "^[[:space:]]*${key}=" .env | tail -n 1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")" || true
  fi
  printf '%s' "${value:-$default}"
}

SERVER="$(env_get TUNNEL_SERVER)"
TOKEN="$(env_get TUNNEL_TOKEN)"
REMOTE_PORT="$(env_get TUNNEL_REMOTE_PORT 8000)"
MODE="$(env_get TUNNEL_MODE http)"
BIN="$(env_get TUNNEL_BIN ./minitunnel)"
LOCAL_PORT="$(env_get PORT 3000)"

if [[ -z "$SERVER" || -z "$TOKEN" ]]; then
  echo "error: set TUNNEL_SERVER and TUNNEL_TOKEN in .env (see .env.example)" >&2
  exit 1
fi
if [[ ! -x "$BIN" ]]; then
  echo "error: minitunnel binary not found or not executable: $BIN" >&2
  exit 1
fi
case "$MODE" in
  http) PROTO="http" ;;
  tcp) PROTO="tcp" ;;
  *) echo "error: TUNNEL_MODE must be http or tcp (got '$MODE')" >&2; exit 1 ;;
esac

toml_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

mkdir -p .tunnel
umask 077
cat > .tunnel/client.toml <<EOF
[client]
server = "$(toml_escape "$SERVER")"
token = "$(toml_escape "$TOKEN")"

[[client.tunnel]]
remote = ${REMOTE_PORT}
local = "127.0.0.1:${LOCAL_PORT}"
proto = "${PROTO}"
EOF

HOST="${SERVER%:*}"
SCHEME="http"
[[ "$MODE" == "tcp" ]] && SCHEME="https"
echo "tunnel: ${SCHEME}://${HOST}:${REMOTE_PORT}  ->  127.0.0.1:${LOCAL_PORT} (${PROTO})"
exec "$BIN" client --config .tunnel/client.toml
