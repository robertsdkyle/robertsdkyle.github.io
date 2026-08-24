/* Bearings: pick the town you are staying in, anywhere in the Northeast,
   and learn what is around you. */
"use strict";

/* ---------- data ---------- */
let TOWNS = [], BY_ID = new Map(), GRID = null;
const LIST_CAP = 40;    // the list is the lookup surface; it can run long
const PLOT_CAP = 16;    // legibility limit for the compass plot
const CONTEXT_CAP = 300;// unnamed context markers drawn in the viewport
const LABEL_CAP = 60;   // permanent labels fed to the declutter pass

const STATE_NAMES = {
  CT:"connecticut", ME:"maine", MA:"massachusetts", NH:"new hampshire",
  NJ:"new jersey", NY:"new york", PA:"pennsylvania", RI:"rhode island", VT:"vermont",
};
const KIND_WORD = { town:"town", township:"township", city:"city", borough:"borough",
  village:"village", plantation:"plantation", municipality:"municipality",
  locality:"unincorporated community" };

const fig = s => `<span class="fig">${s}</span>`;
const fmtPop = p => p >= 1000 ? p.toLocaleString("en-US") : String(p);

/* ---------- state ---------- */
let base = null;          // where the visitor is staying (persisted)
let hub = null;           // where they are standing right now (transient)
let radius = 30, view = "map", mode = "browse";
let current = null, focusName = null, answered = false, quizCat = "shuffle";
let bands = { near: 15, mid: 30, day: 60 };
let listPage = 0, listPageSize = LIST_CAP, listData = [];

/* ---------- adaptive bands ----------------------------------------------
   15/30/60 was a Vermont assumption. Around Manhattan, 15 miles holds
   hundreds of places; in northern Maine the nearest town can be 40 miles
   out. So the bands come from how towns actually cluster around the hub:
   "next door" ends near the 10th nearest town, "a short drive" near the
   40th, and everything past that is "a day trip". The rings on the map
   are these same numbers drawn as circles, and the legend prints the
   actual mileage so the words never hide the distances. */
function computeBands(center) {
  const ds = [];
  for (const t of TOWNS) {
    if (t.g === center.g) continue;
    ds.push(milesBetween(center, t));
  }
  ds.sort((a, b) => a - b);
  const d10 = ds[Math.min(9, ds.length - 1)] || 15;
  const d40 = ds[Math.min(39, ds.length - 1)] || 30;
  const r5 = v => Math.max(5, Math.round(v / 5) * 5);
  const near = Math.min(40, r5(d10));
  const mid = Math.min(100, Math.max(near + 5, r5(d40)));
  const day = Math.min(150, Math.max(mid + 10, Math.round(mid * 2 / 10) * 10));
  return { near, mid, day };
}
function band(mi) {
  if (mi < bands.near) return { key:"near", css:"var(--near)", tcss:"var(--near-t)", hex:HEX.near, thex:HEX.neart, word:"next door" };
  if (mi < bands.mid)  return { key:"mid",  css:"var(--mid)",  tcss:"var(--mid-t)",  hex:HEX.mid,  thex:HEX.midt,  word:"a short drive" };
  return { key:"far",  css:"var(--far)",  tcss:"var(--far-t)",  hex:HEX.far,  thex:HEX.fart,  word:"a day trip" };
}
const HEX = { near:"#2E7D5B", mid:"#C07A1E", far:"#8A5A83",
              neart:"#1F6B49", midt:"#8A5210", fart:"#6E4468",
              accent:"#B7791F", accentText:"#8F5F0F",
              dim:"#8A968B", wrong:"#B3402E", ink:"#26302A" };

/* ---------- relations ---------- */
function relate(from, to) {
  const m = Distance.between(from, to);
  return { ...to, mi: m.v, m, brg: bearingBetween(from, to) };
}
function neighborsOf(of, within, cap) {
  return GRID.within(of.a, of.o, within)
    .filter(t => t.g !== of.g)
    .map(t => relate(of, t))
    .sort((a, b) => a.mi - b.mi)
    .slice(0, cap || LIST_CAP);
}
function stateTag(t, relativeTo) {
  return t.s !== (relativeTo ? relativeTo.s : base && base.s) ? ", " + t.s : "";
}
function labelOf(t, relativeTo) { return t.n + stateTag(t, relativeTo); }

/* ---------- URL <-> state ---------- */
function syncUrl() {
  if (!base) return;
  const qs = `?home=${base.g}&r=${radius}&view=${view}`;
  try { history.replaceState(null, "", qs); } catch (e) { /* file:// etc. */ }
}
function readUrl() {
  const p = new URLSearchParams(location.search);
  return { home: p.get("home"), r: parseInt(p.get("r"), 10) || null, view: p.get("view") };
}

/* ---------- radar (compass plot) ---------- */
const CX = 180, CY = 180, R_MAX = 132, GAP = 15;
const NS = "http://www.w3.org/2000/svg";
const el = (t, a) => { const n = document.createElementNS(NS, t); for (const k in a) n.setAttribute(k, a[k]); return n; };

function placeLabels(list, scale) {
  const pts = list.map(t => {
    const r = scale(t.mi), th = rad(t.brg);
    return { t, x: CX + r * Math.sin(th), y: CY - r * Math.cos(th), east: Math.sin(th) >= 0 };
  });
  const TOP = CY - R_MAX - 24, BOT = CY + R_MAX + 28;
  [true, false].forEach(side => {
    const g = pts.filter(p => p.east === side).sort((a, b) => a.y - b.y);
    let last = -Infinity;
    g.forEach(p => { p.ly = Math.max(p.y, last + GAP, TOP); last = p.ly; });
    let next = Infinity;
    for (let i = g.length - 1; i >= 0; i--) { g[i].ly = Math.min(g[i].ly, next - GAP, BOT); next = g[i].ly; }
  });
  return pts;
}

