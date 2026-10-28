#!/usr/bin/env bash
# 实验室管理台 · 一键访问（macOS / Linux）
#   bash deploy/tunnel/lab-mgmt-tunnel.sh
# 第一次用先改下面 4 个变量（或直接用环境变量覆盖）：
SSH_HOST="${SSH_HOST:-your.server.com}"
SSH_PORT="${SSH_PORT:-22}"
SSH_USER="${SSH_USER:-yourname}"
APP_PORT="${APP_PORT:-18447}"

echo "正在建立隧道 → http://localhost:$APP_PORT/ （Ctrl+C 断开）"
ssh -N -p "$SSH_PORT" -L "$APP_PORT:127.0.0.1:$APP_PORT" "$SSH_USER@$SSH_HOST" &
TUNNEL_PID=$!
trap 'kill $TUNNEL_PID 2>/dev/null' EXIT

for i in $(seq 1 20); do
  if (echo >/dev/tcp/127.0.0.1/"$APP_PORT") >/dev/null 2>&1; then break; fi
  sleep 0.5
done

URL="http://localhost:$APP_PORT/"
echo "已就绪：$URL"
if command -v open >/dev/null 2>&1; then open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
fi

wait $TUNNEL_PID
