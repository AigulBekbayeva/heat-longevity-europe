/* Heat & Longevity in Europe — geoportal (d3 v7 + topojson-client) */
(() => {
  "use strict";

  const BLUES = ["#b7d3f6", "#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];
  const HEAT = ["#fee8c8", "#fdd49e", "#fdbb84", "#fc8d59", "#ef6548", "#d7301f", "#b30000", "#7f0000"];
  const BIV = [ // rows: share 65+ low→high, cols: heat low→high
    ["#e8e8e8", "#e4acac", "#c85a5a"],
    ["#b0d5df", "#ad9ea5", "#985356"],
    ["#64acbe", "#627f8c", "#574249"],
  ];
  const NODATA = "#e4e1d9";
  const fmt1 = d3.format(".1f");
  const HEAT_SPEC = {
    tx_jja: { domain: [18, 21, 24, 27, 30, 33], unit: "°", title: "°C", fmt: (v) => `${fmt1(v)} °C`, list: (v) => `${fmt1(v)}°`, cut: (v) => `${fmt1(v)}°` },
    tx_year: { domain: [6, 9, 12, 15, 18, 21, 24], unit: "°", title: "°C", fmt: (v) => `${fmt1(v)} °C`, list: (v) => `${fmt1(v)}°`, cut: (v) => `${fmt1(v)}°` },
    hot30: { domain: [1, 5, 10, 20, 40, 60, 80], unit: "", title: "Days per year", fmt: (v) => `${Math.round(v)} days`, list: (v) => `${Math.round(v)} d`, cut: (v) => `${Math.round(v)} d` },
  };
  const LAYERS = ["le", "heat", "ineq"];

  const $ = (s) => document.querySelector(s);
  const tip = $(".tooltip");
  const setText = (key, html) => { const el = document.querySelector(`[data-fill="${key}"]`); if (el) el.innerHTML = html; };

  const json = (url) => fetch(url, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  });

  Promise.all([
    json("data/europe.topo.json"),
    json("data/cities.json").catch(() => []),
    json("data/indicators.json").catch(() => null),
    json("data/temperature.json").catch(() => null),
  ]).then(([topo, cities, ind, temp]) => init(topo, cities, ind, temp))
    .catch((e) => { console.error(e); setText("deck", `Could not load map data (${e.message}).`); });

  function init(topo, cities, ind, temp) {
    const regions = topojson.feature(topo, topo.objects.nuts2).features;
    const bg = topojson.feature(topo, topo.objects.bg).features;
    const country = Object.fromEntries(bg.map((f) => [f.id, f.properties.na]));
    country.EL = country.EL || "Greece";
    const regName = Object.fromEntries(regions.map((f) => [f.id, f.properties.na]));
    const ctx = {
      regions, bg, cities, ind, temp,
      shown: new Set(regions.map((f) => f.id)),
      nameOf: (id) => regName[id] || id,
      placeOf: (id) => country[id.slice(0, 2)] || id.slice(0, 2),
    };
    const map = makeMap(ctx);
    const state = { layer: "le", metric: "tx_jja" };

    const render = () => {
      document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.layer === state.layer)));
      $(".seg").hidden = state.layer === "le";
      document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.metric === state.metric)));
      map.clear();
      const fn = { le: layerLongevity, heat: layerHeat, ineq: layerInequality }[state.layer];
      fn(map, ctx, state);
      const hash = `#map-0${LAYERS.indexOf(state.layer) + 1}`;
      if (location.hash !== hash) history.replaceState(null, "", hash);
    };

    document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => { state.layer = b.dataset.layer; render(); }));
    $(".tabs").addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
      const i = (LAYERS.indexOf(state.layer) + (ev.key === "ArrowRight" ? 1 : 2)) % 3;
      state.layer = LAYERS[i]; render();
      document.querySelector(`.tabs button[data-layer="${state.layer}"]`).focus();
    });
    document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => { state.metric = b.dataset.metric; render(); }));

    const fromHash = { "#map-01": "le", "#map-02": "heat", "#map-03": "ineq" }[location.hash];
    if (fromHash) state.layer = fromHash;
    render();
  }

  /* ------------------------------------------------------------------ the map */
  function makeMap(ctx) {
    const stage = $(".stage");
    const svg = d3.select("svg.map");
    const root = svg.append("g");
    const grat = root.append("path").attr("class", "graticule");
    const bgG = root.append("g");
    const regG = root.append("g");
    const cityG = root.append("g").attr("class", "cities");
    const projection = d3.geoAzimuthalEqualArea().rotate([-10, -52]);
    const path = d3.geoPath(projection);
    const fc = { type: "FeatureCollection", features: ctx.regions };
    const LABELLED = new Set(ctx.cities.filter((c) => c.pop >= 4.5e6 || (c.cap && c.pop >= 1e6)).map((c) => c.name));

    let tipFn = (id) => `<div class="tt-name">${ctx.nameOf(id)}</div>`;
    let W = 0, H = 0, k = 1;

    const bgPaths = bgG.selectAll("path").data(ctx.bg).join("path").attr("class", "bgc");
    const regs = regG.selectAll("path").data(ctx.regions).join("path")
      .attr("class", "region").attr("fill", NODATA)
      .on("pointerenter pointermove", function (ev, f) { d3.select(this).classed("hover", true).raise(); showTip(ev, tipFn(f.id)); })
      .on("pointerleave", function () { d3.select(this).classed("hover", false); hideTip(); });
    const cg = cityG.selectAll("g").data(ctx.cities).join("g");
    cg.append("circle").attr("r", (c) => (c.pop >= 2e6 ? 2.8 : 2));
    cg.append("text").attr("x", 4.5).attr("y", 4).text((c) => c.name);

    function placeCities() {
      cg.attr("transform", (c) => `translate(${projection([c.lon, c.lat])}) scale(${1 / k})`);
      const narrow = W < 640;
      cg.select("text").style("display", (c) => ((narrow ? c.pop >= 3.3e6 : LABELLED.has(c.name)) || k >= 2.2 ? null : "none"));
    }

    function layout() {
      const r = stage.getBoundingClientRect();
      W = Math.max(320, r.width); H = Math.max(300, r.height);
      svg.attr("viewBox", `0 0 ${W} ${H}`);
      const top = W > 600 ? 56 : 44;
      projection.fitExtent([[24, top], [W - 64, H - 34]], fc);
      grat.attr("d", path(d3.geoGraticule().step([10, 10])()));
      bgPaths.attr("d", path);
      regs.attr("d", path);
      placeCities();
      zoom.translateExtent([[-W * 0.25, -H * 0.25], [W * 1.25, H * 1.25]]).extent([[0, 0], [W, H]]);
    }

    const zoom = d3.zoom().scaleExtent([1, 12])
      .filter((ev) => (ev.type === "wheel" || !ev.button) && ev.type !== "dblclick")
      .on("zoom", (ev) => { k = ev.transform.k; root.attr("transform", ev.transform); placeCities(); });
    svg.call(zoom);
    document.querySelectorAll(".zoom button").forEach((b) => b.addEventListener("click", () => {
      const z = b.dataset.z;
      if (z === "in") svg.transition().duration(300).call(zoom.scaleBy, 1.8);
      else if (z === "out") svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.8);
      else svg.transition().duration(450).call(zoom.transform, d3.zoomIdentity);
    }));

    layout();
    let t;
    new ResizeObserver(() => { clearTimeout(t); t = setTimeout(layout, 120); }).observe(stage);

    return {
      setFill(fn) { regs.transition().duration(450).attr("fill", (f) => fn(f.id) || NODATA); },
      setTip(fn) { tipFn = fn; },
      highlight(pred) { regs.classed("dim", pred ? (f) => !pred(f.id) : false); },
      focus(id, ev) {
        regs.classed("hover", (f) => f.id === id).filter((f) => f.id === id).raise();
        if (ev) showTip(ev, tipFn(id));
      },
      flyTo(id) {
        const f = ctx.regions.find((x) => x.id === id);
        if (!f) return;
        const [[x0, y0], [x1, y1]] = path.bounds(f);
        const s = Math.min(6, 0.35 / Math.max((x1 - x0) / W, (y1 - y0) / H));
        const tr = d3.zoomIdentity.translate(W / 2, H / 2).scale(Math.max(1, s)).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
        svg.transition().duration(700).call(zoom.transform, tr);
      },
      clear() { regs.classed("hover", false).classed("dim", false); hideTip(); },
    };
  }

  /* ------------------------------------------------------------------ panel helpers */
  function panel({ num, title, deck, mapTitle, stat = "", source, topTitle, bottomTitle, single = false }) {
    setText("num", num); setText("title", title); setText("deck", deck); setText("map-title", mapTitle);
    setText("stat", stat); setText("source", source);
    setText("top-title", topTitle || ""); setText("bottom-title", bottomTitle || "");
    $(".lists").classList.toggle("single", single);
    $(".pending-note").hidden = true;
    $(".lists").hidden = false;
  }

  function pendingPanel(map, what) {
    map.setFill(() => null); map.setTip((id) => `<div class="tt-name">${id}</div>`);
    $(".legend").innerHTML = ""; $(".bilegend").hidden = true; $(".lists").hidden = true;
    const el = $(".pending-note");
    el.hidden = false;
    el.innerHTML = `${what} hasn't been built yet. The GitHub Action builds it on deploy, or run <code>python scripts/build_data.py</code> locally.`;
  }

  function legend(map, title, colors, labels, classOf) {
    $(".bilegend").hidden = true;
    const el = $(".legend");
    el.hidden = false;
    el.innerHTML = `<span class="ltitle">${title}</span><div class="swatches">${colors.map((c, i) =>
      `<span class="sw" data-i="${i}"><i style="background:${c}"></i>${labels[i]}</span>`).join("")
    }<span class="sw nd"><i></i>No data</span></div>`;
    el.querySelectorAll(".sw[data-i]").forEach((s) => {
      s.addEventListener("pointerenter", () => map.highlight((id) => classOf(id) === +s.dataset.i));
      s.addEventListener("pointerleave", () => map.highlight(null));
    });
  }

  function rankList(ol, rows, map, ctx, valueFmt, colorOf) {
    ol.innerHTML = rows.map((r) =>
      `<li tabindex="0" data-k="${r.k}"><span><i class="chip" style="background:${colorOf(r)}"></i>${ctx.nameOf(r.k)}<small>${ctx.placeOf(r.k)}</small></span><b>${valueFmt(r)}</b></li>`).join("");
    ol.querySelectorAll("li").forEach((li) => {
      const k = li.dataset.k;
      const on = () => {
        map.highlight((id) => id === k);
        const rect = li.getBoundingClientRect();
        map.focus(k, { clientX: rect.right + 12, clientY: rect.top, fromList: true });
      };
      li.addEventListener("pointerenter", on);
      li.addEventListener("focus", on);
      li.addEventListener("pointerleave", () => map.clear());
      li.addEventListener("blur", () => map.clear());
      li.addEventListener("click", () => map.flyTo(k));
      li.addEventListener("keydown", (ev) => { if (ev.key === "Enter") map.flyTo(k); });
    });
  }

  function thresholdLabels(domain, unit) {
    const out = [`<${domain[0]}${unit}`];
    for (let i = 1; i < domain.length; i++) out.push(`${domain[i - 1]}–${domain[i]}`);
    out.push(`${domain[domain.length - 1]}+`);
    return out;
  }

  const ttHead = (id, ctx) => `<div class="tt-name">${ctx.nameOf(id)}</div><div class="tt-sub">${ctx.placeOf(id)} · ${id}</div>`;
  const fmtPeople = (n) => (n >= 1e6 ? `${fmt1(n / 1e6)} million` : `${Math.round(n / 1e3)} thousand`);

  /* ------------------------------------------------------------------ Map 01 */
  function layerLongevity(map, ctx) {
    const { ind } = ctx;
    const head = { num: "Map 01", title: "Where Do People Live the Longest?", mapTitle: "Life expectancy at birth", topTitle: "Longest lives", bottomTitle: "Shortest lives" };
    if (!ind) { panel({ ...head, deck: "Life expectancy at birth by region.", source: "" }); return pendingPanel(map, "Eurostat data"); }
    const R = ind.regions;
    const domain = [76, 78, 80, 82, 84];
    const scale = d3.scaleThreshold().domain(domain).range(BLUES);
    const val = (id) => (R[id] && R[id].le != null ? R[id].le : null);
    const rows = Object.keys(R).filter((k) => val(k) != null && ctx.shown.has(k)).map((k) => ({ k, v: val(k) })).sort((a, b) => b.v - a.v);
    const rankOf = new Map(rows.map((r, i) => [r.k, i + 1]));
    const hi = rows[0], lo = rows[rows.length - 1];

    panel({
      ...head,
      mapTitle: `Life expectancy at birth, ${ind.years.le}`,
      deck: `How many years a newborn can expect to live, by NUTS 2 region, ${ind.years.le}. Someone born in ${ctx.nameOf(hi.k)} (${ctx.placeOf(hi.k)})
        can expect to live <strong>${fmt1(hi.v - lo.v)} years longer</strong> than someone born in ${ctx.nameOf(lo.k)} (${ctx.placeOf(lo.k)}).`,
      source: `Data: Eurostat, life expectancy at birth by NUTS 2 region (demo_r_mlifexp), ${ind.years.le}; a few regions use the latest earlier year. Built ${ind.built}.`,
    });
    map.setFill((id) => (val(id) != null ? scale(val(id)) : null));
    map.setTip((id) => {
      const r = R[id];
      if (!r || r.le == null) return `${ttHead(id, ctx)}<div class="tt-row">No data</div>`;
      return `${ttHead(id, ctx)}
        <div class="tt-row">Life expectancy <b>${fmt1(r.le)} years</b></div>
        <div class="tt-row">Rank <b>${rankOf.get(id) || "–"} of ${rows.length}</b></div>
        ${r.le_y !== ind.years.le ? `<div class="tt-row">Year <b>${r.le_y}</b></div>` : ""}`;
    });
    legend(map, "Years", BLUES, thresholdLabels(domain, ""), (id) => (val(id) != null ? d3.bisectRight(domain, val(id)) : -1));
    const f = (r) => fmt1(r.v);
    rankList($(".rank.top"), rows.slice(0, 8), map, ctx, f, (r) => scale(r.v));
    rankList($(".rank.bottom"), rows.slice(-8).reverse(), map, ctx, f, (r) => scale(r.v));
  }

  /* ------------------------------------------------------------------ Map 02 */
  function layerHeat(map, ctx, state) {
    const { temp } = ctx;
    const head = { num: "Map 02", title: "How Hot Was the Last Decade?", topTitle: "Hottest", bottomTitle: "Coolest" };
    if (!temp) { panel({ ...head, deck: "Daily maximum temperature over the last 10 years.", mapTitle: "", source: "" }); return pendingPanel(map, "Temperature data"); }
    const metric = state.metric, spec = HEAT_SPEC[metric], meta = temp.metrics[metric], R = temp.regions;
    const [y0, y1] = temp.period;
    const colors = HEAT.slice(HEAT.length - spec.domain.length - 1);
    const scale = d3.scaleThreshold().domain(spec.domain).range(colors);
    const val = (id) => (R[id] && R[id][metric] != null ? R[id][metric] : null);
    const rows = Object.keys(R).filter((k) => val(k) != null && ctx.shown.has(k)).map((k) => ({ k, v: val(k) })).sort((a, b) => b.v - a.v);
    const rankOf = new Map(rows.map((r, i) => [r.k, i + 1]));

    const decks = {
      tx_jja: `The warmest part of every summer day (June–August), averaged over each region and over the ten years <strong>${y0}–${y1}</strong>.`,
      tx_year: `The warmest part of every day of the year, averaged over each region and over the ten years <strong>${y0}–${y1}</strong>.`,
      hot30: `How many days a year reached <strong>30 °C or more</strong>, on average over ${y0}–${y1}.`,
    };
    panel({
      ...head,
      deck: decks[metric],
      mapTitle: `${meta.label}, ${y0}–${y1}`,
      source: `Data: ${temp.source}, ${y0}–${y1} (file ${temp.file}, built ${temp.built}). Grid cells are averaged within each region, weighted by area. <a href="${temp.source_url}">Source</a>.`,
    });
    map.setFill((id) => (val(id) != null ? scale(val(id)) : null));
    map.setTip((id) => {
      const r = R[id];
      if (!r) return `${ttHead(id, ctx)}<div class="tt-row">No data</div>`;
      const row = (m) => (r[m] != null ? `<div class="tt-row${m === metric ? " on" : ""}">${temp.metrics[m].short} <b>${HEAT_SPEC[m].fmt(r[m])}</b></div>` : "");
      return `${ttHead(id, ctx)}${row("tx_jja")}${row("tx_year")}${row("hot30")}
        <div class="tt-row">Rank <b>${rankOf.get(id) || "–"} of ${rows.length}</b></div>`;
    });
    legend(map, spec.title, colors, thresholdLabels(spec.domain, spec.unit), (id) => (val(id) != null ? d3.bisectRight(spec.domain, val(id)) : -1));
    const f = (r) => spec.list(r.v);
    rankList($(".rank.top"), rows.slice(0, 8), map, ctx, f, (r) => scale(r.v));
    rankList($(".rank.bottom"), rows.slice(-8).reverse(), map, ctx, f, (r) => scale(r.v));
  }

  /* ------------------------------------------------------------------ Map 03 */
  function layerInequality(map, ctx, state) {
    const { ind, temp } = ctx;
    const head = { num: "Map 03", title: "Heat Inequality: Who Suffers Most?", topTitle: "Hot <em>and</em> old", single: true };
    const deck = `Older people are the most vulnerable to heat. Each region is placed in a third by heat (the measure picked above)
      and a third by the share of people aged 65+. The darkest regions are in the <strong>hottest third and the oldest third</strong> at once.`;
    if (!ind || !temp) { panel({ ...head, deck, mapTitle: "", source: "" }); return pendingPanel(map, !temp ? "Temperature data" : "Eurostat data"); }

    const metric = state.metric, spec = HEAT_SPEC[metric], meta = temp.metrics[metric];
    const R = ind.regions, T = temp.regions;
    const both = Object.keys(R).filter((k) => ctx.shown.has(k) && R[k].p65 != null && T[k] && T[k][metric] != null)
      .map((k) => ({ k, t: T[k][metric], e: R[k].p65, pop: R[k].pop || 0 }));
    const ts = both.map((d) => d.t).sort(d3.ascending);
    const es = both.map((d) => d.e).sort(d3.ascending);
    const tq = [d3.quantileSorted(ts, 1 / 3), d3.quantileSorted(ts, 2 / 3)];
    const eq = [d3.quantileSorted(es, 1 / 3), d3.quantileSorted(es, 2 / 3)];
    const third = (v, q) => (v < q[0] ? 0 : v < q[1] ? 1 : 2);
    const pct = (sorted, v) => d3.bisectLeft(sorted, v) / (sorted.length - 1);
    both.forEach((d) => {
      d.ti = third(d.t, tq); d.ei = third(d.e, eq);
      d.score = (pct(ts, d.t) + pct(es, d.e)) / 2;
      d.old = d.pop * d.e / 100;
    });
    const byKey = new Map(both.map((d) => [d.k, d]));
    const color = (d) => BIV[d.ei][d.ti];
    const LEVEL = ["lower", "middle", "top"];
    const hh = both.filter((d) => d.ti === 2 && d.ei === 2).sort((a, b) => b.score - a.score);
    const totalOld = d3.sum(both, (d) => d.old), hhOld = d3.sum(hh, (d) => d.old);
    const byCountry = d3.rollups(hh, (v) => v.length, (d) => ctx.placeOf(d.k)).sort((a, b) => b[1] - a[1]);

    panel({
      ...head, deck,
      mapTitle: `Heat (${meta.short}) × share of people aged 65+`,
      stat: hh.length ? `<strong>${hh.length} regions</strong> are in both the hottest and the oldest third. They are home to
        <strong>${fmtPeople(hhOld)}</strong> people aged 65+ (${Math.round(100 * hhOld / totalOld)}% of all older people on the map).
        Most of these regions are in ${byCountry.slice(0, 3).map(([c, n]) => `${c} (${n})`).join(", ")}.` : "",
      source: `Data: heat is ${meta.label.toLowerCase()} over ${temp.period[0]}–${temp.period[1]} (E-OBS). Share of people aged 65+ and population come from
        Eurostat (demo_r_pjanind2, demo_r_d2jan), ${ind.years.p65}. Thirds are computed over the ${both.length} regions that have both values.`,
    });
    map.setFill((id) => (byKey.has(id) ? color(byKey.get(id)) : null));
    map.setTip((id) => {
      const d = byKey.get(id);
      if (!d) return `${ttHead(id, ctx)}<div class="tt-row">No data</div>`;
      return `${ttHead(id, ctx)}
        <div class="tt-row">${meta.short} <b>${spec.fmt(d.t)}</b></div>
        <div class="tt-row">Aged 65+ <b>${fmt1(d.e)}%</b></div>
        ${d.old ? `<div class="tt-row">People 65+ <b>${fmtPeople(d.old)}</b></div>` : ""}
        <div class="tt-class"><i style="background:${color(d)}"></i>${LEVEL[d.ti]} third by heat · ${LEVEL[d.ei]} third by age</div>`;
    });

    // bivariate legend
    $(".legend").hidden = true;
    const holder = $(".bilegend");
    holder.hidden = false;
    holder.innerHTML = "";
    const cell = 30, pad = 2, g0 = 34, gw = 3 * (cell + pad) - pad;
    const lg = d3.select(holder).append("svg").attr("width", g0 + gw + 150).attr("height", gw + 44);
    const grid = lg.append("g").attr("transform", `translate(${g0},4)`);
    for (let e = 0; e < 3; e++) for (let t = 0; t < 3; t++) {
      grid.append("rect")
        .attr("x", t * (cell + pad)).attr("y", (2 - e) * (cell + pad))
        .attr("width", cell).attr("height", cell).attr("rx", 2).attr("fill", BIV[e][t])
        .on("pointerenter", () => map.highlight((id) => { const d = byKey.get(id); return d && d.ti === t && d.ei === e; }))
        .on("pointerleave", () => map.highlight(null));
    }
    grid.append("text").attr("class", "bt").attr("x", 0).attr("y", gw + 16).text("Hotter →");
    grid.append("text").attr("x", 0).attr("y", gw + 31).text(`thirds split at ${spec.cut(tq[0])} and ${spec.cut(tq[1])}`);
    grid.append("text").attr("class", "bt").attr("transform", `translate(-12,${gw}) rotate(-90)`).text("Older →");
    grid.append("text").attr("x", gw + 10).attr("y", 14).text(`65+ share ≥ ${fmt1(eq[1])}%`);
    grid.append("text").attr("x", gw + 10).attr("y", gw / 2 + 4).text(`${fmt1(eq[0])}–${fmt1(eq[1])}%`);
    grid.append("text").attr("x", gw + 10).attr("y", gw - 4).text(`< ${fmt1(eq[0])}%`);
    grid.append("rect").attr("x", 2 * (cell + pad) - 2).attr("y", -2).attr("width", cell + 4).attr("height", cell + 4)
      .attr("rx", 3).attr("fill", "none").attr("stroke", "#141413").attr("stroke-width", 1.5).attr("pointer-events", "none");

    rankList($(".rank.top"), hh.slice(0, 20), map, ctx, (r) => `${spec.list(r.t)} · ${fmt1(r.e)}%`, color);
    $(".rank.bottom").innerHTML = "";
  }

  /* ------------------------------------------------------------------ tooltip */
  function showTip(ev, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = ev.fromList ? ev.clientX : ev.clientX + 14;
    let y = ev.fromList ? ev.clientY : ev.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = window.innerHeight - r.height - 8;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }
  function hideTip() { tip.hidden = true; }
})();
