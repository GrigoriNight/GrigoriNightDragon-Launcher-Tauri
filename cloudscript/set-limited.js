/* Set the Limited Edition list from the command line, by invoking the SAME
 * CloudScript handler the Admin panel uses (adminSave) as the admin player, then
 * reading Title Data back to prove it persisted. Use this when the in-launcher
 * admin toggle didn't stick, or to script the flag.
 *
 * Passing only {limitedItems:[...]} writes ONLY the limitedItems key — adminSave
 * guards news/maintenance behind their own args, so they are left untouched.
 *
 * Usage:
 *   PLAYFAB_SECRET=<key> node cloudscript/set-limited.js 1          # limitedItems = ["1"]
 *   PLAYFAB_SECRET=<key> node cloudscript/set-limited.js 1 3        # ["1","3"]
 *   PLAYFAB_SECRET=<key> node cloudscript/set-limited.js --clear    # []
 *   PLAYFAB_SECRET=<key> node cloudscript/set-limited.js            # (read-only) show current
 */
const https = require("https");

const TITLE  = (process.env.PLAYFAB_TITLE  || "17CBF3").trim();
const SECRET = (process.env.PLAYFAB_SECRET || "").trim();
const ADMIN  = (process.env.PLAYFAB_ADMIN_PID || "F51D138185E84756").trim();
if (!SECRET) { console.error("Missing $PLAYFAB_SECRET."); process.exit(1); }

const args = process.argv.slice(2);
const READ_ONLY = args.length === 0;
const ids = args.includes("--clear") ? [] : args.filter(a => a !== "--clear");

function call(prefix, path, body) {
  const data = JSON.stringify(body);
  const opts = {
    method: "POST", hostname: TITLE + ".playfabapi.com", path: "/" + prefix + "/" + path,
    headers: { "Content-Type": "application/json", "X-SecretKey": SECRET, "Content-Length": Buffer.byteLength(data) }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let b = ""; res.on("data", d => b += d);
      res.on("end", () => {
        let j; try { j = JSON.parse(b); } catch { return reject(path + ": bad HTTP " + res.statusCode + "\n" + b); }
        if (j.code !== 200 || !j.data) return reject(path + " error " + (j.code || res.statusCode) + ": " + (j.errorMessage || b));
        resolve(j.data);
      });
    });
    req.on("error", e => reject(path + ": " + e.message));
    req.write(data); req.end();
  });
}

function readLimited() {
  return call("Admin", "GetTitleData", { Keys: ["limitedItems"] }).then(d => {
    const raw = (d.Data || {}).limitedItems;
    let arr = []; try { arr = raw ? JSON.parse(raw) : []; } catch {}
    return { raw, arr: Array.isArray(arr) ? arr : [] };
  });
}

(async () => {
  const before = await readLimited();
  console.log("Current limitedItems: " + (before.raw === undefined ? "(key not set)" : JSON.stringify(before.raw)));
  if (READ_ONLY) return;

  // Invoke the real admin handler as the admin player (exercises the live path).
  const res = await call("Server", "ExecuteCloudScript", {
    PlayFabId: ADMIN, FunctionName: "adminSave",
    FunctionParameter: { limitedItems: ids }, GeneratePlayStreamEvent: false
  });
  if (res.Error) throw "adminSave CloudScript error: " + JSON.stringify(res.Error) + "\nLogs: " + JSON.stringify(res.Logs || []);
  console.log("adminSave FunctionResult: " + JSON.stringify(res.FunctionResult));

  const after = await readLimited();
  console.log("Now     limitedItems: " + JSON.stringify(after.raw));
  const ok = JSON.stringify(after.arr) === JSON.stringify(ids);
  console.log(ok
    ? "\nOK — persisted. Reload the launcher store: item(s) " + JSON.stringify(ids) + " should show the LIMITED EDITION badge within ~1s."
    : "\nMISMATCH — server did not persist the expected list. adminSave on the deployed revision may be missing the limitedItems write.");
  if (!ok) process.exit(2);
})().catch(e => { console.error("FAILED:", e); process.exit(1); });
