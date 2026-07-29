/* Create a standalone "Limited Edition" TEST item and add it to the store, to
 * verify the Limited badge shows up in the launcher — and that buying a fresh,
 * non-bundle item grants ONLY itself (a control test for the bundle over-grant).
 *
 * The item is flagged limited via catalog CustomData {"limited":true}, so it
 * needs no Title Data change. It is priced at 1 copper (CC).
 *
 * Usage:
 *   PLAYFAB_SECRET=<key> node make-test-item.js            # create + add to store
 *   PLAYFAB_SECRET=<key> node make-test-item.js --remove   # remove it again
 *
 * SAFETY: this rewrites the catalog + store for CatalogVersion/StoreId below
 * (PlayFab's Update/Set APIs replace the whole list). Before each write it saves
 * catalog.backup.json / store.backup.json and refuses to write if the GET came
 * back empty. Run --remove when done so you don't leave a test item live.
 */
const https = require("https");
const fs    = require("fs");

const TITLE   = (process.env.PLAYFAB_TITLE   || "17CBF3").trim();
const SECRET  = (process.env.PLAYFAB_SECRET  || "").trim();
const CATALOG = (process.env.PLAYFAB_CATALOG || "Items_Items").trim();
const STORE   = (process.env.PLAYFAB_STORE   || "01").trim();
const REMOVE  = process.argv.includes("--remove");
const ITEM_ID = "LIMITED_TEST";

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

(async () => {
  // ---- catalog ----
  const cat = await api("GetCatalogItems", { CatalogVersion: CATALOG });
  const items = cat.Catalog || [];
  if (!items.length) throw "Catalog '" + CATALOG + "' came back empty — refusing to write (check CatalogVersion).";
  fs.writeFileSync("catalog.backup.json", JSON.stringify(items));
  console.log("Backed up " + items.length + " catalog items -> catalog.backup.json");

  const nextCat = items.filter(x => x.ItemId !== ITEM_ID);   // drop any prior test copy
  if (!REMOVE) {
    nextCat.push({
      ItemId: ITEM_ID,
      ItemClass: "test",
      CatalogVersion: CATALOG,
      DisplayName: "Limited Test Dragon",
      Description: "Temporary item to verify the Limited Edition badge. Safe to delete (run --remove).",
      VirtualCurrencyPrices: { CC: 1 },
      CustomData: JSON.stringify({ limited: true }),
      IsStackable: false,
      IsTradable: false,
      Tags: ["test"]
    });
  }
  await api("UpdateCatalogItems", { CatalogVersion: CATALOG, Catalog: nextCat });
  console.log((REMOVE ? "Removed" : "Wrote") + " catalog item " + ITEM_ID + " (" + nextCat.length + " items total).");

  // ---- store ----
  const st = await api("GetStoreItems", { CatalogVersion: CATALOG, StoreId: STORE });
  const sList = st.Store || [];
  if (!sList.length) throw "Store '" + STORE + "' came back empty — refusing to write (check StoreId).";
  fs.writeFileSync("store.backup.json", JSON.stringify(sList));
  console.log("Backed up " + sList.length + " store items -> store.backup.json");

  const nextStore = sList
    .filter(s => s.ItemId !== ITEM_ID)
    .map(s => ({ ItemId: s.ItemId, VirtualCurrencyPrices: s.VirtualCurrencyPrices || {}, RealCurrencyPrices: s.RealCurrencyPrices || {} }));
  if (!REMOVE) nextStore.push({ ItemId: ITEM_ID, VirtualCurrencyPrices: { CC: 1 }, RealCurrencyPrices: {} });

  const setBody = { CatalogVersion: CATALOG, StoreId: STORE, Store: nextStore };
  if (st.MarketingData) setBody.MarketingData = st.MarketingData;   // preserve store banner/marketing
  await api("SetStoreItems", setBody);
  console.log((REMOVE ? "Removed" : "Added") + " store entry " + ITEM_ID + " (" + nextStore.length + " store items total).");

  console.log(REMOVE
    ? "\nDone. LIMITED_TEST removed. Reload the launcher store to confirm it's gone."
    : "\nDone. Reload the launcher store: 'Limited Test Dragon' should show the LIMITED EDITION badge.\n" +
      "Buy it (1 copper) -> you should get ONLY that item, and the button becomes a permanent 'Owned'.\n" +
      "Clean up afterwards:  PLAYFAB_SECRET=... node make-test-item.js --remove");
})().catch(e => { console.error("FAILED:", e); process.exit(1); });
