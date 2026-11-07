# Long lives, hot summers: three maps of Europe

These maps are made for #30DayMapChallenge. All three sit on one GitHub Pages page and use NUTS 2 regions (NUTS 2024). Large cities are marked on each map.

1. **Map 01: Where Do People Live the Longest?** Life expectancy at birth (Eurostat).
2. **Map 02: How Hot Was the Last Decade?** Daily maximum temperature averaged over the last 10 complete years (E-OBS). The map has three views: summer (June–August) average daily maximum, year-round average daily maximum, and the number of days per year at 30 °C or above.
3. **Map 03: Heat Inequality: Who Suffers Most?** A bivariate map. Each region is placed in a third by heat (whichever view is picked in Map 02) and a third by its share of people aged 65+. The darkest regions are in the top third on both measures.

## Publish

1. Push this folder to the `main` branch of a GitHub repository.
2. Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. `.github/workflows/pages.yml` runs on every push. It downloads the Eurostat tables and the E-OBS temperature file (about 0.5 GB), averages the grid within each region, writes `data/indicators.json` and `data/temperature.json`, and deploys the site. The **Summary** step in the log prints a few example regions, so you can sanity-check the numbers there. The workflow also runs once a month and picks up new Eurostat years and new E-OBS versions without any changes.

## Data

| File | What | Source |
|---|---|---|
| `data/indicators.json` *(built)* | Life expectancy at birth, % of people aged 65+, population | Eurostat `demo_r_mlifexp`, `demo_r_pjanind2` (`PC_Y65_MAX`), `demo_r_d2jan` |
| `data/temperature.json` *(built)* | Average daily maximum (summer and year-round) and days ≥ 30 °C, 10-year means | [E-OBS](https://surfobs.climate.copernicus.eu/dataaccess/access_eobs.php) TX ensemble mean, 0.25° (Copernicus C3S, ECA&D) |
| `data/europe.topo.json` | NUTS 2 regions and the surrounding countries | Eurostat GISCO via [Nuts2json](https://github.com/eurostat/Nuts2json), 1:20M |
| `data/cities.json` | Capitals and cities with more than 1.5 million people | [Natural Earth](https://www.naturalearthdata.com/) populated places |

Temperature is the area-weighted average of the E-OBS grid cells whose centres fall inside a region. A region too small to contain any cell centre (for example Ceuta or Melilla) takes the value of the nearest cell.

To build locally:

```bash
pip install -r scripts/requirements.txt
python scripts/build_data.py          # or: eurostat | eobs
python -m http.server 8000
```

E-OBS is free for non-commercial and research use. Please acknowledge "the E-OBS dataset from the Copernicus Climate Change Service, and the data providers in the ECA&D project (https://www.ecad.eu)".
