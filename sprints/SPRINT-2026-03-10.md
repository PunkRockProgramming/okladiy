# Sprint: OKDIY Agent System — Phase 2

**Date:** 2026-03-10
**Type:** Build
**Ratio:** 60% agent improvements / 40% venue expansion

---

## Goal

Make the PM and tech-lead agents useful in day-to-day operations. Add a `plan-sprint` command to PM that reads system state + roadmap and drafts actionable sprint tasks. Wire the tech-lead to auto-investigate anomalies. Complete the RSSHub PoC when Docker is available. Identify and onboard 2-3 new OKC/Tulsa venues.

---

## Decisions (locked before sprint starts)

- **Decision Manager:** Standalone at `decision-manager/` — agents produce decisions, humans review via web UI on port 3339
- **RSSHub PoC:** Approved (DEC-0002, DEC-0003) — execute when Docker + Instagram session are available
- **Agent orchestration:** PM delegates to tech-lead; tech-lead writes proposals; human approves via decision-manager; PM then delegates execution

---

## Tasks

### Agent Improvements

- [x] PM agent: add `plan-sprint` command
  - Reads scraper health, open anomalies, pending decisions, current shows.json stats
  - Reads `ROADMAP.md` or project-roadmap.md for priorities
  - Outputs a draft SPRINT.md with prioritized tasks
- [x] PM agent: add `review` command — summarize what changed since last run (new anomalies, resolved decisions, scraper failures)
- [x] Tech-lead agent: add `auto-investigate` mode
  - Reads open anomalies from DB
  - For each unresolved anomaly, investigates root cause and proposes a fix or writes a DEC
  - Limit: 2 investigations per run to control API costs
- [x] Wire PM `delegate` command to actually execute tech-lead investigations (currently logs as pending)

### RSSHub PoC Completion

- [ ] Start Docker Desktop
- [ ] Create burner Instagram account
- [ ] Extract `sessionid` cookie from browser DevTools
- [ ] `docker run -d --name rsshub-poc -p 1200:1200 -e INSTAGRAM_SESSION_ID=$INSTAGRAM_SESSION_ID diygod/rsshub:latest`
- [ ] Test: `RSSHUB_URL=http://localhost:1200 node scraper/run-one.js sanctuary`
- [ ] If success: `npm install fast-xml-parser` (not needed for manual paste path, but enables RSS)
- [ ] If fail: document failure mode in DEC-0003, promote manual paste to primary

### Venue Expansion

- [x] Research 2-3 new OKC/Tulsa venues to add scrapers for
  - Cain's Ballroom (Tulsa): WordPress + RHP plugin, server-rendered listing, 34 shows — VIABLE
  - Tulsa Theater (Tulsa): WordPress + RHP plugin, server-rendered listing, 19 shows — VIABLE
  - The Blue Note (OKC): site down — NOT VIABLE
  - Sound Pony (Tulsa): domain for sale — NOT VIABLE
  - Jones Assembly (OKC): JS redirect, no scrape — NOT VIABLE
  - Tulsa Theater event detail pages: JS-rendered (no server-side JSON-LD) — listing page used instead
- [x] Build scrapers for viable venues (follow `scraper/scrapers/_template.js` pattern)
  - `scraper/scrapers/cainsballroom.js` — 34 shows from listing page
  - `scraper/scrapers/tulsatheater.js` — 19 shows from listing page
- [x] Verify via `node scraper/run-one.js VENUE` and add to SCRAPERS array

### Consolidation Cleanup

- [x] Update `okladiy/CLAUDE.md` to document new files from consolidation sprint:
  - `scraper/parse-text.js` (shared parser)
  - `scraper/validate.js` (shared validation)
  - `scraper/scrapers/sanctuary.js` (Instagram venue)
  - `scraper/data/sanctuary-manual.txt` (manual paste file)

---

## Done When

- `node agents/pm/index.js plan-sprint` produces a usable draft sprint
- `node agents/pm/index.js review` summarizes recent system changes
- Tech-lead can auto-investigate at least 1 anomaly and write a proposal
- RSSHub PoC has a clear pass/fail result documented
- At least 1 new venue scraper is added and returning shows
