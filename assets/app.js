/* Heat & Longevity in Europe — three NUTS 2 maps (d3 v7 + topojson-client) */
(() => {
  "use strict";

  const W = 960, H = 720;
  const BLUES = ["#b7d3f6", "#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#0d366b"];
  const HEAT = ["#fee8c8", "#fdd49e", "#fdbb84", "#fc8d59", "#ef6548", "#d7301f", "#b30000", "#7f0000"];
  const BIV = [ // rows: share 65+ low→high, cols: heat low→high
    ["#e8e8e8", "#e4acac", "#c85a5a"],
    ["#b0d5df", "#ad9ea5", "#985356"],
    ["#64acbe", "#627f8c", "#574249"],
  ];
  const HEAT_SPEC = {
    tx_jja: { domain: [18, 21, 24, 27, 30, 33], unit: "°", fmt: (v) => `${fmt1(v)} °C`, list: (v) => `${fmt1(v)}°` },
    tx_year: { domain: [6, 9, 12, 15, 18, 21, 24], unit: "°", fmt: (v) => `${fmt1(v)} °C`, list: (v) => `${fmt1(v)}°` },
    hot30: { domain: [1, 5, 10, 20, 40, 60, 80], unit: "", fmt: (v) => `${Math.round(v)} days`, list: (v) => `${Math.round(v)} d` },
  };
  const NODATA = "#e4e1d9";
  const fmt1 = d3.format(".1f");
  const tip = document.querySelector(".tooltip");

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
    .catch((e) => {
      console.error(e);
      document.querySelectorAll(".pending").forEach((el) => { el.hidden = false; el.textContent = `Could not load map data (${e.message}).`; });
    });

  function init(topo, cities, ind, temp) {
    const regions = topojson.feature(topo, topo.objects.nuts2).features;
    const bg = topojson.feature(topo, topo.objects.bg).features;
    const country = Object.fromEntries(bg.map((f) => [f.id, f.properties.na]));
    country.EL = country.EL || "Greece";
    const regName = Object.fromEntries(regions.map((f) => [f.id, f.properties.na]));
    const nameOf = (id) => regName[id] || id;
    const placeOf = (id) => country[id.slice(0, 2)] || id.slice(0, 2);
    const ctx = { regions, bg, cities, nameOf, placeOf };

    const m1 = makeMap(document.querySelector("#map-01"), ctx);
    const m2 = makeMap(document.querySelector("#map-02"), ctx);
    const m3 = makeMap(document.querySelector("#map-03"), ctx);

    if (ind) mapLongevity(m1, ind, ctx); else pending(m1, "Eurostat data");
    if (!temp) { pending(m2, "Temperature data"); }
    if (!temp || !ind) { pending(m3, !temp ? "Temperature data" : "Eurostat data"); }
    if (!temp) return;

    let metric = "tx_jja";
    const redraw = () => {
      mapHeat(m2, temp, metric, ctx);
      if (ind) mapInequality(m3, ind, temp, metric, ctx);
    };
    document.querySelectorAll("#map-02 .seg button").forEach((b) => b.addEventListener("click", () => {
      metric = b.dataset.metric;
      document.querySelectorAll("#map-02 .seg button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      redraw();
    }));
    redraw();
  }

  /* ------------------------------------------------------------------ shared map */
  function makeMap(section, ctx) {
    const svg = d3.select(section).select("svg.map").attr("viewBox", `0 0 ${W} ${H}`);
    const fc = { type: "FeatureCollection", features: ctx.regions };
    const projection = d3.geoAzimuthalEqualArea().rotate([-10, -52]).fitExtent([[8, 8], [W - 8, H - 8]], fc);
    const path = d3.geoPath(projection);
    const root = svg.append("g");
    root.append("rect").attr("class", "sea").attr("x", -W).attr("y", -H).attr("width", 3 * W).attr("height", 3 * H);
    root.append("path").attr("class", "graticule").attr("d", path(d3.geoGraticule().step([10, 10])()));
    root.append("g").selectAll("path").data(ctx.bg).join("path").attr("class", "bgc").attr("d", path);

    let tipFn = (id) => `<div class="tt-name">${ctx.nameOf(id)}</div>`;
    const countries = root.append("g").selectAll("path")
      .data(ctx.regions).join("path")
      .attr("class", "country")
      .attr("d", path)
      .attr("fill", NODATA)
      .on("pointerenter pointermove", function (ev, f) {
        d3.select(this).classed("hover", true).raise();
        showTip(ev, tipFn(f.id));
      })
      .on("pointerleave", function () { d3.select(this).classed("hover", false); hideTip(); });

    // cities: dots for all, labels for the biggest ones
    const cityG = root.append("g").attr("class", "cities");
    const LABELLED = new Set(ctx.cities.filter((c) => c.pop >= 4.5e6 || (c.cap && c.pop >= 1e6)).map((c) => c.name));
    const cg = cityG.selectAll("g").data(ctx.cities).join("g")
      .attr("transform", (c) => `translate(${projection([c.lon, c.lat])})`);
    cg.append("circle").attr("r", (c) => (c.pop >= 2e6 ? 2.6 : 1.9));
    cg.filter((c) => LABELLED.has(c.name)).append("text").attr("x", 4).attr("y", 3.5).text((c) => c.name);

    const zoom = d3.zoom().scaleExtent([1, 10])
      .translateExtent([[0, 0], [W, H]])
      .filter((ev) => (ev.type === "wheel" ? ev.ctrlKey || ev.metaKey : !ev.button) && ev.type !== "dblclick")
      .on("zoom", (ev) => {
        const k = ev.transform.k;
        root.attr("transform", ev.transform);
        cg.attr("transform", (c) => `translate(${projection([c.lon, c.lat])}) scale(${1 / k})`);
        cg.select("text").style("display", null);
        if (k >= 2) cg.filter((c) => !LABELLED.has(c.name)).selectAll("text").data((c) => [c]).join("text")
          .attr("x", 4).attr("y", 3.5).text((c) => c.name);
      });
    svg.call(zoom);
    section.querySelectorAll(".zoom button").forEach((b) => b.addEventListener("click", () => {
      const z = b.dataset.z;
      if (z === "in") svg.transition().duration(300).call(zoom.scaleBy, 1.8);
      else if (z === "out") svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.8);
      else svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
    }));

    return {
      section, countries,
      setFill(fn) { countries.attr("fill", (f) => fn(f.id) || NODATA); },
      setTip(fn) { tipFn = fn; },
      highlight(pred) { countries.classed("dim", pred ? (f) => !pred(f.id) : false); },
      hoverKey(id, ev) {
        countries.classed("hover", (f) => f.id === id).filter((f) => f.id === id).raise();
        showTip(ev, tipFn(id));
      },
      clear() { countries.classed("hover", false).classed("dim", false); hideTip(); },
    };
  }

  function legend(map, title, colors, labels, classOf) {
    const el = map.section.querySelector(".legend");
    el.innerHTML = `<span class="ltitle">${title}</span><div class="swatches">${colors.map((c, i) =>
      `<span class="sw" data-i="${i}"><i style="background:${c}"></i>${labels[i]}</span>`).join("")
    }<span class="sw nd"><i></i>No data</span></div>`;
    el.querySelectorAll(".sw[data-i]").forEach((s) => {
      s.addEventListener("pointerenter", () => map.highlight((id) => classOf(id) === +s.dataset.i));
      s.addEventListener("pointerleave", () => map.highlight(null));
    });
  }

  function rankList(ol, rows, map, valueFmt, colorOf, ctx) {
    ol.innerHTML = rows.map((r) =>
      `<li data-k="${r.k}"><span><i class="chip" style="background:${colorOf(r)}"></i>${ctx.nameOf(r.k)}<small>${ctx.placeOf(r.k)}</small></span><b>${valueFmt(r)}</b></li>`).join("");
    ol.querySelectorAll("li").forEach((li) => {
      li.addEventListener("pointerenter", () => {
        const k = li.dataset.k;
        map.highlight((id) => id === k);
        const rect = li.getBoundingClientRect();
        map.hoverKey(k, { clientX: rect.left - 8, clientY: rect.top, fromList: true });
      });
      li.addEventListener("pointerleave", () => map.clear());
    });
  }

  function thresholdLabels(domain, unit) {
    const out = [`< ${domain[0]}${unit}`];
    for (let i = 1; i < domain.length; i++) out.push(`${domain[i - 1]}–${domain[i]}${unit}`);
    out.push(`${domain[domain.length - 1]}${unit}+`);
    return out;
  }

  const fill = (sel, key, html) => { const el = document.querySelector(`${sel} [data-fill="${key}"]`); if (el) el.innerHTML = html; };
  const ttHead = (id, ctx) => `<div class="tt-name">${ctx.nameOf(id)}</div><div class="tt-sub">${ctx.placeOf(id)} · ${id}</div>`;

  /* ------------------------------------------------------------------ Map 01 */
  function mapLongevity(map, ind, ctx) {
    const R = ind.regions;
    const domain = [76, 78, 80, 82, 84];
    const scale = d3.scaleThreshold().domain(domain).range(BLUES);
    const shown = new Set(ctx.regions.map((f) => f.id));
    const val = (id) => (R[id] && R[id].le != null ? R[id].le : null);
    const rows = Object.keys(R).filter((k) => val(k) != null && shown.has(k))
      .map((k) => ({ k, v: val(k) })).sort((a, b) => b.v - a.v);
    const rankOf = new Map(rows.map((r, i) => [r.k, i + 1]));

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
    const yrs = (r) => fmt1(r.v);
    rankList(map.section.querySelector(".rank.top"), rows.slice(0, 8), map, yrs, (r) => scale(r.v), ctx);
    rankList(map.section.querySelector(".rank.bottom"), rows.slice(-8).reverse(), map, yrs, (r) => scale(r.v), ctx);

    const hi = rows[0], lo = rows[rows.length - 1];
    fill("#map-01", "le-deck", `Life expectancy at birth, ${ind.years.le}, NUTS 2 regions. Someone born in ${ctx.nameOf(hi.k)} (${ctx.placeOf(hi.k)}) can expect to live
      <strong>${fmt1(hi.v - lo.v)} years longer</strong> than someone born in ${ctx.nameOf(lo.k)} (${ctx.placeOf(lo.k)}).`);
    fill("#map-01", "le-source", `Data: Eurostat, life expectancy at birth by NUTS 2 region (demo_r_mlifexp), ${ind.years.le}; a few regions use the latest earlier year. Built ${ind.built}.`);
  }

  /* ------------------------------------------------------------------ Map 02 */
  function mapHeat(map, temp, metric, ctx) {
    const R = temp.regions, spec = HEAT_SPEC[metric], meta = temp.metrics[metric];
    const [y0, y1] = temp.period;
    const colors = HEAT.slice(HEAT.length - spec.domain.length - 1);
    const scale = d3.scaleThreshold().domain(spec.domain).range(colors);
    const shown = new Set(ctx.regions.map((f) => f.id));
    const val = (id) => (R[id] && R[id][metric] != null ? R[id][metric] : null);
    const rows = Object.keys(R).filter((k) => val(k) != null && shown.has(k))
      .map((k) => ({ k, v: val(k) })).sort((a, b) => b.v - a.v);
    const rankOf = new Map(rows.map((r, i) => [r.k, i + 1]));

    map.setFill((id) => (val(id) != null ? scale(val(id)) : null));
    map.setTip((id) => {
      const r = R[id];
      if (!r) return `${ttHead(id, ctx)}<div class="tt-row">No data</div>`;
      const row = (k) => (r[k] != null ? `<div class="tt-row${k === metric ? " on" : ""}">${temp.metrics[k].short} <b>${HEAT_SPEC[k].fmt(r[k])}</b></div>` : "");
      return `${ttHead(id, ctx)}${row("tx_jja")}${row("tx_year")}${row("hot30")}
        <div class="tt-row">Rank (${meta.short}) <b>${rankOf.get(id) || "–"} of ${rows.length}</b></div>
        <div class="tt-row">Period <b>${y0}–${y1}</b></div>`;
    });
    legend(map, metric === "hot30" ? "Days" : "°C", colors, thresholdLabels(spec.domain, spec.unit),
      (id) => (val(id) != null ? d3.bisectRight(spec.domain, val(id)) : -1));
    const f = (r) => spec.list(r.v);
    rankList(map.section.querySelector(".rank.top"), rows.slice(0, 8), map, f, (r) => scale(r.v), ctx);
    rankList(map.section.querySelector(".rank.bottom"), rows.slice(-8).reverse(), map, f, (r) => scale(r.v), ctx);

    const decks = {
      tx_jja: `The warmest part of every summer day (June–August), averaged over each region and over <strong>${y0}–${y1}</strong>.`,
      tx_year: `The warmest part of every day of the year, averaged over each region and over <strong>${y0}–${y1}</strong>.`,
      hot30: `How many days a year reached <strong>30 °C or more</strong>, on average over ${y0}–${y1}.`,
    };
    fill("#map-02", "t-deck", decks[metric]);
    fill("#map-02", "t-source", `Data: ${temp.source}, ${y0}–${y1} (file ${temp.file}, built ${temp.built}). Grid cells averaged within each region, weighted by area. <a href="${temp.source_url}">Source</a>.`);
  }

  /* ------------------------------------------------------------------ Map 03 */
  function mapInequality(map, ind, temp, metric, ctx) {
    const R = ind.regions, T = temp.regions, meta = temp.metrics[metric], spec = HEAT_SPEC[metric];
    const shown = new Set(ctx.regions.map((f) => f.id));
    const both = Object.keys(R).filter((k) => shown.has(k) && R[k].p65 != null && T[k] && T[k][metric] != null)
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
    const holder = map.section.querySelector(".bilegend");
    holder.innerHTML = "";
    const cell = 26, pad = 2, g0 = 30, gw = 3 * (cell + pad) - pad;
    const lg = d3.select(holder).append("svg").attr("width", g0 + gw + 70).attr("height", gw + 46);
    const grid = lg.append("g").attr("transform", `translate(${g0},6)`);
    for (let e = 0; e < 3; e++) for (let t = 0; t < 3; t++) {
      grid.append("rect")
        .attr("x", t * (cell + pad)).attr("y", (2 - e) * (cell + pad))
        .attr("width", cell).attr("height", cell).attr("rx", 2).attr("fill", BIV[e][t])
        .on("pointerenter", () => map.highlight((id) => { const d = byKey.get(id); return d && d.ti === t && d.ei === e; }))
        .on("pointerleave", () => map.highlight(null));
    }
    const cut = (v) => (metric === "hot30" ? `${Math.round(v)} d` : `${fmt1(v)}°`);
    grid.append("text").attr("class", "bt").attr("x", 0).attr("y", gw + 16).text("Hotter →");
    grid.append("text").attr("x", 0).attr("y", gw + 30).text(`cut-offs ${cut(tq[0])} · ${cut(tq[1])}`);
    grid.append("text").attr("class", "bt").attr("transform", `translate(-10,${gw}) rotate(-90)`).text("Older →");
    grid.append("text").attr("x", gw + 8).attr("y", 12).text(`65+ ≥ ${fmt1(eq[1])}%`);
    grid.append("text").attr("x", gw + 8).attr("y", gw - 2).text(`< ${fmt1(eq[0])}%`);

    const hh = both.filter((d) => d.ti === 2 && d.ei === 2).sort((a, b) => b.score - a.score);
    rankList(map.section.querySelector(".rank.hh"), hh.slice(0, 15), map,
      (r) => `${spec.list(r.t)} · ${fmt1(r.e)}%`, color, ctx);

    const totalOld = d3.sum(both, (d) => d.old);
    const hhOld = d3.sum(hh, (d) => d.old);
    const byCountry = d3.rollups(hh, (v) => v.length, (d) => ctx.placeOf(d.k)).sort((a, b) => b[1] - a[1]);
    fill("#map-03", "hh-stat", hh.length
      ? `<strong>${hh.length} regions</strong> are in both the hottest and the oldest third. They are home to
         <strong>${fmtPeople(hhOld)}</strong> people aged 65+ (${Math.round(100 * hhOld / totalOld)}% of all older people on the map).
         Most of these regions are in ${byCountry.slice(0, 3).map(([c, n]) => `${c} (${n})`).join(", ")}.`
      : "");
    fill("#map-03", "i-source", `Data: heat is ${meta.label.toLowerCase()} over ${temp.period[0]}–${temp.period[1]} (Map 02). Share of people aged 65+
      and population come from Eurostat (demo_r_pjanind2, demo_r_d2jan), ${ind.years.p65}. Thirds are computed over the ${both.length} regions that have both values.`);
  }

  function fmtPeople(n) {
    if (n >= 1e6) return `${fmt1(n / 1e6)} million`;
    return `${Math.round(n / 1e3)} thousand`;
  }

  function pending(map, what) {
    const el = map.section.querySelector(".pending");
    const side = map.section.querySelector(".side");
    if (side) side.hidden = true;
    el.hidden = false;
    el.innerHTML = `<div>${what} hasn't been built yet.<br>The GitHub Action builds it on deploy, or run
      <code>python scripts/build_data.py</code> locally.</div>`;
  }

  /* ------------------------------------------------------------------ tooltip */
  function showTip(ev, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = ev.fromList ? ev.clientX - r.width : ev.clientX + 14;
    let y = ev.fromList ? ev.clientY : ev.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - 14;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }
  function hideTip() { tip.hidden = true; }
})();
