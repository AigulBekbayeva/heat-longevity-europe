#!/usr/bin/env python3
"""
Build the data behind the three European maps (NUTS 2 regions, NUTS 2024).

  data/indicators.json   Eurostat: life expectancy at birth, share of people aged 65+, population
  data/temperature.json  E-OBS daily maximum temperature (TX), 0.25° grid, averaged per NUTS 2
                         region over the last 10 complete years:
                           tx_jja  mean daily maximum in June–August
                           tx_year mean daily maximum over the whole year
                           hot30   days per year with a maximum of 30 °C or more

Usage:
  python scripts/build_data.py            # both
  python scripts/build_data.py eurostat   # indicators only
  python scripts/build_data.py eobs       # temperature only
"""
import json
import math
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date

UA = {"User-Agent": "map-challenge-data-build/1.0"}
OUT_DIR = "data"
N_YEARS = 10

NUTS_GEOJSON = ("https://raw.githubusercontent.com/eurostat/Nuts2json/master/pub/v2/"
                "2024/4326/10M/nutsrg_2.json")
EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
EOBS_BASE = "https://knmi-ecad-assets-prd.s3.amazonaws.com/ensembles/data/Grid_0.25deg_reg_ensemble/"


# ----------------------------------------------------------------------------- http
def get(url, timeout=300, tries=3):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
            print(f"  ! {e} — {url[:120]}", file=sys.stderr)
            if isinstance(e, urllib.error.HTTPError) and e.code in (400, 404):
                break
            time.sleep(4 * (i + 1))
    raise last


