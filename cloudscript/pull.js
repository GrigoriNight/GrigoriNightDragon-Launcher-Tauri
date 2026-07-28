#!/usr/bin/env node
/* Pull the deployed PlayFab Legacy CloudScript down to local files.
 *
 * Usage:
 *   read -rsp 'PlayFab secret key: ' K && PLAYFAB_SECRET="$K" node cloudscript/pull.js [revision]; unset K
 *
 * - Reads the title's Developer Secret Key from $PLAYFAB_SECRET. The key is NEVER
 *   written to disk or printed — it only rides in the request header.
 * - TitleId defaults to 17CBF3 (override with $PLAYFAB_TITLE).
 * - With no [revision] arg, fetches the latest revision. Pass a number to force one
 *   (e.g. `node cloudscript/pull.js 80`).
 * - Writes each returned file into cloudscript/ and prints a summary, including
 *   whether the amIAdmin / adminSave / buyItemCascade handlers exist.
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const TITLE  = (process.env.PLAYFAB_TITLE  || "17CBF3").trim();
const SECRET = (process.env.PLAYFAB_SECRET || "").trim();
const REV    = process.argv[2] ? parseInt(process.argv[2], 10) : null;

if (!SECRET) {
  console.error("Missing $PLAYFAB_SECRET.\nRun:\n  read -rsp 'PlayFab secret key: ' K && PLAYFAB_SECRET=\"$K\" node cloudscript/pull.js; unset K");
  process.exit(1);
}

const body = JSON.stringify(REV ? { Revision: REV } : {});
const opts = {
  method: "POST",
  hostname: TITLE + ".playfabapi.com",
  path: "/Admin/GetCloudScriptRevision",
  headers: {
    "Content-Type": "application/json",
    "X-SecretKey": SECRET,
    "Content-Length": Buffer.byteLength(body)
  }
};

const req = https.request(opts, res => {
  let buf = "";
  res.on("data", d => buf += d);
  res.on("end", () => {
    let j;
    try { j = JSON.parse(buf); } catch { console.error("Bad response (HTTP " + res.statusCode + "):\n" + buf); process.exit(1); }
    if (j.code !== 200 || !j.data) {
      console.error("PlayFab error " + (j.code || res.statusCode) + ": " + (j.errorMessage || j.error || buf));
      process.exit(1);
    }
    const d = j.data;
    const saved = [];
    (d.Files || []).forEach(f => {
      const name = (f.Filename || "main.js").replace(/[^\w.\-]/g, "_");
      fs.writeFileSync(path.join(__dirname, name), f.FileContents || "");
      saved.push(name + " (" + (f.FileContents || "").length + " chars)");
    });
    const all = (d.Files || []).map(f => f.FileContents || "").join("\n");
    const has = n => (new RegExp("handlers\\s*\\.\\s*" + n + "\\b|handlers\\s*\\[\\s*[\"']" + n + "[\"']")).test(all) ? "yes" : "NO  <-- missing";
    console.log("Title      : " + TITLE);
    console.log("Revision   : " + d.Revision + "   Version: " + d.Version + "   Published(live): " + d.IsPublished);
    console.log("Created    : " + d.CreatedAt);
    console.log("Files      : " + (saved.join(", ") || "(none)"));
    console.log("Saved into : " + __dirname);
    console.log("--- handlers present in this revision ---");
    console.log("amIAdmin       : " + has("amIAdmin"));
    console.log("adminSave      : " + has("adminSave"));
    console.log("buyItemCascade : " + has("buyItemCascade"));
    if (d.IsPublished === false)
      console.log("\nNOTE: this is NOT the live revision. Re-run with your live number, e.g. `node cloudscript/pull.js 80`.");
  });
});
req.on("error", e => { console.error("Network error: " + e.message); process.exit(1); });
req.write(body);
req.end();
