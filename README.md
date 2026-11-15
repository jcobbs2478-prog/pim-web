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
- **Habits:** the Habits tab (and the top of Today) lists your habits; tap the circle to check in (an amount habit
  asks how much), tap a habit for its month, where any past day can be checked or undone. Habits are created and
  edited in PIM on the PC. Rules in `js/habits.js`, ported from PIM's `HabitLogic.cs`.
- **Record kinds:** each sync file says which kinds of record its writer knows (`Format` 2 = lists, tasks, habits,
  check-ins, focus records). Records of a kind a file's writer did not know are ignored when it is merged, so an older
  device cannot delete them; same rule as the PC.
- **Bad files:** a device file that is not a sound replica (missing records or fields, or from a newer format) is skipped and
  counted in the status line, never merged, so one damaged file cannot stop sync. A damaged saved state on the device is
  set aside (`pim.state.unreadable`) and the page starts clean instead of staying blank.
- **24-hour sign-in:** Microsoft limits browser apps to 24 hours per sign-in. After that the page goes to Microsoft
  and straight back without asking, as long as Microsoft remembers you on this device.

## Not (yet) on the phone

Creating or editing habits, the Pomodoro timer (the focus record syncs and is kept, but is not shown), reminders (a web
page cannot schedule notifications without a server), pictures in notes (their lines show as
`![image](pim-image:...)`; leave them alone and they stay on the PC), Kanban, timeline, calendar and matrix views,
tags, and the PC's plain-English quick add (the phone has Today / Tomorrow / No date buttons instead).

## Develop

Static files, no build step. `python -m http.server 8765 --bind 127.0.0.1`, then open
`http://127.0.0.1:8765/?demo=1` for demo data (never syncs) or without `?demo` to sign in (that address is registered
for sign-in too). Tests: `node tests/engine.test.mjs <a replica written by PIM>`, `node tests/habits.test.mjs <a replica with habits>`,
`node tests/store.test.mjs` (damaged or full device storage), `node tests/compat_habits.mjs <replica> <test sync folder>` (then start PIM on that folder) and
`python tests/ui_demo.py http://127.0.0.1:8765/ shots`.
