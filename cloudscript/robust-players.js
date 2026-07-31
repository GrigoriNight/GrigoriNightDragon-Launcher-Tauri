/* Make the Admin "Load players" feature actually work — and stay working.
 *
 * WHY (the real root cause, finally): legacy CloudScript in this title does NOT
 * expose server.GetPlayersInSegment. Every previous attempt called it and the
 * runtime threw "server.GetPlayersInSegment is not a function", which PlayFab
 * surfaced as the opaque "JavascriptException". The REST /Server/GetPlayersInSegment
 * endpoint also 404s for this title, so there is NO way to enumerate players from
 * inside CloudScript using a segment.
 *
 * THE FIX: maintain our own player roster in Title Data (a plain {pid:name} map),
 * using only methods that DO exist here (GetTitleData / SetTitleData). Then:
 *   - Admin_GetAllPlayers            -> reads the roster, returns {success,players}
 *   - Admin_GetAllPlayersWithCurrency-> reads the roster + GetUserInventory (<=50)
 * Both RETURN {success:false,error:"..."} instead of throwing, so the panel shows
 * the REAL reason on any snag (e.g. "Admin access denied").
 *
 * Keeping the roster fresh: a small decorator is APPENDED at the end of the live
 * code. It wraps a few high-traffic handlers (GetBalance, GiveStarterCurrency,
 * verifyEmailCode) by reference — it never edits their bodies — and upserts the
 * calling player into the roster. It only writes when the player is new (so hot
 * paths stay cheap) and is fully try/guarded (a roster failure can never break
 * gameplay). Races are self-healing: a clobbered player is re-added next call.
 *
 * This tool pulls the CURRENT LIVE CloudScript (never pushes stale local code),
 * swaps the two Admin handlers, appends the tracker once (idempotent via marker),
 * runs safety + syntax checks, then publishes LIVE.
 *
 * Secret: from $PLAYFAB_SECRET, else it prompts (hidden). Never written to disk.
 *
 * Usage:
 *   node cloudscript/robust-players.js          # patch + publish LIVE
 *   node cloudscript/robust-players.js --dry     # preview only, no publish
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const TITLE  = (process.env.PLAYFAB_TITLE  || "17CBF3").trim();
let   SECRET = (process.env.PLAYFAB_SECRET || "").trim();
const args   = process.argv.slice(2);
const DRY    = args.includes("--dry");
const ZERO   = "00000000-0000-0000-0000-000000000000";
const RKEY   = "PlayerRoster";     // Title Data key holding the {pid:name} map
const MARK   = "__GND_ROSTER__";   // marker so the tracker is appended only once

function promptSecret() {
  return new Promise(resolve => {
    const stdin = process.stdin, stdout = process.stdout;
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") return resolve("");
    stdout.write("PlayFab secret key (paste it, then press Enter — input is hidden): ");
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let buf = "";
    const done = v => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); stdout.write("\n"); resolve(v); };
    const onData = chunk => { for (const ch of chunk) {
      if (ch === "\n" || ch === "\r" || ch === "\u0004") return done(buf.trim());
      if (ch === "\u0003") { stdout.write("\n"); process.exit(1); }
      if (ch === "\u007f" || ch === "\b") { buf = buf.slice(0, -1); continue; }
      buf += ch;
    } };
    stdin.on("data", onData);
  });
}

function api(pathName, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = https.request({
      method: "POST", hostname: TITLE + ".playfabapi.com", path: pathName,
      headers: { "Content-Type": "application/json", "X-SecretKey": SECRET, "Content-Length": Buffer.byteLength(data) }
    }, res => {
      let b = ""; res.on("data", d => b += d);
      res.on("end", () => {
        let j; try { j = JSON.parse(b); } catch { return reject(new Error("Bad response (HTTP " + res.statusCode + "): " + b)); }
        if (j.code !== 200 || !j.data)
          return reject(new Error(pathName + " -> HTTP " + (j.code || res.statusCode) + ": " + (j.errorMessage || j.error || b)));
        resolve(j.data);
      });
    });
    req.on("error", reject); req.write(data); req.end();
  });
}

// The two replacement handlers (ES5 — legacy CloudScript). Each ends with "};".
// They read the roster map from Title Data; NO segment API is used anywhere.
const NEW_GETALL =
'handlers.Admin_GetAllPlayers=function(args,context){' +
'if(!isAdminPlayer(currentPlayerId))return{success:false,error:"Admin access denied \\u2014 this account is not flagged as an admin."};' +
'try{' +
'var d=server.GetTitleData({Keys:["' + RKEY + '"]});' +
'var raw=(d&&d.Data&&d.Data.' + RKEY + ')||"";' +
'var map=raw?JSON.parse(raw):{};' +
'var players=[];for(var pid in map){if(map.hasOwnProperty(pid)){players.push({PlayFabId:pid,DisplayName:map[pid]||"Unnamed"});}}' +
'return{success:true,players:players};' +
'}catch(e){var msg=e&&e.message?e.message:String(e);return{success:false,error:"Roster read failed: "+msg,players:[]};}' +
'};';

const NEW_GETALL_CUR =
'handlers.Admin_GetAllPlayersWithCurrency=function(args,context){' +
'if(!isAdminPlayer(currentPlayerId))return{success:false,error:"Admin access denied \\u2014 this account is not flagged as an admin."};' +
'try{' +
'var d=server.GetTitleData({Keys:["' + RKEY + '"]});' +
'var raw=(d&&d.Data&&d.Data.' + RKEY + ')||"";' +
'var map=raw?JSON.parse(raw):{};' +
'var players=[];var n=0;' +
'for(var pid in map){if(!map.hasOwnProperty(pid))continue;if(n>=50)break;n++;' +
'var copper=0;try{var inv=server.GetUserInventory({PlayFabId:pid});var vc=(inv&&inv.VirtualCurrency)||{};copper=vc.CO||vc.CP||0;}catch(ie){copper=0;}' +
'players.push({PlayFabId:pid,DisplayName:map[pid]||"Unnamed",Copper:copper});}' +
'return{success:true,players:players};' +
'}catch(e){var msg=e&&e.message?e.message:String(e);return{success:false,error:"Roster read failed: "+msg,players:[]};}' +
'};';

// Self-maintaining roster tracker, appended ONCE at end of the live code.
// Wraps handlers by reference (never edits their bodies); fully try-guarded.
const TRACKER =
'\n/*' + MARK + '*/\n' +
'(function(){' +
'function _rname(pid){try{var p=server.GetPlayerProfile({PlayFabId:pid});if(p&&p.PlayerProfile&&p.PlayerProfile.DisplayName)return p.PlayerProfile.DisplayName;}catch(e){}return "Unnamed";}' +
'function rosterUpsert(pid){if(!pid)return;try{' +
'var d=server.GetTitleData({Keys:["' + RKEY + '"]});' +
'var raw=(d&&d.Data&&d.Data.' + RKEY + ')||"";' +
'var map=raw?JSON.parse(raw):{};' +
'if(map.hasOwnProperty(pid))return;' +                       // already tracked -> no write (hot path stays cheap)
'var keys=0;for(var k in map){if(map.hasOwnProperty(k))keys++;}if(keys>=2000)return;' +  // soft size cap
'map[pid]=_rname(pid);' +
'server.SetTitleData({Key:"' + RKEY + '",Value:JSON.stringify(map)});' +
'}catch(e){}}' +
'var _hook=["GetBalance","GiveStarterCurrency","verifyEmailCode"];' +
'for(var i=0;i<_hook.length;i++){(function(n){var orig=handlers[n];' +
'if(typeof orig==="function"){handlers[n]=function(a,c){try{rosterUpsert(currentPlayerId);}catch(e){}return orig.apply(this,arguments);};}' +
'})(_hook[i]);}' +
'})();\n';