function drawPlot(center, list, blind) {
  const svg = document.getElementById("radar");
  svg.textContent = "";
  svg.parentElement.parentElement.classList.toggle("blind", !!blind);
  svg.parentElement.parentElement.classList.toggle("browse", !blind);

  const outer = list.length ? Math.max(...list.map(t => t.mi)) : radius;
  const scale = mi => (Math.sqrt(mi) / Math.sqrt(outer)) * R_MAX;

  [5, 10, 15, 25, 40, 60, 90].filter(m => m <= outer).forEach(m => {
    const r = scale(m);
    svg.appendChild(el("circle", { class: "ring", cx: CX, cy: CY, r }));
    const l = el("text", { class: "ring-label", x: CX, y: CY - r - 4 }); l.textContent = m + " mi";
    svg.appendChild(l);
  });

  [[0, "N"], [90, "E"], [180, "S"], [270, "W"]].forEach(([a, letter]) => {
    const t = rad(a);
    svg.appendChild(el("line", { class: "spoke", x1: CX, y1: CY, x2: CX + R_MAX * Math.sin(t), y2: CY - R_MAX * Math.cos(t) }));
    const l = el("text", { class: "cardinal", x: CX + (R_MAX + 15) * Math.sin(t), y: CY - (R_MAX + 15) * Math.cos(t) + 3 });
    l.textContent = letter; svg.appendChild(l);
  });

  svg.appendChild(el("circle", { class: "hub-dot" + (focusName ? " alt" : ""), cx: CX, cy: CY, r: 5 }));
  const hn = el("text", { class: "hub-name" + (focusName ? " alt" : ""), x: CX, y: CY + 18 }); hn.textContent = center.n;
  svg.appendChild(hn);
  if (!blind) {
    const h = el("text", { class: "hint", x: CX, y: CY + 32 }); h.textContent = "tap a town to stand in it";
    svg.appendChild(h);
  }

  placeLabels(list, scale).forEach(p => {
    const dx = p.east ? 9 : -9, dy = p.ly - p.y;
    const g = el("g", { class: "town" + (p.t.n === focusName ? " focus" : ""), "data-name": p.t.n });
    g.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;

    if (Math.abs(dy) > 2)
      g.appendChild(el("line", { class: "lead", x1: 0, y1: 0, x2: dx * 0.8, y2: dy }));
    g.appendChild(el("circle", { class: "dot", cx: 0, cy: 0, r: 3.5 }));
    const lab = el("text", { class: "label", x: dx, y: dy + 3, "text-anchor": p.east ? "start" : "end" });
    lab.textContent = labelOf(p.t, center);
    g.appendChild(lab);

    if (!blind) {
      g.setAttribute("tabindex", "0");
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", `${p.t.n}, ${p.t.mi.toFixed(1)} miles ${to8(p.t.brg)}. Stand here.`);
      g.addEventListener("click", () => setHub(p.t.g));
      g.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setHub(p.t.g); }
      });
    }
    svg.appendChild(g);
  });
}

/* ---------- map ---------- */
const MI = 1609.344;
const TILE_URL = "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png";
let map = null, layer = null, contextLayer = null, canvas = null, mapReady = false;
let suppressContext = false;

function initMap() {
  if (mapReady) return;
  canvas = L.canvas({ padding: 0.3 });
  map = L.map("map", { zoomControl: true, attributionControl: true, scrollWheelZoom: true, renderer: canvas })
         .setView([43.4, -72.7], 7);
  L.tileLayer(TILE_URL, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd", maxZoom: 19,
  }).addTo(map);
  contextLayer = L.layerGroup().addTo(map);
  layer = L.layerGroup().addTo(map);
  map.on("popupopen", e => {
    const b = e.popup.getElement() && e.popup.getElement().querySelector(".pop-go");
    if (b) b.addEventListener("click", () => {
      map.closePopup();
      if (b.dataset.act === "start") setBase(b.dataset.town);
      else setHub(b.dataset.town);
    }, { once: true });
  });
  map.on("zoomend moveend", () => {
    drawContext();
    setTimeout(declutter, 40);
  });
  mapReady = true;
}

/* Unnamed context dots: everything in the viewport that is not already a
   named in-range marker, capped and ranked by population so the map stays
   readable at 6,900 towns. Redrawn on every pan and zoom. */
let namedIds = new Set();
function drawContext() {
  if (!mapReady || suppressContext) return;
  contextLayer.clearLayers();
  if (map.getZoom() < 6) return;
  const b = map.getBounds();
  const cands = GRID.inBounds(b.getSouth(), b.getWest(), b.getNorth(), b.getEast())
    .filter(t => !namedIds.has(t.g))
    .sort((x, y) => (y.p || 0) - (x.p || 0))
    .slice(0, CONTEXT_CAP);
  const center = hub || base;
  for (const t of cands) {
    const dot = L.circleMarker([t.a, t.o], {
      renderer: canvas, radius: 3, color: HEX.dim, weight: 1,
      fillColor: HEX.dim, fillOpacity: .35,
    }).addTo(contextLayer);
    dot.bindTooltip(labelOf(t, center), { className: "tt tt-far", direction: "right", offset: [6, 0] });
    if (center) {
      const r = relate(center, t);
      dot.bindPopup(
        `<div class="pop-name">${labelOf(t, center)}</div>` +
        `<div class="pop-sub"><b>${r.m.label} ${to16(r.brg)}</b> of ${center.n}, ${band(r.mi).word}</div>` +
        `<button class="pop-go" data-town="${t.g}">Stand here</button>`);
    } else {
      dot.bindPopup(
        `<div class="pop-name">${t.n}, ${t.s}</div>` +
        `<button class="pop-go" data-act="start" data-town="${t.g}">Start here</button>`);
    }
  }
}

