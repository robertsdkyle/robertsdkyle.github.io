#!/usr/bin/env python3
# Generates the three rebrand direction mockups as standalone HTML files.
# Each shows the side panel plus the map stage with markers, rings and labels
# drawn over a stylized stand-in for the direction's named basemap (the real
# tiles cannot load in the build sandbox; ground tones match the tile set).
import os

DIRS = [
    dict(
        slug="1-fieldbook", name="Fieldbook",
        feeling="A well-thumbed field guide on a bright morning: paper, ink and moss, made to be read outdoors.",
        basemap="CARTO light_nolabels (Positron, no labels)",
        fonts_link="family=Fraunces:opsz,wght@9..144,500..800&family=Instrument+Sans:wght@400..700&family=Martian+Mono:wght@400..700",
        display="'Fraunces',Georgia,serif", ui="'Instrument Sans',system-ui,sans-serif", num="'Martian Mono',ui-monospace,monospace",
        ground="#F4F1E6", panel="#FBF9F3", panel2="#EFEBDC", ink="#26302A", dim="#66746B", rule="#DCD6C2",
        accent="#8F5F0F", accent_bright="#B7791F",
        near="#2E7D5B", mid="#C07A1E", far="#8A5A83",
        near_t="#1F6B49", mid_t="#8A5210", far_t="#6E4468",
        wrong="#B3402E", tile_ground="#F7F6F3", tile_road="#FFFFFF", tile_water="#D4DADC", tile_park="#EDEFE7",
        label_ink="#26302A", label_halo="#F7F6F3",
    ),
    dict(
        slug="2-nighthike", name="Night Hike",
        feeling="A headlamp over the map after dark: the current spruce-and-brass look, tuned rather than replaced.",
        basemap="CARTO dark_nolabels (Dark Matter, no labels)",
        fonts_link="family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=Instrument+Sans:wght@400..700&family=Martian+Mono:wght@400..700",
        display="'Bricolage Grotesque',system-ui,sans-serif", ui="'Instrument Sans',system-ui,sans-serif", num="'Martian Mono',ui-monospace,monospace",
        ground="#16211E", panel="#1D2C27", panel2="#243830", ink="#EDE7D8", dim="#93A79F", rule="#2E423B",
        accent="#E4B23C", accent_bright="#E4B23C",
        near="#7FB6A6", mid="#C9C07A", far="#B98A6B",
        near_t="#7FB6A6", mid_t="#C9C07A", far_t="#B98A6B",
        wrong="#D2705C", tile_ground="#191A1A", tile_road="#2B2D2C", tile_water="#0E1616", tile_park="#1C221D",
        label_ink="#EDE7D8", label_halo="#191A1A",
    ),
    dict(
        slug="3-waypoint", name="Waypoint",
        feeling="Airport-signage clarity for a region you just landed in: cool, crisp, zero fuss.",
        basemap="CARTO rastertiles/voyager_nolabels (Voyager, no labels)",
        fonts_link="family=Space+Grotesk:wght@400..700&family=Inter:wght@400..700&family=IBM+Plex+Mono:wght@400;700",
        display="'Space Grotesk',system-ui,sans-serif", ui="'Inter',system-ui,sans-serif", num="'IBM Plex Mono',ui-monospace,monospace",
        ground="#F5F7FA", panel="#FFFFFF", panel2="#EDF1F6", ink="#1B2430", dim="#5B6878", rule="#D8DFE8",
        accent="#2450B8", accent_bright="#2D5BD1",
        near="#0E7C86", mid="#B45309", far="#7C3AED",
        near_t="#0B6771", mid_t="#96450a", far_t="#6D2FD6",
        wrong="#C0392B", tile_ground="#FBFAF8", tile_road="#FFFFFF", tile_water="#CFE0E8", tile_park="#E8F0E3",
        label_ink="#1B2430", label_halo="#FBFAF8",
    ),
]