// Replace `handlers.<name>=function(...){ ... };` using a string/brace-aware
// scan (format-independent, ignores braces inside quotes). Returns new code or
// null if the handler wasn't found.
function replaceHandler(code, name, replacement) {
  const re = new RegExp("handlers\\s*\\.\\s*" + name + "\\s*=\\s*function");
  const m = re.exec(code);
  if (!m) return null;
  const start = m.index;
  const brace = code.indexOf("{", start);
  if (brace < 0) return null;
  let depth = 0, inStr = false, strCh = "", prev = "", i = brace;
  for (; i < code.length; i++) {
    const c = code[i];
    if (inStr) { if (c === strCh && prev !== "\\") inStr = false; prev = c; continue; }
    if (c === '"' || c === "'") { inStr = true; strCh = c; prev = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { i++; break; } }
    prev = c;
  }
  let end = i;
  if (code[end] === ";") end++;
  return { code: code.slice(0, start) + replacement + code.slice(end), old: code.slice(start, end) };
}

(async () => {
  if (!SECRET) SECRET = await promptSecret();
  if (!SECRET) { console.error("No secret key entered. Aborting (nothing changed)."); process.exit(1); }

  // 1) pull LIVE (never push stale local code)
  const rev = await api("/Admin/GetCloudScriptRevision", {});
  const files = rev.Files || [];
  console.log("Live now   : revision " + rev.Revision + "   version " + rev.Version + "   published=" + rev.IsPublished);
  if (!files.length) { console.error("Live revision has no files?"); process.exit(1); }

  // back up exactly what is live
  fs.writeFileSync(path.join(__dirname, "main.live-backup.js"), files.map(f => f.FileContents || "").join("\n"));
  console.log("Backup     : cloudscript/main.live-backup.js (pre-change live code)");

  // 2) patch the two handlers in whichever file defines them
  let patched = 0, hookHost = -1;
  const newFiles = files.map((f, idx) => {
    let c = f.FileContents || "";
    for (const [name, repl] of [["Admin_GetAllPlayers", NEW_GETALL], ["Admin_GetAllPlayersWithCurrency", NEW_GETALL_CUR]]) {
      const r = replaceHandler(c, name, repl);
      if (r) { c = r.code; patched++; console.log("Patched    : " + name); }
    }
    if (c.indexOf("handlers.GetBalance") !== -1) hookHost = idx; // file that owns the hooked handlers
    return { Filename: f.Filename || "main.js", FileContents: c };
  });
  if (patched < 2) { console.error("Expected to patch 2 handlers but patched " + patched + ". Aborting (nothing published)."); process.exit(1); }

  // 3) append the roster tracker ONCE (idempotent across re-runs via marker)
  const already = newFiles.some(f => f.FileContents.indexOf(MARK) !== -1);
  if (already) {
    console.log("Tracker    : already present (marker found) — not appending again");
  } else {
    const host = hookHost >= 0 ? hookHost : newFiles.length - 1;
    newFiles[host].FileContents += TRACKER;
    console.log("Tracker    : appended to " + newFiles[host].Filename + " (wraps GetBalance/GiveStarterCurrency/verifyEmailCode)");
  }

  const merged = newFiles.map(f => f.FileContents).join("\n");

  // 4) safety checks before publishing
  if (merged.indexOf(ZERO) !== -1) { console.error("All-zeros placeholder present?! Aborting."); process.exit(1); }
  if (merged.indexOf("GetPlayersInSegment") !== -1) { console.error("GetPlayersInSegment still referenced (it does not exist here). Aborting."); process.exit(1); }
  if (merged.split(RKEY).length - 1 < 3) { console.error("Roster key '" + RKEY + "' missing after patch. Aborting."); process.exit(1); }
  if (merged.indexOf(MARK) === -1) { console.error("Roster tracker marker missing after patch. Aborting."); process.exit(1); }
  try { newFiles.forEach(f => new Function(f.FileContents)); } // syntax check only (never executed)
  catch (e) { console.error("Syntax check FAILED after patch: " + e.message + "\nAborting (nothing published)."); process.exit(1); }
  console.log("Syntax     : OK (new code parses)");

  if (DRY) { console.log("--dry: NOT publishing. Review cloudscript/main.live-backup.js for the pre-change code."); process.exit(0); }

  // 5) publish LIVE
  const up = await api("/Admin/UpdateCloudScript", { Publish: true, Files: newFiles });
  console.log("PUBLISHED  : new revision " + up.Revision + "   version " + up.Version + " is now LIVE");
  console.log("Done. The roster fills as players open the launcher / log in;");
  console.log("your own admin account appears right after you use the launcher once.");
})().catch(e => { console.error("FAILED: " + e.message); process.exit(1); });
