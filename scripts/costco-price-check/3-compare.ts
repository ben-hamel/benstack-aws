import { getRecentItems } from "./1-get-items";
import { fetchCurrentPrice } from "./2-scrape-price";

const SINCE = "2026-01-01";

const items = await getRecentItems(SINCE);
console.log(`Checking ${items.length} purchases since ${SINCE}...\n`);

// Deduplicate — only fetch each item number once
const uniqueItems = [...new Map(items.map(i => [i.itemNumber, i])).values()];
console.log(`Fetching prices for ${uniqueItems.length} unique items...\n`);

// Fetch current price for each unique item with a delay to avoid rate limiting
const priceMap = new Map<string, number | null>();
for (const item of uniqueItems) {
  const price = await fetchCurrentPrice(item.itemNumber, item.samedayProductId);
  // treat 0 as "warehouse-only, no online price"
  const validPrice = price !== null && price > 0 ? price : null;
  priceMap.set(item.itemNumber, validPrice);
  await new Promise(r => setTimeout(r, item.samedayProductId ? 0 : 1500));
}

console.table(
  uniqueItems.map(item => ({
    description: item.description,
    itemNumber: item.itemNumber,
    samedayId: item.samedayProductId ?? "—",
    currentPrice: priceMap.get(item.itemNumber) != null ? `$${priceMap.get(item.itemNumber)}` : "no online price",
  }))
);

// Compare every purchase against current price
const refunds = items
  .filter(item => {
    const current = priceMap.get(item.itemNumber);
    const paid = parseFloat(item.unitPrice);
    return current !== null && current < paid;
  })
  .map(item => {
    const current = priceMap.get(item.itemNumber)!;
    const paid = parseFloat(item.unitPrice);
    const savings = ((paid - current) * item.quantity).toFixed(2);
    return {
      description: item.description,
      itemNumber: item.itemNumber,
      date: item.transactionDate,
      paid: `$${paid}`,
      now: `$${current}`,
      qty: item.quantity,
      refund: `$${savings}`,
    };
  });

console.log("\n─────────────────────────────────────────");
if (refunds.length === 0) {
  console.log("No refunds available.");
} else {
  console.log(`${refunds.length} potential refund(s):\n`);
  console.table(refunds);
  const total = refunds.reduce((sum, r) => sum + parseFloat(r.refund.slice(1)), 0);
  console.log(`\nTotal potential savings: $${total.toFixed(2)}`);
}
