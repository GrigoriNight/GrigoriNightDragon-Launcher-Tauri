// GrigoriNightDragon Launcher — desktop shell
// Exposes the bridges the HTML launcher calls:
//   window.__GND_LAUNCH__(payload)        -> launch_game   (opens the .exe with the sign-on handoff)
//   window.__GND_HIDE__()                 -> hide_launcher (hide window while playing)
//   window.__GND_SELF_UPDATE__(payload)   -> self_update   (open the downloaded launcher installer, then quit)

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use serde::Deserialize;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

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
    version: String,
    #[serde(default)]
    url: String,
}

/// Resolve the game executable. We look next to the launcher and in a `game/`
/// subfolder (that's where the bundle places resources), so a normal install
/// "just works".
fn resolve_exe(app: &tauri::AppHandle, exe_name: &str) -> Option<PathBuf> {
    let name = if exe_name.is_empty() { "GrigoriNightDragon.exe" } else { exe_name };

    let mut candidates: Vec<PathBuf> = Vec::new();

    // 1) bundled resources (game/ shipped alongside the launcher)
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("game").join(name));
        candidates.push(res.join(name));
    }
    // 2) next to the launcher executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("game").join(name));
            candidates.push(dir.join(name));
        }
    }

    candidates.into_iter().find(|p| p.exists())
}

#[tauri::command]
fn launch_game(app: tauri::AppHandle, payload: LaunchPayload) -> Result<(), String> {
    let exe = resolve_exe(&app, &payload.exe)
        .ok_or_else(|| format!("Couldn't find {} — put it in the launcher's `game` folder.", if payload.exe.is_empty() { "GrigoriNightDragon.exe" } else { &payload.exe }))?;

    let workdir = exe.parent().map(|p| p.to_path_buf());

    let mut cmd = Command::new(&exe);
    // Single sign-on handoff — the UE5 game reads these (see PlayFab-SSO-UE5.md).
    // Environment variables keep the ticket out of the visible process command line.
    cmd.env("GND_TITLE_ID", &payload.title_id)
        .env("GND_PLAYFAB_ID", &payload.play_fab_id)
        .env("GND_TICKET", &payload.session_ticket);
    if let Some(dir) = workdir {
        cmd.current_dir(dir);
    }

    cmd.spawn().map_err(|e| format!("Failed to launch: {e}"))?;

    if payload.hide_launcher {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.hide();
        }
    }
    Ok(())
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

/// Real launcher self-update: open the downloaded installer, then quit so it can
/// replace this app. `url` is the installer the HTML already downloaded/points to.
#[tauri::command]
fn self_update(app: tauri::AppHandle, payload: UpdatePayload) -> Result<(), String> {
    if payload.url.is_empty() {
        return Err("No update URL provided.".into());
    }
    // Hand the installer URL to the OS (browser/associated handler downloads+runs
    // an .exe/.msi installer), then exit so the update can overwrite the launcher.
    open_url(&payload.url)?;
    // Give the handoff a beat, then close.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1200));
        handle.exit(0);
    });
    Ok(())
}

fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd").args(["/C", "start", "", url]).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(url).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(url).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            launch_game,
            hide_launcher,
            show_launcher,
            self_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running GrigoriNightDragon Launcher");
}
