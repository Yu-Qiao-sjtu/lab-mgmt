# 🐭 实验室管理台（Lab Mgmt）

**小鼠 · 繁育 · 试剂 · 耗材 · 出入库 · 成本 —— 一个 HTML 文件搞定的实验室台账**

零安装、零依赖、不联网、不上传。把这个 `index.html` 拷到任何电脑，双击用 Edge / Chrome 打开就能用，数据存在本机浏览器里。

[![License: MIT](https://img.shields.io/badge/license-MIT-0d9488.svg)](LICENSE)
[![单文件](https://img.shields.io/badge/build-single--file%20HTML-0d9488.svg)](index.html)
[![依赖](https://img.shields.io/badge/dependencies-0-15803d.svg)](package.json)
[![CI](https://github.com/Yu-Qiao-sjtu/lab-mgmt/actions/workflows/ci.yml/badge.svg)](https://github.com/Yu-Qiao-sjtu/lab-mgmt/actions/workflows/ci.yml)

> 在线试用（示例数据，不保存）：<https://yu-qiao-sjtu.github.io/lab-mgmt/?demo=1>

![概览](docs/screenshot-dashboard.png)

## 为什么做这个

湿实验的日常台账散在 Excel 里：小鼠周龄靠手算、试剂过期靠想起来、耗材用完才发现没存货、笼牌手写。
这个工具把它们收进一个文件里：打开就能录，关上自动存，随时能打印和导出，还能整包备份搬走。
没有服务器、没有账号、没有安装包——不会因为实验室断网、IT 不给装软件、或者换台电脑就没法干活。

## 功能

| 模块 | 内容 |
|---|---|
| 🐭 **小鼠统计** | 品系、性别、周龄（填出生日期自动算并实时增长）、**笼数**、**只数/笼**、自动算总只数、**实验目的**、项目、耳号/笼号、房间架位、负责人、在养 / 已结束 |
| 🐣 **繁育台账** | 配对编号、合笼 / 孕检 / 出生 / 断奶日期、窝仔数、分笼笼数×只数；按「合笼 + 妊娠天数」「出生 + 断奶天数」自动算预产 / 断奶倒计时，一键「转小鼠记录」 |
| 🧪 **试剂** | 名称、货号、品牌、规格、类别、库存、单位、库存下限、单价、位置、开封日期、有效期、供应商 |
| 🧴 **耗材** | 名称、规格、库存、单位、安全库存、单价、位置、供应商 |
| 📥 **出入库流水** | 每次入库 / 出库留痕（日期、数量、单价、金额、项目、操作人、备注），自动加减库存；**超量出库会被拦住**；可按项目统计成本 |
| 📈 **消耗预测** | 按近 N 天出库量算「日均消耗 / 可用天数 / 预计用完日期」，自动生成**补货建议清单**（含建议补货量），可导出 CSV 去询价 |
| 🔔 **提醒** | 试剂已过期 / 临期 / 低于下限、耗材低于安全库存、库存即将用完、繁育超预产期 / 该断奶了 |
| 🖨 **笼牌打印** | 当前筛选结果一键打 A4 笼牌（4 / 6 / 9 张一页三档版式），品系、周龄、笼数、只数、实验目的、负责人、日期 |
| 📊 **概览图示** | 品系只数分布、近 30 天出入库趋势、繁育近期节点、最近流水 |
| 💾 **数据安全** | 每次改动自动保存 + 每天一份自动快照（可回滚到某天）、Ctrl+Z 撤销、JSON 全量备份 / 恢复、CSV 导出（UTF-8 BOM，Excel / WPS 不乱码）、从 Excel / CSV 粘贴导入（表头自动识别、自动去重） |
| 🌓 **深色模式** | 浅色 / 深色 / 跟随系统，点右上角切换，选择跟着备份一起走 |

计算规则：**总只数 = 笼数 × 只数/笼**；周龄按「今天」实时换算；日均消耗 = 统计窗口内出库量 ÷ 窗口天数。

<table>
<tr>
<td><img src="docs/screenshot-mice.png" alt="小鼠统计"></td>
<td><img src="docs/screenshot-reagents.png" alt="试剂库存"></td>
</tr>
<tr>
<td><img src="docs/screenshot-logs.png" alt="出入库流水"></td>
<td><img src="docs/screenshot-dark.png" alt="深色模式"></td>
</tr>
</table>

## 快速开始

**方式一：本地文件（推荐，数据完全在你自己机器上）**

1. 下载 [`index.html`](https://github.com/Yu-Qiao-sjtu/lab-mgmt/releases/latest/download/index.html)（或本仓库里的 `index.html`）；
2. 双击，用 Edge / Chrome 打开；
3. 首次进入点「载入示例数据」看一眼，然后「清空全部数据」开始录自己的；也可以直接从 Excel 粘贴导入。

**方式二：建个桌面快捷方式** —— 右键 `index.html` → 发送到 → 桌面快捷方式。

**方式三：在线用** —— 打开 <https://yu-qiao-sjtu.github.io/lab-mgmt/>。注意：在线版的数据存在**那个网址**的浏览器存储里，和本地文件不互通，只用来看效果或临时用。

常用键盘操作：`Ctrl+Z` 撤销上一步、`Ctrl+K` 跳到搜索框、`Ctrl+Enter` 保存弹窗表单、`Esc` 关闭弹窗。

## 数据在哪、怎么带走

- 数据存在**当前浏览器**的 `localStorage`，键名 `labmgmt.v1`（老版本键名不变，永远能直接打开）。
- 换电脑 / 换浏览器 / 清浏览器缓存 / 无痕窗口 → 数据**不会**跟过去。所以每个星期到「💾 数据 · 设置 → 下载 JSON 备份」存一份到网盘。
- 换机器：把 `index.html` 和新备份一起拷过去 → 打开 → 「从 JSON 恢复」。
- 多人共用：**不要**把同一个文件放共享盘各自打开（会变成互不同步的多份数据）。需要多人共用请用局域网小服务器版（见 Roadmap）。
- 手机 / 平板可以打开，但和电脑不互通，靠 JSON 备份搬运。

## 仓库结构

```
index.html          ← 构建产物：单文件应用（可直接分发 / 直接用）
src/head.html       ← <head> + 全部 CSS
src/body.html       ← DOM 骨架
src/s1.js … s6.js   ← 应用逻辑（工具/数据层 → 计算 → 视图 → 表单 → 打印 → 导入导出/启动）
build.js            ← 把 src/ 拼成 index.html，并做语法 / 标签 / 离线自检
tools/smoke.mjs     ← 端到端自测（无头 Edge 实跑 + 截图）
docs/               ← README 用截图
```

为什么还留一个「一个文件」？因为分发和离线是硬需求：实验室电脑不能装东西、U 盘拷来拷去。
源码拆成 `src/` 只是为了好维护，`index.html` 始终是唯一产物。

## 开发

```bash
git clone https://github.com/Yu-Qiao-sjtu/lab-mgmt.git
cd lab-mgmt

# 改 src/ 下的文件，然后
node build.js          # 生成 index.html（自带语法 / 标签配对 / 离线检查）
node build.js --check  # 只校验 index.html 是否与 src/ 同步（CI 用这个）

# 端到端自测（需要本机 Edge 或 Chrome；会顺带刷新 docs/ 截图）
npm install
npm run smoke
```

改代码时注意：

- `index.html` 是**生成物**，不要手改；改 `src/` 再 `node build.js`，两个一起提交。
- 老用户数据必须永远能打开：`KEY` 不变，结构变更走 `migrate()` 补默认值（`DATA_V` 递增）。
- 单文件版不许引用外部资源（`build.js` 会拦住 `<script src="http…">` 这类写法）。
- 数据以 `localStorage` 单键 JSON 存，改动要经过 `normalizeRecord()` 修剪。

## Roadmap

- [ ] 多人共用版：局域网小服务器 + SQLite + 简单登录（浏览器访问同一份数据）
- [ ] 繁育谱系图 / 近交系数
- [ ] 条码 / 二维码笼牌（扫码定位笼位）
- [ ] 试剂按项目扣减预算、月度消耗报表
- [ ] 数据表自定义字段（不同课题组字段不同）

有需求或 bug 请开 [Issue](https://github.com/Yu-Qiao-sjtu/lab-mgmt/issues)，也欢迎 PR。

## English

A **single-file, offline, dependency-free lab ledger** for wet-lab work: mouse colony (strain / age in weeks / cages / mice per cage / purpose), breeding records with gestation & weaning countdown, reagent and consumable inventory with stock in/out logs, cost per project, consumption forecast with reorder suggestions, printing cage cards, CSV export and JSON backup.

Open `index.html` in any modern browser — no install, no server, no network. Data lives in your browser's `localStorage` (key `labmgmt.v1`), so export a JSON backup regularly. MIT licensed.

Live demo (sample data, nothing saved): <https://yu-qiao-sjtu.github.io/lab-mgmt/?demo=1>

## License

[MIT](LICENSE) © 2026 Yu-Qiao-sjtu
