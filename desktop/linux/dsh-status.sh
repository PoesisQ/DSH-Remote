#!/usr/bin/env bash
# DS Harness 状态汇总：当前峰/谷时段 + 本会话分时段用量与费用 + DeepSeek 余额。
# 由 DSHarness.exe 通过 wsl.exe 调用，输出一行 JSON。密钥只在本地用于调用余额接口，绝不输出。
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
DSH_DATA_DIR="${DSH_DATA_DIR:-$HOME/.dsh}"
umask 077
TMP=$(mktemp "${TMPDIR:-/tmp}/dsh-status.XXXXXXXX.jsonl") || exit 1
trap 'rm -f -- "$TMP"' EXIT

# 1) 最新会话日志：按会话文件的修改时间选（目录 mtime 不随文件更新）
FILE=$(ls -t "$DSH_DATA_DIR/sessions/"*/session-*/session.jsonl.zstd 2>/dev/null | head -1)
if [ -n "$FILE" ] && [ -f "$FILE" ]; then
"$DIR/zcat" "$FILE" "$TMP" 2>/dev/null || { echo '{"error":"zcat failed"}'; exit 0; }
fi

# 2) 余额：解析 DEEPSEEK_API_KEY（.credentials.yaml -> .env 兜底）
BALANCE='{}'
if command -v curl >/dev/null 2>&1; then
  KEY=$(python3 - "$DSH_DATA_DIR/.credentials.yaml" "$DSH_DATA_DIR/.env" <<'PYEOF'
import sys, os
key = ''
try:
    import yaml
    d = yaml.safe_load(open(sys.argv[1]))
    v = (d.get('refs') or {}).get('DEEPSEEK_API_KEY') or ''
    if isinstance(v, str):
        if v.startswith('${') and v.endswith('}'):
            v = os.environ.get(v[2:-1], '')
        key = v.strip()
except Exception:
    pass
if not key:
    for p in (sys.argv[2], os.environ.get('DSH_ENV_FILE', '')):
        try:
            for ln in open(p):
                if ln.strip().startswith('DEEPSEEK_API_KEY='):
                    key = ln.strip().split('=', 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
print(key if key and all(c.isascii() and (c.isalnum() or c in '_-') for c in key) else '')
PYEOF
)
  if [ -n "$KEY" ]; then
    BALANCE=$(printf 'header = "Authorization: Bearer %s"\n' "$KEY" | curl --config - -s --http2 --max-time 8 \
      -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
      https://api.deepseek.com/user/balance | tr -d '\r\n' || true)
    [ -z "$BALANCE" ] && BALANCE='{}'
  fi
fi

# 3) 分时段统计与计价（官方 2026-08-17 峰谷规则：
#    高峰 = 北京时间 周一至周五 9:00-12:00、14:00-18:00；其余（含周末全天）为空闲，空闲价为高峰价一半）
python3 - "$TMP" "$BALANCE" "$FILE" <<'PYEOF'
import sys, json, datetime, os, time

PRICES = {  # 元 / 百万 tokens（官方 2026-08-17 生效的峰谷定价）
    'deepseek-v4-pro':              {'peak': {'hit': 0.30, 'miss': 9.0, 'out': 27.0}, 'off': {'hit': 0.15, 'miss': 4.5, 'out': 13.5}},
    'deepseek-v4-flash':            {'peak': {'hit': 0.10, 'miss': 3.0, 'out': 9.0},  'off': {'hit': 0.05, 'miss': 1.5, 'out': 4.5}},
    'deepseek-v4-flash-vision-exp': {'peak': {'hit': 0.10, 'miss': 3.0, 'out': 9.0},  'off': {'hit': 0.05, 'miss': 1.5, 'out': 4.5}},
}
BJT = datetime.timedelta(hours=8)
PEAK_WINDOWS = ((540, 720), (840, 1080))  # 9:00-12:00、14:00-18:00（北京时间，分钟）

def bj_time(ts_ms):
    return datetime.datetime.utcfromtimestamp(ts_ms / 1000.0) + BJT

def is_peak(t):
    if t.weekday() >= 5:  # 周六/周日全天空闲
        return False
    hm = t.hour * 60 + t.minute
    return any(start <= hm < end for start, end in PEAK_WINDOWS)

def bucket(ts_ms):
    return 'peak' if is_peak(bj_time(ts_ms)) else 'off'

model = None
buckets = {'peak': {'hit': 0, 'miss': 0, 'out': 0, 'cost': 0.0},
           'off':  {'hit': 0, 'miss': 0, 'out': 0, 'cost': 0.0}}
with open(sys.argv[1], encoding='utf-8', errors='replace') as f:
    for ln in f:
        try:
            r = json.loads(ln)
        except Exception:
            continue
        if r.get('type') == 'request/header':
            cfg = ((r.get('data') or {}).get('header') or {}).get('config') or {}
            if cfg.get('model'):
                model = cfg['model']
            continue
        if r.get('type') != 'assistant/message':
            continue
        u = (r.get('data') or {}).get('usage')
        if not isinstance(u, dict):
            continue
        ts = r.get('time') or 0
        b = bucket(ts or time.time() * 1000)
        buckets[b]['hit'] += int(u.get('cacheReadTokens') or 0)
        buckets[b]['miss'] += int(u.get('inputTokens') or 0)
        buckets[b]['out'] += int(u.get('outputTokens') or 0)

model = model or 'deepseek-v4-pro'
pricing_note = None
if model not in PRICES:
    pricing_note = '无官方现价，按 deepseek-v4-pro 估算'
price = PRICES.get(model) or PRICES['deepseek-v4-pro']
for b in ('peak', 'off'):
    p = price[b]
    buckets[b]['cost'] = round(
        (buckets[b]['hit'] * p['hit'] + buckets[b]['miss'] * p['miss'] + buckets[b]['out'] * p['out']) / 1e6, 4)

now = datetime.datetime.utcnow() + BJT
cur = 'peak' if is_peak(now) else 'off'

balance = None
currency = 'CNY'
try:
    bal = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
except Exception:
    bal = {}
for info in (bal.get('balance_infos') or []):
    if info.get('total_balance') is not None:
        balance = info.get('total_balance')
        currency = info.get('currency') or 'CNY'

print(json.dumps({
    'model': model,
    'nowPeriod': cur,
    'peak': buckets['peak'],
    'offpeak': buckets['off'],
    'totalCost': round(buckets['peak']['cost'] + buckets['off']['cost'], 4),
    'totalTokens': sum(buckets[b][k] for b in buckets for k in ('hit', 'miss', 'out')),
    'balance': balance,
    'currency': currency,
    'updatedAt': now.strftime('%H:%M:%S'),
    'sampledAt': int(time.time() * 1000),
    'sessionId': os.path.basename(os.path.dirname(sys.argv[3])) if sys.argv[3] else None,
    'scope': 'latest-active-session',
    'costCurrency': 'CNY',
    'pricingDate': '2026-08-17',
    'schedule': {'timezone': 'Asia/Shanghai', 'utcOffsetMinutes': 480,
                 'weekdaysOnly': True,
                 'peakWindows': [list(w) for w in PEAK_WINDOWS]},
    'pricingNote': pricing_note,
}, ensure_ascii=False))
PYEOF
