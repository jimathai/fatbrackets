# FatBrackets Local React/Vite

Local React/Vite conversion of the current FatBrackets application.

## Requirements

- Node.js 22.12 or newer
- npm
- An existing Supabase project with the FatBrackets schema

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Environment

The project reads these values from `.env`:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

`.env` is intentionally ignored by Git. Use `.env.example` when sharing the project.

## Production build

```bash
npm run build
npm run preview
```

## Main project files

- `src/App.tsx` — FatBrackets application and UI
- `src/lib/supabase.ts` — Supabase browser client
- `src/styles/` — application styles
- `supabase/schema.sql` — database schema reference


## Current feature pass

- Bracket terminology throughout the visible UI
- Create flow starts with Bracket Name
- New brackets default to 16 entries
- Manual, pasted-list, TXT, and CSV entry options
- Manual, Voting, and Random play-mode selector

TXT and CSV imports currently support simple one-entry-per-line or comma-separated lists. XLSX, voice entry, AI-assisted list creation, and Explore are planned next.

## v1.4 Bracket advancement fix

Changing one matchup now preserves unrelated and still-valid downstream winners. Only picks that are no longer possible are cleared.


## v1.9 Manage Bracket

Saved brackets now include a dedicated Manage screen with drag-and-drop reseeding, region movement, seed locks, regional randomization, contestant editing, image URL support, and Supabase Storage uploads. Run `supabase/schema.sql` again to ensure the `contestant-images` bucket and storage policies exist.


## v2.1 save fix

Contestants are temporarily moved to non-conflicting seed slots before reseeded rows are saved, preserving IDs and avoiding unique seed collisions. Save failures now show the actual database message instead of incorrectly reporting missing seeds.

## v2.2 Product polish

- Added a confirmed Clear action on the live bracket that removes matchup winners only.
- Restored Edit bracket beside Save bracket on the bracket header.
- My Brackets now shows equal-width Manage and Open Bracket actions, with Manage first.
- Permanent bracket deletion moved to a Danger Zone on Manage Bracket.
- Added the initial Explore page with category discovery and public/published bracket listings.
- Matchup cards enlarge subtly on hover for easier focus.

## v2.3 tags and visibility

For an existing Supabase project, run `supabase/tags-and-visibility.sql` once in the Supabase SQL Editor before using this version. It adds the searchable `tags` column and index.

New bracket setup order:
1. Bracket Name
2. Tags
3. Bracket Size
4. Play Mode
5. Add Contestants

New brackets default to the `Undefined` tag and Private visibility. Public brackets are published and eligible to appear in Explore.


## v2.6 expanded regions

- 32-entry brackets use two regions of 16.
- 64-entry brackets use four regions of 16.
- 128-entry brackets use eight regions of 16.
- Region setup, Manage Bracket, region watermarks, dropdown navigation, double-click focus, overall seeding, and regional 1-16 seeding support all regional sizes.
- 128-entry brackets include a Final Eight focus option.


## v2.7 database migration
Run `supabase/clone-lineage.sql` once before using bracket cloning.

## Ownership security update

Before publishing, run `supabase/ownership-security.sql` once in the Supabase SQL Editor.

This version enforces owner-only editing and deletion in both the UI and Supabase Row Level Security:

- Explore brackets open in View only mode for guests and non-owners.
- Only the owner sees Edit, Clear, Save, Manage, and Delete controls.
- My Brackets is filtered by `owner_id`.
- Tournament, contestant, and matchup writes require ownership of the parent bracket.
