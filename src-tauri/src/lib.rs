use serde::Deserialize;
#[cfg(not(target_os = "android"))]
use std::path::PathBuf;
#[cfg(not(target_os = "android"))]
use std::process::Command;
#[cfg(not(target_os = "android"))]
use std::io::Read;
#[cfg(not(target_os = "android"))]
use std::process::Stdio;
use tauri::Manager;
#[cfg(not(target_os = "android"))]
use tauri::Emitter;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchPayload {
    #[serde(default)]
    title_id: String,
    #[serde(default)]
    play_fab_id: String,
    #[serde(default)]
    session_ticket: String,
    #[serde(default)]
    exe: String,
    #[serde(default)]
    hide_launcher: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePayload {
    #[serde(default)]
    url: String,
}

#[cfg(not(target_os = "android"))]
fn resolve_exe(app: &tauri::AppHandle, exe_name: &str) -> Option<PathBuf> {
    // The packaged UE5 game ships inside the launcher's bundled `game/` folder
    // (tauri.conf.json bundles ../game/*). exe_name may be a plain file name
    // ("GNDPlayFab.exe") or a relative subpath ("Windows/GNDPlayFab.exe").
    let name = if exe_name.is_empty() { "GNDPlayFab.exe" } else { exe_name };
    let mut candidates: Vec<PathBuf> = Vec::new();
    // Bundled game files — the source of truth now that we no longer download.
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("game").join(name));
        candidates.push(res.join(name));
    }
    // Next to the launcher exe (dev / portable layout).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("game").join(name));
            candidates.push(dir.join(name));
        }
    }
    // Optional writable override (a future in-place patch dropped here wins last).
    if let Ok(data) = app.path().app_local_data_dir() {
        candidates.push(data.join("game").join(name));
    }
    candidates.into_iter().find(|p| p.exists())
}

#[tauri::command]
fn launch_game(app: tauri::AppHandle, payload: LaunchPayload) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return Err("Game launching is not supported on Android.".into());

    #[cfg(not(target_os = "android"))]
    {
        let exe = resolve_exe(&app, &payload.exe)
            .ok_or_else(|| format!("Couldn't find {} in the bundled game files.", if payload.exe.is_empty() { "GNDPlayFab.exe" } else { &payload.exe }))?;
        let workdir = exe.parent().map(|p| p.to_path_buf());
        // Where the captured game output is written, for the bug reporter to attach.
        let log_path = app.path().app_local_data_dir().ok().map(|d| d.join("last-run.log"));
        let exe_disp = exe.to_string_lossy().into_owned();
        let mut cmd = Command::new(&exe);
        cmd.env("GND_TITLE_ID", &payload.title_id)
            .env("GND_PLAYFAB_ID", &payload.play_fab_id)
            .env("GND_TICKET", &payload.session_ticket)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = workdir { cmd.current_dir(dir); }
        let mut child = cmd.spawn().map_err(|e| format!("Failed to launch: {e}"))?;
        // Tell the webview the game is live so it can report in-game presence to
        // the guild (heartbeat source "game"); a matching "game-exited" fires when
        // the process ends. The launcher webview keeps running JS while hidden.
        let _ = app.emit("game-started", ());
        let app_evt = app.clone();
        // Drain stdout/stderr on separate threads (a single sequential reader can
        // deadlock if the game fills the other pipe); a waiter thread then records
        // the exit code + captured output to last-run.log when the game closes.
        let mut out = child.stdout.take();
        let mut err = child.stderr.take();
        let h_out = std::thread::spawn(move || { let mut s = String::new(); if let Some(ref mut r) = out { let _ = r.read_to_string(&mut s); } s });
        let h_err = std::thread::spawn(move || { let mut s = String::new(); if let Some(ref mut r) = err { let _ = r.read_to_string(&mut s); } s });
        std::thread::spawn(move || {
            let status = child.wait();
            let _ = app_evt.emit("game-exited", ());
            let so = h_out.join().unwrap_or_default();
            let se = h_err.join().unwrap_or_default();
            if let Some(path) = log_path {
                let code = match status {
                    Ok(s) => s.code().map(|c| c.to_string()).unwrap_or_else(|| "terminated by signal".into()),
                    Err(_) => "unknown".into(),
                };
                let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                let body = format!(
                    "GrigoriNightDragon game log\nExe: {exe_disp}\nWhen (unix): {ts}\nExit code: {code}\n\n--- stdout ---\n{so}\n--- stderr ---\n{se}\n"
                );
                let _ = std::fs::write(&path, body);
            }
        });
        if payload.hide_launcher {
            if let Some(w) = app.get_webview_window("main") { let _ = w.hide(); }
        }
        Ok(())
    }
}

#[tauri::command]
fn hide_launcher(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_launcher(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
    Ok(())
}

#[tauri::command]
fn self_update(_app: tauri::AppHandle, payload: UpdatePayload) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return Err("Self-update is not supported on Android.".into());

    #[cfg(not(target_os = "android"))]
    {
        if payload.url.is_empty() { return Err("No update URL provided.".into()); }
        open_url(&payload.url)?;
        let handle = _app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1200));
            handle.exit(0);
        });
        Ok(())
    }
}

#[cfg(not(target_os = "android"))]
fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    { Command::new("cmd").args(["/C", "start", "", url]).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "macos")]
    { Command::new("open").arg(url).spawn().map_err(|e| e.to_string())?; }
    #[cfg(all(unix, not(target_os = "macos")))]
    { Command::new("xdg-open").arg(url).spawn().map_err(|e| e.to_string())?; }
    Ok(())
}

/// Return the tail (~16 KB) of the last game run's captured output, for the bug
/// reporter to attach. Empty string if the game hasn't been launched yet.
#[tauri::command]
fn read_crash_log(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("last-run.log");
    match std::fs::read_to_string(&path) {
        Ok(s) => {
            const MAX: usize = 16 * 1024;
            if s.len() > MAX {
                let mut start = s.len() - MAX;
                while start < s.len() && !s.is_char_boundary(start) { start += 1; }
                Ok(format!("…(truncated)…\n{}", &s[start..]))
            } else {
                Ok(s)
            }
        }
        Err(_) => Ok(String::new()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            launch_game,
            hide_launcher,
            show_launcher,
            self_update,
            read_crash_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running GrigoriNightDragon Launcher");
}
