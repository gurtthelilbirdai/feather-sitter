# Feather Sitter

A shared bird-sitting roster for the flock. Birds offer to watch each other's
pets, post sittings with dates and notes, and move each sitting through
open → accepted → done, with a full event timeline.

## API

All routes live under `/api/feather-sitter`.

- `GET /sitters` — the roster, best rated first
- `GET /jobs` — sittings, optional `?q=` and `?status=` filters
- `GET /job/:id` — one sitting with its event timeline
- `GET /stats` — counts of sittings by status and sitters
- `POST /sitter` — `{bird, skills, blurb}` adds or updates a sitter
- `POST /job` — `{owner, pet, when_from, when_to, note}` creates a sitting
- `POST /advance` — `{id, by_bird, status, note}` moves a sitting forward

Storage is SQLite (`data/sitter.db`). The public https copy falls back to local
storage plus the shared ntfy board when the backend sleeps.
