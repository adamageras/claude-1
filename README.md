# get-gus

Schedule viewer for upcoming aufguss (sauna gus) sessions at Winter Island.

## What it does

Fetches the live session schedule and presents it as a filterable table. Visitors can narrow results by gusmaster, session type (CALM / FLOW / BOOST / HEAT & BEATS), and date via a calendar date picker.

## How it works

| Part | Description |
|------|-------------|
| `index.html` | Single-file frontend — no build step, no dependencies |
| `data.json` | Schedule data updated automatically every 30 minutes |
| `scripts/fetch-data.js` | Node.js script that fetches from the Google Apps Script endpoint and writes `data.json` |
| `.github/workflows/update-data.yml` | GitHub Actions workflow that runs `fetch-data.js` on a cron schedule and commits the result |

## Data pipeline

```
Google Apps Script (source) → fetch-data.js → data.json → index.html
                                    ↑
                          GitHub Actions (every 30 min)
```

The frontend reads `./data.json` directly — same origin, no CORS issues.

## Running locally

```bash
# Fetch latest data
node scripts/fetch-data.js

# Serve locally (any static server works)
npx serve .
```

## Design

Winter Island aesthetic: Playfair Display heading, warm linen background (`#ede8dc`), forest green accents. Mobile-first — desktop shows a table, mobile shows cards.
