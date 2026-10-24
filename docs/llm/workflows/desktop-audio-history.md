# Desktop audio history

## Requirements

### DAH-numbered-pages

The desktop app SHALL display local WAV/MP3 history in newest-first numbered pages of 20 items and expose the total item count and page count.

#### Scenario: navigate through all audio history pages

- GIVEN 55 local audio files
- WHEN the client requests pages 1, 2, and 3
- THEN the pages contain 20, 20, and 15 unique files in newest-first order, with a page count of 3

Evidence: `apps/desktop/src/App.tsx`, `src/tts_mcp/desktop.py`, `tests/test_desktop.py`

## Flow

The Audio History view keeps the selected 1-based page in React state and keys its TanStack Query by that page. The shadcn-style Pagination component exposes direct page links, previous/next controls, and ellipses for long page ranges. The sidecar scans the local output directory, combines regular WAV/MP3 files with available synthesis metadata, sorts newest first, and returns the requested page with the total and page count.

## State changes

Changing pages updates only in-memory UI state and the query cache. It does not modify audio files or metadata. Opening Audio History starts at page 1, and synthesis success resets the selected history page to page 1. If a requested page is beyond the current last page, the sidecar clamps it to the last available page, or page 1 when history is empty.

## Side effects

Page requests read the local output directory and synthesis metadata. They do not make network requests or write history data.

## Authorization & constraints

The page number must be a positive integer. Each response contains at most 20 items. A valid page number past the current page count is clamped to the last available page.

## Error paths

Invalid page values return `invalid_input`. An empty output directory returns no items and a page count of zero; the UI hides pagination when there is only one or zero pages.

## Tests

`tests/test_desktop.py` covers numbered page sizes, page counts, ordering, and equivalence with the full listing.

## Related

- [Architecture overview](../architecture/overview.md)

## Sources

- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/ui/pagination.tsx`
- `apps/desktop/src/lib/i18n.ts`
- `apps/desktop/src/lib/sidecar.ts`
- `src/tts_mcp/desktop.py`
- `tests/test_desktop.py`
