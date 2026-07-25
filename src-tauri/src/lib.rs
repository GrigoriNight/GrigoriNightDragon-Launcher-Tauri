use serde::Deserialize;
#[cfg(not(target_os = "android"))]
use std::path::PathBuf;
#[cfg(not(target_os = "android"))]
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
    url: String,
}

#[cfg(not(target_os = "android"))]
fn resolve_exe(app: &tauri::AppHandle, exe_name: &str) -> Option<PathBuf> {
    let name = if exe_name.is_empty() { "GrigoriNightDragon.exe" } else { exe_name };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("game").join(name));
        candidates.push(res.join(name));
    }
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
    #[cfg(target_os = "android")]
    return Err("Game launching is not supported on Android.".into());

    #[cfg(not(target_os = "android"))]
    {
        let exe = resolve_exe(&app, &payload.exe)
            .ok_or_else(|| format!("Couldn't find {} — put it in the launcher's `game` folder.", if payload.exe.is_empty() { "GrigoriNightDragon.exe" } else { &payload.exe }))?;
        let workdir = exe.parent().map(|p| p.to_path_buf());
        let mut cmd = Command::new(&exe);
        cmd.env("GND_TITLE_ID", &payload.title_id)
            .env("GND_PLAYFAB_ID", &payload.play_fab_id)
            .env("GND_TICKET", &payload.session_ticket);
        if let Some(dir) = workdir { cmd.current_dir(dir); }
        cmd.spawn().map_err(|e| format!("Failed to launch: {e}"))?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
