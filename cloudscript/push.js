/* Deploy a CloudScript file to PlayFab as a new revision and publish it LIVE.
 *
 * Usage:
 *   PLAYFAB_SECRET=<dev secret key> node cloudscript/push.js [file]
 *
 * - Defaults to cloudscript/main.clean.js.
 * - TitleId defaults to 17CBF3 (override with $PLAYFAB_TITLE).
 * - Uploads as a new revision and publishes it (Publish:true) so it goes live.
 * - The secret key only rides in the request header; never written to disk.
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const TITLE  = (process.env.PLAYFAB_TITLE  || "17CBF3").trim();
const SECRET = (process.env.PLAYFAB_SECRET || "").trim();
const file   = process.argv[2] || path.join(__dirname, "main.clean.js");

if (!SECRET) { console.error("Missing $PLAYFAB_SECRET."); process.exit(1); }

const code = fs.readFileSync(file, "utf8");
const body = JSON.stringify({ Publish: true, Files: [{ Filename: "main.js", FileContents: code }] });
const opts = {
  method: "POST",
  hostname: TITLE + ".playfabapi.com",
  path: "/Admin/UpdateCloudScript",
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
    console.log("Deployed + published LIVE.");
    console.log("Revision : " + j.data.Revision + "   Version: " + j.data.Version);
    console.log("Uploaded : " + code.length.toLocaleString() + " bytes from " + path.basename(file));
  });
});
req.on("error", e => { console.error("Network error: " + e.message); process.exit(1); });
req.write(body);
req.end();
