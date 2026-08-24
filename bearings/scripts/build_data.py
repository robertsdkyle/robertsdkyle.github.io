#!/usr/bin/env python3
"""
Build the towns dataset for the nine Census Northeast states.

Sources, in order of preference:

  LIVE (default when census.gov is reachable):
    - 2024 Census Gazetteer, National Places file
    - 2024 Census Gazetteer, National County Subdivisions file
    - 2024 Census Gazetteer, National Counties file
    - SUB-EST2024 sub-county population estimates (incorporated places + MCDs)
      CDPs are not covered by SUB-EST; their population falls back to the
      vendored 2010 Census counts (or pass --acs-key to pull ACS 5-year).

  VENDORED (--vendored, or automatic when census.gov is unreachable):
    - 2016 Gazetteer place/cousub/county files (geometry, names, status)
    - 2010 Gazetteer files (POP10: 2010 Census population, joined on GEOID)
    These are the original, unmodified Census files, committed under
    data/raw/ because this build environment cannot reach census.gov.
    Population is used only for search ranking, label priority and the CDP
    floor, so the 2010 vintage is acceptable there; re-run against live
    sources when you can.

THE PLACE-vs-MCD MERGE RULE (also documented in README.md)
-----------------------------------------------------------
All nine Northeast states have functioning minor civil divisions, so the
Places file and the County Subdivisions file overlap. The rule that yields
one entry per place a person would name:

1. County subdivisions with FUNCSTAT A, B or C are kept. These are the
   functioning general-purpose governments: every New England town, every
   NY town, every NJ/PA township. No population test - if it has a town
   line sign, it is in.
   - FUNCSTAT F cousubs are coextensive duplicates of an incorporated
     place (NJ/PA boroughs and cities, NY cities, New England cities);
     the Places file supplies those, so F is skipped here.
   - FUNCSTAT N/S/I/G are nonfunctioning or statistical (NH grants and
     purchases, ME unorganized territories, VT gores): skipped, with one
     exception below.
   - Exception: the five NYC boroughs are FUNCSTAT G but are the names
     people actually use, so they are kept, and the "New York city" place
     record is dropped so the city does not appear twice.

2. Incorporated places (LSAD 21 borough, 25 city, 43 town, 47 village,
   37 municipality; FUNCSTAT A) are kept. No population test.

3. Same-name collision between a kept place and a kept cousub within
   10 miles in the same state (an NY village inside its same-named town,
   a CT borough inside its same-named town):
   - New England states: the TOWN (cousub) wins - it is the primary
     identity there - and the place record is dropped.
   - NY / NJ / PA: the PLACE wins - the village or city center is where
     the settlement actually is - and the cousub is dropped.

4. CDPs (LSAD 57) are statistical constructs, so they alone get a
   population floor (--cdp-floor, default 1000). A CDP is also dropped
   when its name matches a kept entity within 10 miles (e.g. Middlebury
   CDP inside Middlebury town).

5. Density backstop: after filtering, any dropped CDP with fewer than
   8 kept entries within 25 miles is re-included, so sparse corners of
   Maine or the Adirondacks are not left empty.

Output: data/towns.json - compact JSON, short keys, 4-decimal coordinates.
"""

import argparse, csv, io, json, math, os, sys, urllib.request, zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "data", "towns.json")

NE_STATES = {"09": "CT", "23": "ME", "25": "MA", "33": "NH",
             "34": "NJ", "36": "NY", "42": "PA", "44": "RI", "50": "VT"}
USPS = set(NE_STATES.values())
NEW_ENGLAND = {"CT", "ME", "MA", "NH", "RI", "VT"}

LIVE = {
    "places":  "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip",
    "cousubs": "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_cousubs_national.zip",
    "counties":"https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip",
    "popest":  "https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv",
}
VENDORED = {
    "places":  "2016_Gaz_place_national.zip",
    "cousubs": "2016_Gaz_cousubs_national.zip",
    "counties":"2016_Gaz_counties_national.zip",
    "pop_places":  "Gaz_places_national.zip",   # 2010, has POP10
    "pop_cousubs": "Gaz_cousubs_national.zip",  # 2010, has POP10
}

NYC_BOROUGH_GEOIDS = {"3600508510", "3604710022", "3606144919",
                      "3608160323", "3608570915"}
