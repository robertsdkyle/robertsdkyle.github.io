# Bearings

Pick the town you are staying in, anywhere in the nine-state Census Northeast
(CT, ME, MA, NH, NJ, NY, PA, RI, VT), and learn what is around you: which way
every town sits, how far it really is, and which ones are worth the drive.
A map view, a compass view, and a quiz that teaches the geography of wherever
you happen to be.

Built for two audiences, weighted equally: visitors orienting themselves
around wherever they are staying, and people learning their own region.
**6,888 towns**, all static files, no backend, no accounts, no build step.

## Run it locally

The app fetches `data/towns.json`, so it needs to be served over http:

```
cd bearings
python3 -m http.server 8000
# open http://localhost:8000
```

Any static file server works. There is nothing to build.

## Deploy

The whole `bearings/` directory is the site. Options:

- **GitHub Pages (this repo):** merge to `main` and it publishes at
  `https://robertsdkyle.com/bearings/` via the existing Pages setup and CNAME.
- **Cloudflare Pages / Netlify:** point the project at this directory. No
  build command, publish directory `.` . Cloudflare Pages is the recommended
  home as traffic grows (unmetered bandwidth; see `COSTS.md`).

Everything is self-hosted (Leaflet, fonts, data) except the basemap tiles,
which come from CARTO's free raster endpoint. The tile URL lives in one
constant (`TILE_URL` in `js/app.js`) so swapping providers is a one-line
change; `COSTS.md` documents when and why you would.

## Regenerate the data

```
cd bearings
python3 scripts/build_data.py            # live: pulls current census.gov files
python3 scripts/build_data.py --vendored # offline: builds from data/raw/
python3 scripts/build_data.py --cdp-floor 500   # tune the CDP floor
```

The script prefers the live 2024 Gazetteer plus Vintage 2024 population
estimates from census.gov and falls back to the vendored files in `data/raw/`
(the original, unmodified Census files) when census.gov is unreachable.

**Data vintage note:** the committed `data/towns.json` was built from the
vendored files, because the environment this project was built in could not
reach census.gov (its network allowlist blocks it; the files came from a
public GitHub mirror of the original Census zips). That means **geometry and
status are 2016 Gazetteer, population is the 2010 Census (POP10)**.
Population is used only for search ranking, label priority and the CDP floor,
so stale counts degrade gracefully, but the first thing to do on a normal
network is re-run `python3 scripts/build_data.py` and commit the fresh output.

Pipeline report from the committed build:

```
towns: 6888  (CT 250, MA 426, ME 503, NH 246, NJ 698, NY 1657, PA 2791, RI 53, VT 264)
same-name collision drops: 398
CDP count at floors (500 / 1000 / 2500): 1296 / 1026 / 598 (before backstop)
backstop re-included CDPs: 2
entries with <8 neighbors within 25 mi after backstop: 10 (islands and the
  far Maine woods: real geography, not data holes)
towns.json: 719,813 bytes raw, 153,162 bytes gzipped (single file, no split needed)
```

## The place-vs-MCD merge rule

All nine Northeast states have functioning minor civil divisions, so the
Census Places file and County Subdivisions file overlap and both are real.
The rule that yields one entry per place a person would name:

1. **County subdivisions with FUNCSTAT A, B or C are always in**, no
   population test: every New England town, NY town, NJ/PA township. If it
   has a town line sign, it is in (Goshen VT, population 164, stays).
   FUNCSTAT F cousubs are coextensive duplicates of an incorporated place
   and are skipped (the Places file supplies them); N/S/I/G are
   nonfunctioning or statistical (NH grants, ME unorganized territories,
   VT gores) and are skipped.
2. **Incorporated places are always in** (LSAD city/borough/village/town/
   municipality, FUNCSTAT A).
3. **Same-name collisions within 10 miles in the same state**: in New
   England the town (cousub) wins (Stonington CT keeps the town, drops the
   borough); in NY/NJ/PA the place wins (Ossining keeps the village, drops
   the town), because that is where the settlement actually is.
4. **CDPs alone get a population floor** (default 1,000), and a CDP whose
   name matches a kept entity within 10 miles is dropped as a duplicate
   (Middlebury CDP inside Middlebury town).
5. **Density backstop**: any dropped CDP with fewer than 8 kept entries
   within 25 miles is re-included, so sparse country is never left empty.
6. **New York City**: the five boroughs (FUNCSTAT G) are kept and the
   "New York city" place record is dropped, because Brooklyn is what a
   person names, and one pin for 8.4M people helps nobody.

