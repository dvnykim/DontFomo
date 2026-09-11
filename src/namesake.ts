/**
 * Real-world namesake detection.
 *
 * A large share of launches are named after something that already exists —
 * a listed company, a consumer brand, an AI product. That is not decoration,
 * it IS the catalyst: "pumpfun turned into a stock-ticker costume party" is a
 * sentence about the market, and on one live scan nine of twenty-four runners
 * were wearing a real company's name.
 *
 * Mechanical, needs no API and no model, and it gives a catalyst to coins that
 * would otherwise have none.
 *
 * EXACT MATCHES ONLY. Fuzzy matching here would be actively harmful: claiming
 * a coin is "the Tesla play" because its ticker merely resembles TSLA invents a
 * narrative, which is the failure this codebase is built to avoid.
 */

export type NamesakeKind = "stock" | "ai" | "brand";

export interface Namesake {
  kind: NamesakeKind;
  /** The real-world thing, as a reader would name it. */
  name: string;
}

/** Listed equities, by the ticker traders would actually type. */
const STOCKS: Record<string, string> = {
  tsla: "Tesla", aapl: "Apple", amzn: "Amazon", googl: "Google", goog: "Google",
  msft: "Microsoft", meta: "Meta", nvda: "Nvidia", nflx: "Netflix", hood: "Robinhood",
  coin: "Coinbase", spy: "the S&P 500", qqq: "the Nasdaq 100", gme: "GameStop",
  amc: "AMC", pltr: "Palantir", amd: "AMD", intc: "Intel", mu: "Micron",
  dis: "Disney", ba: "Boeing", wmt: "Walmart", cost: "Costco", sbux: "Starbucks",
  uber: "Uber", abnb: "Airbnb", rblx: "Roblox", shop: "Shopify", pypl: "PayPal",
  jpm: "JPMorgan", gs: "Goldman Sachs", xom: "Exxon", cvx: "Chevron",
  orcl: "Oracle", crm: "Salesforce", adbe: "Adobe", ibm: "IBM", qcom: "Qualcomm",
  avgo: "Broadcom", lly: "Eli Lilly", jnj: "Johnson & Johnson", pfe: "Pfizer",
  djt: "Trump Media", mstr: "MicroStrategy", rddt: "Reddit", snap: "Snap",
  psg: "Paris Saint-Germain", mgm: "MGM", nke: "Nike",
};

/** AI labs and products. The other half of the same meta. */
const AI: Record<string, string> = {
  nvidia: "Nvidia", claude: "Claude", anthropic: "Anthropic", anthrp: "Anthropic",
  openai: "OpenAI", chatgpt: "ChatGPT", gpt: "GPT", deepseek: "DeepSeek",
  deepseekai: "DeepSeek", gemini: "Gemini", grok: "Grok", llama: "Llama",
  mistral: "Mistral", perplexity: "Perplexity", sora: "Sora", copilot: "Copilot",
  cursor: "Cursor", devin: "Devin", midjourney: "Midjourney",
};

/** Consumer brands and institutions that are neither of the above. */
const BRANDS: Record<string, string> = {
  nike: "Nike", adidas: "Adidas", mcdonalds: "McDonald's", starbucks: "Starbucks",
  ferrari: "Ferrari", porsche: "Porsche", rolex: "Rolex", gucci: "Gucci",
  spacex: "SpaceX", spcx: "SpaceX", nasa: "NASA", tesla: "Tesla",
  robinhood: "Robinhood", kalshi: "Kalshi", polymarket: "Polymarket",
  grindr: "Grindr", nasdaq: "the Nasdaq", cme: "the CME",
};

/**
 * What a ticker is named after, if anything.
 * Returns null for the overwhelming majority, which is correct.
 */
export function detectNamesake(symbol: string): Namesake | null {
  const key = symbol.trim().toLowerCase().replace(/^\$/, "");
  if (!key) return null;

  if (AI[key]) return { kind: "ai", name: AI[key]! };
  if (STOCKS[key]) return { kind: "stock", name: STOCKS[key]! };
  if (BRANDS[key]) return { kind: "brand", name: BRANDS[key]! };
  return null;
}

/** Section title for a group of same-kind namesakes. */
export function namesakeGroupTitle(kind: NamesakeKind, n: number): string {
  if (kind === "stock") return n > 1 ? "Stock Ticker Cosplay" : "Wearing A Stock Ticker";
  if (kind === "ai") return n > 1 ? "AI Name Grab" : "Wearing An AI Name";
  return n > 1 ? "Brand Cosplay" : "Wearing A Brand";
}
