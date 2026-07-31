/* Verify the Admin "Load players" fix (roster-in-TitleData) is live & working.
 *
 * READ-ONLY by default: it never publishes. With --admin it will run the real
 * handlers via Server/ExecuteCloudScript (which, as a side effect, causes the
 * tracker to add that player to the roster — that is expected and desired).
 * The Developer Secret Key comes from $PLAYFAB_SECRET, or it prompts (hidden).
 * The key is never written to disk or printed.
 *
 * Checks:
 *   1) the LIVE CloudScript revision is published,
 *   2) the all-zeros placeholder is gone AND GetPlayersInSegment is no longer
 *      referenced (it does not exist in this title's CloudScript), and the
 *      roster key + tracker marker are present,
 *   3) both admin handlers still exist,
 *   4) reads Title Data PlayerRoster directly and reports how many players are
 *      currently tracked (+ a small sample),
 *   5) (optional) with --admin <PlayFabId>: confirms that id is an admin, runs
 *      GetBalance as that id (exercises the tracker), then runs the real
 *      Admin_GetAllPlayers end-to-end and shows what the panel will get.
 *
 * Usage:
 *   node cloudscript/verify-fix.js [--admin <PlayFabId>]
 */
const https = require("https");

const TITLE  = (process.env.PLAYFAB_TITLE || "17CBF3").trim();
let   SECRET = (process.env.PLAYFAB_SECRET || "").trim();
const args   = process.argv.slice(2);
const ZERO   = "00000000-0000-0000-0000-000000000000";
const RKEY   = "PlayerRoster";
const MARK   = "__GND_ROSTER__";
const ADMIN  = (() => { const i = args.indexOf("--admin"); return i >= 0 ? args[i + 1] : null; })();

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

let pass = 0, fail = 0;
const ok  = m => { pass++; console.log("  PASS  " + m); };
const bad = m => { fail++; console.log("  FAIL  " + m); };

(async () => {
  if (!SECRET) SECRET = await promptSecret();
  if (!SECRET) { console.error("No secret key entered. Aborting."); process.exit(1); }

  console.log("== 1) Live CloudScript revision ==");
  const rev = await api("/Admin/GetCloudScriptRevision", {});
  const code = (rev.Files || []).map(f => f.FileContents || "").join("\n");
  console.log("  revision " + rev.Revision + "  version " + rev.Version + "  published=" + rev.IsPublished);
  rev.IsPublished ? ok("live revision is published") : bad("live revision is NOT published");

  console.log("== 2) Bad calls removed / roster wiring present ==");
  (code.split(ZERO).length - 1) === 0 ? ok("no all-zeros placeholder SegmentId remains") : bad("all-zeros placeholder still in live code");
  code.indexOf("GetPlayersInSegment") === -1 ? ok("GetPlayersInSegment no longer referenced (it does not exist here)") : bad("GetPlayersInSegment STILL referenced — will throw at runtime");
  (code.split(RKEY).length - 1) >= 3 ? ok("roster key '" + RKEY + "' wired into handlers + tracker") : bad("roster key '" + RKEY + "' missing/underused");
  code.indexOf(MARK) !== -1 ? ok("roster tracker marker present") : bad("roster tracker marker MISSING");

  console.log("== 3) Handlers exist ==");
  for (const h of ["Admin_GetAllPlayers", "Admin_GetAllPlayersWithCurrency"]) {
    new RegExp("handlers\\s*\\.\\s*" + h + "\\b").test(code) ? ok(h + " defined") : bad(h + " MISSING");
  }

  console.log("== 4) Current roster in Title Data ==");
  let rosterCount = 0;
  try {
    const td = await api("/Server/GetTitleData", { Keys: [RKEY] });
    const raw = (td.Data && td.Data[RKEY]) || "";
    const map = raw ? JSON.parse(raw) : {};
    rosterCount = Object.keys(map).length;
    ok("roster currently tracks " + rosterCount + " player(s)");
    const sample = Object.keys(map).slice(0, 3).map(pid => (map[pid] || "(unnamed)") + " [" + pid + "]").join(", ");
    if (sample) console.log("        sample: " + sample);
    else console.log("        (roster is empty — it fills as players open the launcher / log in)");
  } catch (e) { bad("could not read Title Data roster -> " + e.message); }

  if (ADMIN) {
    console.log("== 5) End-to-end as " + ADMIN + " (authoritative) ==");
    // 5a) admin?
    try {
      const a = await api("/Server/ExecuteCloudScript", { PlayFabId: ADMIN, FunctionName: "amIAdmin", FunctionParameter: {}, GeneratePlayStreamEvent: false });
      const isA = a.FunctionResult && a.FunctionResult.isAdmin;
      isA ? ok(ADMIN + " IS flagged as admin") : bad(ADMIN + " is NOT an admin — handler will refuse. Flag it (flag-admin.js).");
    } catch (e) { bad("amIAdmin probe failed -> " + e.message); }
    // 5b) exercise the tracker: run GetBalance as this id, then confirm they're in the roster.
    try {
      await api("/Server/ExecuteCloudScript", { PlayFabId: ADMIN, FunctionName: "GetBalance", FunctionParameter: {}, GeneratePlayStreamEvent: false });
      const td2 = await api("/Server/GetTitleData", { Keys: [RKEY] });
      const raw2 = (td2.Data && td2.Data[RKEY]) || "";
      const map2 = raw2 ? JSON.parse(raw2) : {};
      map2.hasOwnProperty(ADMIN)
        ? ok("tracker works: " + ADMIN + " is now in the roster after GetBalance (total " + Object.keys(map2).length + ")")
        : bad("tracker did NOT add " + ADMIN + " to the roster after GetBalance");
    } catch (e) { bad("tracker exercise failed -> " + e.message); }
    // 5c) the real Load-players handler.
    try {
      const r = await api("/Server/ExecuteCloudScript", { PlayFabId: ADMIN, FunctionName: "Admin_GetAllPlayers", FunctionParameter: {}, GeneratePlayStreamEvent: false });
      if (r.Error) {
        bad("handler THREW: " + (r.Error.Message || r.Error.Error));
        console.log("        full error: " + JSON.stringify(r.Error));
        if (r.Logs && r.Logs.length) console.log("        logs: " + JSON.stringify(r.Logs));
      } else {
        const fr = r.FunctionResult || {};
        if (fr && fr.success === false) bad("handler returned error: " + fr.error);
        else {
          const list = Array.isArray(fr) ? fr : (fr.players || []);
          ok("Admin_GetAllPlayers returned " + list.length + " player(s), no error");
          const sample = list.slice(0, 3).map(p => (p.DisplayName || "(unnamed)") + " [" + p.PlayFabId + "]").join(", ");
          if (sample) console.log("        sample: " + sample);
        }
      }
    } catch (e) { bad("ExecuteCloudScript failed -> " + e.message); }
  } else {
    console.log("== 5) (skipped) pass --admin <your real admin PlayFabId> to run the real handler ==");
  }

  console.log("\n== RESULT: " + pass + " passed, " + fail + " failed ==");
  console.log(fail === 0
    ? "Everything checks out. Reopen the Admin panel and click 'Load players'."
    : "Something is off — paste this output back.");
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error("VERIFY FAILED: " + e.message); process.exit(1); });
