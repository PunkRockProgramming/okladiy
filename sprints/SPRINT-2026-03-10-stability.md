# Sprint: OKDIY — Stability & Instagram PoC

**Date:** 2026-03-10
**Type:** Debt / Build
**Ratio:** 50% scraper fixes / 50% RSSHub PoC

---

## Goal

Fix the two open scraper anomalies (Opolis returning 0 shows, BeerCity DB constraint error) and complete the RSSHub Instagram PoC for The Sanctuary OKC.

---

## Decisions (locked before sprint starts)

- **RSSHub PoC:** Approved (DEC-0002, DEC-0003) — deferred from Phase 2 sprint, execute when Docker + Instagram session are available

---

## Tasks

### Scraper Fixes

- [ ] Investigate Opolis 0-show anomaly
  - Verify opolis.net/events is still live and has listings
  - Run `node scraper/run-one.js opolis` and inspect raw HTML
  - Fix selectors if Squarespace layout changed
  - Mark anomaly resolved once show_count > 0
- [ ] Fix BeerCity `ON CONFLICT` DB constraint error
  - Trace the error in `agents/scraper/index.js` — likely a schema mismatch in the `shows` table upsert
  - Check `db/schema.sql` UNIQUE constraint vs the INSERT statement
  - Fix and verify via `node agents/scraper/index.js beercity`
  - Mark anomaly resolved

### RSSHub PoC Completion

- [ ] Start Docker Desktop
- [ ] Create burner Instagram account
- [ ] Extract `sessionid` cookie from browser DevTools
- [ ] `docker run -d --name rsshub-poc -p 1200:1200 -e INSTAGRAM_SESSION_ID=$INSTAGRAM_SESSION_ID diygod/rsshub:latest`
- [ ] Test: `RSSHUB_URL=http://localhost:1200 node scraper/run-one.js sanctuary`
- [ ] If success: `npm install fast-xml-parser` (not needed for manual paste path, but enables RSS)
- [ ] If fail: document failure mode in DEC-0003, promote manual paste to primary

---

## Done When

- Opolis scraper returns > 0 shows
- BeerCity scraper runs without DB constraint errors
- Both anomalies marked resolved in DB
- RSSHub PoC has a clear pass/fail result documented
