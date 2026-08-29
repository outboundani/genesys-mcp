// HTML -> readable text + link extraction, tuned for API documentation pages.
// No DOM parser on Workers, so this is a careful regex pipeline: drop
// script/style/nav chrome, keep code blocks and headings, collect hyperlinks.

export function htmlToText(htmlSrc, baseUrl) {
  let s = String(htmlSrc || '');

  const links = [];
  const seen = new Set();
  for (const m of s.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(m[1], baseUrl).toString();
      if (!/^https?:/.test(url)) continue;
      const label = stripTags(m[2]).trim().slice(0, 120);
      const key = url.split('#')[0];
      if (seen.has(key) || !label) continue;
      seen.add(key);
      links.push({ url: key, label });
      if (links.length >= 400) break;
    } catch { /* bad href */ }
  }

  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(nav|footer|header)\b[\s\S]*?<\/\1>/gi, ' ');

  // Preserve structure that matters for doc comprehension.
  s = s
    .replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => `\n\n## ${stripTags(inner).trim()}\n`)
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => `\n\`\`\`\n${decodeEntities(stripTags(inner))}\n\`\`\`\n`)
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner) => `\`${stripTags(inner)}\``)
    .replace(/<(td|th)\b[^>]*>/gi, ' | ')
    .replace(/<(br|\/tr|\/p|\/div|\/li|\/table)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ');

  s = decodeEntities(stripTags(s))
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text: s, links };
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, ' ');
}

function decodeEntities(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '-', ndash: '-', hellip: '...', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', copy: '(c)' };
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}

function safeChar(code) {
  try { return code > 8 && code < 0x110000 ? String.fromCodePoint(code) : ' '; } catch { return ' '; }
}

// Fetches a page with sane limits and a docs-friendly UA. Returns
// { url, status, contentType, text, links } - `text` already extracted when HTML.
export async function fetchPage(url, { maxBytes = 900_000, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'makeittalk-docs-reader/1.0 (+https://makeittalk.dev)',
        Accept: 'text/html,application/json,text/plain,*/*',
      },
    });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    let raw = await res.text();
    if (raw.length > maxBytes) raw = raw.slice(0, maxBytes);
    if (contentType.includes('html') || /^\s*<(!doctype|html)/i.test(raw)) {
      const { text, links } = htmlToText(raw, res.url || url);
      return { url: res.url || url, status: res.status, contentType, text, raw: null, links };
    }
    return { url: res.url || url, status: res.status, contentType, text: raw, raw, links: [] };
  } finally {
    clearTimeout(timer);
  }
}
