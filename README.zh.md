# dsh-balance-meter

[English](README.md) | 中文

DeepSeek Harness (DSH) Web 界面的账户余额与本场会话花费读数插件。

- 实时账户余额（查询官方 Get User Balance 接口）
- 当前会话估算花费（token 用量 × 官方单价）
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
        model: flash        # 'flash'（默认）或 'pro'
        pricingRefreshHours: 6
```

| 键 | 类型 | 默认值 | 含义 |
|---|---|---|---|
| `model` | `'flash' \| 'pro'` | `flash` | 价格预设（被自动抓取的官方价格覆盖之前使用） |
| `pricingRefreshHours` | `number` | `6` | 自动刷新官方价格页的间隔（小时） |
| `apiKeyEnv` | `string` | `DEEPSEEK_API_KEY` | 存储 DeepSeek API Key 的凭据引用 |
| `baseUrl` | `string` | `https://api.deepseek.com` | API 基础地址（网关/兼容接口时覆盖） |
| `refreshIntervalSeconds` | `number` | `30` | 两次余额查询的最小间隔（秒） |

## 花费如何估算

插件读取 DSH 持久化的 `tokenUsage` 投影（与内置统计行同一套记账），把四个分桶——未命中输入、缓存读、缓存写、输出——按官方价格页解析出的单价换算为金额。DeepSeek 不对缓存写单独计费，默认按 0。2026-08-17 峰谷定价上线前使用当前单价；上线后按当前北京时段的峰/闲价格计费。若官方价格页抓取失败，回退到内置预设（flash：0.02 / 1 / 2 元每百万 tokens）。

## 许可

BSD-3-Clause。Copyright (c) 2026, Ghost011118。
