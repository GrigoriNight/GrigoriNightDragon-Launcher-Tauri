# GrigoriNightDragon — Desktop Launcher (Tauri)

This wraps your HTML launcher in a real Windows app so **Play actually opens
`GrigoriNightDragon.exe`**, the launcher can hide while the game runs, and it can
self-update — the things a browser can't do.

You do **not** need to edit any code. Two things to drop in, then build.

---

## What's inside

```
gnd-tauri/
├─ package.json
├─ game/                         <-- PUT YOUR GAME BUILD HERE (GrigoriNightDragon.exe + files)
├─ src/                          the launcher UI shown in the window
│  ├─ index.html                 entry (redirects to launcher.html)
│  ├─ launcher.html              YOUR launcher (bridge already injected)
│  ├─ bridge.js                  connects Play/Hide/Update to the app
│  ├─ GrigoriNightDragon-bg.jpg
│  └─ GrigoriNightDragon-logo.png
└─ src-tauri/                    the native app (Rust)
   ├─ Cargo.toml
   ├─ build.rs
   ├─ tauri.conf.json
   ├─ icons/                     app icons (generated from your logo)
   └─ src/main.rs                launch_game / hide / self_update
```

---

## One-time setup (install the tools)

1. **Node.js** (LTS) — https://nodejs.org
2. **Rust** — https://rustup.rs  (run the installer, accept defaults)
3. **Windows build tools** — install "Desktop development with C++" from the
   Visual Studio Build Tools, and the **WebView2 runtime** (most Win10/11 PCs
   already have it): https://developer.microsoft.com/microsoft-edge/webview2

---

## Drop in your two things

1. **Your game build** → copy `GrigoriNightDragon.exe` (and all its files) into
   the **`game/`** folder. The launcher's config already points at
   `GrigoriNightDragon.exe`; if your exe has a different name, change
   `gameExe` in `src/launcher.html` (in the `CONFIG` block near the top of the
   `<script>`).

2. Nothing else — your background, logo, PlayFab title, and support email are
   already baked into `launcher.html`.

---

## Run it (dev)

From the `gnd-tauri/` folder:

```bash
npm install
npm run dev
```

A window opens with your launcher. Sign in, Install/Update, and **Play now
launches `GrigoriNightDragon.exe`** with the PlayFab sign-on handoff.

## Build the installer

```bash
npm run build
```

The installer lands in
`src-tauri/target/release/bundle/` (`.msi` and `.exe` (NSIS)).
That's what you give players.

---

## How the pieces connect (no action needed)

- **Play** → `bridge.js` → Rust `launch_game` → runs `game/GrigoriNightDragon.exe`
  with `GND_TITLE_ID`, `GND_PLAYFAB_ID`, `GND_TICKET` as environment variables.
  Your UE5 game reads those on startup (see `PlayFab-SSO-UE5.md`) so the player
  isn't asked to log in twice.
- **Hide while playing** (Settings) → `hide_launcher`.
- **Launcher self-update** → when your manifest's `launcherVersion` changes, the
  maintenance screen downloads the update, then `self_update` opens the installer
  and quits so it can replace itself. Set `launcherUrl` in `CONFIG` to your
  installer link for this.

## Notes

- The game exe is searched for in `game/` next to the launcher (and in the
  bundled resources), so a normal install works with no path fiddling.
- PlayFab and downloads work from the packaged app the same as from a hosted
  page — no `file://` origin problem here.
