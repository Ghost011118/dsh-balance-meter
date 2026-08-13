# dsh-balance-meter

DeepSeek account balance and session-cost readout for the DeepSeek Harness (DSH) Web GUI.

- Live account balance (queries the official Get User Balance endpoint)
- Current session estimated spend (token usage x official pricing)
- Auto-fetches the official pricing page every 6h, so price changes and the
  2026-08-17 peak/off-peak pricing rollout never require a plugin update
- Peak-hour band (Beijing 09:00-12:00 / 14:00-18:00) applied automatically
  once the peak pricing goes live

## Features

The composer dock shows a chip with the account total balance and the
current session's estimated cost:

```
Balance CNY 4.16 · This session CNY 2.57
```

Clicking the chip reveals the per-currency balance breakdown (granted +
top-up) and the per-bucket cost breakdown (input / cache read / output).
Clicking while an error is shown forces an immediate refresh.

## Requirements

- DeepSeek Harness `0.1.0-rc.6` or newer (web profile)
- A DeepSeek API key stored through the DSH credentials seam
  (`DEEPSEEK_API_KEY` — the web Models page writes it)

## Installation

From a git URL (no npm account needed):

```sh
dsh plugin --profile web add https://github.com/Ghost011118/dsh-balance-meter
```

Or from a local checkout:

```sh
git clone https://github.com/Ghost011118/dsh-balance-meter.git
dsh plugin --profile web add link:$(pwd)/dsh-balance-meter
```

Restart `dsh web`, then refresh the page. The balance chip appears in the
composer dock next to the conversation stats line.

## Configuration

The plugin is zero-config by default (uses `DEEPSEEK_API_KEY` and the
official pricing page). Optional composition settings:

```yaml
- insert:
    - id: balance
      name: 'dsh-balance-meter'
      config:
        model: flash        # 'flash' (default) or 'pro'
        pricingRefreshHours: 6
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `model` | `'flash' \| 'pro'` | `flash` | Pricing preset used until the auto-fetched page overrides it |
| `pricingRefreshHours` | `number` | `6` | Hours between automatic official-pricing refreshes |
| `apiKeyEnv` | `string` | `DEEPSEEK_API_KEY` | Credential ref storing the DeepSeek API key |
| `baseUrl` | `string` | `https://api.deepseek.com` | API base URL (gateway/compat override) |
| `refreshIntervalSeconds` | `number` | `30` | Minimum seconds between balance queries |

## How the cost is estimated

The plugin reads DSH's durable `tokenUsage` projection (the same accounting
the built-in stats line uses) and converts the four buckets — uncached
input, cache read, cache write, output — to money using prices parsed from
the official pricing page. Cache-write tokens are not billed separately by
DeepSeek and default to 0. Before the 2026-08-17 peak-pricing rollout the
current single prices stay authoritative; after it, the peak/off-peak band
for the current Beijing hour is applied. If the pricing page cannot be
fetched, built-in presets (flash: 0.02 / 1 / 2 CNY per 1M) are used.

## License

BSD-3-Clause. Copyright (c) 2026, Ghost011118.
