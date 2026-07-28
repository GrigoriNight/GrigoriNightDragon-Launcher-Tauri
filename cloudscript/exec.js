/* Run a CloudScript handler AS a given player via the PlayFab Server API, to
 * verify the live revision loads and returns the expected result.
 *
 * Usage:
 *   PLAYFAB_SECRET=<key> node cloudscript/exec.js <FunctionName> [PlayFabId] [jsonParam]
 *
 * Prints FunctionResult and Error. A non-null Error containing "No function
 * named" means the revision failed to load.
 */
const https = require("https");

const TITLE  = (process.env.PLAYFAB_TITLE  || "17CBF3").trim();
const SECRET = (process.env.PLAYFAB_SECRET || "").trim();
const FN     = process.argv[2];
const PID    = (process.argv[3] || "F51D138185E84756").trim();
let   PARAM  = {};
try { if (process.argv[4]) PARAM = JSON.parse(process.argv[4]); } catch { console.error("bad jsonParam"); process.exit(1); }

if (!SECRET) { console.error("Missing $PLAYFAB_SECRET."); process.exit(1); }
if (!FN)     { console.error("Missing FunctionName."); process.exit(1); }

const body = JSON.stringify({ PlayFabId: PID, FunctionName: FN, FunctionParameter: PARAM, GeneratePlayStreamEvent: false });
const opts = {
  method: "POST",
  hostname: TITLE + ".playfabapi.com",
  path: "/Server/ExecuteCloudScript",
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
    if (j.code !== 200 || !j.data) {
      console.error("PlayFab error " + (j.code || res.statusCode) + ": " + (j.errorMessage || j.error || b));
      process.exit(1);
    }
    const d = j.data;
    console.log("Function     : " + FN + "  (as " + PID + ")");
    console.log("FunctionResult: " + JSON.stringify(d.FunctionResult));
    console.log("Error        : " + JSON.stringify(d.Error));
    console.log("ExecTimeMs   : " + d.ExecutionTimeMilliseconds + "   APIcalls: " + d.APIRequestsIssued);
    if (d.Logs && d.Logs.length) console.log("Logs         : " + JSON.stringify(d.Logs));
  });
});
req.on("error", e => { console.error("Network error: " + e.message); process.exit(1); });
req.write(body);
req.end();
