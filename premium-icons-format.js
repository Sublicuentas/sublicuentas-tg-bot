"use strict";

// No Telegram/Firebase side effects. Keep credentials, code, links and callback
// payloads intact; only decorate the leading UI icon in each line/button.
const escapeHTML = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const emojiKey = value => String(value || "").replace(/[\uFE0E\uFE0F]/g, "");
const segments = new Intl.Segmenter("es", { granularity: "grapheme" });
const isEmoji = value => /\p{Extended_Pictographic}/u.test(value);
function cleanIcon(value) {
  const id = String(value?.id || ""), alt = String(value?.alt || "");
  if (!/^\d{1,30}$/.test(id) || alt.length > 32 || [...segments.segment(alt)].length !== 1 || !isEmoji(alt)) return null;
  return { id, alt };
}
const tag = icon => `<tg-emoji emoji-id="${icon.id}">${escapeHTML(icon.alt)}</tg-emoji>`;
const PLATFORMS = [
  ["netflix", "Netflix / Netflix VIP", /\b(?:netflix|vipnetflix)\b/],
  ["disney", "Disney+", /\b(?:disney(?:plus|p|s)?|disneyp|disneys)\b/],
  ["hbo", "HBO Max", /\b(?:hbo\s*max|hbomax|max)\b/],
  ["prime", "Prime Video", /\b(?:prime\s*video|primevideo)\b/],
  ["paramount", "Paramount+", /\bparamount(?:plus)?\b/],
  ["crunchyroll", "Crunchyroll", /\bcrunchyroll\b/],
  ["vix", "ViX", /\bvix\b/], ["viki", "Viki Rakuten", /\bviki\b/],
  ["apple", "Apple TV", /\bapple\s*tv\b/], ["universal", "Universal+", /\buniversal\b/],
  ["spotify", "Spotify", /\bspotify\b/], ["youtube", "YouTube", /\byoutube\b/],
  ["deezer", "Deezer", /\bdeezer\b/], ["canva", "Canva", /\bcanva\b/],
  ["gemini", "Gemini", /\bgemini\b/], ["chatgpt", "ChatGPT", /\bchatgpt\b/],
  ["duolingo", "Duolingo", /\bduolingo\b/], ["office", "Microsoft Office", /\boffice(?:2021|365)?\b/],
  ["stella", "Stella TV", /\bstella\s*tv\d?\b/], ["oleada", "Oleada TV", /\boleada\s*tv\d?\b/],
  ["latin", "LatinTV", /\blatin\s*tv\d?\b/], ["lion", "Lion TV", /\blion\s*tv\d?\b/],
  ["iptv", "IPTV", /\biptv\d?\b/],
];
function platformKey(text) {
  const plain = String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const matches = PLATFORMS.filter(([, , re]) => re.test(plain));
  return matches.length === 1 ? matches[0][0] : "";
}