NYC_PLACE_GEOID = "3651000"

SUFFIXES = ["township", "plantation", "municipality", "borough", "village",
            "city", "town", "CDP", "UT", "grant", "purchase", "location",
            "gore", "Reservation"]
KIND = {"town": "town", "township": "township", "city": "city",
        "borough": "borough", "village": "village",
        "plantation": "plantation", "municipality": "municipality",
        "CDP": "locality"}
LSAD_KIND = {"21": "borough", "25": "city", "43": "town", "47": "village",
             "37": "municipality", "57": "locality"}


def gaz_rows(blob):
    """Parse a Gazetteer tab-separated file (bytes) into dicts."""
    text = blob.decode("latin-1")
    rdr = csv.reader(io.StringIO(text), delimiter="\t")
    hdr = [h.strip() for h in next(rdr)]
    for line in rdr:
        yield dict(zip(hdr, [c.strip() for c in line]))


def read_zip_txt(path):
    with zipfile.ZipFile(path) as z:
        name = [n for n in z.namelist() if n.endswith(".txt")][0]
        return z.read(name)


def fetch(url):
    print(f"  fetching {url}")
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def base_name(name):
    """Strip the type suffix Census embeds in NAME: 'Middlebury town' ->
    'Middlebury'. MA has 'X Town city' oddities, so strip twice."""
    parts = name.split()
    kind = None
    if len(parts) > 1 and parts[-1] in SUFFIXES:
        kind = parts[-1]
        parts = parts[:-1]
    if len(parts) > 1 and parts[-1] == "Town":  # 'Barnstable Town city'
        parts = parts[:-1]
    return " ".join(parts), kind


def norm(name):
    return "".join(c for c in name.lower() if c.isalnum() or c == " ").strip()


