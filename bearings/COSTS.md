# COSTS.md

Cost audit for running Bearings as a live public site. Every claim below was
checked against current vendor pages on **2026-08-24** (via web search of the
cited pages; this build environment cannot open most vendor sites directly, so
re-confirm the flagged items at the linked pages before relying on them for a
contract). Budget ceiling set by the owner: **$50/month**. Expected traffic:
low; figures below are given at 10k and 100k page views/month.

A page view loads roughly 20 to 30 map tiles at first paint plus a handful per
pan/zoom; the math below assumes ~25 tiles per view.

| What it is | License / terms | Free tier | What triggers a bill | Self-hosted escape |
|---|---|---|---|---|
| **Census Gazetteer + population data** (data/towns.json) | US government work, public domain. Census.gov terms: data is free to use, reuse and redistribute, attribution requested not required. Checked at census.gov data terms, 2026-08-24. | Everything. | Nothing, ever. | Already vendored in `data/raw/`. |
| **Leaflet 1.9.4** (vendored in `vendor/leaflet/`) | BSD-2-Clause (LICENSE file ships with it). Commercial use permitted. Confirmed from the package's own LICENSE, 2026-08-24. | Everything; it is a library, not a service. | Nothing. | Already self-hosted. |
| **CARTO raster basemap** (`basemaps.cartocdn.com` light_nolabels), what the site ships with | Per CARTO's basemaps FAQ (docs.carto.com/faqs/carto-basemaps, checked 2026-08-24): free up to a fair-use limit of **5 million tile requests/month**, an API key is requested (no account needed), attribution to CARTO and OpenStreetMap must stay visible. **Commercial use may require an Enterprise conversation with CARTO.** This app is non-commercial hobby use today; if it ever carries revenue, re-read those terms. | ~5M tiles/mo ≈ 200k page views/mo. | Passing fair use, or CARTO deciding your use is commercial. Note: this page's exact current wording should be re-confirmed at the FAQ link; the sandbox could not open it directly. | Protomaps (below). |
| **OpenStreetMap raw tiles** (`tile.openstreetmap.org`) | **Not used, and should not be.** The OSMF tile usage policy (operations.osmfoundation.org/policies/tiles, checked 2026-08-24) is written for light use; it warns that heavy use harms the project and that commercial or donation-funded services "should be especially aware that access may be withdrawn at any point." That is not a production dependency, it is a favor. | n/a | n/a | n/a |
| **Protomaps + Cloudflare R2** (the recommended migration) | Protomaps is open source (basemap build + PMTiles format); OSM data is ODbL with attribution. A Northeast-US extract is a few GB. R2 has no egress fees, only per-request fees, and small regional tilesets can sit inside R2's free tier. Real-world reports (pinballmap.com's writeup, bonitotech.com, checked 2026-08-24): ~$1-3/month for a full planet, effectively $0 for a region. | R2 free tier covers a regional tileset at this scale. | Tens of millions of requests/month. | This *is* the escape hatch. |
| **Stadia Maps** (paid raster alternative) | Free tier with a monthly credit pool for non-commercial use, then $20/mo Starter (stadiamaps.com/pricing, checked 2026-08-24; exact free credit count not re-confirmed, verify at the pricing page). | Non-commercial low traffic. | Commercial use or outgrowing the credit pool: $20/mo. | Protomaps. |
| **MapTiler** (paid raster alternative) | Free plan: 100,000 requests/month, personal/non-commercial; Flex $25/mo (maptiler.com/cloud/pricing, checked 2026-08-24). | ~4k page views/mo. Too small for comfort. | ~4k page views or commercial use. | Protomaps. |
| **OpenFreeMap** (free vector alternative) | Genuinely free public instance, no limits, no keys, donation-funded (openfreemap.org, checked 2026-08-24). Requires switching Leaflet to MapLibre GL (vector), which is a real code change and ~250KB more JS. | Everything. | Nothing, but it is a donation-funded service with no SLA. | It is itself self-hostable. |
| **Fonts: Fraunces, Instrument Sans, Martian Mono** (vendored in `fonts/`) | All three are SIL Open Font License 1.1 (per their Google Fonts listings and upstream repos, checked 2026-08-24). OFL expressly permits self-hosting, embedding and commercial use; the only real restriction is not selling the font files themselves. | Everything. | Nothing. | Already self-hosted (121KB total). |
| **Static hosting** | **GitHub Pages** (current): free, 1GB site, **100GB/month soft bandwidth cap**, no server-side code. **Cloudflare Pages**: free plan with **unmetered bandwidth** (500 builds/mo limit). **Netlify Free**: **100GB/month hard cap**, site pauses when exceeded. All checked 2026-08-24. | This site is ~1MB per first visit (0.9MB app+data, mostly cacheable). 100GB ≈ 100k+ first visits/mo. | On GitHub Pages/Netlify: ~100k fresh visits/mo. Cloudflare Pages: effectively nothing at this scale. | Any static host; the site is plain files by design. |
| **Domain** | No free option. .com wholesale is ~$10.46/yr (rising ~$11.81 after Nov 2026); at-cost registrars (Cloudflare Registrar) charge exactly wholesale, retail registrars $10-20/yr first year with higher renewals. Checked 2026-08-24. | n/a | ~$11-15/year, forever. Watch renewal pricing on non-.com TLDs (.guide, .app can renew at $20-40). | n/a |

