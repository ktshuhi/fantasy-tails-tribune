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
- `archive.html`: Back issues, admins only. Readers who open it are sent to the paper.
- `tribune-<edition>.html`: Archived editions, kept exactly as they ran (same key, so they still open).
- `tools/build.py`: Encrypts a new edition. Needs the passwords (league, admin, then one per extra editor); never commit them.

## Editing (admins)
1. Sign in with the admin password.
2. Tap the round pencil at the bottom right. Small pencils appear under every editable block.
3. Tap one, change the text, Save change.
4. The first save on a device asks for a GitHub key (fine-grained token with
   Contents: Read and write on this repo only). The phone remembers it.
   Edits show for everyone within about a minute.

## New edition each week
Before building, save the current paper as an archive copy: copy tribune.html to tribune-<its edition>.html (e.g. tribune-2026-week-11-vol-2.html), then add it to the EDITIONS list at the bottom of archive.html, newest first, and move "current: true" to the new edition.
1. Put the new export next to the plain-text sources (not in this repo), with the
   `ftt-edition` meta set to a new value (e.g. `2026-week-12`).
2. Run `python3 tools/build.py SRC_DIR . LEAGUE_PASSWORD ADMIN_PASSWORD`.
   It reuses the same paper key, so signed-in phones keep working.
3. Commit and push. Pencil edits are kept per edition and are encrypted too.

## Traffic
GoatCounter: https://fantasy-tails-tribune.goatcounter.com. Visits from devices signed in as admin are
counted separately under paths starting with /admin/, so readers and admins can be told apart.

When signed in as admin, the round chart button at the bottom left shows views for the
last 30 days: readers as solid bars, admin visits dashed on top and left out of
the total. The first tap asks for a GoatCounter API key (GoatCounter: Settings, API,
with "Read statistics" ticked). The device remembers it.

Saved app (home screen)

- The "Put the Tribune on your phone" tip shows once per visit and never inside the saved app. (iPhones can't tell Safari whether the app is already saved, so someone who saved it but opens a link in Safari can still see the tip once.)
- Opening the saved app is counted in GoatCounter as the event "app-open", once per device per day. That is the count of people using the saved app.
- Notifications are offered only inside the saved app, only to people who haven't turned them on, and not again for 7 days after "Not now". They run through OneSignal (free): create a Web app at onesignal.com with site URL https://ktshuhi.github.io/fantasy-tails-tribune, paste its App ID into ONESIGNAL_APP_ID in the edition source, rebuild. Send pushes from the OneSignal dashboard. OneSignalSDKWorker.js must stay in the repo root. iPhones need iOS 16.4 or later and the app saved to the home screen.
