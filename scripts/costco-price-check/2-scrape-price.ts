const WHS_NUMBER = "894";
const CLIENT_ID = "e442e6e6-2602-4a39-937b-8b28b4457ed3";
const CLIENT_IDENTIFIER = "6b262714-2ed4-4dcb-a39d-39a4b0357309";

async function fetchSamedayPrice(samedayProductId: string): Promise<number | null> {
  const res = await fetch(`https://sameday.costco.ca/store/costco-canada/products/${samedayProductId}`);
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/"price":"([\d.]+)"/);
  return m ? parseFloat(m[1]) : null;
}

export async function fetchCurrentPrice(itemNumber: string, samedayProductId?: string | null): Promise<number | null> {
  if (samedayProductId) {
    return fetchSamedayPrice(samedayProductId);
  }

  const url = `https://gdx-api.costco.com/catalog/product/dispprice-api/v2/display-price-lite?whsNumber=${WHS_NUMBER}&clientId=${CLIENT_ID}&item=${itemNumber}&locale=en-ca`;

  const res = await fetch(url, {
    headers: {
      "Client-Identifier": CLIENT_IDENTIFIER,
      "Origin": "https://www.costco.ca",
      "Referer": "https://www.costco.ca/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    },
  });

  if (!res.ok) {
    console.error(`Failed to fetch price for item ${itemNumber}: ${res.status}`);
    return null;
  }

  const data = await res.json();
  return data.priceData?.displayPrice?.onlinePrice ?? null;
}

// Standalone test run
if (import.meta.main) {
  const ITEM_NUMBER = "1829101";
  const PAID_PRICE = 31.99;

  const currentPrice = await fetchCurrentPrice(ITEM_NUMBER);

  if (currentPrice === null) {
    console.log("Could not fetch price.");
  } else if (currentPrice < PAID_PRICE) {
    console.log(`Refund available! Paid $${PAID_PRICE}, now $${currentPrice} — save $${(PAID_PRICE - currentPrice).toFixed(2)}`);
  } else {
    console.log(`No refund. Paid $${PAID_PRICE}, current price $${currentPrice} (went up $${(currentPrice - PAID_PRICE).toFixed(2)})`);
  }
}
