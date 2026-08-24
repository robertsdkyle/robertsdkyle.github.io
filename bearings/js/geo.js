/* Geodesy, spatial index, and the distance abstraction.
   Everything that needs a distance asks Distance.between(); when real
   drive time arrives it becomes a second provider behind the same call,
   and a measurement always carries its own unit and label so "26 min"
   can occupy the same slot as "12.4 mi". */

const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;

function milesBetween(a, b) {
  const R = 3958.8, dLat = rad(b.a - a.a), dLng = rad(b.o - a.o);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.a)) * Math.cos(rad(b.a)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingBetween(a, b) {
  const dLng = rad(b.o - a.o);
  const y = Math.sin(dLng) * Math.cos(rad(b.a));
  const x = Math.cos(rad(a.a)) * Math.sin(rad(b.a)) -
            Math.sin(rad(a.a)) * Math.cos(rad(b.a)) * Math.cos(dLng);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const P16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const P8  = ["north","northeast","east","southeast","south","southwest","west","northwest"];
const to16 = b => P16[Math.round(b / 22.5) % 16];
const to8  = b => P8[Math.round(b / 45) % 8];

/* The single distance function (section: build for drive time without
   building drive time). A measurement is {v, unit, label}. */
const Distance = {
  between(a, b) {
    const v = milesBetween(a, b);
    return { v, unit: "mi", label: v.toFixed(1) + " mi" };
  },
  labelFor(v) { return v.toFixed(1) + " mi"; },
};

/* Half-degree spatial buckets. 6,900 towns means any radius query touches
   a handful of cells; good enough and simple. */
class Grid {
  constructor(items) {
    this.cells = new Map();
    for (const t of items) {
      const k = this.key(t.a, t.o);
      if (!this.cells.has(k)) this.cells.set(k, []);
      this.cells.get(k).push(t);
    }
  }
  key(lat, lng) { return (Math.floor(lat * 2)) + ":" + (Math.floor(lng * 2)); }
  /* all towns within `mi` miles of (lat,lng) */
  within(lat, lng, mi) {
    const span = Math.floor(mi / 34.5) + 1;
    const cy = Math.floor(lat * 2), cx = Math.floor(lng * 2);
    const out = [];
    const from = { a: lat, o: lng };
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span - 1; dx <= span + 1; dx++) {
        const cell = this.cells.get((cy + dy) + ":" + (cx + dx));
        if (!cell) continue;
        for (const t of cell) {
          if (milesBetween(from, t) <= mi) out.push(t);
        }
      }
    }
    return out;
  }
  /* towns inside a lat/lng bounding box, for viewport rendering */
  inBounds(s, w, n, e) {
    const out = [];
    for (let cy = Math.floor(s * 2); cy <= Math.floor(n * 2); cy++) {
      for (let cx = Math.floor(w * 2); cx <= Math.floor(e * 2); cx++) {
        const cell = this.cells.get(cy + ":" + cx);
        if (!cell) continue;
        for (const t of cell) {
          if (t.a >= s && t.a <= n && t.o >= w && t.o <= e) out.push(t);
        }
      }
    }
    return out;
  }
}
