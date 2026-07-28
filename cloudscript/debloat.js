/* De-bloat a whitespace-inflated PlayFab Legacy CloudScript.
 * Safe transform: parses the JS and reprints it without the padding whitespace
 * and comments. No compression, no identifier mangling -> logic + strings + all
 * handler definitions are preserved byte-for-byte in meaning. Duplicate
 * `handlers.X = function(){}` assignments are kept (last one wins at runtime).
 *
 * Usage: node cloudscript/debloat.js [inFile] [outFile]
 */
const { minify } = require("terser");
const fs = require("fs");
const path = require("path");

const inFile  = process.argv[2] || path.join(__dirname, "main.rev80.js");
const outFile = process.argv[3] || path.join(__dirname, "main.clean.js");
const src = fs.readFileSync(inFile, "utf8");

minify(src, {
  compress: false,
  mangle: false,
  ecma: 5,                       // legacy CloudScript engine is ES5-era
  format: { comments: false, beautify: false, ecma: 5 }
}).then(r => {
  if (r.error) { console.error("terser parse error:", r.error.message); process.exit(1); }
  fs.writeFileSync(outFile, r.code);
  const has = n => (new RegExp("handlers\\s*\\.\\s*" + n + "\\b")).test(r.code) ? "yes" : "NO";
  console.log("in  : " + src.length.toLocaleString() + " bytes");
  console.log("out : " + r.code.length.toLocaleString() + " bytes");
  console.log("saved: " + outFile);
  console.log("amIAdmin=" + has("amIAdmin") + "  adminSave=" + has("adminSave") + "  buyItemCascade=" + has("buyItemCascade"));
}).catch(e => { console.error("terser failed:", e.message); process.exit(1); });
