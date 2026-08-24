/* Store: the only code that knows where persistent state lives.
   One serializable object, one schema version, one storage key. When
   sign-in arrives in v2, swapping localStorage for an API happens here
   and nowhere else. Nothing in the object references the DOM, and
   nothing derived is stored; it should read cleanly as a JSON payload. */
const Store = (() => {
  const KEY = "bearings.state";

  const DEFAULTS = () => ({
    version: 1,
    home: null,          // GEOID of the visitor's base, or null before onboarding
    radius: 30,          // miles
    view: "map",         // "map" | "compass"
    quiz: {
      right: 0, asked: 0, streak: 0, best: 0,
      updatedAt: null,   // ISO timestamp of the last answered question
    },
  });

  /* v2 will read v1 state through this. It does nothing yet on purpose. */
  function migrate(state) {
    if (!state.version) state.version = 1;
    return state;
  }

  let cache = null;

  function load() {
    if (cache) return cache;
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* storage unavailable */ }
    if (raw) {
      try { cache = migrate({ ...DEFAULTS(), ...JSON.parse(raw) }); }
      catch (e) { cache = DEFAULTS(); }
    } else {
      cache = DEFAULTS();
    }
    return cache;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* best effort */ }
  }

  function patch(changes) {
    const s = load();
    Object.assign(s, changes);
    save();
    return s;
  }

  function patchQuiz(changes) {
    const s = load();
    Object.assign(s.quiz, changes, { updatedAt: new Date().toISOString() });
    save();
    return s;
  }

  return { load, patch, patchQuiz };
})();