function drawMap(center, list, blind) {
  initMap();
  layer.clearLayers();
  suppressContext = blind;
  if (blind) contextLayer.clearLayers();

  namedIds = new Set(list.map(t => t.g));
  namedIds.add(center.g);

  if (!blind) {
    [[bands.near, HEX.near], [bands.mid, HEX.mid], [bands.day, HEX.far]].forEach(([m, c]) => {
      L.circle([center.a, center.o], {
        renderer: canvas, radius: m * MI, color: c, weight: 2, dashArray: "6 7", opacity: 1,
        fill: true, fillColor: c, fillOpacity: .035, interactive: false,
      }).addTo(layer);
      const edge = L.latLng(center.a, center.o).toBounds(m * MI * 2).getNorth();
      L.marker([edge, center.o], {
        interactive: false, zIndexOffset: 1000,
        icon: L.divIcon({ className: "ringtag", iconSize: [46, 14], iconAnchor: [23, 17],
          html: `<span style="color:${c}">${m} mi</span>` }),
      }).addTo(layer);
    });
  }

  const rank = new Map(list.map((t, i) => [t.g, i + 1]));
  const drawTown = (t) => {
    const isHub = t.g === center.g;
    const r = isHub ? null : relate(center, t);
    const color = isHub ? (focusName ? HEX.ink : HEX.accent) : band(r.mi).hex;
    const label = labelOf(t, center);

    const dot = L.circleMarker([t.a, t.o], {
      renderer: canvas,
      radius: isHub ? 7 : 5,
      color: "#FFFFFF", weight: isHub ? 2 : 1.25,
      fillColor: color, fillOpacity: isHub ? 1 : .9,
    }).addTo(layer);
    dot.townId = t.g;
    dot.priority = isHub ? 0 : (rank.get(t.g) || 500);

    if (blind) {
      if (isHub) dot.bindTooltip(label, { className: focusName ? "tt" : "tt tt-hub", direction: "right", offset: [6, 0], permanent: true });
      if (t.n === focusName)
        dot.setStyle({ color: "#FFFFFF", fillColor: HEX.accent, fillOpacity: 1, radius: 9, weight: 3 });
      return;
    }

    dot.bindTooltip(label, {
      className: isHub ? "tt tt-hub" : "tt",
      direction: "right", offset: [6, 0], permanent: true,
    });
    dot.bindPopup(
      `<div class="pop-name">${label}</div>` +
      (isHub
        ? `<div class="pop-sub">You are standing here</div>`
        : `<div class="pop-sub"><b>${r.m.label} ${to16(r.brg)}</b> of ${center.n}, ${band(r.mi).word}</div>` +
          `<button class="pop-go" data-town="${t.g}">Stand here</button>`));
  };

  drawTown(center);
  list.slice(0, LABEL_CAP).forEach(drawTown);

  map.invalidateSize();
  map.once("moveend zoomend", () => setTimeout(declutter, 60));
  setTimeout(declutter, 120);
  const fitR = blind ? Math.max(radius, list.length ? Math.max(...list.map(t => t.mi)) : radius)
                     : radius + 4;
  map.flyToBounds(L.latLng(center.a, center.o).toBounds(fitR * MI * 2),
                  { duration: .7, padding: [12, 12] });

  document.getElementById("mapLegend").innerHTML = blind
    ? `<b>Names stay hidden</b> until you commit to an answer below.`
    : `Rings mark ${fig(bands.near + " / " + bands.mid + " / " + bands.day + " mi")} from <b>${center.n}</b>, sized to how towns cluster around it. ` +
      `<span class="swatch" style="background:${HEX.near}"></span><b>next door</b>` +
      `<span class="swatch" style="background:${HEX.mid};margin-left:14px"></span><b>a short drive</b>` +
      `<span class="swatch" style="background:${HEX.far};margin-left:14px"></span><b>a day trip</b><br>` +
      `Tap any marker to see how far it sits from you. Tap <b>Stand here</b> and everything remeasures from that town.`;
  setTimeout(() => { map.invalidateSize(); drawContext(); }, 60);
}

function revealMap() {
  if (!mapReady || !current) return;
  layer.eachLayer(l => {
    if (!l.townId || !l.getTooltip) return;
    const t = BY_ID.get(l.townId);
    if (!t) return;
    const lit = current.lit.includes(t.n), miss = current.miss.includes(t.n);
    l.unbindTooltip();
    l.bindTooltip(labelOf(t, current.center), {
      className: "tt" + (t.g === current.center.g ? " tt-hub" : ""),
      direction: "right", offset: [6, 0],
      permanent: t.g === current.center.g || lit || miss,
    });
    if (lit)  l.setStyle({ fillColor: HEX.accent, fillOpacity: 1, radius: 7 });
    if (miss) l.setStyle({ fillColor: HEX.wrong, fillOpacity: 1, radius: 6 });
    if (lit || miss) l.priority = -1;          // the answer always keeps its label
  });
  const lg = document.getElementById("mapLegend");
  if (lg) lg.innerHTML = `<b>Answer shown.</b> The correct town is <b style="color:${HEX.accentText}">gold</b>` +
    (current.miss.length ? `, the ones you passed over are <b style="color:${HEX.wrong}">rust</b>.` : `.`);
  setTimeout(declutter, 40);
}

/* Leaflet won't de-conflict permanent tooltips, so do it here: keep the
   highest-priority label in any overlapping cluster, hide the rest. The
   input is capped (hub + at most LABEL_CAP named towns + ring tags), so
   the O(n^2) sweep stays around 60 items. */