// Telegram's legacy Markdown is deliberately small. If parsing is ambiguous,
// retain the original parse mode/message instead of silently changing content.
function legacyToHTML(text) {
  function read(start, stop) {
    let out = "", i = start;
    while (i < text.length) {
      if (stop && text[i] === stop) return { html: out, end: i + 1 };
      const c = text[i];
      if (c === "\\" && /[_*`\[\\]/.test(text[i + 1] || "")) {
        out += escapeHTML(text[i + 1]); i += 2; continue;
      }
      if (text.startsWith("```", i)) {
        const end = text.indexOf("```", i + 3);
        if (end < 0 || stop) throw new Error("markdown");
        let body = text.slice(i + 3, end), language = "";
        const lang = body.match(/^([a-zA-Z0-9_+-]+)\n/);
        if (lang) { language = lang[1]; body = body.slice(lang[0].length); }
        out += language ? `<pre><code class="language-${language}">${escapeHTML(body)}</code></pre>` : `<pre>${escapeHTML(body)}</pre>`;
        i = end + 3; continue;
      }
      if (c === "`") {
        const end = text.indexOf("`", i + 1);
        if (end < 0 || stop) throw new Error("markdown");
        out += `<code>${escapeHTML(text.slice(i + 1, end))}</code>`; i = end + 1; continue;
      }
      if (c === "*" || c === "_") {
        if (stop) throw new Error("nested legacy markdown");
        const inner = read(i + 1, c), name = c === "*" ? "b" : "i";
        if (!inner.html) throw new Error("empty markdown");
        out += `<${name}>${inner.html}</${name}>`; i = inner.end; continue;
      }
      if (c === "[") {
        const endLabel = text.indexOf("](", i + 1);
        if (endLabel < 0 || stop) throw new Error("markdown link");
        let end = endLabel + 2, depth = 1;
        for (; end < text.length; end++) {
          if (text[end] === "\\") { end++; continue; }
          if (text[end] === "(") depth++;
          if (text[end] === ")" && --depth === 0) break;
        }
        if (end >= text.length) throw new Error("markdown link");
        const label = text.slice(i + 1, endLabel), url = text.slice(endLabel + 2, end);
        if (!/^(https?:\/\/|tg:\/\/|mailto:)/i.test(url) || /[*_`\[\]\\]/.test(label)) throw new Error("markdown link");
        out += `<a href="${escapeHTML(url.replace(/\\([()\\])/g, "$1"))}">${escapeHTML(label)}</a>`;
        i = end + 1; continue;
      }
      out += escapeHTML(c); i++;
    }
    if (stop) throw new Error("unclosed markdown");
    return { html: out, end: i };
  }
  try { return read(0, "").html; } catch (_) { return null; }
}

function prefixEmoji(text) {
  const prefix = text.match(/^\s*(?:(?:\d+[.)]|[•│└├─>—-])\s*)*/)?.[0] || "";
  const first = [...segments.segment(text.slice(prefix.length))][0]?.segment;
  return first && isEmoji(first) ? { emoji: first, start: prefix.length, end: prefix.length + first.length } : null;
}
function selectIcon(text, emoji, config, button = false) {
  // Only platform headings or platform-labelled buttons get a brand logo.
  // "Eliminar cuenta de Netflix" must retain its delete icon.
  const family = platformKey(text);
  const plain = String(text).trim();
  const action = /^(?:eliminar|editar|renovar|volver|cancelar|borrar|buscar|cerrar|activar|desactivar|asignar|quitar|copiar)\b/i.test(plain);
  const field = /^([^:]+):/.exec(plain);
  const platformHeading = family && !action && (!field || /^(?:plataforma|servicio)$/i.test(field[1].trim()));
  const selected = platformHeading ? cleanIcon(config.platformIcons?.[family]) : null;
  return selected || cleanIcon(config.emojiIcons?.[emojiKey(emoji)]);
}

function decorateHTML(html, config) {
  // Track protected tags across line breaks. Never replace within code, pre,
  // URLs or an already configured tg-emoji.
  const tokens = html.split(/(<[^>]*>)/g);
  let blocked = 0, lineText = "", output = "", changed = false, sourceOffset = 0;
  for (const token of tokens) {
    if (token.startsWith("<")) {
      const close = /^<\//.test(token), name = token.match(/^<\/?([\w-]+)/)?.[1]?.toLowerCase();
      if (["code", "pre", "a", "tg-emoji"].includes(name)) {
        blocked = Math.max(0, blocked + (close ? -1 : 1));
        // A protected element at the start consumes the line's leading slot.
        if (!close) lineText += "x";
      }
      output += token; sourceOffset += token.length; continue;
    }
    const lines = token.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i) { output += "\n"; lineText = ""; sourceOffset++; }
      let part = lines[i];
      if (!blocked) {
        const prefix = prefixEmoji(lineText + part);
        if (prefix && prefix.start >= lineText.length) {
          const start = prefix.start - lineText.length, end = prefix.end - lineText.length;
          // Include later formatting spans on this same line when finding a platform.
          const remainder = html.slice(sourceOffset).split("\n")[0].replace(/<[^>]*>/g, "");
          const icon = selectIcon(remainder.slice(remainder.indexOf(prefix.emoji) + prefix.emoji.length), prefix.emoji, config);
          if (icon) { part = part.slice(0, start) + tag(icon) + part.slice(end); changed = true; }
        }
      }
      lineText += lines[i]; output += part; sourceOffset += lines[i].length;
    }
  }
  return { text: output, changed };
}

function decorateText(text, options, config, caption = false) {
  const entityKey = caption ? "caption_entities" : "entities";
  if (options[entityKey]?.length) return { text, options };
  const mode = String(options.parse_mode || "").toLowerCase();
  const html = mode === "html" ? text : mode === "markdown" ? legacyToHTML(text) : !mode ? escapeHTML(text) : null;
  if (html == null) return { text, options };
  const result = decorateHTML(html, config);
  return result.changed ? { text: result.text, options: { ...options, parse_mode: "HTML" } } : { text, options };
}

function decorateKeyboard(markup, config) {
  let value = markup, serialized = false;
  if (typeof value === "string") { try { value = JSON.parse(value); serialized = true; } catch (_) { return markup; } }
  if (!value?.inline_keyboard) return markup;
  let changed = false;
  const rows = value.inline_keyboard.map(row => row.map(button => {
    if (button.icon_custom_emoji_id || typeof button.text !== "string") return button;
    const prefix = prefixEmoji(button.text);
    const plain = prefix ? button.text.slice(prefix.end).trim() : button.text;
    const icon = selectIcon(plain, prefix?.emoji || "", config, true);
    if (!icon) return button;
    changed = true;
    return { ...button, text: (prefix ? button.text.slice(0, prefix.start) + plain : plain) || button.text, icon_custom_emoji_id: icon.id };
  }));
  if (!changed) return markup;
  const result = { ...value, inline_keyboard: rows };
  return serialized ? JSON.stringify(result) : result;
}

module.exports = { escapeHTML, emojiKey, cleanIcon, tag, isEmoji, PLATFORMS, platformKey, legacyToHTML, decorateHTML, decorateText, decorateKeyboard };
