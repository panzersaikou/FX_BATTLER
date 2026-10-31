"""Build a dated offline fixture from pinned, attributed World Bank mirrors.

Run: python scripts/import-world-baseline.py
Uses standard HTTPS proxy / CA settings. Fails on missing core observations;
optional missing observations stay null (the model labels its own assumptions).
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import urllib.request
from concurrent.futures import ThreadPoolExecutor

YEAR = 2023
WDI = '4ebec5a2273f531ba238a34dbe440394dc5a6c4b'
COUNTRIES = dict(zip(
    'USD EUR JPY GBP CHF CAD AUD NZD MXN CNY INR KRW SGD IDR THB MYR PHP VND BRL CLP COP PEN ZAR TRY PLN CZK HUF SEK NOK DKK'.split(),
    'USA EMU JPN GBR CHE CAN AUS NZL MEX CHN IND KOR SGP IDN THA MYS PHL VNM BRA CHL COL PER ZAF TUR POL CZE HUN SWE NOR DNK'.split(),
))
SPECS = {
    'gdp': ('NY.GDP.MKTP.CD', 'gdp', '36d761dc5617982d3e50b213e02b9a1b47c4e958', 'data/gdp.csv'),
    'population': ('SP.POP.TOTL', 'population', 'd4b1a4a9a17e2123baf0ef119de05bceced1ab1b', 'data/population.csv'),
    **{name: (code, 'world-development-indicators', WDI, f'indicators/{code.lower()}/data.csv') for name, code in {
        'inflation': 'FP.CPI.TOTL.ZG', 'growth': 'NY.GDP.MKTP.KD.ZG', 'unemployment': 'SL.UEM.TOTL.ZS',
        'lcuPerUsd': 'PA.NUS.FCRF', 'exports': 'NE.EXP.GNFS.ZS', 'imports': 'NE.IMP.GNFS.ZS',
        'investment': 'NE.GDI.TOTL.ZS', 'credit': 'FS.AST.PRVT.GD.ZS',
        'debt': 'GC.DOD.TOTL.GD.ZS', 'currentAccountUsd': 'BN.CAB.XOKA.CD',
    }.items()},
}

def download(item):
    key, (indicator, repo, revision, path) = item
    url = f'https://raw.githubusercontent.com/datasets/{repo}/{revision}/{path}'
    with urllib.request.urlopen(url, timeout=40) as response:
        raw = response.read()
    rows = {r['Country Code']: float(r['Value']) for r in csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
            if int(r['Year']) == YEAR and r['Country Code'] in COUNTRIES.values()}
    return key, rows, {'indicator': indicator, 'publisher': 'World Bank WDI (includes OECD / ILO source series)',
                       'url': f'https://data.worldbank.org/indicator/{indicator}', 'mirror': url,
                       'sha256': hashlib.sha256(raw).hexdigest(), 'license': 'World Bank data terms / CC BY 4.0; see source and third-party notices'}

def main():
    data, sources = {}, {}
    with ThreadPoolExecutor(max_workers=5) as executor:
        for key, values, source in executor.map(download, SPECS.items()):
            data[key], sources[key] = values, source
    economies = {}
    for currency, iso3 in COUNTRIES.items():
        values = {key: rows.get(iso3) for key, rows in data.items()}
        for key in ('gdp', 'population', 'inflation', 'growth', 'unemployment', 'lcuPerUsd', 'exports', 'imports'):
            if values[key] is None: raise ValueError(f'Missing required observation: {currency}/{key}')
        if values['lcuPerUsd'] <= 0 or values['gdp'] <= 0: raise ValueError(currency)
        economies[currency] = {'iso3': iso3, **values}
    result = {'version': 'world-bank-2023-v1', 'year': YEAR, 'retrievedOn': '2026-10-31',
              'description': '2023 annual observations, later revisions; not a contemporaneous 2023 information set or current market data.',
              'sources': sources, 'economies': economies}
    path = Path(__file__).resolve().parents[1] / 'packages/simulation/src/data/world-baseline.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(f'Wrote {len(economies)} economies, {len(sources)} indicators to {path}')

if __name__ == '__main__': main()