function declutter() {
  if (!mapReady) return;
  const items = [];
  document.querySelectorAll("#map .ringtag").forEach(elm => {
    elm.style.visibility = "visible";
    items.push({ el: elm, pri: -5 });        // ring captions always win
  });
  layer.eachLayer(l => {
    if (!l.getTooltip) return;
    const tt = l.getTooltip();
    if (!tt || !tt.options.permanent) return;
    const elm = tt.getElement();
    if (!elm) return;
    elm.style.visibility = "visible";
    items.push({ el: elm, pri: l.priority == null ? 999 : l.priority });
  });
  items.sort((a, b) => a.pri - b.pri);
  const kept = [];
  const PAD = 2;
  items.forEach(it => {
    const b = it.el.getBoundingClientRect();
    if (!b.width) return;
    const r = { left: b.left - PAD, right: b.right + PAD, top: b.top - PAD, bottom: b.bottom + PAD };
    const clash = kept.some(k => !(r.right < k.left || r.left > k.right || r.bottom < k.top || r.top > k.bottom));
    if (clash) it.el.style.visibility = "hidden";
    else kept.push(r);
  });
}

/* ---------- one entry point for both views ---------- */
function paint(center, list, blind) {
  const mapOn = view === "map";
  document.getElementById("map").classList.toggle("hidden", !mapOn);
  document.getElementById("mapLegend").classList.toggle("hidden", !mapOn);
  document.getElementById("plotWrap").classList.toggle("hidden", mapOn);
  if (mapOn) drawMap(center, list, blind);
  else drawPlot(center, list.slice(0, PLOT_CAP), blind);
}

/* ---------- browse view ---------- */
function drawList(list) {
  listData = list;
  renderListPage();
}

function renderListPage() {
  const ol = document.getElementById("list");
  const pager = document.getElementById("pager");
  ol.textContent = "";
  if (!listData.length) {
    ol.innerHTML = `<li class="empty"><b>Nothing on file within ${radius} miles of here.</b> Widen the radius above, or type another town and stand there instead.</li>`;
    pager.classList.add("hidden");
    updateListFoot();
    return;
  }
  const pages = Math.max(1, Math.ceil(listData.length / listPageSize));
  listPage = Math.min(listPage, pages - 1);
  const from = listPage * listPageSize;
  const slice = listData.slice(from, from + listPageSize);

  slice.forEach(t => {
    const b = document.createElement("button");
    b.className = "row";
    b.innerHTML =
      `<span class="compass" style="color:${band(t.mi).tcss}">${to16(t.brg)}</span>` +
      `<span class="name">${t.n}<i>${stateTag(t, hub)}</i></span>` +
      `<span class="dist">${t.mi.toFixed(1)}<span>mi</span></span>`;
    b.addEventListener("click", () => setHub(t.g));
    const li = document.createElement("li"); li.appendChild(b); ol.appendChild(li);
  });

  if (pages > 1) {
    pager.classList.remove("hidden");
    document.getElementById("pageInfo").textContent =
      `${from + 1} to ${Math.min(from + listPageSize, listData.length)} of ${listData.length}`;
    document.getElementById("pagePrev").disabled = listPage === 0;
    document.getElementById("pageNext").disabled = listPage >= pages - 1;
  } else {
    pager.classList.add("hidden");
  }
  updateListFoot();
}

function updateListFoot() {
  const f = document.getElementById("listFoot");
  if (!listData.length) { f.innerHTML = ""; return; }
  f.innerHTML =
    `${fig(listData.length)} <b>town${listData.length > 1 ? "s" : ""}</b> within ${fig(radius + " mi")} of <b>${hub.n}</b>. ` +
    `These are <b>straight-line miles</b>, so the road will always be longer. ` +
    `In hill country that gap gets wide, and a short distance east can cost you ` +
    `more time than a long one north. Around here, <b>next door</b> means under ` +
    `${fig(bands.near + " mi")} and <b>a day trip</b> starts past ${fig(bands.mid + " mi")}.`;
}

/* ---------- head ---------- */
function renderHead() {
  document.getElementById("onboard").classList.toggle("hidden", !!base);
  document.getElementById("hubBlock").classList.toggle("hidden", !base);
  if (!base) return;

  document.getElementById("hubName").textContent = hub.n;
  document.getElementById("hubState").textContent = hub.s;
  const kl = document.getElementById("kindLine");
  kl.textContent = KIND_WORD[hub.k] + (hub.c ? " in " + hub.c + " County" : "") +
    (hub.p ? " · " + fmtPop(hub.p) + " people" : "");

  const fh = document.getElementById("fromHome");
  const mk = document.getElementById("makeBase");
  const bk = document.getElementById("backBase");
  if (hub.g === base.g) {
    fh.style.setProperty("--band", "var(--near)");
    fh.style.setProperty("--band-t", "var(--near-t)");
    fh.innerHTML = `<b style="font-family:var(--ui);font-size:14.5px;color:var(--ink)">Your base.</b> <i>Every distance below is measured from this spot.</i>`;
    mk.classList.add("hidden"); bk.classList.add("hidden");
  } else {
    const r = relate(base, hub), bd = band(r.mi);
    fh.style.setProperty("--band", bd.css);
    fh.style.setProperty("--band-t", bd.tcss);
    fh.innerHTML = `<b>${r.m.label}</b> <em>${to16(r.brg)}</em> of ${base.n}, your base. <em>${bd.word}</em>.`;
    mk.classList.remove("hidden"); bk.classList.remove("hidden");
  }
}

function render() {
  renderHead();
  if (!base) { renderOverview(); return; }
  const list = neighborsOf(hub, radius);
  if (mode === "browse") { paint(hub, list, false); drawList(list); fitPanel(); }
}