TPL = """<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Direction {slug}: {name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?{fonts_link}&display=swap" rel="stylesheet">
<style>
:root{{--ground:{ground};--panel:{panel};--panel2:{panel2};--ink:{ink};--dim:{dim};--rule:{rule};
--accent:{accent};--near:{near};--mid:{mid};--far:{far};--neart:{near_t};--midt:{mid_t};--fart:{far_t};--wrong:{wrong}}}
*{{box-sizing:border-box}} body{{margin:0;background:var(--ground);color:var(--ink);
font-family:{ui};font-size:15px;line-height:1.5}}
.frame{{display:grid;grid-template-columns:380px 1fr;height:760px;width:1280px;overflow:hidden}}
.side{{background:var(--panel);border-right:1px solid var(--rule);padding:22px 20px;display:flex;flex-direction:column;gap:0}}
.tag{{font-weight:700;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);margin:0 0 12px}}
.find{{background:var(--panel2);border:1px solid var(--rule);border-radius:4px;color:var(--dim);
font-weight:600;padding:12px 13px;margin-bottom:18px}}
h1{{font-family:{display};font-weight:800;font-size:38px;line-height:1;margin:0;letter-spacing:-.01em}}
.st{{font-family:{num};font-weight:700;font-size:12px;color:var(--accent)}}
.base{{font-size:14px;font-weight:600;margin:12px 0 0;padding:10px 12px;background:var(--panel2);
border-left:4px solid var(--near);border-radius:0 4px 4px 0}}
.base b{{font-family:{num};font-size:13px;color:var(--neart)}}
.chips{{display:flex;gap:6px;margin:16px 0 0;flex-wrap:wrap;align-items:center}}
.chips p{{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);margin:0 4px 0 0}}
.chip{{border:1px solid var(--rule);color:var(--dim);font-weight:700;font-size:12px;padding:5px 11px;border-radius:99px}}
.chip.on{{border-color:var(--accent);color:var(--accent);background:var(--panel2)}}
.tabs{{display:flex;margin:18px 0 0;border-bottom:1px solid var(--rule)}}
.tab{{font-weight:700;font-size:13px;letter-spacing:.05em;text-transform:uppercase;padding:9px 13px;color:var(--dim)}}
.tab.on{{color:var(--accent);border-bottom:2px solid var(--accent)}}
.row{{display:grid;grid-template-columns:42px 1fr auto;gap:10px;align-items:baseline;padding:11px 2px;border-bottom:1px solid var(--rule)}}
.cp{{font-family:{num};font-size:11px;font-weight:700}}
.nm{{font-family:{display};font-weight:700;font-size:17px}}
.ds{{font-family:{num};font-size:13px;font-weight:700}}
.ds i{{font-style:normal;font-size:10px;color:var(--dim);font-family:{ui}}}
.q{{margin-top:14px}}
.ask{{font-family:{display};font-weight:700;font-size:19px;line-height:1.3;margin:0 0 10px}}
.ask em{{font-style:normal;color:var(--accent)}}
.opt{{background:var(--panel2);border:1px solid var(--rule);border-radius:4px;
font-family:{display};font-weight:700;font-size:15px;padding:11px 13px;margin:7px 0}}
.opt.right{{border-color:var(--accent);color:var(--accent)}}
.opt.wrong{{border-color:var(--wrong);color:var(--wrong)}}
.stage{{position:relative;overflow:hidden}}
.stage svg{{position:absolute;inset:0}}
.legend{{position:absolute;left:14px;bottom:12px;background:color-mix(in srgb, var(--panel) 92%, transparent);
border:1px solid var(--rule);border-radius:4px;padding:9px 12px;font-size:12.5px;font-weight:600;color:var(--dim)}}
.legend b{{color:var(--ink)}}
.legend .fig{{font-family:{num};font-weight:700;font-size:11px;color:var(--ink)}}
.sw{{display:inline-block;width:9px;height:9px;border-radius:50%;margin:0 4px 0 10px}}
.bmname{{position:absolute;right:12px;top:10px;font-family:{num};font-size:11px;font-weight:700;
color:var(--dim);background:color-mix(in srgb, var(--panel) 88%, transparent);padding:4px 8px;border-radius:3px}}
.pop{{position:absolute;left:600px;top:190px;background:var(--panel);border:1px solid var(--rule);border-radius:5px;
padding:12px 14px;box-shadow:0 6px 22px rgba(0,0,0,.18);width:230px}}
.pop .pn{{font-family:{display};font-weight:800;font-size:17px}}
.pop .ps{{font-size:12.5px;color:var(--dim);font-weight:600;margin-top:4px}}
.pop .ps b{{font-family:{num};font-size:11.5px;color:var(--ink)}}
.pop .go{{display:inline-block;margin-top:9px;border:1px solid var(--accent);color:var(--accent);
font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:6px 10px;border-radius:3px}}
</style></head><body>
<div class="frame">
<div class="side">
  <p class="tag">Bearings &middot; direction {slug}: {name}</p>
  <div class="find">Type any town to move there</div>
  <div style="display:flex;align-items:baseline;gap:10px"><h1>Woodstock</h1><span class="st">VT</span></div>
  <p class="base"><b>3,005 people</b> &nbsp;live around your base. Every distance below starts from this spot.</p>
  <div class="chips"><p>Within</p><span class="chip">5 mi</span><span class="chip">15 mi</span><span class="chip on">30 mi</span><span class="chip">45 mi</span><span class="chip">60 mi</span></div>
  <div class="tabs"><span class="tab on">Neighbors</span><span class="tab">Quiz me</span></div>
  <div class="row"><span class="cp" style="color:var(--neart)">NNW</span><span class="nm">Bridgewater</span><span class="ds">6.1 <i>mi</i></span></div>
  <div class="row"><span class="cp" style="color:var(--neart)">E</span><span class="nm">Hartland</span><span class="ds">8.9 <i>mi</i></span></div>
  <div class="row"><span class="cp" style="color:var(--midt)">SSW</span><span class="nm">Ludlow</span><span class="ds">14.7 <i>mi</i></span></div>
  <div class="row"><span class="cp" style="color:var(--fart)">NE</span><span class="nm">Hanover, NH</span><span class="ds">19.9 <i>mi</i></span></div>
  <div class="q">
    <p class="ask">Leaving <em>Woodstock</em>, which way is Killington?</p>
    <div class="opt right">West</div>
    <div class="opt wrong">South</div>
  </div>
</div>
<div class="stage" style="background:{tile_ground}">
  <svg width="900" height="760" viewBox="0 0 900 760" xmlns="http://www.w3.org/2000/svg">
    <rect width="900" height="760" fill="{tile_ground}"/>
    <path d="M0,600 C180,560 260,640 420,610 C580,580 640,660 900,620 L900,760 L0,760 Z" fill="{tile_water}"/>
    <ellipse cx="150" cy="180" rx="130" ry="90" fill="{tile_park}"/>
    <ellipse cx="700" cy="120" rx="150" ry="80" fill="{tile_park}"/>
    <ellipse cx="560" cy="430" rx="110" ry="70" fill="{tile_park}"/>
    <path d="M-20,300 C200,290 420,330 920,260" stroke="{tile_road}" stroke-width="7" fill="none"/>
    <path d="M300,-20 C320,220 420,480 380,780" stroke="{tile_road}" stroke-width="7" fill="none"/>
    <path d="M-20,470 C240,430 600,500 920,420" stroke="{tile_road}" stroke-width="4" fill="none"/>
    <path d="M620,-20 C600,200 700,420 660,780" stroke="{tile_road}" stroke-width="4" fill="none"/>
    <g fill="none" stroke-dasharray="6 7" stroke-width="2">
      <circle cx="430" cy="360" r="110" stroke="{near}"/>
      <circle cx="430" cy="360" r="210" stroke="{mid}"/>
      <circle cx="430" cy="360" r="330" stroke="{far}"/>
    </g>
    <g font-family={numq} font-size="11" font-weight="700" text-anchor="middle">
      <text x="430" y="243" fill="{near_t}">8 mi</text>
      <text x="430" y="143" fill="{mid_t}">18 mi</text>
      <text x="430" y="23" fill="{far_t}">45 mi</text>
    </g>
    <circle cx="430" cy="360" r="8" fill="{accent_bright}" stroke="{label_halo}" stroke-width="2"/>
    {markers}
    <g font-family={dispq} font-size="13" font-weight="700" fill="{label_ink}" style="paint-order:stroke" stroke="{label_halo}" stroke-width="3">
      <text x="444" y="348" font-size="15" fill="{accent}">Woodstock</text>
      {labels}
    </g>
  </svg>
  <span class="bmname">basemap: {basemap}</span>
  <div class="pop">
    <div class="pn">Killington, VT</div>
    <div class="ps"><b>9.8 mi W</b> of Woodstock, next door</div>
    <div class="go">Stand here</div>
  </div>
  <div class="legend">Rings mark <span class="fig">8 / 18 / 45 mi</span> from <b>Woodstock</b>, sized to how towns cluster here.
  <span class="sw" style="background:{near}"></span><b>next door</b>
  <span class="sw" style="background:{mid}"></span><b>a short drive</b>
  <span class="sw" style="background:{far}"></span><b>a day trip</b></div>
</div>
</div>
<div style="width:1280px;background:var(--panel);border-top:1px solid var(--rule);padding:14px 20px;font-size:13.5px">
<b>{name}.</b> {feeling}<br>
<span style="color:var(--dim)">Display {display_name} &middot; UI {ui_name} &middot; figures {num_name} (all SIL OFL, self-hosted) &middot;
palette: ground {ground}, ink {ink}, accent {accent}, bands {near} / {mid} / {far}, wrong {wrong}</span>
</div>
</body></html>"""

