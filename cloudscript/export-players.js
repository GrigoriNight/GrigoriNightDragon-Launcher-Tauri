/* Bulk-populate the launcher's PlayerRoster from PlayFab's real player data,
 * using the Admin async segment-export flow (NO hardcoded player IDs):
 *
 *   1) /Admin/GetAllSegments            -> find the "All Players" segment id
 *   2) /Admin/ExportPlayersInSegment    -> { ExportId }   (starts a snapshot)
 *   3) /Admin/GetSegmentExport (poll)   -> { State, IndexUrl } when complete
 *   4) download IndexUrl                -> a list of data-file URLs
 *   5) download each data file          -> tab-separated rows (header + players)
 *   6) merge { PlayFabId: DisplayName } into Title Data key PlayerRoster
 *      (keeps anyone the live tracker already added; never shrinks the roster)
 *
 * The Developer Secret Key comes from $PLAYFAB_SECRET, or it prompts (hidden).
 * It is never written to disk or printed.
 *
 * Usage:
 *   node cloudscript/export-players.js [--dry] [--segment <id>] [--max <n>]
 *     --dry        run the whole export + parse but DON'T write the roster
 *     --segment    force a specific SegmentId (default: auto-detect "All Players")
 *     --max        safety cap on players written (default 100000)
 */
const https = require("https");
const zlib  = require("zlib");

const TITLE  = (process.env.PLAYFAB_TITLE || "17CBF3").trim();
let   SECRET = (process.env.PLAYFAB_SECRET || "").trim();
const args   = process.argv.slice(2);
const DRY    = args.includes("--dry");
const RKEY   = "PlayerRoster";
const ALLSEG = "3A4038F3A54D1CF1"; // known "All Players" id for this title (fallback)
const argOf  = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const SEG    = argOf("--segment");
const MAX    = parseInt(argOf("--max") || "100000", 10);

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

// PlayFab API call (secret-key auth).
function api(pathName, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = https.request({
      method: "POST", hostname: TITLE + ".playfabapi.com", path: pathName,
      headers: { "Content-Type": "application/json", "X-SecretKey": SECRET, "Content-Length": Buffer.byteLength(data) }
    }, res => {
      let b = ""; res.on("data", d => b += d);
      res.on("end", () => {
        let j; try { j = JSON.parse(b); } catch { return reject(new Error("Bad response (HTTP " + res.statusCode + "): " + b.slice(0, 300))); }
        if (j.code !== 200 || !j.data)
          return reject(new Error(pathName + " -> HTTP " + (j.code || res.statusCode) + " " + (j.error || "") + ": " + (j.errorMessage || b.slice(0, 300))));
        resolve(j.data);
      });
    });
    req.on("error", reject); req.write(data); req.end();
  });
}

// HTTPS GET returning raw bytes (export blobs may be binary/gzip); follows redirects.
function httpGetBuf(url, depth) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (depth || 0) < 5) {
        res.resume(); return resolve(httpGetBuf(res.headers.location, (depth || 0) + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("download HTTP " + res.statusCode)); }
      const chunks = []; res.on("data", d => chunks.push(d)); res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}
// Download and decode to text, transparently gunzipping gzip'd blobs (magic 1f 8b).
async function httpGetText(url) {
  const buf = await httpGetBuf(url);
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) { try { return zlib.gunzipSync(buf).toString("utf8"); } catch { /* fall through */ } }
  return buf.toString("utf8");
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Exported data files are TAB-separated: a header row names the columns, then
// one row per player. We locate the PlayerId + DisplayName columns by header.
const cells = line => line.split("\t");