## The future cost that dwarfs the rest: real drive time

v2 wants road travel time. Verified options, 2026-08-24:

- **openrouteservice.org hosted API**: free tier is **2,500 requests/day,
  40,000/month**. Fine for prototyping; a town-to-town matrix for one visitor
  can burn 40 requests, so ~60 visitors/day exhausts it. Not a production plan.
- **Hosted commercial routing** (Google Routes, Mapbox Directions, HERE): free
  tiers in the 2,500-10,000 requests/day range, then hundreds of dollars per
  month at real volume. Breaks the $50 ceiling fast.
- **Self-hosting Valhalla or OSRM on a Northeast-US OSM extract** (the
  recommendation): the extract is small enough to route on a **$10-20/month
  VPS** (Hetzner/DigitalOcean class). The scary "$1,000-3,000/month" figures
  quoted for AWS setups are for large fleets at high request volume, not this.
  Better still: since the town set is fixed, drive times can be **precomputed
  in batches offline** (each town to its ~40 neighbors), cached as static JSON,
  and served for free; the data shape already leaves room for a sparse per-pair
  time (see README). A routing server then only needs to exist during batch
  runs, which a laptop can do. **Realistic v2 routing cost: $0 ongoing with
  batch precompute, or $10-20/mo for a live server.**

## Accounts, when they come (v2 note required by the spec)

v1 stores everything on-device and collects nothing, so there is nothing to
leak and no privacy obligations beyond honesty. When sign-in arrives, a managed
auth provider's free tier (Clerk, Auth0, Supabase Auth are all free into the
thousands of monthly active users, checked 2026-08-24) costs $0 at this scale
and offloads password/breach liability; rolling your own later costs no vendor
fee but buys you session security, email delivery and breach obligations as
engineering work. At this project's scale, managed free tier wins until it
does not, and the single-module storage design means the swap touches one file.

## Bottom line

**At low traffic this site costs ~$1/month, which is the domain ($11-15/year
amortized); every other dependency sits comfortably inside a free tier.** At
10k page views/month: ~250k CARTO tiles (5% of fair use), ~10GB bandwidth,
still $0 + domain. At 100k page views/month: ~2.5M tiles, half of CARTO's
fair-use ceiling; move hosting to Cloudflare Pages (unmetered) and budget the
migration to self-hosted Protomaps tiles (~$0-5/month on R2).

**The first thing that will start charging as it grows is the basemap**:
either by crossing CARTO's 5M-tile fair use or by CARTO reading a grown-up
version of this site as commercial. The escape is already chosen and cheap:
Protomaps PMTiles for the Northeast on Cloudflare R2, ~$0-5/month, no meter
that can surprise you. Everything else (data, fonts, Leaflet, the app itself)
is public domain, OFL or BSD and self-hosted, and cannot send a bill. The $50
ceiling is roughly 10x anything this plan needs before six figures of monthly
page views.
