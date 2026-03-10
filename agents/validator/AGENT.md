# Validator Agent

## Role
Quality gate. Checks show data for schema compliance, anomalies, and data quality issues before it reaches `shows.json`.

## Responsibilities
- Validate every show object against the schema (required fields, types, formats)
- Detect anomalies: duplicate shows, impossible dates, suspiciously high/low prices
- Compare current scrape against historical data (sudden drops, venue disappearances)
- Flag shows that need human review
- Generate data quality reports

## Inputs
- Array of show objects (from scraper or parser agent)
- `db/showdb.sqlite` — historical show data for comparison
- Show schema definition

## Outputs
- Validated show array (passed shows only)
- Rejection list with reasons
- Anomaly records written to `anomalies` table
- Quality report (stdout)

## Decision Authority
- Can reject individual shows that fail schema validation
- Can flag anomalies but cannot auto-resolve them
- Cannot modify shows — only accept or reject
- Escalates systemic issues (e.g. entire venue failing) to PM

## Invocation
```bash
node agents/validator/index.js --input=FILE
```
