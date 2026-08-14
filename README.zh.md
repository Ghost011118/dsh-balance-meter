# dsh-balance-meter

[English](README.md) | 中文

DeepSeek Harness (DSH) Web 界面的账户余额与本场会话花费读数插件。

- 实时账户余额（查询官方 Get User Balance 接口）
- 当前会话估算花费（token 用量 × 官方单价）
- 按模型计价：从每个会话的请求头读取实际使用的模型（flash / pro），让花费跟随你真正用的模型，而非固定默认
- 每 6 小时自动抓取官方价格页，价格变动与 2026-08-17 峰谷定价上线后均无需更新插件
- 峰谷时段（北京时间 09:00-12:00 / 14:00-18:00）自动按高峰/空闲计价（峰谷定价生效后）

## 功能

输入框下方状态条会显示一个 chip，包含账户总余额与当前会话的估算花费：

```
余额 CNY 4.16 · 本场 CNY 2.57
```

点击 chip 展开：余额按币种明细（赠送 + 充值）、花费按分桶明细（输入 / 缓存读 / 输出）。出错时点击 chip 会立即强制刷新。

## 环境要求

- DeepSeek Harness `0.1.0-rc.6` 或更新版本（web profile）
- 通过 DSH 凭据通道存储的 DeepSeek API Key（`DEEPSEEK_API_KEY`——在 Web 的 Models 页面填写即可）

## 安装

从 git URL 安装（无需 npm 账号）：

```sh
dsh plugin --profile web add https://github.com/Ghost011118/dsh-balance-meter
```

或从本地检出安装：

```sh
git clone https://github.com/Ghost011118/dsh-balance-meter.git
dsh plugin --profile web add link:$(pwd)/dsh-balance-meter
```

安装后重启 `dsh web` 并刷新页面，余额 chip 会出现在输入框下方、与官方会话统计行同一排。

## 配置

插件默认零配置（使用 `DEEPSEEK_API_KEY` 与官方价格页）。可选组合配置：

```yaml
- insert:
    - id: balance
      name: 'dsh-balance-meter'
      config:
        model: auto         # 'auto'（默认）| 'flash' | 'pro'
        pricingRefreshHours: 6
```

| 键 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `model` | `'auto' \| 'flash' \| 'pro'` | `auto` | `auto` 从会话请求头自动识别模型（flash/pro）；`flash`/`pro` 强制指定该预设、忽略自动识别 |
| `pricingRefreshHours` | `number` | `6` | 自动刷新官方价格页的间隔（小时） |
| `apiKeyEnv` | `string` | `DEEPSEEK_API_KEY` | 存储 DeepSeek API Key 的凭据引用 |
| `baseUrl` | `string` | `https://api.deepseek.com` | API 基础地址（网关/兼容接口时覆盖） |
| `refreshIntervalSeconds` | `number` | `30` | 两次余额查询的最小间隔（秒） |

## 花费如何估算

插件读取 DSH 持久化的 `tokenUsage` 投影（与内置统计行同一套记账），把四个分桶——未命中输入、缓存读、缓存写、输出——按官方价格页解析出的单价换算为金额。DeepSeek 不对缓存写单独计费，默认按 0。

价格集在 `auto`（默认）模式下按真正驱动该会话的模型选取：每个会话的请求头都会记录最近一次请求的 provider/model，插件将该 id（`deepseek-v4-flash` → flash、`deepseek-v4-pro` → pro）映射到对应的每百万 tokens 单价。因此会话按产生其用量所用的模型计价，而非写死的 flash。当尚无请求头或模型 id 无法识别时，`auto` 回退到 flash。显式设置 `model: flash` 或 `model: pro` 会**强制**采用该预设、忽略自动识别，方便你想锁定某个模型计价时使用。

2026-08-17 峰谷定价上线前使用当前单价；上线后按当前北京时段的峰/闲价格计费。若官方价格页抓取失败，回退到内置预设（flash：0.02 / 1 / 2 元每百万 tokens）。组合配置中显式的 `cost.*` 覆盖优先于任何预设。花费 JSON 同时返回 `pricingKey` 与 `model`，便于 chip 展示按哪个模型计价。

## 疑难排查

### “no API key for provider route \`deepseek-official\`”

宿主从 DSH 凭据存储读取你的 Key——即 `<harness home>/.credentials.yaml`（默认 `~/.dsh/.credentials.yaml`），也就是 Web 的 **Models** 页面写入的那个存储。本插件的余额查询与 LLM 路由都走同一套 seam。

- 若出现该报错，请确认该文档里包含 `DEEPSEEK_API_KEY: sk-...`（严格的“引用→非空字符串”映射）。DSH 运行中直接编辑即可——provider 会热重载并重新读取该文件。
- 当凭据 seam 已挂载时，LLM 路由与本插件都**只**从凭据存储读取；此时仅 `export DEEPSEEK_API_KEY` 无效（seam 存在时不被采用）。导出仅在未挂载 seam 时对本插件的兜底有效。
- 建议用单一受守护实例（如 `dsh-autostart`）运行 `dsh web`，避免临时拉起多个 `npx dsh web` 在同一个端口上互相抢占、各自读到不同凭据快照。若刚关掉一个手动实例后就遇到此报错，请确认仍由守护托管的那一个读到了 Key——余额 chip 恢复到实时总额即代表 Key 已解析。
- 该报错对恢复友好：余额 chip 会自动恢复，因为错误状态不会被当作新鲜缓存——下一次轮询会重新查询 provider。

### 余额卡在“不可用”，只有点击才刷新

此前“不可用/错误”的快照也会被缓存，直到过期才重查，所以一次瞬时失败可能让 chip 一直停在“不可用”，直到你点一下强制刷新。现在**错误视图永远不会作为新鲜缓存复用**：每次轮询都会重新查询 provider，因此只要底层条件恢复（余额可达、网络恢复、Key 已写入），chip 会自动恢复，无需手动点击。

## 许可

BSD-3-Clause。Copyright (c) 2026, Ghost011118。