R_MI = 3958.8
def miles(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = (math.sin((la2 - la1) / 2) ** 2
         + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2)
    return 2 * R_MI * math.asin(math.sqrt(h))


class Grid:
    """Half-degree spatial buckets for radius queries."""
    def __init__(self):
        self.cells = defaultdict(list)
    def key(self, lat, lng):
        return (int(lat * 2), int(lng * 2))
    def add(self, lat, lng, item):
        self.cells[self.key(lat, lng)].append((lat, lng, item))
    def within(self, lat, lng, mi):
        span = int(mi / 34.5) + 1  # half a degree of latitude is ~34.5 mi
        ky = self.key(lat, lng)
        out = []
        for dy in range(-span, span + 1):
            for dx in range(-span - 1, span + 2):
                for (la, lo, item) in self.cells.get((ky[0] + dy, ky[1] + dx), []):
                    if miles((lat, lng), (la, lo)) <= mi:
                        out.append(item)
        return out


def load_sources(vendored):
    if not vendored:
        try:
            places = list(gaz_rows(zipfile.ZipFile(io.BytesIO(fetch(LIVE["places"]))).read(
                [n for n in zipfile.ZipFile(io.BytesIO(fetch(LIVE["places"]))).namelist() if n.endswith(".txt")][0])))
        except Exception as e:
            print(f"  live census.gov fetch failed ({e}); falling back to vendored files")
            vendored = True
    if vendored:
        places  = [d for d in gaz_rows(read_zip_txt(os.path.join(RAW, VENDORED["places"])))  if d["USPS"] in USPS]
        cousubs = [d for d in gaz_rows(read_zip_txt(os.path.join(RAW, VENDORED["cousubs"]))) if d["USPS"] in USPS]
        counties = {d["GEOID"]: d["NAME"]
                    for d in gaz_rows(read_zip_txt(os.path.join(RAW, VENDORED["counties"])))}
        pop = {}
        for k in ("pop_places", "pop_cousubs"):
            for d in gaz_rows(read_zip_txt(os.path.join(RAW, VENDORED[k]))):
                if d["USPS"] in USPS and d.get("POP10", "").isdigit():
                    pop[d["GEOID"]] = int(d["POP10"])
        vintage = "geometry 2016 Gazetteer, population 2010 Census (POP10)"
    else:
        # Live path: 2024 gazetteer + SUB-EST2024. (Kept simple; this branch
        # runs on a normal network, not in the sandboxed build environment.)
        def live_zip(url):
            blob = fetch(url)
            z = zipfile.ZipFile(io.BytesIO(blob))
            name = [n for n in z.namelist() if n.endswith(".txt")][0]
            return list(gaz_rows(z.read(name)))
        places  = [d for d in live_zip(LIVE["places"])  if d["USPS"] in USPS]
        cousubs = [d for d in live_zip(LIVE["cousubs"]) if d["USPS"] in USPS]
        counties = {d["GEOID"]: d["NAME"] for d in live_zip(LIVE["counties"])}
        pop = {}
        rows = csv.DictReader(io.StringIO(fetch(LIVE["popest"]).decode("latin-1")))
        for r in rows:
            st = r["STATE"].zfill(2)
            if st not in NE_STATES:
                continue
            n = int(r["POPESTIMATE2024"])
            if r["SUMLEV"] == "162":          # incorporated place
                pop[st + r["PLACE"].zfill(5)] = n
            elif r["SUMLEV"] == "061":        # county subdivision
                pop[st + r["COUNTY"].zfill(3) + r["COUSUB"].zfill(5)] = n
        # CDP population is not in SUB-EST; fall back to vendored 2010 counts
        for k in ("pop_places",):
            for d in gaz_rows(read_zip_txt(os.path.join(RAW, VENDORED[k]))):
                if d["USPS"] in USPS and d.get("POP10", "").isdigit():
                    pop.setdefault(d["GEOID"], int(d["POP10"]))
        vintage = "geometry 2024 Gazetteer, population Vintage 2024 estimates (CDPs: 2010 Census)"
    return places, cousubs, counties, pop, vintage


def build(cdp_floor, vendored, report_floors=(500, 1000, 2500)):
    places, cousubs, counties, pop, vintage = load_sources(vendored)

    entries = []   # dicts with full fields, filtered later
    def add(geoid, name, kind, st, lat, lng, county, layer):
        entries.append({
            "g": geoid, "n": name, "k": kind, "s": st,
            "a": round(float(lat), 4), "o": round(float(lng), 4),
            "c": county, "p": pop.get(geoid), "layer": layer,
        })

    # --- rule 1: functioning county subdivisions --------------------------
    kept_cousubs = []
    for d in cousubs:
        name, kind = base_name(d["NAME"])
        if name.lower().endswith("not defined"):
            continue
        keep = d["FUNCSTAT"] in ("A", "B", "C") or d["GEOID"] in NYC_BOROUGH_GEOIDS
        if not keep:
            continue
        county = counties.get(d["GEOID"][:5], "").replace(" County", "")
        add(d["GEOID"], name, KIND.get(kind, "town"), d["USPS"],
            d["INTPTLAT"], d["INTPTLONG"], county, "cousub")
    kept_cousubs = [e for e in entries if e["layer"] == "cousub"]

    # --- rule 2: incorporated places --------------------------------------
    inc_places, cdps = [], []
    for d in places:
        if d["GEOID"] == NYC_PLACE_GEOID:
            continue  # the five boroughs stand in for New York city
        name, _ = base_name(d["NAME"])
        kind = LSAD_KIND.get(d["LSAD"])
        if d["LSAD"] == "57":
            cdps.append((d, name))
            continue
        if kind is None or d["FUNCSTAT"] != "A":
            continue
        inc_places.append((d, name, kind))

    # county for places: the county of the nearest kept cousub
    cousub_grid = Grid()
    for e in kept_cousubs:
        cousub_grid.add(e["a"], e["o"], e)
    def nearest_county(lat, lng):
        for radius in (15, 40, 100):
            hits = cousub_grid.within(lat, lng, radius)
            if hits:
                return min(hits, key=lambda e: miles((lat, lng), (e["a"], e["o"])))["c"]
        return ""

    for d, name, kind in inc_places:
        lat, lng = float(d["INTPTLAT"]), float(d["INTPTLONG"])
        add(d["GEOID"], name, kind, d["USPS"], lat, lng,
            nearest_county(lat, lng), "place")

    # --- rule 3: same-name collisions within 10 miles ---------------------
    by_state_name = defaultdict(list)
    for e in entries:
        by_state_name[(e["s"], norm(e["n"]))].append(e)
    dropped = set()
    for key, group in by_state_name.items():
        if len(group) < 2:
            continue
        places_g = [e for e in group if e["layer"] == "place"]
        cousubs_g = [e for e in group if e["layer"] == "cousub"]
        for p in places_g:
            for c in cousubs_g:
                if miles((p["a"], p["o"]), (c["a"], c["o"])) <= 10:
                    loser = p if p["s"] in NEW_ENGLAND else c
                    dropped.add(loser["g"])
    entries = [e for e in entries if e["g"] not in dropped]
    n_collision_drops = len(dropped)

    # --- rule 4 + 5: CDPs with a floor, then the density backstop ---------
    kept_grid = Grid()
    kept_names = defaultdict(list)
    for e in entries:
        kept_grid.add(e["a"], e["o"], e)
        kept_names[(e["s"], norm(e["n"]))].append(e)

    floor_counts = {}
    cdp_rows = []
    for d, name in cdps:
        lat, lng = float(d["INTPTLAT"]), float(d["INTPTLONG"])
        p = pop.get(d["GEOID"]) or 0
        dup = any(miles((lat, lng), (e["a"], e["o"])) <= 10
                  for e in kept_names.get((d["USPS"], norm(name)), []))
        cdp_rows.append((d, name, lat, lng, p, dup))
    for f in report_floors:
        floor_counts[f] = sum(1 for (_, _, _, _, p, dup) in cdp_rows
                              if p >= f and not dup)

    included_cdps, excluded = [], []
    for row in cdp_rows:
        d, name, lat, lng, p, dup = row
        if dup:
            continue
        (included_cdps if p >= cdp_floor else excluded).append(row)

    backstop = 0
    for d, name, lat, lng, p, dup in excluded:
        if len(kept_grid.within(lat, lng, 25)) < 8:
            included_cdps.append((d, name, lat, lng, p, dup))
            backstop += 1

    for d, name, lat, lng, p, dup in included_cdps:
        county = counties.get("", "")
        e = {"g": d["GEOID"], "n": name, "k": "locality", "s": d["USPS"],
             "a": round(lat, 4), "o": round(lng, 4),
             "c": nearest_county(lat, lng), "p": pop.get(d["GEOID"]),
             "layer": "cdp"}
        entries.append(e)

    # --- density sweep check ----------------------------------------------
    grid_all = Grid()
    for e in entries:
        grid_all.add(e["a"], e["o"], e)
    holes = 0
    for e in entries:
        if len(grid_all.within(e["a"], e["o"], 25)) < 8:
            holes += 1
    # (a hole is an entry with <8 neighbors in 25 mi; expected ~0 after backstop)

    # --- emit ---------------------------------------------------------------
    towns = []
    for e in sorted(entries, key=lambda e: (e["s"], e["n"])):
        t = {"g": e["g"], "n": e["n"], "s": e["s"], "c": e["c"],
             "a": e["a"], "o": e["o"], "k": e["k"]}
        if e["p"]:
            t["p"] = e["p"]
        towns.append(t)

    out = {
        "v": 1,
        "source": vintage,
        "note": "US Census Bureau Gazetteer files (public domain). "
                "Keys: g geoid, n name, s state, c county, a lat, o lng, "
                "k kind, p population.",
        "towns": towns,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)

    import gzip
    gz = len(gzip.compress(open(OUT, "rb").read()))
    by_state = defaultdict(int)
    for t in towns:
        by_state[t["s"]] += 1
    print(f"\nsource: {vintage}")
    print(f"towns: {len(towns)}  ({dict(sorted(by_state.items()))})")
    print(f"same-name collision drops: {n_collision_drops}")
    print(f"CDP count at floors {report_floors}: "
          f"{[floor_counts[f] for f in report_floors]} (before backstop)")
    print(f"backstop re-included CDPs: {backstop}")
    print(f"entries with <8 neighbors within 25 mi after backstop: {holes}")
    print(f"towns.json: {os.path.getsize(OUT):,} bytes raw, {gz:,} bytes gzipped")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--cdp-floor", type=int, default=1000,
                    help="population floor applied to CDPs only (default 1000)")
    ap.add_argument("--vendored", action="store_true",
                    help="skip census.gov and build from data/raw/ files")
    args = ap.parse_args()
    build(args.cdp_floor, args.vendored)