## Design: the "Fieldbook" direction

Three rebrand directions were mocked up as pixels (side panel plus map) in
`design/`:

1. **Fieldbook**: paper, ink and moss on CARTO `light_nolabels` (Positron).
   Fraunces + Instrument Sans + Martian Mono.
2. **Night Hike**: the original spruce-and-brass dark look, tuned, on CARTO
   `dark_nolabels`. Bricolage Grotesque + Instrument Sans + Martian Mono.
3. **Waypoint**: cool civic clarity on CARTO `voyager_nolabels`.
   Space Grotesk + Inter + IBM Plex Mono.

**Fieldbook was chosen** (this session runs unattended, so the pick is
recorded here rather than asked): a visitor tool is used in daylight while
planning the day, and the warm field-guide look matches the product's settled
voice ("a knowledgeable local who is genuinely glad you asked") in a way the
relocation-era dark ops look never did. The light basemap also retires the
dark-glow label trick for a simple light halo. Waypoint was the runner-up but
reads like every SaaS dashboard; Night Hike stays in `design/` as the future
dark mode. All three type families are SIL OFL and self-hosted (121KB total,
latin subsets). Functional color survives the rebrand: three band colors
distinguishable from each other and the ground, right/wrong colors that
differ in lightness not just hue (gold vs rust), and text-safe darker
variants of each band color used wherever the color carries words.

## Architecture notes (what v2 will care about)

- **State**: one serializable object with a schema `version`, read and
  written only through `js/store.js`. Swapping localStorage for a synced API
  is one file. The URL carries shareable state: `?home=<geoid>&r=30&view=map`.
- **Distance**: every distance goes through `Distance.between()` in
  `js/geo.js`, and a measurement carries its own unit and label, so real
  drive time can slot in beside haversine without touching call sites. The
  band function takes thresholds, not hardcoded miles.
- **Adaptive bands**: "next door / a short drive / a day trip" are derived
  from the distance to roughly the 10th and 40th nearest town of wherever
  you stand (5/10/20 mi in Manhattan, 10/20/40 mi around Woodstock VT), and
  the rings, legend and copy all print the actual mileage.
- **Scale**: markers render through Leaflet's canvas renderer; a
  half-degree spatial grid answers radius and viewport queries; context
  markers are capped at 300 by population; the label declutter pass is fed
  at most ~60 permanent labels.
- **The panel never scrolls**: on desktop the sidebar is a fixed cell and
  the neighbor list paginates to the rows that actually fit (measured with
  a ResizeObserver, recomputed on resize, radius, tab and font load); the
  quiz pane steps through compaction levels and, as a last resort, sheds
  decoy options rather than letting the Next button fall off the bottom.

## Tests

```
cd bearings
python3 -m http.server 8901 &
node scripts/acceptance.test.js        # needs: npm install playwright
```

The suite asserts, at 360, 390, 768, 834, 1280, 1920 and 2560 px wide plus
360x640 and 1280x720: panel `scrollHeight <= clientHeight + 1` in both tabs
at the widest radius, no element but the map with overflow-y auto/scroll, no
horizontal scroll, no page errors; that all six quiz types build and answer
in both dense (Manhattan) and sparse (Allagash ME) regions; that markers,
rings and labels actually paint (the canvas is read back, because a previous
round shipped an invisible-overlay bug that survived code review); and that
zero em dashes appear in rendered text across every view and quiz type.
All of it passes as committed.

## What I would do next, and what was left out on purpose

Next, in order: (1) re-run the data pipeline on an open network for 2024
geometry and current population; (2) batch-precompute drive times between
each town and its 40 nearest neighbors (see COSTS.md for why that is nearly
free) and let the bands speak minutes; (3) a shareable "week card": the
towns you stood in, quiz score, one link; (4) PMTiles migration once traffic
justifies it; (5) the dark mode that is already sitting in `design/` as
Night Hike.

Deliberately left out: points of interest, opening hours, itineraries and
anything else that turns a geography tool into a travel guide (the spec's
scope line, kept); routing in v1; accounts (structured for, not built);
analytics of any kind (nothing to leak); a build step (plain files deploy
anywhere and survive neglect).

## Licenses

Data: US Census Bureau, public domain. Leaflet: BSD-2-Clause (vendored with
its LICENSE). Fonts: Fraunces, Instrument Sans, Martian Mono, all SIL OFL,
self-hosted. Basemap tiles: CARTO free tier with required attribution
(rendered on the map). App code: yours.
