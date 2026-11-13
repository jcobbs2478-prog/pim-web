# PIM for iPhone and iPad

**https://jcobbs2478-prog.github.io/pim-web/**

The phone and tablet version of [PIM](../PIM), Jerry's Windows task manager. It is a web page you add to the Home
Screen, and it syncs with PIM on the PCs through OneDrive. **This repository holds only code.** Your tasks are never
here: they live in your own OneDrive, behind your Microsoft sign-in.

## How it works

- **Sign-in:** standard Microsoft sign-in for browser apps (authorization code + PKCE). The app registration
  "PIM Sync" accepts personal Microsoft accounts only and has one permission, `Files.ReadWrite.AppFolder`: the page
  can read and write `OneDrive\Apps\PIM Sync` and nothing else in OneDrive. Its client id in `js/auth.js` is public
  by design; a browser app has no secret.
- **Sync:** the phone is a sync device like each PC. It reads every other device's newest file from
  `Apps\PIM Sync\devices`, merges field by field (newer stamp wins), and uploads its own edits as a new file
  `devices\<iPhone|iPad>-<id>\v<time>.json`, keeping the newest two. The rules in `js/engine.js` are a line-by-line
  port of PIM's `SyncEngine.cs`, checked against real PIM files (`tests/engine.test.mjs`, `tests/compat_write.mjs`).
- **When:** on opening, every 15 s while the page is on screen, when you come back to it, and 0.8 s after an edit.
- **Offline:** the page and your tasks are kept on the device; edits made offline upload when you are back online.
- **24-hour sign-in:** Microsoft limits browser apps to 24 hours per sign-in. After that the page goes to Microsoft
  and straight back without asking, as long as Microsoft remembers you on this device.

## Not (yet) on the phone

Reminders (a web page cannot schedule notifications without a server), pictures in notes (their lines show as
`![image](pim-image:...)`; leave them alone and they stay on the PC), Kanban, timeline, calendar and matrix views,
tags, and the PC's plain-English quick add (the phone has Today / Tomorrow / No date buttons instead).

## Develop

Static files, no build step. `python -m http.server 8765 --bind 127.0.0.1`, then open
`http://127.0.0.1:8765/?demo=1` for demo data (never syncs) or without `?demo` to sign in (that address is registered
for sign-in too). Tests: `node tests/engine.test.mjs <a replica written by PIM>` and
`python tests/ui_demo.py http://127.0.0.1:8765/ shots`.
