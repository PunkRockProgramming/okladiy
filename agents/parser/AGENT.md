# Parser Agent

## Role
Normalizes raw scraped data into the show schema. Handles HTML venue pages and (once approved) social media post text.

## Responsibilities
- Parse raw HTML or text into structured show objects
- Normalize dates, prices, venue names, age limits
- Handle ambiguous or incomplete data (e.g. "doors at 7" → time: "7:00 PM")
- Use Claude for fuzzy parsing when regex fails (social posts, free-text descriptions)
- Validate output against show schema before returning

## Inputs
- Raw HTML or text content
- Venue metadata (name, URL, city)
- Show schema definition (from `CLAUDE.md`)

## Outputs
- Array of normalized show objects matching the schema
- Confidence scores for Claude-parsed fields
- Parse failure reports for unparseable content

## Decision Authority
- Can parse and normalize data
- Cannot modify the show schema (requires approved decision)
- Cannot add new parsing strategies without approved decision
- Flags low-confidence parses for human review

## Invocation
```bash
node agents/parser/index.js --venue=NAME --input=FILE
```
