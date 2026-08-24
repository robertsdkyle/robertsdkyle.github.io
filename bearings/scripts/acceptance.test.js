/* Acceptance tests (sections 3c and 7 of the build spec).
   Run: node scripts/acceptance.test.js [--base-url http://localhost:8901]
   Needs playwright and a chromium binary (CHROMIUM_PATH overrides). */
const { chromium } = require("playwright");

const BASE = process.argv.includes("--base-url")
  ? process.argv[process.argv.indexOf("--base-url") + 1]
  : "http://localhost:8901";
const EXEC = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";

const WOODSTOCK = "5002785975";   // mid-density Vermont
const MANHATTAN = "3606144919";   // the dense extreme
const ALLAGASH  = "2300300800";   // the sparse extreme (far northern Maine)

const SIZES = [
  [360, 900], [390, 900], [768, 900], [834, 900],
  [1280, 900], [1920, 1080], [2560, 1440],
  [360, 640], [1280, 720],
];

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
}

async function panelAsserts(p, label) {
  const r = await p.evaluate(() => {
    const d = document.getElementById("detail");
    const scrollers = [];
    document.querySelectorAll("*").forEach(el => {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && !el.closest("#map")) {
        scrollers.push(el.tagName + "." + (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className));
      }
    });
    return {
      sh: d.scrollHeight, ch: d.clientHeight,
      scrollers,
      hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check(`${label} panel fits (scrollHeight ${r.sh} <= clientHeight ${r.ch} + 1)`, r.sh <= r.ch + 1);
  check(`${label} no nested scrollers`, r.scrollers.length === 0, r.scrollers.join(", "));
  check(`${label} no horizontal scroll`, r.hscroll <= 0, `overflow ${r.hscroll}px`);
}

(async () => {
  const b = await chromium.launch({ executablePath: EXEC });

  console.log("\n== Layout matrix (base Woodstock, radius 60, both tabs) ==");
  for (const [w, h] of SIZES) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    p.on("pageerror", e => errors.push(e.message));
    await p.goto(`${BASE}/?home=${WOODSTOCK}&r=60&view=map`);
    await p.waitForSelector("#list .row", { timeout: 15000 });
    await p.waitForTimeout(1400);
    console.log(`-- ${w}x${h}`);
    await panelAsserts(p, "neighbors");
    await p.click("#tabQuiz");
    await p.waitForTimeout(900);
    await panelAsserts(p, "quiz(unanswered)");
    const opt = await p.$("#opts .opt");
    if (opt) { await opt.click(); await p.waitForTimeout(700); }
    await panelAsserts(p, "quiz(answered)");
    check("no page errors", errors.length === 0, errors.join(" | "));
    await p.close();
  }

  console.log("\n== All six quiz types build and answer, dense and sparse ==");
  for (const [name, geoid] of [["Manhattan", MANHATTAN], ["Allagash ME", ALLAGASH]]) {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    p.on("pageerror", e => errors.push(e.message));
    await p.goto(`${BASE}/?home=${geoid}&r=30&view=map`);
    await p.waitForSelector("#list .row", { timeout: 15000 });
    await p.click("#tabQuiz");
    await p.waitForTimeout(600);
    console.log(`-- base: ${name}`);
    for (const cat of ["closer", "farthest", "direction", "distance", "identify", "withinReach"]) {
      await p.click(`.cat[data-k="${cat}"]`);
      await p.waitForTimeout(700);
      const nOpts = await p.$$eval("#opts .opt", els => els.length);
      const ask = (await p.textContent("#ask")).trim();
      const built = nOpts >= 2 && !/Not enough towns/.test(ask);
      check(`${cat} builds (${nOpts} options)`, built, ask.slice(0, 60));
      if (built) {
        await p.click("#opts .opt");
        await p.waitForTimeout(500);
        const verdict = (await p.textContent("#verdict")).trim();
        check(`${cat} answers`, verdict.length > 0);
      }
    }
    check("no page errors", errors.length === 0, errors.join(" | "));
    await p.close();
  }

  console.log("\n== Markers and rings actually render (regression: svg width rule) ==");
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    await p.goto(`${BASE}/?home=${WOODSTOCK}&r=30&view=map`);
    await p.waitForSelector("#list .row", { timeout: 15000 });
    await p.waitForTimeout(1800);
    const m = await p.evaluate(() => {
      const canvas = document.querySelector("#map canvas");
      const tags = document.querySelectorAll("#map .ringtag").length;
      const tips = [...document.querySelectorAll("#map .tt")].filter(t => t.style.visibility !== "hidden").length;
      let painted = 0;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < d.length; i += 400) if (d[i] > 0) painted++;
      }
      return { hasCanvas: !!canvas, painted, tags, tips };
    });
    check("canvas renderer present", m.hasCanvas);
    check("canvas has painted pixels (markers/rings)", m.painted > 20, String(m.painted));
    check("ring captions present", m.tags === 3, String(m.tags));
    check("visible town labels", m.tips > 5, String(m.tips));
    // compass view renders towns
    await p.click("#viewCompass");
    await p.waitForTimeout(700);
    const towns = await p.$$eval("#radar .town", els => els.length);
    check("compass plot towns", towns > 5 && towns <= 16, String(towns));
    await p.close();
  }

  console.log("\n== Em dash scan of rendered text across views and quiz types ==");
  {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    await p.goto(`${BASE}/?home=${WOODSTOCK}&r=60&view=map`);
    await p.waitForSelector("#list .row", { timeout: 15000 });
    let dirty = [];
    async function scan(tag) {
      const t = await p.evaluate(() => document.body.innerText + " " + document.title);
      if (t.includes("—")) dirty.push(tag);
    }
    await scan("neighbors/map");
    await p.click("#viewCompass"); await p.waitForTimeout(400); await scan("compass");
    await p.click("#viewMap"); await p.waitForTimeout(400);
    await p.click("#tabQuiz");
    for (const cat of ["closer", "farthest", "direction", "distance", "identify", "withinReach"]) {
      await p.click(`.cat[data-k="${cat}"]`); await p.waitForTimeout(500);
      await scan(cat + "/question");
      const opt = await p.$("#opts .opt");
      if (opt) { await opt.click(); await p.waitForTimeout(400); await scan(cat + "/verdict"); }
    }
    // onboarding copy too
    await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await p.goto(BASE + "/"); await p.waitForTimeout(800); await scan("onboarding");
    check("zero em dashes in rendered text", dirty.length === 0, dirty.join(", "));
    await p.close();
  }

  await b.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
