(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Time-of-day buckets -> what kind of place fits right now
  // ---------------------------------------------------------------------
  const BUCKETS = [
    {
      id: "wake_up", start: 5, end: 9,
      label: "Rise & Shine", emoji: "☕",
      desc: "Early hours call for something warm to wake up to.",
      tags: [["amenity", "cafe"], ["shop", "bakery"]],
    },
    {
      id: "brunch", start: 9, end: 11,
      label: "Brunch Mode", emoji: "🥐",
      desc: "Prime time for a lazy brunch or a good cup of coffee.",
      tags: [["amenity", "cafe"], ["shop", "bakery"], ["amenity", "restaurant"]],
    },
    {
      id: "lunch", start: 11, end: 14,
      label: "Lunch Run", emoji: "🍜",
      desc: "Midday fuel-up. Let's find something to eat nearby.",
      tags: [["amenity", "restaurant"], ["amenity", "fast_food"], ["amenity", "food_court"]],
    },
    {
      id: "afternoon", start: 14, end: 17,
      label: "Afternoon Wander", emoji: "🎨",
      desc: "A good stretch for a walk, a browse, or a little culture.",
      tags: [["leisure", "park"], ["tourism", "museum"], ["shop", "books"], ["amenity", "cafe"], ["amenity", "ice_cream"]],
    },
    {
      id: "golden_hour", start: 17, end: 19,
      label: "Golden Hour", emoji: "🌇",
      desc: "The light's getting good — perfect for a walk or happy hour.",
      tags: [["leisure", "park"], ["amenity", "bar"], ["amenity", "ice_cream"], ["amenity", "cafe"]],
    },
    {
      id: "dinner", start: 19, end: 22,
      label: "Dinner Time", emoji: "🍽️",
      desc: "Let's get you fed. Scouting restaurants nearby.",
      tags: [["amenity", "restaurant"], ["amenity", "pub"], ["amenity", "bar"]],
    },
    {
      id: "night_owl", start: 22, end: 24,
      label: "Night Owl", emoji: "🌙",
      desc: "Still up? Time for a drink or somewhere lively.",
      tags: [["amenity", "bar"], ["amenity", "nightclub"], ["amenity", "fast_food"]],
    },
    {
      id: "late_night", start: 0, end: 5,
      label: "Late Night Cravings", emoji: "🌃",
      desc: "Burning the midnight oil — let's find whatever's still open.",
      tags: [["amenity", "fast_food"], ["amenity", "bar"], ["amenity", "restaurant"]],
    },
  ];

  function getBucket(date) {
    const h = date.getHours();
    return BUCKETS.find(b => (b.start <= b.end ? (h >= b.start && h < b.end) : (h >= b.start || h < b.end)))
      || BUCKETS[0];
  }

  const CATEGORY_LABELS = {
    cafe: "Cafe", bakery: "Bakery", restaurant: "Restaurant", fast_food: "Fast Food",
    food_court: "Food Court", park: "Park", museum: "Museum", books: "Bookshop",
    ice_cream: "Ice Cream", bar: "Bar", pub: "Pub", nightclub: "Nightclub",
  };

  const CATEGORY_EMOJI = {
    cafe: "☕", bakery: "🥐", restaurant: "🍽️", fast_food: "🍔",
    food_court: "🍜", park: "🌳", museum: "🏛️", books: "📚",
    ice_cream: "🍦", bar: "🍸", pub: "🍺", nightclub: "🪩",
  };

  // ---------------------------------------------------------------------
  // Overpass
  // ---------------------------------------------------------------------
  const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  function buildQuery(tags, lat, lon, radius) {
    const clauses = tags.map(([k, v]) =>
      `  node["${k}"="${v}"](around:${radius},${lat},${lon});\n  way["${k}"="${v}"](around:${radius},${lat},${lon});`
    ).join("\n");
    return `[out:json][timeout:25];\n(\n${clauses}\n);\nout center 60;`;
  }

  async function fetchPlaces(tags, lat, lon, radius) {
    const query = buildQuery(tags, lat, lon, radius);
    let lastErr;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error("Overpass responded " + res.status);
        const data = await res.json();
        return parseElements(data.elements || [], lat, lon);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Could not reach place search.");
  }

  function parseElements(elements, originLat, originLon) {
    const seen = new Set();
    const places = [];
    for (const el of elements) {
      const tags = el.tags || {};
      const name = tags.name;
      if (!name) continue;
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) continue;
      const key = name.toLowerCase() + "@" + lat.toFixed(4) + "," + lon.toFixed(4);
      if (seen.has(key)) continue;
      seen.add(key);

      const categoryKey = tags.amenity || tags.shop || tags.leisure || tags.tourism || "place";
      const address = formatAddress(tags);
      const distance = haversine(originLat, originLon, lat, lon);

      places.push({ name, lat, lon, categoryKey, address, distance });
    }
    places.sort((a, b) => a.distance - b.distance);
    return places;
  }

  function formatAddress(tags) {
    const parts = [];
    if (tags["addr:housenumber"] && tags["addr:street"]) {
      parts.push(`${tags["addr:housenumber"]} ${tags["addr:street"]}`);
    } else if (tags["addr:street"]) {
      parts.push(tags["addr:street"]);
    }
    if (tags["addr:city"]) parts.push(tags["addr:city"]);
    return parts.join(", ");
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDistance(m) {
    return m < 1000 ? `${Math.round(m)} m away` : `${(m / 1000).toFixed(1)} km away`;
  }

  // ---------------------------------------------------------------------
  // Geolocation
  // ---------------------------------------------------------------------
  function getLocation() {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("This browser doesn't support location. Try opening this in a phone browser."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        err => {
          if (err.code === err.PERMISSION_DENIED) {
            reject(new Error("Location access was denied. Allow location for this site in your browser settings and try again."));
          } else if (err.code === err.TIMEOUT) {
            reject(new Error("Timed out getting your location. Try again with a clearer GPS signal."));
          } else {
            reject(new Error("Couldn't get your location. Try again."));
          }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    });
  }

  // ---------------------------------------------------------------------
  // App state / DOM
  // ---------------------------------------------------------------------
  const els = {
    clock: document.getElementById("clock"),
    setup: document.getElementById("setup"),
    greetingEyebrow: document.getElementById("greetingEyebrow"),
    bucketLabel: document.getElementById("bucketLabel"),
    bucketDesc: document.getElementById("bucketDesc"),
    vibeEmoji: document.getElementById("vibeEmoji"),
    vibeTitle: document.getElementById("vibeTitle"),
    vibeSub: document.getElementById("vibeSub"),
    radiusSelect: document.getElementById("radiusSelect"),
    spinCta: document.getElementById("spinCta"),
    statusLine: document.getElementById("statusLine"),

    wheelSection: document.getElementById("wheelSection"),
    wheelEyebrow: document.getElementById("wheelEyebrow"),
    wheelHeading: document.getElementById("wheelHeading"),
    wheel: document.getElementById("wheel"),
    wheelInner: document.getElementById("wheelInner"),
    spinBtn: document.getElementById("spinBtn"),
    backFromWheel: document.getElementById("backFromWheel"),

    resultSection: document.getElementById("resultSection"),
    resultEmoji: document.getElementById("resultEmoji"),
    resultName: document.getElementById("resultName"),
    resultCategory: document.getElementById("resultCategory"),
    resultMeta: document.getElementById("resultMeta"),
    resultAddress: document.getElementById("resultAddress"),
    directionsBtn: document.getElementById("directionsBtn"),
    spinAgainBtn: document.getElementById("spinAgainBtn"),
    refreshBtn: document.getElementById("refreshBtn"),

    errorSection: document.getElementById("errorSection"),
    errorMessage: document.getElementById("errorMessage"),
    retryBtn: document.getElementById("retryBtn"),
  };

  const SCREENS = [els.setup, els.wheelSection, els.resultSection, els.errorSection];
  function showScreen(el) {
    SCREENS.forEach(s => { s.hidden = s !== el; });
  }

  const WHEEL_COLORS = ["#c0392b", "#161616", "#1f6b4d", "#161616", "#c0392b", "#161616"];

  const state = {
    bucket: getBucket(new Date()),
    location: null,
    places: [],
    candidates: [],
    rotation: 0,
  };

  function updateClock() {
    const now = new Date();
    els.clock.textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  updateClock();
  setInterval(updateClock, 15000);

  function paintSetupScreen() {
    const b = state.bucket;
    const hour = new Date().getHours();
    els.greetingEyebrow.textContent =
      hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    els.bucketLabel.textContent = `${b.label} time`;
    els.bucketDesc.textContent = b.desc;
    els.vibeEmoji.textContent = b.emoji;
    els.vibeTitle.textContent = b.label;
    els.vibeSub.textContent = "Matched to the time right now";
  }
  paintSetupScreen();

  function setStatus(msg, isError = false) {
    els.statusLine.textContent = msg || "";
    els.statusLine.classList.toggle("is-error", isError);
  }

  // ---------------------------------------------------------------------
  // Wheel rendering
  // ---------------------------------------------------------------------
  function buildWheel(candidates) {
    const n = candidates.length;
    const seg = 360 / n;
    const stops = [];
    candidates.forEach((_, i) => {
      const color = WHEEL_COLORS[i % WHEEL_COLORS.length];
      stops.push(`${color} ${i * seg}deg ${(i + 1) * seg}deg`);
    });
    els.wheelInner.style.background = `conic-gradient(${stops.join(", ")})`;

    els.wheelInner.innerHTML = "";
    candidates.forEach((place, i) => {
      const center = i * seg + seg / 2;
      const wrap = document.createElement("div");
      wrap.className = "wheel-label";
      wrap.style.transform = `rotate(${center}deg)`;
      const span = document.createElement("span");
      span.textContent = place.name;
      wrap.appendChild(span);
      els.wheelInner.appendChild(wrap);
    });

    state.rotation = 0;
    els.wheelInner.style.transition = "none";
    els.wheelInner.style.transform = "rotate(0deg)";
    // force reflow so the next transition actually animates
    void els.wheelInner.offsetHeight;
    els.wheelInner.style.transition = "";
  }

  function pickWeightedIndex(candidates) {
    const weights = candidates.map(p => 1 / (p.distance + 80));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return candidates.length - 1;
  }

  function spinWheel() {
    const n = state.candidates.length;
    if (!n) return;
    els.spinBtn.disabled = true;
    const seg = 360 / n;
    const winnerIndex = pickWeightedIndex(state.candidates);
    const center = winnerIndex * seg + seg / 2;
    const jitter = (Math.random() - 0.5) * seg * 0.6;
    const fullSpins = 6 * 360;
    const currentMod = state.rotation % 360;
    const targetMod = ((360 - center + jitter) % 360 + 360) % 360;
    let delta = targetMod - currentMod;
    if (delta < 0) delta += 360;
    const newRotation = state.rotation + fullSpins + delta;

    state.rotation = newRotation;
    els.wheelInner.style.transform = `rotate(${newRotation}deg)`;

    const onDone = () => {
      els.wheelInner.removeEventListener("transitionend", onDone);
      els.spinBtn.disabled = false;
      showResult(state.candidates[winnerIndex]);
    };
    els.wheelInner.addEventListener("transitionend", onDone);
  }

  function showResult(place) {
    els.resultEmoji.textContent = CATEGORY_EMOJI[place.categoryKey] || "📍";
    els.resultName.textContent = place.name;
    els.resultCategory.textContent = CATEGORY_LABELS[place.categoryKey] || place.categoryKey;
    els.resultMeta.textContent = formatDistance(place.distance);
    els.resultAddress.textContent = place.address || "";
    els.directionsBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lon}`;
    showScreen(els.resultSection);
  }

  // ---------------------------------------------------------------------
  // Flow
  // ---------------------------------------------------------------------
  async function startSpin() {
    state.bucket = getBucket(new Date());
    const radius = Number(els.radiusSelect.value);

    els.spinCta.disabled = true;
    setStatus("Finding your location…");
    try {
      state.location = await getLocation();
      setStatus("Scouting nearby spots…");
      let places = await fetchPlaces(state.bucket.tags, state.location.lat, state.location.lon, radius);

      if (places.length < 3 && radius < 8000) {
        setStatus("Not much nearby, widening the search…");
        places = await fetchPlaces(state.bucket.tags, state.location.lat, state.location.lon, radius * 2.5);
      }

      if (places.length === 0) {
        throw new Error("Couldn't find any named spots nearby. Try a wider search radius.");
      }

      state.places = places;
      state.candidates = places.slice(0, 8);

      els.wheelEyebrow.textContent = `${state.bucket.emoji} ${state.bucket.label}`;
      els.wheelHeading.textContent = "Spin to pick your spot";
      buildWheel(state.candidates);
      showScreen(els.wheelSection);
      setStatus("");
    } catch (err) {
      showError(err.message || "Something went wrong.");
    } finally {
      els.spinCta.disabled = false;
    }
  }

  function showError(message) {
    els.errorMessage.textContent = message;
    showScreen(els.errorSection);
  }

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------
  els.spinCta.addEventListener("click", startSpin);
  els.spinBtn.addEventListener("click", spinWheel);
  els.backFromWheel.addEventListener("click", () => showScreen(els.setup));
  els.spinAgainBtn.addEventListener("click", () => {
    state.candidates = [...state.candidates].sort(() => Math.random() - 0.5);
    buildWheel(state.candidates);
    showScreen(els.wheelSection);
  });
  els.refreshBtn.addEventListener("click", startSpin);
  els.retryBtn.addEventListener("click", () => showScreen(els.setup));

  // ---------------------------------------------------------------------
  // Service worker (best-effort offline app shell)
  // ---------------------------------------------------------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
