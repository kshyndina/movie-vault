# 🎬 Movie Vault

A personal, filterable library of the greatest films, scraped from 8 IMDb charts/lists.
Filter by category, tag, director, cast, and length; shuffle for a pick; and track what
you have watched, liked, and disliked — which retrains the "Recommended for you" sort.

**Live site:** https://kshyndina.github.io/movie-vault/

## What it does

- **~1,200 films** deduped from: IMDb Top 250, Top English, and 5 curated "greatest films" lists.
- **Filter** by:
  - Categories (max 2 per film — the primary IMDb genres)
  - Tags (up to 10 per film — IMDb plot keywords + extra genres + decade)
  - Director, Cast (top-billed stars), Length buckets, Source list, Search
- **Sort** by Recommended, Rating, Year, Length, Title, or Shuffle.
- **🎲 Surprise me** — picks one at random from whatever filters are active (prefers unseen).
- **Seen / 👍 / 👎 + why** — every film has watch + verdict buttons. Verdicts feed the recommender.

## Where your data lives

Your watch history (seen / liked / disliked / why) is stored in your **browser's localStorage**
on this site. It is private to you, needs zero setup, and survives refreshes. Use
**My data → Export** to back it up (JSON, or CSV that opens cleanly in Google Sheets).

### Optional: auto-sync to a Google Sheet

If you want every click written to a Google Sheet automatically:
1. Follow the 4 steps at the top of [`sheet-sync.gs`](sheet-sync.gs) (deploy it as a Web App, ~2 min).
2. Paste the resulting `/exec` URL into **My data → Google Sheet auto-sync**.

That is the only manual step, and only if you want the Sheet. The site works fully without it.

## Rebuilding the data

```
python3 merge.py      # merges data/base_all.json + data/enrich.json -> site/movies.json
```

- `data/base_all.json` — the 8 source lists (membership, genres, runtime, rating, year), scraped via the browser.
- `data/enrich.json` — per-title director, stars, plot-keyword tags, poster, synopsis.

## Gotchas (read before re-scraping)

- **IMDb is behind AWS WAF.** `curl`, `wget`, and server-side fetchers get a 202 challenge and empty body. You MUST scrape from a real signed-in browser. The data lives in the page's `__NEXT_DATA__` JSON.
- **Chart vs list shape differ.** Charts: `pageProps.pageData.chartTitles.edges[].node`. Lists: `pageProps.mainColumnData.list.titleListItemSearch.edges[].listItem`. Lists over 250 paginate via `?page=N`.
- **Charts/lists carry no cast or director** — only title/year/genre/runtime/rating. Those need a per-title fetch (we read each title page's `ld+json` for director/keywords/poster and `__NEXT_DATA__` `principalCredits` for stars).
- **Title pages are ~1.6 MB each.** Concurrency 4+ saturates bandwidth and the fetches time out; concurrency 2 with a 13s timeout is the stable setting. Bursts also trip IMDb rate-limiting (everything starts failing); back off and it recovers in ~30–60s.
- **`ld+json` caps actors at 3.** The 4th/5th star comes from `__NEXT_DATA__` `principalCredits`.
- **Exfil from the browser:** Chrome blocks https→localhost POSTs and only allows ONE automatic download per tab. Workaround used here: accumulate everything in one tab and trigger a single `Blob` download; checkpoint long jobs to `localStorage` so a disconnect can't lose progress.
- **Posters** are IMDb CDN URLs (`m.media-amazon.com`) resized via the `._V1_QL75_UY280_` token. They hotlink fine.
