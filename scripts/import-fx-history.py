"""Pinned FRED public mirror → observed daily USD values. Python standard library only."""
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import re
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
COMMIT = 'c28e171e36a46bd2941cf66156acd8efaf9906f5'
EXPECTED_SHA256 = '5f82c543467ae6398e766fb110fe57abe446b95c4ad13b2eaca8954911c6259d'
URL = f'https://raw.githubusercontent.com/datasets/exchange-rates/{COMMIT}/data/daily.csv'
COUNTRIES = {
    'Australia': ('AUD', 'DEXUSAL'), 'Brazil': ('BRL', 'DEXBZUS'),
    'Canada': ('CAD', 'DEXCAUS'), 'China': ('CNY', 'DEXCHUS'),
    'Denmark': ('DKK', 'DEXDNUS'), 'Euro': ('EUR', 'DEXUSEU'),
    'India': ('INR', 'DEXINUS'), 'Japan': ('JPY', 'DEXJPUS'),
    'Malaysia': ('MYR', 'DEXMAUS'), 'Mexico': ('MXN', 'DEXMXUS'),
    'New Zealand': ('NZD', 'DEXUSNZ'), 'Norway': ('NOK', 'DEXNOUS'),
    'Singapore': ('SGD', 'DEXSIUS'), 'South Africa': ('ZAR', 'DEXSFUS'),
    'South Korea': ('KRW', 'DEXKOUS'), 'Sweden': ('SEK', 'DEXSDUS'),
    'Switzerland': ('CHF', 'DEXSZUS'), 'Thailand': ('THB', 'DEXTHUS'),
    'United Kingdom': ('GBP', 'DEXUSUK'),
}
ROSTER = 'USD EUR JPY GBP CHF CAD AUD NZD MXN CNY INR KRW SGD IDR THB MYR PHP VND BRL CLP COP PEN ZAR TRY PLN CZK HUF SEK NOK DKK'.split()
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--input', type=Path, help='Optional cached original daily.csv')
p.add_argument('--as-of', default='2026-10-31')
a = p.parse_args()
as_of = dt.date.fromisoformat(a.as_of)
start = as_of.replace(year=as_of.year - 2).isoformat()
raw = a.input.read_bytes() if a.input else urllib.request.urlopen(URL, timeout=60).read()
if hashlib.sha256(raw).hexdigest() != EXPECTED_SHA256:
    raise ValueError('Input does not match the reviewed pinned source; review a new version before importing')
series = {code: {'seriesId': sid, 'sourceUrl': f'https://fred.stlouisfed.org/series/{sid}', 'points': []} for code, sid in COUNTRIES.values()}
for row in csv.DictReader(io.StringIO(raw.decode())):
    if row['Country'] not in COUNTRIES or not start <= row['Date'] <= a.as_of:
        continue
    value = row['Exchange rate']
    if value in ('', '.'):
        continue
    value = float(value)
    if not 0 < value < float('inf'):
        raise ValueError('Invalid rate')
    code = COUNTRIES[row['Country']][0]
    # Pinned exchange_rates_flow.py already inverts AUD/EUR/NZD/GBP into LCU/USD.
    # README/schema descriptions are stale. Every daily.csv row uses LCU/USD.
    series[code]['points'].append([row['Date'], round(1 / value, 12)])
for code, item in series.items():
    item['points'].sort()
    dates = [x[0] for x in item['points']]
    if len(dates) != len(set(dates)) or len(dates) < 400:
        raise ValueError(f'Incomplete/duplicate history: {code}')
latest = max(x[0] for item in series.values() for x in item['points'])
result = {
    'version': 'fred-daily-2026-10-v1', 'requestedStart': start,
    'requestedEnd': a.as_of, 'latestObservation': latest, 'retrievedOn': a.as_of,
    'unit': 'USD per currency unit', 'frequency': 'daily observations; holidays missing',
    'publisher': 'Federal Reserve H.10 / FRED', 'mirror': 'datasets/exchange-rates',
    'sourceUrl': URL, 'commit': COMMIT, 'sha256': hashlib.sha256(raw).hexdigest(),
    'transformUrl': f'https://github.com/datasets/exchange-rates/blob/{COMMIT}/exchange_rates_flow.py',
    'license': 'Mirror declares ODC-PDDL; original series terms apply.',
    'notes': 'Daily reference observations, not executable bid/ask, intraday OHLC or real-time quotes. No forward fill or interpolation. USD=1 is the numeraire, not an observation. Historical macro baseline stays at 2023; this research archive does not reset the game.',
    'missing': [code for code in ROSTER if code != 'USD' and code not in series],
    'series': series,
}
out = ROOT / 'packages/simulation/src/data/fx-history.json'
serialized = json.dumps(result, ensure_ascii=False, indent=2)
# Stable readable arrays, matching the project's formatter without requiring Node.
serialized = re.sub(r'\[\n\s+"(\d{4}-\d{2}-\d{2})",\n\s+([0-9.]+)\n\s+\]', r'["\1", \2]', serialized)
serialized = re.sub(r'"missing": \[[^]]*\]', '"missing": ' + json.dumps(result['missing']), serialized)
out.write_text(serialized + '\n')
artifact = ROOT / 'artifacts/fx-history-daily-2024-2026.csv'
artifact.parent.mkdir(exist_ok=True)
with artifact.open('w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['date', 'currency', 'usd_per_unit', 'fred_series'])
    for code, item in series.items():
        for date, value in item['points']:
            w.writerow([date, code, value, item['seriesId']])
(ROOT / 'artifacts/fx-history-provenance.json').write_text(json.dumps({k: v for k, v in result.items() if k != 'series'}, indent=2) + '\n')
print(json.dumps({'currencies': len(series), 'start': start, 'latest': latest, 'observations': sum(len(v['points']) for v in series.values()), 'missing': result['missing'], 'output': str(out)}))
