/* READ-ONLY audit of the Limited Edition wiring. Answers, for the live title:
 *   - what does Title Data key "limitedItems" actually contain?
 *   - what is each STORE item's real ItemId / DisplayName (in store order, so
 *     "item 1" = the first row the player sees)?
 *   - is each store item flagged limited via the Title Data list AND/OR via its
 *     catalog CustomData {"limited":true}?
 *
 * This makes NO writes (only GetTitleData / GetCatalogItems / GetStoreItems), so
 * it is safe to run against production. Use it to see why a badge is/ isn't
 * showing before changing any code.
 *
 * Usage:
 *   PLAYFAB_SECRET=<key> node cloudscript/audit-limited.js
 */
const https = require("https");

const TITLE   = (process.env.PLAYFAB_TITLE   || "17CBF3").trim();
const SECRET  = (process.env.PLAYFAB_SECRET  || "").trim();
const CATALOG = (process.env.PLAYFAB_CATALOG || "Items_Items").trim();
const STORE   = (process.env.PLAYFAB_STORE   || "01").trim();

if (!SECRET) { console.error("Missing $PLAYFAB_SECRET."); process.exit(1); }

function api(path, body) {
  const data = JSON.stringify(body);
  const opts = {
    method: "POST",
    hostname: TITLE + ".playfabapi.com",
    path: "/Admin/" + path,
    headers: {
      "Content-Type": "application/json",
      "X-SecretKey": SECRET,
      "Content-Length": Buffer.byteLength(data)
    }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let b = "";
      res.on("data", d => b += d);
      res.on("end", () => {
        let j; try { j = JSON.parse(b); } catch { return reject(path + ": bad response HTTP " + res.statusCode + "\n" + b); }
        if (j.code !== 200 || !j.data) return reject(path + " error " + (j.code || res.statusCode) + ": " + (j.errorMessage || b));
        resolve(j.data);
      });
    });
    req.on("error", e => reject(path + ": " + e.message));
    req.write(data); req.end();
  });
}

function customLimited(raw) {
  if (!raw) return false;
  try { const d = (typeof raw === "string") ? JSON.parse(raw) : raw; return !!(d && d.limited); }
  catch { return false; }
}

(async () => {
  // 1) Title Data limitedItems (the client's badge source #1)
  const td = await api("GetTitleData", { Keys: ["limitedItems"] });
  const rawList = (td.Data || {}).limitedItems;
  let limited = [];
  try { limited = rawList ? JSON.parse(rawList) : []; } catch {}
  if (!Array.isArray(limited)) limited = [];
  console.log("Title Data 'limitedItems' raw : " + (rawList === undefined ? "(key not set)" : JSON.stringify(rawList)));
  console.log("Parsed limitedItems array     : " + JSON.stringify(limited) + "  (" + limited.length + " ids)\n");

  // 2) Catalog: ItemId -> {DisplayName, CustomData.limited}  (badge source #2)
  const cat = await api("GetCatalogItems", { CatalogVersion: CATALOG });
  const byId = {};
  (cat.Catalog || []).forEach(it => { byId[it.ItemId] = it; });

  // 3) Store order = what the player sees; row 1 == "item 1"
  const st = await api("GetStoreItems", { CatalogVersion: CATALOG, StoreId: STORE });
  const store = st.Store || [];
  console.log("Store '" + STORE + "' has " + store.length + " items (catalog '" + CATALOG + "'). In display order:\n");
  console.log("  #  ItemId                DisplayName                 inList  custom  -> LIMITED?");
  console.log("  -- --------------------  --------------------------  ------  ------  ---------");
  store.forEach((s, i) => {
    const meta = byId[s.ItemId] || {};
    const inList = limited.indexOf(s.ItemId) >= 0;
    const cust   = customLimited(meta.CustomData);
    const isLim  = inList || cust;
    console.log(
      "  " + String(i + 1).padStart(2) + " " +
      String(s.ItemId).padEnd(20).slice(0, 20) + "  " +
      String(meta.DisplayName || "").padEnd(26).slice(0, 26) + "  " +
      (inList ? " yes " : "  no ") + "   " +
      (cust ? " yes " : "  no ") + "   " +
      (isLim ? "LIMITED" : "-"));
  });

  // 4) flag any ids in the Title Data list that aren't actually in the store/catalog
  const orphan = limited.filter(id => !byId[id]);
  if (orphan.length) console.log("\n! limitedItems ids not found in catalog: " + JSON.stringify(orphan));
  console.log("\nBadge shows in the launcher iff the LIMITED? column is LIMITED for that row.");
})().catch(e => { console.error("FAILED:", e); process.exit(1); });
