/* Set the four EmailJS credentials into PlayFab Title INTERNAL Data so that
 * handlers.sendEmailCode() can send login/signup codes. Title INTERNAL Data is
 * server-only — it is NEVER served to clients — which is why the private key is
 * safe to store here (and must NOT go in any served/client file).
 *
 * The handler reads exactly these four keys and refuses ("email not configured")
 * if ANY is missing:
 *   emailjsService    <- Service ID   (EmailJS: service_xxxxxxx)         => EmailJS service_id
 *   emailjsTemplate   <- Template ID  (EmailJS: template_xxxxxxx)        => EmailJS template_id
 *   emailjsPublicKey  <- Public Key   (EmailJS Account > API Keys)       => EmailJS user_id
 *   emailjsPrivateKey <- Private Key  (EmailJS Account > API Keys)       => EmailJS accessToken
 *
 * The EmailJS template MUST expose {{code}} and {{to_email}} (the handler sends
 * template_params:{code, to_email}); the template's "To email" field must be
 * {{to_email}} or the code goes nowhere.
 *
 * Values are read from ENVIRONMENT VARIABLES so nothing sensitive is hardcoded,
 * written to disk, or left in shell history via argv:
 *   EMAILJS_SERVICE   EMAILJS_TEMPLATE   EMAILJS_PUBLIC   EMAILJS_PRIVATE
 *
 * The PlayFab Developer Secret Key comes from $PLAYFAB_SECRET, or a hidden
 * prompt. It is never written to disk or printed.
 *
 * Usage:
 *   EMAILJS_SERVICE=service_xxx EMAILJS_TEMPLATE=template_xxx \
 *   EMAILJS_PUBLIC=xxxx EMAILJS_PRIVATE=xxxx \
 *   PLAYFAB_SECRET=xxxx node cloudscript/set-email-config.js [--verify <PlayFabId> <toEmail>]
 *
 *   --verify <PlayFabId> <toEmail>  after setting the keys, runs sendEmailCode as
 *                                   that player to that address and reports whether
 *                                   EmailJS accepted it ({sent:true}).
 *   --show                          read back the four keys (masked) without writing.
 */
const https = require("https");

const TITLE  = (process.env.PLAYFAB_TITLE || "17CBF3").trim();
let   SECRET = (process.env.PLAYFAB_SECRET || "").trim();
const args   = process.argv.slice(2);

const SHOW   = args.indexOf("--show") !== -1;
const VERIFY = (() => {
  const i = args.indexOf("--verify");
  return i >= 0 ? { pid: args[i + 1], email: args[i + 2] } : null;
})();

// key name in Title Internal Data  <-  env var that supplies it
const MAP = [
  ["emailjsService",    "EMAILJS_SERVICE"],
  ["emailjsTemplate",   "EMAILJS_TEMPLATE"],
  ["emailjsPublicKey",  "EMAILJS_PUBLIC"],
  ["emailjsPrivateKey", "EMAILJS_PRIVATE"],
];

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

const mask = v => !v ? "(empty)" : (v.length <= 4 ? "****" : v.slice(0, 2) + "…" + v.slice(-2) + " (" + v.length + " chars)");

(async () => {
  if (!SECRET) SECRET = await promptSecret();
  if (!SECRET) { console.error("No secret key entered. Aborting."); process.exit(1); }

  if (SHOW) {
    const td = await api("/Admin/GetTitleInternalData", { Keys: MAP.map(m => m[0]) });
    const C = (td && td.Data) || {};
    console.log("== Current Title Internal Data (masked) ==");
    for (const [k] of MAP) console.log("  " + k.padEnd(18) + " = " + mask(C[k] || ""));
    const missing = MAP.filter(([k]) => !C[k]).map(([k]) => k);
    console.log(missing.length ? "\nMISSING: " + missing.join(", ") : "\nAll four keys are set.");
    process.exit(0);
  }

  // Collect values from env; refuse unless all four are present.
  const vals = {};
  const missingEnv = [];
  for (const [key, env] of MAP) {
    const v = (process.env[env] || "").trim();
    if (!v) missingEnv.push(env);
    vals[key] = v;
  }
  if (missingEnv.length) {
    console.error("Missing required env var(s): " + missingEnv.join(", "));
    console.error("Set all four: EMAILJS_SERVICE, EMAILJS_TEMPLATE, EMAILJS_PUBLIC, EMAILJS_PRIVATE");
    process.exit(1);
  }

  console.log("== Setting Title Internal Data (server-only) ==");
  for (const [key] of MAP) {
    // SetTitleInternalData sets ONE Key/Value per call.
    await api("/Admin/SetTitleInternalData", { Key: key, Value: vals[key] });
    console.log("  set " + key.padEnd(18) + " = " + mask(vals[key]));
  }

  // Read back to confirm the server sees all four.
  const td = await api("/Admin/GetTitleInternalData", { Keys: MAP.map(m => m[0]) });
  const C = (td && td.Data) || {};
  const stillMissing = MAP.filter(([k]) => !C[k]).map(([k]) => k);
  if (stillMissing.length) { console.error("Readback shows missing: " + stillMissing.join(", ")); process.exit(1); }
  console.log("All four keys confirmed set.");

  if (VERIFY) {
    if (!VERIFY.pid || !VERIFY.email) { console.error("--verify needs <PlayFabId> <toEmail>"); process.exit(1); }
    console.log("\n== Verify: sendEmailCode as " + VERIFY.pid + " -> " + VERIFY.email + " ==");
    const r = await api("/Server/ExecuteCloudScript", {
      PlayFabId: VERIFY.pid, FunctionName: "sendEmailCode",
      FunctionParameter: { email: VERIFY.email }, GeneratePlayStreamEvent: false
    });
    if (r.Error) {
      console.error("  handler THREW: " + (r.Error.Message || r.Error.Error));
      if (r.Logs && r.Logs.length) console.error("  logs: " + JSON.stringify(r.Logs));
      process.exit(1);
    }
    const fr = r.FunctionResult || {};
    if (fr.sent === true) {
      console.log("  OK — EmailJS accepted the send. Check " + VERIFY.email + " (and spam) for the code.");
    } else {
      console.error("  NOT sent -> " + (fr.error || JSON.stringify(fr)));
      if (r.Logs && r.Logs.length) console.error("  logs: " + JSON.stringify(r.Logs));
      process.exit(1);
    }
  } else {
    console.log("\nNext: verify with a real send ->");
    console.log("  node cloudscript/set-email-config.js --verify <yourPlayFabId> <yourEmail>");
    console.log("(or just try logging in from the launcher).");
  }

  console.log("\nDone.");
})().catch(e => { console.error("FAILED: " + e.message); process.exit(1); });