/* before a base exists: the whole region, ready to be tapped */
function renderOverview() {
  if (view !== "map") { setView("map"); return; }
  initMap();
  layer.clearLayers();
  namedIds = new Set();
  suppressContext = false;
  map.fitBounds([[38.9, -80.6], [47.5, -66.8]]);
  document.getElementById("mapLegend").innerHTML =
    `Every dot is a town. Tap one and <b>Start here</b>, or use the search up top. ` +
    `Once you have a base, the map redraws around it.`;
  document.getElementById("list").innerHTML =
    `<li class="empty"><b>No base yet.</b> Type the town you are staying in, up top, and this list fills with everything around it.</li>`;
  document.getElementById("pager").classList.add("hidden");
  document.getElementById("listFoot").innerHTML = "";
  setTimeout(() => { map.invalidateSize(); drawContext(); }, 60);
}

function setHub(geoid) {
  const t = BY_ID.get(geoid);
  if (!t) return;
  hub = t;
  bands = computeBands(hub);
  listPage = 0;
  if (mode === "quiz") { showTab("list"); } else { render(); }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setBase(geoid) {
  const t = BY_ID.get(geoid);
  if (!t) return;
  base = t; hub = t;
  bands = computeBands(hub);
  listPage = 0;
  Store.patch({ home: t.g });
  syncUrl();
  if (mode === "quiz") { showTab("list"); } else { render(); }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- search ---------- */
const qEl = document.getElementById("q"), hitsEl = document.getElementById("hits");

/* "springfield ma", "springfield, massachusetts" and plain "springfield"
   all work; results are ranked by population so the one you have heard
   of comes first. */
function searchTowns(query) {
  let s = query.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (s.length < 2) return [];
  let stateFilter = null;
  for (const [abbr, full] of Object.entries(STATE_NAMES)) {
    if (s.endsWith(" " + full)) { stateFilter = abbr; s = s.slice(0, -(full.length + 1)).trim(); break; }
    if (s.endsWith(" " + abbr.toLowerCase())) { stateFilter = abbr; s = s.slice(0, -3).trim(); break; }
  }
  const needle = s;
  if (!needle) return [];
  const scored = [];
  for (const t of TOWNS) {
    if (stateFilter && t.s !== stateFilter) continue;
    const n = t.nl;
    let tier;
    if (n === needle) tier = 0;
    else if (n.startsWith(needle)) tier = 1;
    else if (n.includes(needle)) tier = 2;
    else continue;
    scored.push([tier, -(t.p || 0), t]);
  }
  scored.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return scored.slice(0, 7).map(x => x[2]);
}

qEl.addEventListener("input", () => {
  hitsEl.textContent = "";
  const results = searchTowns(qEl.value);
  results.forEach(t => {
    const b = document.createElement("button");
    b.className = "hit";
    let dist = "";
    if (base) {
      const r = relate(base, t);
      dist = t.g === base.g ? `<span class="hd" style="color:var(--accent)">your base</span>`
           : `<span class="hd" style="color:${band(r.mi).tcss}">${r.m.label} ${to16(r.brg)}</span>`;
    }
    b.innerHTML =
      `<span class="hn"><b>${t.n}, ${t.s}</b>${dist}</span>` +
      `<span class="hs">${KIND_WORD[t.k]}${t.c ? " in " + t.c + " County" : ""}${t.p ? " · " + fmtPop(t.p) + " people" : ""}</span>`;
    b.addEventListener("click", () => {
      qEl.value = ""; hitsEl.textContent = "";
      if (!base) setBase(t.g);
      else { showTab("list"); setHub(t.g); }
    });
    hitsEl.appendChild(b);
  });
});
document.addEventListener("click", e => {
  if (!e.target.closest(".find")) hitsEl.textContent = "";
});

/* ---------- base controls ---------- */
document.getElementById("makeBase").addEventListener("click", () => setBase(hub.g));
document.getElementById("backBase").addEventListener("click", () => setHub(base.g));
document.getElementById("moveBase").addEventListener("click", () => {
  qEl.focus();
  qEl.placeholder = "Type the town you are staying in now";
});
document.getElementById("locateBtn").addEventListener("click", () => {
  const note = document.getElementById("locateNote");
  if (!navigator.geolocation) {
    note.textContent = "This browser keeps its location to itself. The search box works without it.";
    return;
  }
  note.textContent = "Asking your browser where you are...";
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: la, longitude: lo } = pos.coords;
    let cands = [];
    for (const r of [25, 60, 150]) {
      cands = GRID.within(la, lo, r);
      if (cands.length) break;
    }
    if (!cands.length) {
      note.textContent = "You seem to be outside the Northeast. Type the town you are headed to instead.";
      return;
    }
    const from = { a: la, o: lo };
    const nearest = cands.reduce((m, t) => milesBetween(from, t) < milesBetween(from, m) ? t : m);
    note.textContent = "";
    setBase(nearest.g);
  }, () => {
    note.textContent = "No luck getting a location. No matter, the search box works without it.";
  }, { timeout: 8000 });
});

/* ---------- radius ---------- */
document.querySelectorAll(".chip").forEach(c => {
  c.addEventListener("click", () => {
    radius = +c.dataset.r;
    listPage = 0;
    document.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", x === c));
    Store.patch({ radius });
    syncUrl();
    if (mode !== "quiz") { render(); return; }
    // in the quiz, radius only shapes the NEXT question; never advance
    // the current one, and never wipe an answer already given
    if (current) { paint(current.center, current.near, !answered); if (answered) revealAfterSwitch(); }
  });
});

/* ---------- quiz ---------- */
const stats = Store.load().quiz;
let right = stats.right, asked = stats.asked, streak = stats.streak, best = stats.best;
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffled = a => a.slice().sort(() => Math.random() - .5);

