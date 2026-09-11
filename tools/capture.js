/**
 * fomo capture bookmarklet — source form.
 *
 * WHY THIS EXISTS
 *
 * Cmd+A does not work on fomo. The thesis feed lives in a virtualised scroll
 * container that the browser's selection API skips, so select-all returns the
 * page chrome — nav, footer, your own balances — and zero theses. It looks like
 * a successful 5kB capture and contains none of the data.
 *
 * Reading the DOM directly does work. But clipboard writes require a real user
 * gesture: navigator.clipboard.writeText() hangs and execCommand('copy')
 * returns false when called from automation. A bookmarklet click IS that
 * gesture, which is why this is a button you press rather than something that
 * runs on your behalf.
 *
 * It also means the captured text goes browser -> clipboard -> disk without
 * passing through a model's context, which is both cheaper and a smaller
 * surface for platform content to leak into somewhere it shouldn't live.
 *
 * USAGE
 *   1. Open a fomo token page and click the "Thesis" tab (or a trader profile).
 *   2. Click the bookmarklet.
 *   3. Run: npm run grab
 */
(async () => {
  const findFeed = () =>
    [...document.querySelectorAll("*")]
      .filter(
        (e) =>
          e.scrollHeight > e.clientHeight + 50 &&
          e.clientHeight > 120 &&
          /Thesis|Buy|Sell/.test(e.innerText),
      )
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];

  // Stitch successive snapshots by their overlap. Virtualised rows are recycled
  // as you scroll, so naive concatenation duplicates and naive line-dedupe
  // destroys structure (every entry repeats the literal line "Thesis").
  const merge = (acc, chunk) => {
    if (!acc) return chunk;
    const max = Math.min(acc.length, chunk.length);
    for (let k = max; k > 40; k--) {
      if (acc.endsWith(chunk.slice(0, k))) return acc + chunk.slice(k);
    }
    return acc + "\n" + chunk;
  };

  const el = findFeed();
  if (!el) {
    alert("No feed found.\n\nOpen a token page and click the Thesis tab first.");
    return;
  }

  const restore = el.scrollTop;
  let acc = "";
  for (let i = 0; i < 25; i++) {
    acc = merge(acc, el.innerText);
    if (el.scrollTop >= el.scrollHeight - el.clientHeight - 5) break;
    el.scrollTop += el.clientHeight * 0.75;
    await new Promise((r) => setTimeout(r, 350));
  }
  el.scrollTop = restore;

  const payload =
    "FOMO-EXPORT\n" + document.title + "\n" + location.href + "\n\n" + acc;

  const ta = document.createElement("textarea");
  ta.value = payload;
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();

  const theses = (acc.match(/Thesis/g) || []).length;
  alert(
    ok
      ? `Copied ${theses} theses (${Math.round(payload.length / 1024)} kB).\n\nNow run:  npm run grab`
      : "Copy failed — click the page once, then try again.",
  );
})();
