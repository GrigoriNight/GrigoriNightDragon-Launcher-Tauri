// bridge.js — connects the launcher's window.__GND_* hooks to the Rust commands.
// Loaded before launcher.html's own script so the hooks exist when Play is clicked.
(function () {
  function invoke(cmd, args) {
    // Tauri v2 exposes the invoke function on window.__TAURI__.core
    var t = window.__TAURI__;
    if (t && t.core && typeof t.core.invoke === "function") {
      return t.core.invoke(cmd, args);
    }
    return Promise.reject(new Error("Tauri bridge unavailable"));
  }

  // Play -> launch the game exe with the sign-on handoff
  window.__GND_LAUNCH__ = function (payload) {
    return invoke("launch_game", { payload: payload });
  };

  // Hide the launcher window while the game runs
  window.__GND_HIDE__ = function () {
    return invoke("hide_launcher", {});
  };

  // Show it again (e.g. if you later detect the game closed)
  window.__GND_SHOW__ = function () {
    return invoke("show_launcher", {});
  };

  // Launcher self-update -> open installer + quit so it can replace itself
  window.__GND_SELF_UPDATE__ = function (payload) {
    return invoke("self_update", { payload: payload });
  };

  // Download + unzip the game into the launcher's own data folder (Rust side)
  window.__GND_DOWNLOAD__ = function (payload) {
    return invoke("download_game", { payload: payload });
  };
})();