const CATS = [
  { k: "shuffle",     label: "Shuffle" },
  { k: "closer",      label: "Closer" },
  { k: "farthest",    label: "Farthest" },
  { k: "direction",   label: "Direction" },
  { k: "distance",    label: "How far" },
  { k: "identify",    label: "Name it" },
  { k: "withinReach", label: "Within reach" },
];
const KINDS = CATS.filter(c => c.k !== "shuffle").map(c => c.k);

const BUCKETS = [
  { lo: 0,  hi: 5,   label: "Under 5 mi" },
  { lo: 5,  hi: 10,  label: "5 to 10 mi" },
  { lo: 10, hi: 20,  label: "10 to 20 mi" },
  { lo: 20, hi: 35,  label: "20 to 35 mi" },
  { lo: 35, hi: 60,  label: "35 to 60 mi" },
  { lo: 60, hi: 1e9, label: "Over 60 mi" },
];
const bucketOf = mi => BUCKETS.findIndex(b => mi >= b.lo && mi < b.hi);

/* Each builder returns null if the current data can't support it, so the
   caller can try another anchor or fall back to a different type. */
const BUILD = {

  closer(anchor, near) {
    for (let i = 0; i < 24; i++) {
      const a = pick(near), b = pick(near);
      if (a.g === b.g) continue;
      if (Math.max(a.mi, b.mi) / Math.min(a.mi, b.mi) < 1.3) continue;
      const [close, other] = a.mi < b.mi ? [a, b] : [b, a];
      return { kind: "closer",
        text: `Which sits closer to <em>${anchor.n}</em>?`,
        options: shuffled([labelOf(a, anchor), labelOf(b, anchor)]),
        answer: labelOf(close, anchor), lit: [close.n], miss: [other.n],
        why: `<b>${close.n}</b> sits ${fig(close.m.label)} <b>${to8(close.brg)}</b>. ` +
             `<b>${other.n}</b> is further out at ${fig(other.m.label)} <b>${to8(other.brg)}</b>.` };
    }
    return null;
  },

  farthest(anchor, near) {
    if (near.length < 5) return null;
    for (let i = 0; i < 24; i++) {
      const three = shuffled(near).slice(0, 3);
      const sorted = three.slice().sort((x, y) => x.mi - y.mi);
      if (sorted[2].mi / sorted[1].mi < 1.25) continue;   // needs a clear winner
      const far = sorted[2];
      return { kind: "farthest",
        text: `Which of these is <em>farthest</em> from ${anchor.n}?`,
        options: three.map(t => labelOf(t, anchor)),
        answer: labelOf(far, anchor), lit: [far.n], miss: [],
        why: "Furthest first: " + three.slice().sort((x, y) => y.mi - x.mi)
              .map(t => `<b>${t.n}</b> ${fig(t.m.label)}`).join(" · ") + "." };
    }
    return null;
  },

  direction(anchor, near) {
    const target = pick(near.slice(0, 10));
    if (!target) return null;
    const correct = to8(target.brg);
    return { kind: "direction",
      text: `Leaving <em>${anchor.n}</em>, which way is ${labelOf(target, anchor)}?`,
      options: shuffled([correct, ...shuffled(P8.filter(p => p !== correct)).slice(0, 3)]),
      answer: correct, lit: [target.n], miss: [],
      why: `<b>${target.n}</b> lies <b>${correct}</b> of <b>${anchor.n}</b>, ` +
           `${fig(target.m.label)} out, bearing ${fig(Math.round(target.brg) + "°")}.` };
  },

  distance(anchor, near) {
    const target = pick(near);
    if (!target) return null;
    const bi = bucketOf(target.mi);
    if (bi < 0) return null;
    const others = shuffled(BUCKETS.map((b, i) => i).filter(i => i !== bi)).slice(0, 3);
    return { kind: "distance",
      text: `Roughly how far is it from <em>${anchor.n}</em> to ${labelOf(target, anchor)}?`,
      options: shuffled([bi, ...others]).map(i => BUCKETS[i].label),
      answer: BUCKETS[bi].label, lit: [target.n], miss: [],
      why: `${fig(target.m.label)} <b>${to8(target.brg)}</b> as the crow flies. ` +
           `Allow more than that by road, and more again if the way runs over high ground.` };
  },

  identify(anchor, near) {
    const target = pick(near.slice(0, 10));
    if (!target || near.length < 4) return null;
    const decoys = shuffled(near.filter(t => t.g !== target.g)).slice(0, 3);
    if (decoys.length < 3) return null;
    return { kind: "identify", focus: target.n,
      text: `One town near <em>${anchor.n}</em> is marked in gold. Which is it?`,
      options: shuffled([target, ...decoys]).map(t => labelOf(t, anchor)),
      answer: labelOf(target, anchor), lit: [target.n], miss: [],
      why: `<b>${target.n}</b>, ${fig(target.m.label)} <b>${to8(target.brg)}</b> of <b>${anchor.n}</b>.` };
  },

  /* the visitor question: is this town inside your chosen radius of your
     base? The chosen radius is tried first; sparse country falls back to
     tighter bands rather than failing to build. */
  withinReach() {
    const center = hub;
    const scored = GRID.within(center.a, center.o, Math.max(radius, bands.mid) * 3)
      .filter(t => t.g !== center.g).map(t => relate(center, t));
    const tries = [...new Set([radius, bands.mid, bands.near, 10])].filter(b => b >= 5);
    for (const b of tries) {
      const inside = scored.filter(t => t.mi <= b * 0.9);
      let outside = scored.filter(t => t.mi > b * 1.1);
      if (!inside.length || outside.length < 3) continue;
      // near-misses teach more than obviously distant towns
      const tight = outside.filter(t => t.mi <= b * 2.5);
      if (tight.length >= 3) outside = tight;
      const hit = pick(inside);
      const decoys = shuffled(outside).slice(0, 3);
      return { kind: "withinReach", center,
        near: neighborsOf(center, Math.max(b, radius), PLOT_CAP),
        text: `Which of these is within <em>${b} miles</em> of ${center.n}?`,
        options: shuffled([hit, ...decoys]).map(t => labelOf(t, center)),
        answer: labelOf(hit, center), lit: [hit.n], miss: decoys.map(t => t.n),
        why: `<b>${hit.n}</b> sits ${fig(hit.m.label)} <b>${to16(hit.brg)}</b>. ` +
             "<b>Past the line:</b> " + decoys.map(t => `${t.n} ${fig(t.m.label)}`).join(" · ") + "." };
    }
    return null;
  },
};

