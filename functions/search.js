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

  const key = context.env.BRAVE_API_KEY;
  if (!key) return json({ error: "Missing BRAVE_API_KEY" }, 500);

  const queries = buildQueries(q);
  const pages = await searchBrave(queries, key);
  const uniquePages = dedupe(pages).slice(0, 25);

  const scanned = await Promise.allSettled(
    uniquePages.map(page => extractMega(page))
  );

  const results = scanned
    .filter(x => x.status === "fulfilled" && x.value.megaLinks.length)
    .map(x => x.value);

  return json({
    query: q,
    scanned: uniquePages.length,
    found: results.length,
    results
  });
}

function buildQueries(q) {
  q = q.replace(/"/g, "").trim();
  const list = [
    `${q} mega.nz`,
    `${q} mega.nz/file OR mega.nz/folder OR mega.nz`
  ];

  for (const site of SOURCES) {
    list.push(`site:${site} ${q} mega.nz`);
  }

  return list.slice(0, 18);
}

async function searchBrave(queries, key) {
  const all = [];

  for (const query of queries) {
    try {
      const api =
        "https://api.search.brave.com/res/v1/web/search?q=" +
        encodeURIComponent(query) +
        "&count=5&freshness=pm";

      const res = await fetch(api, {
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": key
        }
      });

      if (!res.ok) continue;

      const data = await res.json();
      const items = data.web?.results || [];

      for (const item of items) {
        all.push({
          title: cleanText(item.title || ""),
          url: item.url || "",
          description: cleanText(item.description || "")
        });
      }
    } catch {}
  }

  return all;
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

    const type = res.headers.get("content-type") || "";
    if (!type.includes("text") && !type.includes("html") && !type.includes("json")) {
      return { ...page, megaLinks: [] };
    }

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

function cleanText(text) {
  return String(text).replace(/<[^>]+>/g, "").trim();
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