(async () => {
  if (!SECRET) SECRET = await promptSecret();
  if (!SECRET) { console.error("No secret key entered. Aborting."); process.exit(1); }

  // 1) resolve the segment id.
  let segId = SEG;
  if (!segId) {
    try {
      const seg = await api("/Admin/GetAllSegments", {});
      const all = (seg.Segments || []).find(s => /all players/i.test(s.Name || ""));
      segId = (all && all.Id) || ALLSEG;
      console.log("Segment: " + (all ? all.Name : "(fallback)") + " [" + segId + "]");
    } catch (e) { segId = ALLSEG; console.log("GetAllSegments failed (" + e.message + "); using fallback " + segId); }
  } else {
    console.log("Segment: (forced) [" + segId + "]");
  }

  // 2) start the export.
  console.log("Starting export…");
  let exportId;
  try {
    const r = await api("/Admin/ExportPlayersInSegment", { SegmentId: segId });
    exportId = r.ExportId;
    console.log("  ExportId = " + exportId);
  } catch (e) {
    console.error("\nExportPlayersInSegment failed: " + e.message);
    if (/ProductDisabledForTitle|1609/.test(e.message))
      console.error("  -> Segment export is DISABLED for this title (PlayFab tier/setting). This path is not available.");
    process.exit(1);
  }

  // 3) poll for completion.
  let indexUrl = "";
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    let s; try { s = await api("/Admin/GetSegmentExport", { ExportId: exportId }); }
    catch (e) { console.error("  GetSegmentExport error: " + e.message); continue; }
    if (s.IndexUrl) { indexUrl = s.IndexUrl; console.log("  export complete."); break; }
    console.log("  state: " + (s.State || "(pending)") + " …");
  }
  if (!indexUrl) { console.error("Export did not complete in time. Re-run later with the same segment."); process.exit(1); }

  // 4) index file -> list of data-file URLs (be tolerant of JSON array or newline list).
  const indexRaw = await httpGetText(indexUrl);
  const urls = (indexRaw.match(/https?:\/\/[^\s"'\\]+/g) || []).filter((u, i, a) => a.indexOf(u) === i);
  console.log("Index lists " + urls.length + " data file(s).");
  if (!urls.length) { console.error("Index file had no data URLs. Raw head: " + indexRaw.slice(0, 200)); process.exit(1); }

  // 5) download + parse every data file.
  const roster = {};
  let seen = 0;
  let firstHead = "";
  let idIdx = 1, nameIdx = 5; // defaults matching the observed export header
  for (const u of urls) {
    let body; try { body = await httpGetText(u); } catch (e) { console.error("  skip file (" + e.message + ")"); continue; }
    if (!firstHead && body) firstHead = body.slice(0, 400);
    const lines = body.split(/\r?\n/);
    let start = 0;
    while (start < lines.length && !lines[start].trim()) start++;   // skip blank lead
    if (start < lines.length) {                                     // consume a header row if present
      const cols = cells(lines[start]);
      const hi = cols.indexOf("PlayerId");
      if (hi !== -1) { idIdx = hi; const ni = cols.indexOf("DisplayName"); if (ni !== -1) nameIdx = ni; start++; }
    }
    for (let i = start; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = cells(lines[i]);
      // Uppercase to match the live tracker's PlayFabId case (PlayFab IDs are
      // case-insensitive), so the same player never lands in the roster twice.
      const id = (cols[idIdx] || "").trim().toUpperCase();
      if (!id) continue;
      seen++;
      if (!roster[id]) roster[id] = (cols[nameIdx] || "").trim();
      if (Object.keys(roster).length >= MAX) break;
    }
    if (Object.keys(roster).length >= MAX) break;
  }
  const found = Object.keys(roster).length;
  console.log("Parsed " + seen + " profile line(s) -> " + found + " unique player(s).");
  if (seen === 0 && firstHead) console.log("  (0 parsed) first data file decoded head:\n----\n" + firstHead + "\n----");
  const sample = Object.keys(roster).slice(0, 5).map(id => (roster[id] || "(unnamed)") + " [" + id + "]");
  if (sample.length) console.log("  sample: " + sample.join(", "));

  if (DRY) { console.log("\n--dry: not writing the roster. " + found + " players would be merged."); return; }
  if (!found) { console.log("Nothing to write (no players found)."); return; }

  // 6) merge with existing roster, then write Title Data.
  let existing = {};
  try {
    const td = await api("/Server/GetTitleData", { Keys: [RKEY] });
    const raw = (td.Data && td.Data[RKEY]) || "";
    existing = raw ? JSON.parse(raw) : {};
  } catch (e) { console.log("  (couldn't read existing roster: " + e.message + " — writing fresh)"); }
  const before = Object.keys(existing).length;
  for (const id in roster) if (!existing[id]) existing[id] = roster[id];
  const after = Object.keys(existing).length;

  await api("/Admin/SetTitleData", { Key: RKEY, Value: JSON.stringify(existing) });
  console.log("\nRoster written: " + before + " -> " + after + " players (added " + (after - before) + ").");
  console.log("Reopen the Admin panel and click 'Load players'.");
})().catch(e => { console.error("EXPORT FAILED: " + e.message); process.exit(1); });