def download(url, path):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=600) as r, open(path, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done, step = 0, 1 << 20
        while True:
            chunk = r.read(step)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if total and done % (100 << 20) < step:
                print(f"    {done >> 20} / {total >> 20} MB")
    return path


# ----------------------------------------------------------------------------- Eurostat
PREFERRED = {"A", "T", "TOTAL", "YR", "Y_LT1", "PC", "NR"}


def parse_jsonstat(js):
    """JSON-stat 2.0 -> {geo: {year: value}} keeping only NUTS 2 codes (4 characters)."""
    ids, sizes, dims = js["id"], js["size"], js["dimension"]

    def index_of(d):
        idx = dims[d]["category"]["index"]
        return {c: i for i, c in enumerate(idx)} if isinstance(idx, list) else idx

    pos = {d: index_of(d) for d in ids}
    fixed = {}
    for d, n in zip(ids, sizes):
        if d in ("geo", "time"):
            continue
        if n == 1:
            fixed[d] = 0
        else:
            pick = [c for c in pos[d] if c in PREFERRED]
            if not pick:
                raise ValueError(f"dimension {d} has {n} categories {list(pos[d])[:8]}; add a filter")
            fixed[d] = pos[d][pick[0]]
            print(f"  dimension {d}: using {pick[0]}")
    strides, s = [], 1
    for n in reversed(sizes):
        strides.append(s)
        s *= n
    strides = list(reversed(strides))
    values = js["value"]
    getv = (lambda k: values.get(str(k))) if isinstance(values, dict) else (lambda k: values[k] if k < len(values) else None)

    out = defaultdict(dict)
    for geo, gi in pos["geo"].items():
        if len(geo) != 4:
            continue
        for year, ti in pos["time"].items():
            flat = 0
            for d, st in zip(ids, strides):
                i = gi if d == "geo" else ti if d == "time" else fixed[d]
                flat += i * st
            v = getv(flat)
            if v is not None:
                out[geo][int(str(year)[:4])] = float(v)
    return out


def eurostat(dataset, **filters):
    q = "&".join(f"{k}={v}" for k, v in filters.items())
    url = f"{EUROSTAT}{dataset}?format=JSON&lang=EN&sinceTimePeriod=2014&{q}"
    print(f"Eurostat: {url}")
    return parse_jsonstat(json.loads(get(url)))


def latest(series, min_regions=150):
    """Most recent year with good coverage; each region takes that year or up to 3 years earlier."""
    count = defaultdict(int)
    for s in series.values():
        for y in s:
            count[y] += 1
    good = [y for y, c in count.items() if c >= min_regions]
    if not good:
        raise SystemExit("Eurostat: no year with enough regions")
    year = max(good)
    out = {}
    for geo, s in series.items():
        for y in range(year, year - 4, -1):
            if y in s:
                out[geo] = (round(s[y], 2), y)
                break
    return year, out


def build_indicators():
    le_year, le = latest(eurostat("demo_r_mlifexp", sex="T", age="Y_LT1", unit="YR"))
    p65_year, p65 = latest(eurostat("demo_r_pjanind2", indic_de="PC_Y65_MAX"))
    pop_year, pop = latest(eurostat("demo_r_d2jan", sex="T", age="TOTAL", unit="NR"))
    regions = {}
    for geo in sorted(set(le) | set(p65)):
        r = {}
        if geo in le:
            r["le"], r["le_y"] = le[geo]
        if geo in p65:
            r["p65"], r["p65_y"] = p65[geo]
        if geo in pop:
            r["pop"] = int(pop[geo][0])
        regions[geo] = r
    out = {
        "source": "Eurostat: demo_r_mlifexp (life expectancy at birth), demo_r_pjanind2 (PC_Y65_MAX), demo_r_d2jan (population on 1 January)",
        "source_url": "https://ec.europa.eu/eurostat/web/regions/database",
        "years": {"le": le_year, "p65": p65_year, "pop": pop_year},
        "built": date.today().isoformat(),
        "regions": regions,
    }
    write("indicators.json", out)
    print(f"indicators: {len(regions)} regions; LE {le_year}, 65+ {p65_year}, pop {pop_year}")


# ----------------------------------------------------------------------------- E-OBS
def eobs_candidates():
    this = date.today().year
    for v in range(40, 29, -1):
        for end in range(this, this - 3, -1):
            yield f"{EOBS_BASE}tx_ens_mean_0.25deg_reg_2011-{end}_v{v}.0e.nc"
    for v in range(40, 29, -1):  # full-period file (bigger) as a last resort
        yield f"{EOBS_BASE}tx_ens_mean_0.25deg_reg_v{v}.0e.nc"


def find_eobs():
    for url in eobs_candidates():
        req = urllib.request.Request(url, headers=UA, method="HEAD")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                if r.status == 200:
                    return url
        except Exception:
            continue
    raise SystemExit("E-OBS: no TX file found at the expected locations")


def region_cells(features, lats, lons, valid):
    """For each region: (iy, ix, weights) of grid cells whose centres fall inside it."""
    import numpy as np
    import shapely
    from shapely.geometry import shape

    lon2d, lat2d = np.meshgrid(lons, lats)
    dlat = abs(float(lats[1] - lats[0]))
    cells = {}
    for f in features:
        rid = f["properties"]["id"]
        geom = shape(f["geometry"])
        shapely.prepare(geom)
        x0, y0, x1, y1 = geom.bounds
        sub = (lon2d >= x0 - dlat) & (lon2d <= x1 + dlat) & (lat2d >= y0 - dlat) & (lat2d <= y1 + dlat)
        iy, ix = np.nonzero(sub)
        inside = shapely.contains_xy(geom, lon2d[iy, ix], lat2d[iy, ix]) & valid[iy, ix]
        iy, ix = iy[inside], ix[inside]
        if iy.size == 0:  # small region: nearest valid cell to a point inside it
            p = geom.representative_point()
            d = (lon2d - p.x) ** 2 * math.cos(math.radians(p.y)) ** 2 + (lat2d - p.y) ** 2
            d = np.where(valid, d, np.inf)
            j = np.unravel_index(np.argmin(d), d.shape)
            if not np.isfinite(d[j]) or d[j] > 1.0:
                print(f"  no grid cell for {rid}")
                continue
            iy, ix = np.array([j[0]]), np.array([j[1]])
        cells[rid] = (iy, ix, np.cos(np.radians(lat2d[iy, ix])))
    return cells


def build_temperature():
    import numpy as np
    import xarray as xr

    url = find_eobs()
    print(f"E-OBS: {url}")
    tmp = os.path.join(tempfile.gettempdir(), os.path.basename(url))
    if not os.path.exists(tmp):
        download(url, tmp)
    ds = xr.open_dataset(tmp)
    tx = ds["tx"]
    lat, lon = ("latitude", "longitude") if "latitude" in tx.dims else ("lat", "lon")
    times = ds["time"].to_index()
    years = sorted(set(times.year))
    complete = [y for y in years if ((times.year == y).sum() >= 365 and
                                     times[times.year == y].max().month == 12 and
                                     times[times.year == y].max().day == 31)]
    complete = [y for y in complete if y < date.today().year]
    if len(complete) < N_YEARS:
        raise SystemExit(f"E-OBS: only {len(complete)} complete years in file")
    period = complete[-N_YEARS:]
    print(f"E-OBS period: {period[0]}–{period[-1]}")

    lats, lons = ds[lat].values, ds[lon].values
    nuts = json.loads(get(NUTS_GEOJSON))["features"]

    per_year = defaultdict(lambda: defaultdict(dict))
    cells = None
    for y in period:
        block = tx.sel(time=str(y)).load()
        arr = block.values  # (time, lat, lon) in °C, NaN over sea
        months = block["time"].dt.month.values
        with np.errstate(invalid="ignore"):
            f_year = np.nanmean(arr, axis=0)
            f_jja = np.nanmean(arr[(months >= 6) & (months <= 8)], axis=0)
            f_hot = np.sum(arr >= 30.0, axis=0).astype(float)
        valid_cov = np.isfinite(arr).sum(axis=0) >= 0.9 * arr.shape[0]
        f_hot[~valid_cov] = np.nan
        if cells is None:
            cells = region_cells(nuts, lats, lons, valid_cov)
            print(f"  regions with grid cells: {len(cells)} of {len(nuts)}")
        for rid, (iy, ix, w) in cells.items():
            for key, field in (("tx_year", f_year), ("tx_jja", f_jja), ("hot30", f_hot)):
                v = field[iy, ix]
                ok = np.isfinite(v)
                if ok.any():
                    per_year[rid][key][y] = float(np.sum(v[ok] * w[ok]) / np.sum(w[ok]))
        print(f"  {y} done")

    regions = {}
    for rid, metrics in per_year.items():
        r = {}
        for key, s in metrics.items():
            vals = [s[y] for y in period if y in s]
            if len(vals) >= N_YEARS - 2:
                r[key] = round(sum(vals) / len(vals), 2 if key != "hot30" else 1)
        if r:
            regions[rid] = r
    if len(regions) < 150:
        raise SystemExit(f"E-OBS: only {len(regions)} regions with values; refusing to write")
    out = {
        "source": "E-OBS daily maximum temperature (TX), ensemble mean, 0.25° grid — Copernicus Climate Change Service & ECA&D",
        "source_url": "https://surfobs.climate.copernicus.eu/dataaccess/access_eobs.php",
        "file": os.path.basename(url),
        "period": [period[0], period[-1]],
        "built": date.today().isoformat(),
        "metrics": {
            "tx_jja": {"label": "Average daily maximum in summer (June–August)", "short": "summer daily max", "unit": "°C"},
            "tx_year": {"label": "Average daily maximum, whole year", "short": "year-round daily max", "unit": "°C"},
            "hot30": {"label": "Days per year at 30 °C or above", "short": "days ≥ 30 °C", "unit": "days"},
        },
        "regions": regions,
    }
    write("temperature.json", out)
    print(f"temperature: {len(regions)} regions")


def write(name, obj):
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("all", "eurostat"):
        build_indicators()
    if what in ("all", "eobs"):
        build_temperature()
