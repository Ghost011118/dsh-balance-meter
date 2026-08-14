# dsh-balance-meter

English | [中文](README.zh.md)

DeepSeek account balance and session-cost readout for the DeepSeek Harness (DSH) Web GUI.

- Live account balance (queries the official Get User Balance endpoint)
- Current session estimated spend (token usage x official pricing)
- Per-model pricing: reads the model actually driving each session from its
  request header (flash vs pro), so the cost tracks the model you used instead
  of a fixed default
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
        model: auto         # 'auto' (default) | 'flash' | 'pro'
        pricingRefreshHours: 6
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `model` | `'auto' \| 'flash' \| 'pro'` | `auto` | `auto` detects each session's model from its request header (flash/pro); `flash`/`pro` force that preset regardless of auto-detection |
| `pricingRefreshHours` | `number` | `6` | Hours between automatic official-pricing refreshes |
| `apiKeyEnv` | `string` | `DEEPSEEK_API_KEY` | Credential ref storing the DeepSeek API key |
| `baseUrl` | `string` | `https://api.deepseek.com` | API base URL (gateway/compat override) |
| `refreshIntervalSeconds` | `number` | `30` | Minimum seconds between balance queries |

## How the cost is estimated

The plugin reads DSH's durable `tokenUsage` projection (the same accounting
the built-in stats line uses) and converts the four buckets — uncached
input, cache read, cache write, output — to money using prices parsed from
the official pricing page. Cache-write tokens are not billed separately by
DeepSeek and default to 0.

For the price set, in `auto` mode (the default) it uses the model actually
driving the session: each session's request header records the provider/model
of the most recent request, and the plugin maps that id (`deepseek-v4-flash`
→ flash, `deepseek-v4-pro` → pro) to the matching per-million prices. A
session is therefore priced at whatever model produced its usage, not a
hard-coded flash. When no header exists yet or the model id is unrecognized,
`auto` falls back to flash. Setting `model: flash` or `model: pro` explicitly
forces that preset and ignores auto-detection, so you can pin the estimate to
one model when you want to.

Before the 2026-08-17 peak-pricing rollout the current single prices stay
authoritative; after it, the peak/off-peak band for the current Beijing hour
is applied. If the pricing page cannot be fetched, built-in presets (flash:
0.02 / 1 / 2 CNY per 1M) are used. Explicit `cost.*` overrides in the
composition config take precedence over any preset. The cost JSON also
reports `pricingKey` and `model` so the chip can show which model was priced.

## Troubleshooting

### "no API key for provider route \`deepseek-official\`"

The host reads your key from the DSH credentials store — the file
`<harness home>/.credentials.yaml` (default `~/.dsh/.credentials.yaml`), the
same store the web **Models** page writes. This plugin's balance query and the
LLM route resolve through that same seam.

- If this error appears, make sure the document contains
  `DEEPSEEK_API_KEY: sk-...` (a strict mapping of reference to non-empty
  string). Editing it while DSH runs is fine — the provider hot-reloads and
  re-reads the file.
- When a credentials seam is mounted, both the LLM route and this plugin read
  the key *only* from the credential store; a plain `export DEEPSEEK_API_KEY`
  is ignored in that case. Exporting still helps for the plugin's own fallback
  when no seam is present.
- Prefer running `dsh web` through a single supervised instance (e.g.
  `dsh-autostart`) instead of launching several ad-hoc `npx dsh web`
  processes that can race on the same port and settle different credential
  snapshots. If you encounter this right after killing a manual instance,
  confirm the other (still-supervised) instance read the key — the balance
  chip recovering to a live total means the key resolved.
- The error is transient-friendly: the balance chip auto-recovers, because an
  error state is never cached as fresh — the next poll re-queries the
  provider.

### Balance stuck on "unavailable" and only updates on click

An error/unavailable snapshot used to be served from the cache until it aged
out, so a transient failure could hold the chip on "unavailable" until you
clicked to force a refresh. Now an erroneous view is **never** reused as a
fresh cache: every poll re-queries the provider, so the chip recovers on its
own as soon as the underlying condition clears (balance reachable, network
back, key stored).

## License

BSD-3-Clause. Copyright (c) 2026, Ghost011118.