/* anchors come from around the visitor's own standpoint and radius */
function quizPool() {
  for (const r of [Math.max(radius, 25), 60, 120]) {
    const pool = GRID.within(hub.a, hub.o, r);
    if (pool.length >= 5) return pool;
  }
  return TOWNS;
}

function buildQuestion() {
  const wanted = quizCat === "shuffle" ? null : quizCat;
  const pool = quizPool();
  for (let attempt = 0; attempt < 90; attempt++) {
    const kind = wanted || pick(KINDS);
    if (kind === "withinReach") {
      const q = BUILD.withinReach();
      if (!q) continue;
      return Object.assign({ anchor: q.center, focus: null }, q);
    }
    const anchor = pick(pool);
    let near = null;
    for (const r of [Math.max(radius, 20), 45, 90, 160]) {
      near = neighborsOf(anchor, r, PLOT_CAP);
      if (near.length >= 4) break;
    }
    if (!near || near.length < 4) continue;
    const q = BUILD[kind](anchor, near);
    if (!q) continue;
    return Object.assign({ anchor, near, center: anchor, focus: null }, q);
  }
  return null;
}

function askQuestion() {
  answered = false;
  current = buildQuestion();
  const askEl = document.getElementById("ask");
  const box = document.getElementById("opts");
  document.getElementById("verdict").textContent = "";
  document.getElementById("next").classList.add("hidden");
  document.getElementById("askNote").classList.remove("hidden");
  box.textContent = "";

  if (!current) {
    askEl.textContent = "Not enough towns in range for that question type. Widen the radius, or pick another type.";
    paintScore();
    fitPanel();
    return;
  }
  askEl.innerHTML = current.text;
  focusName = current.focus || null;
  paint(current.center, current.near, true);          // blind: no names in either view

  current.options.forEach(o => {
    const b = document.createElement("button");
    b.className = "opt";
    b.textContent = current.kind === "direction" ? o[0].toUpperCase() + o.slice(1) : o;
    b.addEventListener("click", () => answerQ(o, box));
    box.appendChild(b);
  });
  paintScore();
  fitPanel();
}

function answerQ(choice, box) {
  if (answered) return;                                // one answer per question
  asked++; answered = true;
  current.chosen = choice;
  const ok = choice === current.answer;
  if (ok) { right++; streak++; best = Math.max(best, streak); } else streak = 0;
  Store.patchQuiz({ right, asked, streak, best });

  [...box.children].forEach(b => {
    b.disabled = true;
    const val = current.kind === "direction" ? b.textContent.toLowerCase() : b.textContent;
    if (val === current.answer) b.classList.add("right");
    else if (val === choice) b.classList.add("wrong");
  });

  focusName = null;
  revealAfterSwitch();                                 // the view fills in as the reward
  document.getElementById("verdict").innerHTML =
    (ok ? `<span class="lede">Right.</span> ` : `<span class="lede no">Not quite.</span> `) + current.why;
  document.getElementById("next").classList.remove("hidden");
  paintScore();
  fitPanel();
}

function paintScore() {
  document.getElementById("score").innerHTML =
    `<b>${right}</b> of <b>${asked}</b> &nbsp;·&nbsp; streak <b>${streak}</b> &nbsp;·&nbsp; best <b>${best}</b>`;
}

/* category picker */
(function buildCats() {
  const box = document.getElementById("cats");
  CATS.forEach(c => {
    const b = document.createElement("button");
    b.className = "cat"; b.dataset.k = c.k; b.textContent = c.label;
    b.setAttribute("aria-pressed", c.k === quizCat);
    b.addEventListener("click", () => {
      quizCat = c.k;
      box.querySelectorAll(".cat").forEach(x => x.setAttribute("aria-pressed", x === b));
      askQuestion();                                   // a type change starts a fresh question
    });
    box.appendChild(b);
  });
})();

document.getElementById("next").addEventListener("click", askQuestion);

/* ---------- tabs ---------- */
function showTab(which) {
  mode = which === "list" ? "browse" : "quiz";
  document.getElementById("tabList").setAttribute("aria-selected", mode === "browse");
  document.getElementById("tabQuiz").setAttribute("aria-selected", mode === "quiz");
  document.getElementById("paneList").classList.toggle("hidden", mode !== "browse");
  document.getElementById("paneQuiz").classList.toggle("hidden", mode !== "quiz");
  if (!base) {
    if (mode === "quiz") {
      document.getElementById("ask").textContent =
        "Pick a base first: type the town you are staying in, up top. Then the questions build themselves around you.";
      document.getElementById("askNote").classList.add("hidden");
      document.getElementById("opts").textContent = "";
      paintScore();
    }
    return;
  }
  if (mode === "browse") render(); else askQuestion();
}
document.getElementById("tabList").addEventListener("click", () => showTab("list"));
document.getElementById("tabQuiz").addEventListener("click", () => showTab("quiz"));

