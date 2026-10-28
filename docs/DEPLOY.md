# 多用户版部署指南（自己电脑当服务器）

单文件版是「一个人的台账」；多用户版是「一个实验室共用一份台账」：大家用自己的账号登录，管理员负责开账号和查日志。

需要的东西只有一样：**一台常开的电脑 + Node.js 18 以上**。不用数据库、不用 Docker、不用云服务。

---

## 0. 五分钟跑起来

1. 装 Node.js（<https://nodejs.org> 下载 LTS，一路下一步）。
2. 把本仓库放到那台电脑上，例如 `D:\lab-mgmt`。
3. 双击 `start.bat`（或命令行 `node server/index.js`）。
4. 窗口里会打印类似这样的信息：

```
本机访问：   http://localhost:8787
局域网访问： http://192.168.1.23:8787   (WLAN)
首次启动，已创建管理员账号（请立即登录并改密码）：
   用户名：admin
   密  码：k7Qw2xR9
```

5. 浏览器打开 <http://localhost:8787>，用这个密码登录 → **立刻改密码**（右上角 🔑）。
6. 同一 WiFi 下的同事打开 `http://192.168.1.23:8787`（换成你窗口里那个地址）。

> 那个初始密码只显示一次。想自己指定，第一次启动前设置环境变量 `ADMIN_PASSWORD`：
> `set ADMIN_PASSWORD=你的密码 && node server/index.js`

**想让初始密码固定**（适合脚本部署）：

```bat
set ADMIN_PASSWORD=MyLab@2026
node server/index.js
```

---

## 1. 让同事能稳定连上

### 1.1 给这台电脑固定内网 IP

路由器后台 → DHCP 静态分配，把这台电脑的 MAC 绑到一个固定 IP（比如 `192.168.1.23`）。
否则路由器重启后 IP 变了，大家的书签就失效。

### 1.2 放行防火墙端口（Windows）

第一次启动时 Windows 可能弹窗询问，勾选「专用网络」允许即可。如果没弹或误点了取消，管理员 PowerShell 里执行：

```powershell
New-NetFirewallRule -DisplayName "LabMgmt 8787" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow -Profile Private
```

删掉这条规则：

```powershell
Remove-NetFirewallRule -DisplayName "LabMgmt 8787"
```

### 1.3 换端口

8787 被占用时：

```bat
node server/index.js --port 9000
```

### 1.4 开机自动启动（推荐）

「任务计划程序」→ 创建任务：

- **常规**：勾选「不管用户是否登录都要运行」→ 勾选「使用最高权限运行」不需要。
- **触发器**：启动时。
- **操作**：程序 `C:\Program Files\nodejs\node.exe`，参数 `server\index.js`，起始于 `D:\lab-mgmt`。
- **条件**：取消「只有在计算机使用交流电源时才启动」。
- **设置**：勾选「如果任务失败，每隔 1 分钟重新启动一次」。

想让它以「后台服务」的样子跑（不弹出黑窗口），把任务改成运行这个 VBS：

```vbscript
' D:\lab-mgmt\run-hidden.vbs
Set s = CreateObject("WScript.Shell")
s.CurrentDirectory = "D:\lab-mgmt"
s.Run """C:\Program Files\nodejs\node.exe"" server\index.js", 0, False
```

---

## 2. 不在实验室也能用（外网访问）

两条路，**都要求先在本地跑通**。

### 2.1 Tailscale（推荐：不把服务暴露到公网）

原理：给你和你的设备组成一个私有网络，只有登录了同一个 Tailscale 账号的设备能访问。

1. 服务器那台电脑装 <https://tailscale.com/download> → 登录。
2. 手机 / 家里的电脑也装 Tailscale → **登录同一个账号**。
3. 在服务器上查它的 Tailscale IP：`tailscale ip -4` → 例如 `100.101.102.103`。
4. 手机浏览器打开 `http://100.101.102.103:8787` 就能登录。

优点：不暴露公网、不用域名、免费额度够一个实验室用。
缺点：每台要访问的设备都得装 Tailscale（实验室内部的电脑不用装，走局域网 IP 即可）。

