/* Flag a player as admin for the GND CloudScript's isAdminPlayer() check by
 * setting Read-Only Data key `admin` = "true" via the PlayFab Server API.
 *
 * Usage:
 *   PLAYFAB_SECRET=<dev secret key> node cloudscript/flag-admin.js [PlayFabId] [value]
 *
 * - PlayFabId defaults to F51D138185E84756.
 * - value defaults to "true" (isAdminPlayer also accepts admin/gm/gamemaster).
 * - Pass value "" to clear the flag (revoke admin).
 */
const https = require("https");

const TITLE  = (process.env.PLAYFAB_TITLE  || "17CBF3").trim();
const SECRET = (process.env.PLAYFAB_SECRET || "").trim();
const PID    = (process.argv[2] || "F51D138185E84756").trim();
const VALUE  = process.argv[3] !== undefined ? process.argv[3] : "true";

if (!SECRET) { console.error("Missing $PLAYFAB_SECRET."); process.exit(1); }

const data = {};
data.admin = VALUE;                       // "" clears the key
const body = JSON.stringify({ PlayFabId: PID, Data: data });
const opts = {
  method: "POST",
  hostname: TITLE + ".playfabapi.com",
  path: "/Server/UpdateUserReadOnlyData",
  headers: {
    "Content-Type": "application/json",
    "X-SecretKey": SECRET,
    "Content-Length": Buffer.byteLength(body)
  }
};

const req = https.request(opts, res => {
  let b = "";
  res.on("data", d => b += d);
  res.on("end", () => {
    let j;
    try { j = JSON.parse(b); } catch { console.error("Bad response (HTTP " + res.statusCode + "):\n" + b); process.exit(1); }
    if (j.code !== 200) {
      console.error("PlayFab error " + (j.code || res.statusCode) + ": " + (j.errorMessage || j.error || b));
      process.exit(1);
    }
    console.log("OK. Player " + PID + " Read-Only Data admin = " + JSON.stringify(VALUE) +
                "  (DataVersion " + (j.data && j.data.DataVersion) + ")");
  });
});
req.on("error", e => { console.error("Network error: " + e.message); process.exit(1); });
req.write(body);
req.end();
