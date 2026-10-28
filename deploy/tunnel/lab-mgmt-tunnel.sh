#!/usr/bin/env bash
# 实验室管理台 · 一键访问（macOS / Linux）
#   bash deploy/tunnel/lab-mgmt-tunnel.sh
#
# SSH_TARGET 填 ~/.ssh/config 里的别名（推荐，端口与密钥都跟着走），
# 或者填 用户名@服务器地址，再用 SSH_EXTRA 补端口/密钥。
SSH_TARGET="${SSH_TARGET:-your.server.alias}"
SSH_EXTRA="${SSH_EXTRA:-}"
APP_PORT="${APP_PORT:-18447}"

echo "正在建立隧道 → http://localhost:$APP_PORT/ （Ctrl+C 断开）"
# shellcheck disable=SC2086
ssh -N $SSH_EXTRA -L "$APP_PORT:127.0.0.1:$APP_PORT" "$SSH_TARGET" &
TUNNEL_PID=$!
trap 'kill $TUNNEL_PID 2>/dev/null' EXIT

for _ in $(seq 1 20); do
  if (echo >/dev/tcp/127.0.0.1/"$APP_PORT") >/dev/null 2>&1; then break; fi
  sleep 0.5
done

if ! (echo >/dev/tcp/127.0.0.1/"$APP_PORT") >/dev/null 2>&1; then
  echo "隧道没建立起来：确认 SSH_TARGET 正确、密钥可用（先试 ssh $SSH_TARGET 能否登录）" >&2
  exit 1
fi

URL="http://localhost:$APP_PORT/"
echo "已就绪：$URL"
if command -v open >/dev/null 2>&1; then open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
fi

wait $TUNNEL_PID