### 2.2 Cloudflare Tunnel（有域名时更顺手）

原理：`cloudflared` 在你电脑上开一条出站隧道，Cloudflare 那边给你一个 HTTPS 地址。**不需要在路由器上做端口映射**。

临时用（每次地址都会变，适合演示）：

```bat
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:8787
```

正式用：

```bat
cloudflared tunnel login
cloudflared tunnel create labmgmt
cloudflared tunnel route dns labmgmt lab.your-domain.com
cloudflared tunnel run --url http://localhost:8787 labmgmt
```

有域名后建议再加一层 **Cloudflare Access**（只允许指定邮箱登录），别把实验室数据挂在裸公网上。

> HTTPS 时服务会自动给 Cookie 加 `Secure` 标记；通过隧道访问时 `X-Forwarded-Proto: https` 由 Cloudflare 带上，不用额外配置。

### 2.3 安全底线（外网开放前务必确认）

- [ ] 管理员密码已经改掉，不是初始密码，不是 `12345678`，不和其他网站重复；
- [ ] 只给需要的人开账号，实习生 / 轮转学生给「只读」；
- [ ] 走 Tailscale 或 Cloudflare Access，不要直接做公网端口映射（8787 是明文 HTTP）；
- [ ] 定期看一眼「📋 操作日志」，异常登录失败会记在里面；
- [ ] `data/` 目录定期备份（见下一节）。

---

### 2.4 共享服务器：只开了 SSH 端口怎么办

学校 / 医院 / 机房的共享服务器通常**只对外开一个 SSH 端口**，其他端口一律进不来（拿 `Test-NetConnection 服务器 18447` 试一下，返回 `False` 就是这个情况）。不用求管理员开端口也能用，走 SSH 隧道：

```bash
# 1) 服务器上：克隆 + 一键安装（systemd 用户服务，不需要 sudo）
git clone https://github.com/Yu-Qiao-sjtu/lab-mgmt
cd lab-mgmt
bash deploy/install.sh                  # 默认 18447 端口，只监听 127.0.0.1
```

```bash
# 2) 每个人本机：建隧道（-L 本地端口:127.0.0.1:服务器端口）
ssh -N -L 18447:127.0.0.1:18447 用户名@服务器
# 然后浏览器打开 http://localhost:18447
```

嫌命令麻烦，就用现成的双击脚本：`deploy/tunnel/lab-mgmt-windows.bat`（Windows）/ `lab-mgmt-tunnel.sh`（macOS、Linux）——改开头 4 行服务器信息，双击即连并自动开浏览器。

要点：

- 隧道脚本默认用 **`~/.ssh/config` 里的别名**（端口、密钥、用户名都跟着配置走）。只写 `用户名@地址` 很容易漏掉 `-i 密钥`，变成 `Permission denied (publickey)` —— 实测踩过；
- 服务**只绑 127.0.0.1**，不对外多开一个口子，符合共享服务器的管理约定；
- SSH 断了网页就断，重新双击脚本即可，数据在服务器上不会丢；
- 退出登录后服务是否继续跑，取决于 `loginctl enable-linger 用户名`（`deploy/install.sh` 会自动尝试，失败会提示找管理员，或退回 `@reboot` crontab）；
- 端口冲突很常见（别人的 8787）：`PORT=18500 bash deploy/install.sh` 换一个，隧道两边端口号保持一致即可；
- 数据默认放在仓库**同级**目录 `lab-mgmt-data/`，`git pull` 升级不会碰它；
- 想升级：`cd lab-mgmt && git pull && systemctl --user restart lab-mgmt`。

之后如果管理员愿意开端口或做 nginx 反代，把这个服务从 `127.0.0.1` 改成局域网地址即可，账号权限那套东西完全不用改。

---

## 3. 账号与权限

| 角色 | 看数据 | 录入 / 编辑 / 删除 | 导入表格 | 改全局设置 | 管账号 | 操作日志 | 全库备份 / 恢复 |
|---|---|---|---|---|---|---|---|
| **管理员** admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **实验员** editor | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **只读** viewer | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

