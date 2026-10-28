#!/usr/bin/env bash
# 实验室管理台 · Linux 一键安装（systemd 用户级服务，无需 sudo）
#
#   bash deploy/install.sh                 # 默认端口 18447，只监听 127.0.0.1
#   PORT=18500 bash deploy/install.sh      # 换端口
#   DATA_DIR=/data/lab bash deploy/install.sh
#
# 依赖：node >= 18
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DATA_DIR="${DATA_DIR:-$(dirname "$APP_DIR")/lab-mgmt-data}"
PORT="${PORT:-18447}"
UNIT_NAME="${UNIT_NAME:-lab-mgmt}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
UNIT_DIR="$HOME/.config/systemd/user"

say() { printf '%s\n' "$*"; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }

# ---------- 前置检查 ----------
[ -n "$NODE_BIN" ] || die "找不到 node，请先安装 Node.js 18+（或用 NODE_BIN=/path/to/node 指定）"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 版本过低（当前 $("$NODE_BIN" -v)），需要 >= 18"

[ -f "$APP_DIR/server/index.js" ] || die "在 $APP_DIR 没找到 server/index.js，请在仓库根目录运行"
[ -f "$APP_DIR/index.html" ] || die "缺少 index.html，请先运行 node build.js"

command -v systemctl >/dev/null || die "这台机器没有 systemd，请改用 nohup / supervisor / docker 方式启动"

if ss -lnt 2>/dev/null | grep -q ":$PORT "; then
  die "端口 $PORT 已被占用，请换一个：PORT=18500 bash deploy/install.sh"
fi

# ---------- 安装 ----------
mkdir -p "$DATA_DIR" "$UNIT_DIR"
chmod 700 "$DATA_DIR"

sed -e "s#__APP_DIR__#$APP_DIR#g" \
    -e "s#__DATA_DIR__#$DATA_DIR#g" \
    -e "s#__NODE_BIN__#$NODE_BIN#g" \
    -e "s#__PORT__#$PORT#g" \
    "$APP_DIR/deploy/systemd/lab-mgmt.service.example" > "$UNIT_DIR/$UNIT_NAME.service"

systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME"
sleep 2

# ---------- 保活：退出登录后不停止 ----------
if ! loginctl show-user "$USER" 2>/dev/null | grep -q 'Linger=yes'; then
  if loginctl enable-linger "$USER" 2>/dev/null; then
    say "已开启 linger：退出 SSH 后服务继续运行"
  else
    say "⚠ 无法开启 linger（需要管理员权限）：退出 SSH 后服务可能停止"
    say "  让管理员执行：loginctl enable-linger $USER"
    say "  临时替代：crontab 里加一行 @reboot 启动（见 docs/DEPLOY.md）"
  fi
fi

# ---------- 结果 ----------
say ""
say "==================================================="
say " 安装完成"
say "  应用目录：$APP_DIR"
say "  数据目录：$DATA_DIR"
say "  监听地址：127.0.0.1:$PORT（仅本机，外网需隧道/反代）"
say "==================================================="
say ""
say " 本机自检：curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:$PORT/"
say " 首次启动密码（如果只显示过一次就看不到了）："
say "     journalctl --user -u $UNIT_NAME -n 50 --no-pager | grep -A2 '首次启动'"
say " 忘了密码：cd $APP_DIR && DATA_DIR=$DATA_DIR node server/index.js --reset-admin"
say " 服务状态：systemctl --user status $UNIT_NAME"
say " 重启：    systemctl --user restart $UNIT_NAME"
say ""
say " 客户端访问（先建隧道）："
say "     ssh -N -L $PORT:127.0.0.1:$PORT <用户名>@<服务器>   然后打开 http://localhost:$PORT"
say ""