/* ---------- the panel always fits: pagination, not scrolling ----------
   On desktop the sidebar is a fixed-height cell and never scrolls. The
   neighbour list is paginated to the rows that actually fit, and the quiz
   pane steps through compaction levels until it fits. Recomputed on every
   resize, tab switch, radius change and font load via ResizeObserver. */
const detailEl = document.getElementById("detail");

function fitList() {
  if (!listData.length) return;
  const ol = document.getElementById("list");
  const probe = ol.querySelector(".row");
  if (!probe) return;
  const rowH = probe.getBoundingClientRect().height || 49;
  const cols = getComputedStyle(ol).gridTemplateColumns.split(" ").length || 1;
  const avail = ol.clientHeight;
  // leave one row of air for the pager when it will be needed
  let fit = Math.max(3, Math.floor(avail / rowH) * cols);
  if (fit < listData.length) fit = Math.max(3, fit - cols);
  if (fit !== listPageSize) {
    listPageSize = fit;
    renderListPage();
  }
}

function fitQuiz() {
  detailEl.classList.remove("compact", "compact2", "compact3");
  const fits = () => detailEl.scrollHeight <= detailEl.clientHeight + 1;
  for (const step of ["compact", "compact2", "compact3"]) {
    if (fits()) return;
    detailEl.classList.add(step);
  }
  if (fits()) return;
  // last resort: shed options, down to three unanswered (question, answer
  // and one decoy once answered), so the Next button is never the thing
  // that falls off the bottom
  const box = document.getElementById("opts");
  const floor = answered ? 2 : 3;
  while (box.children.length > floor && !fits()) {
    const kill = [...box.children].reverse().find(b => {
      if (!current) return false;
      const val = current.kind === "direction" ? b.textContent.toLowerCase() : b.textContent;
      return val !== current.answer && (!answered || val !== current.chosen);
    });
    if (!kill) break;
    current.options = current.options.filter(o => {
      const shown = current.kind === "direction" ? o[0].toUpperCase() + o.slice(1) : o;
      return shown !== kill.textContent;
    });
    kill.remove();
  }
}

let fitQueued = false;
function fitPanel() {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => {
    fitQueued = false;
    detailEl.classList.remove("compact", "compact2");
    if (mode === "browse") {
      fitList();
      // rows beat the footnote: when fewer than 8 fit, trade the footnote
      // and some row padding for more of the list
      if (listData.length > listPageSize &&
          (listPageSize < 8 || detailEl.scrollHeight > detailEl.clientHeight + 1)) {
        detailEl.classList.add("compact2");   // shrinks rows, hides the footnote
        fitList();
      }
    } else {
      fitQuiz();
    }
  });
}
if (window.ResizeObserver) new ResizeObserver(() => fitPanel()).observe(detailEl);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitPanel());

document.getElementById("pagePrev").addEventListener("click", () => { listPage--; renderListPage(); });
document.getElementById("pageNext").addEventListener("click", () => { listPage++; renderListPage(); });

/* ---------- keep the stage sized to the viewport ---------- */
let resizeTimer = null;
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (mapReady && view === "map") map.invalidateSize();
    fitPanel();
  }, 140);
}
window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", onResize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", onResize);

/* ---------- view toggle ---------- */
function setView(v) {
  view = v;
  document.getElementById("viewMap").setAttribute("aria-pressed", v === "map");
  document.getElementById("viewCompass").setAttribute("aria-pressed", v === "compass");
  Store.patch({ view });
  syncUrl();
  if (!base) { renderOverview(); return; }
  if (mode === "browse") { render(); return; }
  if (!current) return;
  paint(current.center, current.near, !answered);
  if (answered) revealAfterSwitch();
}
function revealAfterSwitch() {
  if (view === "map") revealMap();
  else document.querySelectorAll("#radar .town").forEach(g => {
    g.classList.add("show");
    if (current.lit.includes(g.dataset.name)) g.classList.add("lit");
    if (current.miss.includes(g.dataset.name)) g.classList.add("miss");
  });
}
document.getElementById("viewMap").addEventListener("click", () => setView("map"));
document.getElementById("viewCompass").addEventListener("click", () => setView("compass"));

/* ---------- go ---------- */
function boot() {
  const saved = Store.load();
  const url = readUrl();
  radius = url.r || saved.radius || 30;
  if (![5, 15, 30, 45, 60].includes(radius)) radius = 30;
  view = (url.view === "compass" || url.view === "map") ? url.view : (saved.view || "map");
  document.querySelectorAll(".chip").forEach(c =>
    c.setAttribute("aria-pressed", +c.dataset.r === radius));
  document.getElementById("viewMap").setAttribute("aria-pressed", view === "map");
  document.getElementById("viewCompass").setAttribute("aria-pressed", view === "compass");

  fetch("data/towns.json")
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => {
      TOWNS = d.towns;
      for (const t of TOWNS) { t.nl = t.n.toLowerCase(); BY_ID.set(t.g, t); }
      GRID = new Grid(TOWNS);
      const homeId = url.home || saved.home;
      if (homeId && BY_ID.has(homeId)) {
        base = hub = BY_ID.get(homeId);
        bands = computeBands(hub);
        Store.patch({ home: homeId, radius, view });
        syncUrl();
      }
      render();
    })
    .catch(() => {
      document.getElementById("onboard").classList.remove("hidden");
      document.getElementById("onboard").innerHTML =
        `<h2>The town list did not load.</h2>
         <p>This page needs its data file, so it has to be served over http.
         If you are running it locally, start a small server in this folder
         (for example: python3 -m http.server) and reload.</p>`;
    });
}
boot();