- 权限**由服务端强制校验**：前端隐藏按钮只是顺手，绕过界面直接发请求也会被 403 拒掉。
- 新建账号默认要求**首次登录改密码**；没改密码之前，连数据都读不到。
- 密码用 `scrypt` + 每用户随机盐存储，`data/users.json` 里没有明文。
- 同一个 IP + 用户名连续错 6 次，锁 5 分钟。
- 至少保留一个管理员：想删 / 降级最后一个管理员会被拦住。

管理员在 **👥 账号管理** 里可以：新建账号、改角色、停用（立即下线）、重置密码、删除。
**📋 操作日志** 里能看到：谁、什么时候、从哪个 IP、登录了还是改了哪几条数据（带 rev 号）。

---

## 4. 数据、备份与恢复

```
data/
  db.json                ← 全部业务数据 + 修订号（原子写入，不会写一半）
  backups/db-20261025.json ← 每天一份自动备份，保留 30 天
  users.json             ← 账号与密码哈希（不含业务数据）
  sessions.json          ← 登录会话（只有 token 的哈希）
  audit.jsonl            ← 操作日志，只追加
```

- **备份**：停服务后把整个 `data/` 目录拷走即可；最省事的是每周拷一份到网盘 / 移动硬盘。
- **恢复**：停服务 → 用备份里的 `db.json` 覆盖 `data/db.json` → 启动。
- 管理员的「💾 数据 · 设置」里还能下载 / 恢复 JSON 全量快照（走接口，管理员专用）。
- 想给整个实验室留一份可读的表格，就用 CSV 导出。

### 换电脑迁移

1. 老电脑停服务，拷走 `data/`；
2. 新电脑放好代码，把 `data/` 放回去；
3. 启动 → 大家的账号、密码、数据都在（会话也保留，不用重新登录）。

---

## 5. 常见问题

**忘了管理员密码？**

```bat
node server/index.js --reset-admin
```

会把管理员密码重置成随机密码并打印出来，下次登录要求改。极端情况：删掉 `data/users.json` 重启，会重建一个 `admin`（数据不动，但所有账号要重开）。

**同事打不开页面？**

按顺序查：① 服务窗口是不是还开着；② 是不是同一个 WiFi / 网段；③ 防火墙规则；④ 用 `http://IP:8787/health` 看有没有返回 JSON。

**能不能还用单文件版？**

能。多用户版和单文件版是同一个 `index.html`：双击打开（`file://`）就是原来的离线版，数据在本机浏览器；从服务器地址打开就要求登录、数据在服务器。两者数据**互相独立**，不会串。

**两个人同时改同一条记录会怎样？**

后保存的生效（同一条记录不会各留半条），记录上会盖「最后修改人 / 时间」，操作日志里能查到是谁改的。改不同记录互不影响。

**服务关了数据会丢吗？**

不会，数据在磁盘上。关掉服务只是没人能访问。

**要装数据库吗？**

不用。数据量到几万条都没问题；真到那个量级再看换成 SQLite / PostgreSQL。

**升级怎么办？**

```bat
git pull
node build.js
```

然后重启服务。`data/` 不会被碰；如果结构升级（`DATA_V` 变大），前端会自动补默认值。

---

## 6. 命令行参数与环境变量

| 项 | 说明 |
|---|---|
| `--port 8787` | 换端口（也可用环境变量 `PORT`） |
| `HOST=0.0.0.0` | 监听地址，默认所有网卡 |
| `DATA_DIR=./data` | 数据目录，可指到 D 盘 / 移动硬盘 |
| `ADMIN_PASSWORD=...` | 首次启动时的管理员初始密码 |
| `--reset-admin` | 重置管理员密码并退出 |

---

## 7. 自测（改完代码或部署前建议跑一遍）

```bash
node tools/server-smoke.mjs   # 服务端 68 项：权限、并发、审计、重启后数据仍在
node tools/server-ui.mjs      # 浏览器端到端：登录 → 录入 → 建账号 → 只读拦截（需 Edge）
node tools/smoke.mjs          # 单文件离线版 27 项
```