MARKS = [
    (355,300,"near"),(505,290,"near"),(470,455,"near"),(340,430,"near"),
    (560,250,"mid"),(255,250,"mid"),(600,480,"mid"),(280,540,"mid"),(590,370,"mid"),
    (700,180,"far"),(160,360,"far"),(740,560,"far"),(120,600,"far"),(660,60,"far"),(80,140,"far"),
]
LBLS = [
    (355,300,"Bridgewater"),(505,290,"Hartland"),(470,455,"Reading"),(340,430,"Plymouth"),
    (560,250,"White River Junction"),(255,250,"Killington"),(600,480,"Windsor"),(280,540,"Ludlow"),
    (700,180,"Hanover"),(160,360,"Rutland"),(740,560,"Claremont"),
]

here = os.path.dirname(os.path.abspath(__file__))
for d in DIRS:
    markers = "\n    ".join(
        f'<circle cx="{x}" cy="{y}" r="5" fill="{d[b]}" stroke="{d["label_halo"]}" stroke-width="1.5"/>'
        for (x, y, b) in MARKS)
    labels = "\n      ".join(
        f'<text x="{x+9}" y="{y+4}">{n}</text>' for (x, y, n) in LBLS)
    html = TPL.format(markers=markers, labels=labels,
                      numq='"'+d["num"].replace("'", "")+'"',
                      dispq='"'+d["display"].replace("'", "")+'"',
                      display_name=d["display"].split("'")[1],
                      ui_name=d["ui"].split("'")[1],
                      num_name=d["num"].split("'")[1], **d)
    path = os.path.join(here, f"direction-{d['slug']}.html")
    with open(path, "w") as f:
        f.write(html)
    print("wrote", path)
