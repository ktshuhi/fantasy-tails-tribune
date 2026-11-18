# The Fantasy Tails Tribune

Live at https://ktshuhi.github.io/fantasy-tails-tribune/

## Files
- `index.html`: League sign-in page (front door), with the small "Admin" link.
- `tribune.html`: The current edition, encrypted. Only opens on a device that signed in with the league or admin password.
- `ftt-runtime.js`: Draws both pages.
- `ftt-admin.js`: Pencil editing for admins, and loads saved edits for everyone.
- `edits/<edition>.json`: Edits made with the pencil, one file per edition.
- `manifest.webmanifest`, `apple-touch-icon.png`, `app-icon-*.png`: Home screen app name and icon.
- `assets/`: Paper texture (photos live inside the encrypted paper).
- `tools/build.py`: Encrypts a new edition. Needs the passwords (league, admin, then one per extra editor); never commit them.

## Editing (admins)
1. Sign in with the admin password.
2. Tap the round pencil at the bottom right. Small pencils appear under every editable block.
3. Tap one, change the text, Save change.
4. The first save on a device asks for a GitHub key (fine-grained token with
   Contents: Read and write on this repo only). The phone remembers it.
   Edits show for everyone within about a minute.

## New edition each week
1. Put the new export next to the plain-text sources (not in this repo), with the
   `ftt-edition` meta set to a new value (e.g. `2026-week-12`).
2. Run `python3 tools/build.py SRC_DIR . LEAGUE_PASSWORD ADMIN_PASSWORD`.
   It reuses the same paper key, so signed-in phones keep working.
3. Commit and push. Pencil edits are kept per edition and are encrypted too.

## Traffic
GoatCounter: https://fantasy-tails-tribune.goatcounter.com (visits from admin devices are skipped).
