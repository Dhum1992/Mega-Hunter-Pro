const SOURCES = [
  "rentry.co","pastebin.com","pastelink.net","justpaste.it","paste.ee",
  "controlc.com","pastes.io","notes.io","dpaste.com","hastebin.com",
  "gist.github.com","linktr.ee","linkvertise.com","meawfy.com",
  "telegra.ph","reddit.com","t.me"
];

const MEGA_RE = /https?:\/\/(?:www\.)?mega\.(?:nz|io)\/[^\s"'<>]+/gi;

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json({ error: "Missing q" }, 400);

  const queries = buildQueries(q);
  const pages = [];

  for (const query of queries) {
    const found = await duckSearch(query);
    pages.push(...found);
  }

  const uniquePages = dedupe(pages).slice(0, 20);

  const scanned = await Promise.allSettled(
    uniquePages.map(page => extractMega(page))
  );

  const results = scanned
    .filter(x => x.status === "fulfilled" && x.value.megaLinks.length)
    .map(x => x.value);

  return json({
    query: q,
    source: "DuckDuckGo public search",
    scanned: uniquePages.length,
    found: results.length,
    results
  });
}

function buildQueries(q) {
  q = q.replace(/"/g, "").trim();
  const list = [
    `${q} mega.nz`,
    `${q} mega.nz/file OR mega.nz/folder`
  ];

  for (const site of SOURCES) {
    list.push(`site:${site} ${q} mega.nz`);
  }

  return list.slice(0, 16);
}

async function duckSearch(query) {
  try {
    const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html"
      }
    });

    const html = await res.text();
    const links = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"/g;
    let m;

    while ((m = re.exec(html)) !== null) {
      let href = decodeHtml(m[1]);
      href = cleanDuckUrl(href);
      if (href && href.startsWith("http")) {
        links.push({
          title: "Search Result",
          url: href,
          description: query
        });
      }
    }

    return links.slice(0, 5);
  } catch {
    return [];
  }
}

async function extractMega(page) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(page.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 MegaHunterPro",
        "Accept": "text/html,text/plain,application/json,*/*"
      }
    });

    clearTimeout(timer);

    const text = await res.text();
    const matches = text.match(MEGA_RE) || [];

    const megaLinks = [...new Set(
      matches.map(cleanMega).filter(Boolean)
    )];

    return { ...page, megaLinks };
  } catch {
    return { ...page, megaLinks: [] };
  }
}

function cleanMega(link) {
  return String(link)
    .replace(/&amp;/g, "&")
    .replace(/%23/g, "#")
    .replace(/["'<>)\]}،؛\s]+$/g, "")
    .trim();
}

function cleanDuckUrl(href) {
  try {
    href = href.replace(/&amp;/g, "&");
    if (href.includes("/l/?")) {
      const u = new URL("https://duckduckgo.com" + href);
      return decodeURIComponent(u.searchParams.get("uddg") || "");
    }
    return href;
  } catch {
    return "";
  }
}

function decodeHtml(text) {
  return String(text)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&#39;/g, "'");
}

function dedupe(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    try {
      const u = new URL(item.url);
      u.hash = "";
      const clean = u.href;
      if (seen.has(clean)) continue;
      seen.add(clean);
      item.url = clean;
      out.push(item);
    } catch {}
  }

  return out;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
