/* Fix the Admin panel "get list of players" feature.
 *
 * Root cause: the CloudScript handlers Admin_GetAllPlayers and
 * Admin_GetAllPlayersWithCurrency call server.GetPlayersInSegment with a
 * placeholder SegmentId of all zeros ("00000000-0000-0000-0000-000000000000").
 * That segment does not exist, so PlayFab throws -> the launcher shows
 * "Load failed: JavascriptException".
 *
 * This script (Developer Secret Key comes from $PLAYFAB_SECRET, env only,
 * never written to disk, never pasted in chat):
 *   1) looks up your title's real "All Players" segment id,
 *   2) pulls the CURRENT LIVE CloudScript revision (so nothing is regressed),
 *   3) replaces the all-zeros SegmentId with the real one,
 *   4) publishes it LIVE as a new revision.
 *
 * Usage (it will ask for your key privately; nothing is echoed):
 *   node cloudscript/fix-all-players.js
 *
 * Options:
 *   --segment <id|name>   use a specific segment (default: the one named "All Players")
 *   --dry                 do everything EXCEPT the final publish (preview only)
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const TITLE  = (process.env.PLAYFAB_TITLE  || "17CBF3").trim();
let   SECRET = (process.env.PLAYFAB_SECRET || "").trim();  // may be filled by prompt below
const args   = process.argv.slice(2);
const DRY    = args.includes("--dry");
const segSel = (() => { const i = args.indexOf("--segment"); return i >= 0 ? args[i + 1] : null; })();
const ZERO   = "00000000-0000-0000-0000-000000000000";

// Ask for the Developer Secret Key with hidden input (no echo, no shell history).
// Raw-mode stdin: reliable in Termux; shows the prompt, hides what you type,
// accepts a pasted key, and submits on Enter.
function promptSecret() {
  return new Promise(resolve => {
    const stdin = process.stdin, stdout = process.stdout;
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") return resolve("");  // non-interactive: env only
    stdout.write("PlayFab secret key (paste it, then press Enter — input is hidden): ");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const done = val => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); stdout.write("\n"); resolve(val); };
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === "\n" || ch === "\r" || ch === "\u0004") return done(buf.trim());  // Enter / Ctrl-D
        if (ch === "\u0003") { stdout.write("\n"); process.exit(1); }                // Ctrl-C
        if (ch === "\u007f" || ch === "\b") { buf = buf.slice(0, -1); continue; }    // Backspace
        buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

function api(pathName, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = https.request({
      method: "POST",
      hostname: TITLE + ".playfabapi.com",
      path: pathName,
      headers: {
        "Content-Type": "application/json",
        "X-SecretKey": SECRET,
        "Content-Length": Buffer.byteLength(data)
      }
    }, res => {
      let b = "";
      res.on("data", d => b += d);
      res.on("end", () => {
        let j;
        try { j = JSON.parse(b); } catch { return reject(new Error("Bad response (HTTP " + res.statusCode + "): " + b)); }
        if (j.code !== 200 || !j.data)
          return reject(new Error("PlayFab " + pathName + " error " + (j.code || res.statusCode) + ": " + (j.errorMessage || j.error || b)));
        resolve(j.data);
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

const norm = x => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");

(async () => {
  if (!SECRET) SECRET = await promptSecret();
  if (!SECRET) { console.error("No secret key entered. Aborting (nothing was changed)."); process.exit(1); }

  // 1) find the real "All Players" segment
  const seg = await api("/Admin/GetAllSegments", {});
  const segments = seg.Segments || [];
  if (!segments.length) {
    console.error("No segments exist on title " + TITLE + ". Create an 'All Players' segment in Game Manager (Players > Segments), then re-run.");
    process.exit(1);
  }
  let chosen;
  if (segSel) {
    chosen = segments.find(s => s.Id === segSel) || segments.find(s => norm(s.Name) === norm(segSel));
    if (!chosen) {
      console.error("No segment matches --segment " + segSel + ". Available segments:");
      segments.forEach(s => console.error("  " + s.Id + "  " + s.Name));
      process.exit(1);
    }
  } else {
    const cand = segments.filter(s => norm(s.Name) === "allplayers");
    if (cand.length === 1) {
      chosen = cand[0];
    } else {
      console.error(cand.length
        ? "Found multiple 'All Players' segments. Re-run with --segment <id>:"
        : "No segment named 'All Players'. Re-run with --segment <id|name>. Available segments:");
      segments.forEach(s => console.error("  " + s.Id + "  " + s.Name));
      process.exit(1);
    }
  }
  if (chosen.Id === ZERO) { console.error("Chosen segment id is all-zeros?! Aborting."); process.exit(1); }
  console.log("Segment    : " + chosen.Name + "  (" + chosen.Id + ")");

  // 2) pull the CURRENT LIVE revision (never push stale local code)
  const rev = await api("/Admin/GetCloudScriptRevision", {});
  console.log("Live now   : revision " + rev.Revision + "   version " + rev.Version + "   published=" + rev.IsPublished);
  const files = rev.Files || [];
  if (!files.length) { console.error("Live revision has no files?"); process.exit(1); }

  // back up exactly what is live, before touching anything
  fs.writeFileSync(path.join(__dirname, "main.live-backup.js"), files.map(f => f.FileContents || "").join("\n"));

  // 3) replace the placeholder segment id in every file
  let total = 0;
  const newFiles = files.map(f => {
    const before = f.FileContents || "";
    total += before.split(ZERO).length - 1;
    return { Filename: f.Filename || "main.js", FileContents: before.split(ZERO).join(chosen.Id) };
  });
  console.log("Replaced   : " + total + " occurrence(s) of the all-zeros SegmentId");

  if (total === 0) {
    console.log("The LIVE code has NO all-zeros placeholder, so there is nothing to patch.");
    console.log("Either it was already fixed, or the segment id is set some other way. Not publishing.");
    process.exit(0);
  }

  if (DRY) {
    console.log("--dry: NOT publishing. A backup of live code is at cloudscript/main.live-backup.js");
    process.exit(0);
  }

  // 4) publish LIVE
  const up = await api("/Admin/UpdateCloudScript", { Publish: true, Files: newFiles });
  console.log("PUBLISHED  : new revision " + up.Revision + "   version " + up.Version + " is now LIVE");
  console.log("Done. Reopen the Admin panel and click 'Load players' again.");
})().catch(e => { console.error("FAILED: " + e.message); process.exit(1); });
