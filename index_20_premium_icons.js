"use strict";

const crypto = require("crypto");
const { escapeHTML: h, emojiKey, cleanIcon, tag, PLATFORMS, platformKey, decorateText, decorateKeyboard } = require("./premium-icons-format");
const PACKS = ["VariousAnimations9", "streaming_emojis", "G8yg_by_fStikBot"];
const CONFIG_DOC = "telegram_premium_icons";
const PAGE_SIZE = 18;
const SESSION_MS = 30 * 60 * 1000;
// UI glyphs currently used across the bot. /iconos cambiar <emoji> also accepts
// a new glyph, so future menus do not require editing this catalog.
const GENERAL_ICONS = [...new Set("🔥 🎯 💎 🧾 💰 📈 💵 📦 ⏳ ✨ 📲 ℹ️ ↩️ ⏫ ⏭️ ⏰ ⏱️ ▶️ ☀️ ☁️ ♾️ ⚙️ ⚠️ ⚡ ⚪ ⛔ ✅ ✉️ ✏️ ❌ ➕ ➖ ➡️ ⬅️ ⬜ ⭐ 🆔 🆕 🌊 🌍 🌎 🌐 🍎 🍥 🎁 🎓 🎞️ 🎥 🎧 🎨 🎬 🎮 🎵 🎶 🏆 🏠 🏦 🏰 🐛 👁 👋 👍 👑 👤 👥 💡 💫 💬 💲 💳 💸 💻 💾 💿 📄 📅 📉 📊 📋 📌 📎 📏 📒 📗 📜 📝 📡 📣 📤 📥 📧 📨 📩 📬 📭 📱 📺 🔀 🔁 🔄 🔍 🔎 🔐 🔑 🔒 🔔 🔗 🔢 🔧 🔴 🕒 🗂️ 🗄️ 🗑️ 🗓️ 😊 🙂 🙌 🙍 🙏 🚀 🚨 🚫 🛑 🛒 🛡️ 🟠 🟡 🟢 🤖 🤝 🥇 🥈 🥉 🦁 🦉 🧠 🧩 🧬 🧮 🧹 🪙 🪟".split(" "))];
const PROMO_ROLES = { titulo: "🔥", plataforma: "🎯", datos: "💎", normal: "🧾", socio: "💰", venta: "📈", ganancia: "💵", cupos: "📦", vigencia: "⏳", detalles: "✨", solicitar: "📲" };
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const rows = (list, width = 2) => Array.from({ length: Math.ceil(list.length / width) }, (_, i) => list.slice(i * width, i * width + width));
function telegramEmojiError(error) {
  const body = error?.response?.body;
  const code = Number(body?.error_code || error?.response?.statusCode);
  const description = String(body?.description || "");
  return code === 400 && /custom.?emoji|emoji.?id|emoji.*(?:not.allowed|invalid)|can't parse entities|can.t parse entities|unsupported start tag|entity.*(?:invalid|end|start)|premium.*(?:required|allowed)/i.test(description);
}

function createPremiumIcons({ bot, db, admin, isAdmin, now = Date.now }) {
  if (bot.__premiumIconsService) return bot.__premiumIconsService;
  const original = {};
  const sessions = new Map(), busy = new Set();
  let cached = { active: false, platformIcons: {}, emojiIcons: {} }, expires = 0, loading;
  let lastFallback = 0;
  const ref = () => db.collection("config").doc(CONFIG_DOC);
  const stamp = () => admin.firestore.FieldValue.serverTimestamp();
  const scope = msg => `${msg.chat?.id}:${msg.from?.id}`;
  const cleanMap = raw => Object.fromEntries(Object.entries(raw || {}).map(([key, value]) => [key, cleanIcon(value)]).filter(([, value]) => value));

  async function loadConfig(force = false) {
    if (!force && now() < expires) return cached;
    if (loading) return loading;
    loading = (async () => {
      let timer;
      try {
        const [snap, promo] = await Promise.race([
          Promise.all([ref().get(), db.collection("config").doc("telegram_promo_emojis").get()]),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("config timeout")), 4000); timer.unref?.(); }),
        ]);
        const raw = snap.exists ? snap.data() : {}, prior = promo.exists ? promo.data() : {};
        const inherited = {};
        if (prior.activo !== false) for (const [role, alt] of Object.entries(PROMO_ROLES)) {
          const icon = cleanIcon(prior.icons?.[role]);
          if (icon) inherited[emojiKey(alt)] = icon;
        }
        cached = { ...raw, active: raw.active === true, platformIcons: cleanMap(raw.platformIcons), emojiIcons: { ...inherited, ...cleanMap(raw.emojiIcons) } };
      } catch (_) {
        // A configuration read failure must never interrupt normal bot traffic.
      } finally { clearTimeout(timer); expires = now() + 30_000; loading = null; }
      return cached;
    })();
    return loading;
  }
  async function updateConfig(userId, mutate) {
    await db.runTransaction(async tx => {
      const doc = ref(), snap = await tx.get(doc), current = snap.exists ? snap.data() : {};
      tx.set(doc, { ...mutate(current), updatedBy: String(userId), updatedAt: stamp() }, { merge: true });
    });
    if (loading) await loading;
    expires = 0;
    return loadConfig(true);
  }

  // Install once on the shared singleton, before menus, CRM and promotions load.
  const specs = {
    sendMessage: { text: 1, options: 2 }, editMessageText: { text: 0, options: 1 },
    sendPhoto: { options: 2, media: 1 }, sendAnimation: { options: 2, media: 1 },
    sendVideo: { options: 2, media: 1 }, sendDocument: { options: 2, media: 1 },
    editMessageCaption: { text: 0, options: 1, caption: true },
    editMessageReplyMarkup: { markup: 0, options: 1 },
  };
  for (const [name, spec] of Object.entries(specs)) {
    if (typeof bot[name] !== "function") continue;
    original[name] = bot[name].bind(bot);
    bot[name] = async (...args) => {
      const cfg = await loadConfig();
      // Streams cannot safely be retried after Telegram consumes their bytes.
      if (!cfg.active || (spec.media != null && args[spec.media]?.pipe)) return original[name](...args);
      const initial = args.slice(), next = args.slice();
      const opts = copy(args[spec.options] || {});
      initial[spec.options] = copy(opts); next[spec.options] = opts;
      let changed = false;
      if (spec.markup != null) {
        initial[spec.markup] = copy(args[spec.markup]);
        next[spec.markup] = decorateKeyboard(copy(args[spec.markup]), cfg);
        changed = JSON.stringify(next[spec.markup]) !== JSON.stringify(initial[spec.markup]);
      }
      if (opts.reply_markup) {
        const updated = decorateKeyboard(opts.reply_markup, cfg);
        changed ||= updated !== opts.reply_markup; opts.reply_markup = updated;
      }
      const text = spec.text != null ? args[spec.text] : opts.caption;
      if (typeof text === "string") {
        const result = decorateText(text, opts, cfg, spec.caption || spec.media != null);
        changed ||= result.text !== text;
        next[spec.options] = result.options;
        if (spec.text != null) next[spec.text] = result.text;
        else next[spec.options].caption = result.text;
      }
      if (!changed) return original[name](...args);
      try { return await original[name](...next); }
      catch (error) {
        if (!telegramEmojiError(error)) throw error;
        lastFallback = now();
        // Only a rejected Telegram 400 is known not to have delivered a message.
        // Network errors, timeouts, rate limits and server errors are not retried.
        return original[name](...initial);
      }
    };
  }

  const send = (msg, text, keyboard = []) => original.sendMessage(msg.chat.id, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } });
  function newView(msg, state = {}) {
    for (const [key, value] of sessions) if (value.until < now()) sessions.delete(key);
    const session = { ...state, nonce: crypto.randomBytes(5).toString("hex"), until: now() + SESSION_MS };
    sessions.set(scope(msg), session); return session;
  }
  const button = (session, text, action, arg = "") => ({ text, callback_data: `pico:${session.nonce}:${action}:${arg}` });
  const homeButton = session => [button(session, "← Iconos", "home")];
  async function home(msg, note = "") {
    const cfg = await loadConfig(true), session = newView(msg);
    const imported = PACKS.filter(name => cfg.packs?.[name]).length;
    return send(msg,
      `${note ? h(note) + "\n\n" : ""}<b>Iconos Premium del bot</b>\n\n` +
      `Estado: <b>${cfg.active ? "activo" : "pausado"}</b>\nPaquetes cargados: ${imported}/3\n` +
      `Logos elegidos: ${Object.keys(cfg.platformIcons).length}/${PLATFORMS.length}\nIconos generales: ${Object.keys(cfg.emojiIcons).length}\n\n` +
      "1. Cargue los paquetes.\n2. Entre en Plataformas y elija cada logo.\n3. Complete los iconos generales y pruebe el resultado.\n\n" +
      "La configuración se comparte en todo el bot. Los iconos sin asignación conservan su emoji normal.",
      [[button(session, "📥 Cargar los 3 paquetes", "import")],
       [button(session, "📺 Plataformas", "platforms"), button(session, "✨ Iconos generales", "general")],
       [button(session, "👁 Probar", "test"), button(session, cfg.active ? "Pausar" : "Activar", cfg.active ? "off" : "on")],
       [button(session, "Cerrar", "close")]]);
  }

  async function importPacks(msg) {
    await send(msg, "Estoy cargando los tres paquetes desde Telegram…");
    const imported = {}, autoCandidates = {}, report = [];
    for (const name of PACKS) {
      try {
        const pack = await bot.getStickerSet(name);
        if (pack.sticker_type !== "custom_emoji") throw new Error("not custom emoji");
        const unique = new Map();
        for (const sticker of pack.stickers || []) {
          const icon = cleanIcon({ id: sticker.custom_emoji_id, alt: sticker.emoji });
          if (icon) unique.set(icon.id, icon);
        }
        const icons = [...unique.values()];
        if (!icons.length || icons.length > 5000) throw new Error("invalid pack");
        await db.collection("telegram_emoji_packs").doc(name).set({ name, title: String(pack.title || name).slice(0, 150), icons, importedAt: stamp() });
        imported[name] = { count: icons.length, title: String(pack.title || name).slice(0, 150) };
        // Brand packs often tag many different logos with the same 🎬 glyph.
        // Only unambiguous variants from the general animation pack are automatic.
        if (name === "VariousAnimations9") for (const icon of icons) {
          const key = emojiKey(icon.alt); (autoCandidates[key] ||= []).push(icon);
        }
        report.push(`✓ ${name}: ${icons.length} emojis`);
      } catch (_) { report.push(`⚠ ${name}: no se pudo cargar. Puede volver a intentar.`); }
    }
    if (Object.keys(imported).length) await updateConfig(msg.from.id, current => {
      const additions = {}, allowed = new Set(GENERAL_ICONS.map(emojiKey));
      for (const [key, icons] of Object.entries(autoCandidates)) {
        if (icons.length === 1 && allowed.has(key) && !current.emojiIcons?.[key] && !cached.emojiIcons?.[key]) additions[key] = icons[0];
      }
      return { active: true, packs: imported, ...(Object.keys(additions).length ? { emojiIcons: additions } : {}) };
    });
    return home(msg, report.join("\n") + "\n\nLos logos de las plataformas se eligen visualmente para no confundir marcas.");
  }

  async function targetList(msg, kind, page = 0) {
    const cfg = await loadConfig(), list = kind === "p" ? PLATFORMS.map(([key, label]) => ({ key, label, icon: cfg.platformIcons[key] })) : GENERAL_ICONS.map(alt => ({ key: emojiKey(alt), label: alt, icon: cfg.emojiIcons[emojiKey(alt)] }));
    page = Math.max(0, Math.min(Math.floor(page) || 0, Math.ceil(list.length / PAGE_SIZE) - 1));
    const session = newView(msg, { list, kind, page });
    const buttons = list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((target, i) => button(session, `${target.icon ? "✓ " : ""}${target.label}`, "target", String(page * PAGE_SIZE + i)));
    const nav = [];
    if (page) nav.push(button(session, "← Anteriores", "page", String(page - 1)));
    if ((page + 1) * PAGE_SIZE < list.length) nav.push(button(session, "Siguientes →", "page", String(page + 1)));
    return send(msg, `<b>${kind === "p" ? "Logos de plataformas" : "Iconos generales"}</b> · ${page + 1}/${Math.ceil(list.length / PAGE_SIZE)}\n\nSeleccione el icono que quiere cambiar. ✓ significa que ya tiene uno configurado.`, [...rows(buttons, kind === "p" ? 2 : 3), ...(nav.length ? [nav] : []), homeButton(session)]);
  }

  async function choosePack(msg, target) {
    const cfg = await loadConfig(), session = newView(msg, { target });
    const buttons = PACKS.map((name, i) => [button(session, `${cfg.packs?.[name] ? "" : "Sin cargar · "}${name}`, "pack", String(i))]);
    return send(msg, `<b>Cambiar: ${h(target.label)}</b>\n\nElija un paquete para ver sus emojis. También puede enviar aquí <b>un solo emoji Premium</b> de cualquiera de sus paquetes.\n\nPara salir, escriba /iconos cancelar.`, [...buttons, homeButton(session)]);
  }

  async function packPage(msg, target, packIndex, page = 0, pinnedIcons = null) {
    const name = PACKS[packIndex];
    if (!name) return home(msg);
    let icons = pinnedIcons;
    if (!icons) {
      const snap = await db.collection("telegram_emoji_packs").doc(name).get();
      icons = snap.exists ? (snap.data().icons || []).map(cleanIcon).filter(Boolean) : [];
    }
    if (!icons.length) return home(msg, `Primero cargue el paquete ${name}.`);
    page = Math.max(0, Math.min(Math.floor(page) || 0, Math.ceil(icons.length / PAGE_SIZE) - 1));
    const session = newView(msg, { target, icons, packIndex, page });
    const part = icons.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const picks = part.map((icon, i) => ({ ...button(session, String(page * PAGE_SIZE + i + 1), "pick", String(page * PAGE_SIZE + i)), icon_custom_emoji_id: icon.id }));
    const nav = [];
    if (page) nav.push(button(session, "← Anteriores", "packpage", String(page - 1)));
    if ((page + 1) * PAGE_SIZE < icons.length) nav.push(button(session, "Siguientes →", "packpage", String(page + 1)));
    const keyboard = [...rows(picks, 6), ...(nav.length ? [nav] : []), [button(session, "Cambiar paquete", "packs")], homeButton(session)];
    const title = `<b>${h(target.label)}</b> · ${h(name)}\nPágina ${page + 1}/${Math.ceil(icons.length / PAGE_SIZE)}\n\n`;
    try {
      // HTML previews remain useful in clients that don't yet show button icons.
      return await send(msg, title + part.map((icon, i) => `${page * PAGE_SIZE + i + 1}. ${tag(icon)}`).join("  ") + "\n\nToque el número del emoji que quiere usar.", keyboard);
    } catch (error) {
      if (!telegramEmojiError(error)) throw error;
      lastFallback = now();
      return send(msg, title + "Telegram rechazó los emojis Premium de la vista previa. Compruebe que la cuenta dueña del bot en BotFather tenga Premium activo. También puede abrir el paquete y enviarme aquí un solo emoji Premium.", [[{ text: "Abrir paquete", url: `https://t.me/addemoji/${name}` }], [button(session, "Cambiar paquete", "packs")], homeButton(session)]);
    }
  }

  async function saveTarget(msg, target, rawIcon) {
    const icon = cleanIcon(rawIcon);
    if (!icon || !target) return send(msg, "No pude leer ese emoji. Entre en /iconos y vuelva a elegirlo.");
    const field = target.kind === "p" ? "platformIcons" : "emojiIcons";
    await updateConfig(msg.from.id, () => ({ active: true, [field]: { [target.key]: icon } }));
    return home(msg, `Guardado: ${target.label}. Se aplicará a los nuevos mensajes y a los paneles que vuelva a abrir.`);
  }

  async function test(msg) {
    const cfg = await loadConfig(true), session = newView(msg);
    const entries = [...Object.entries(cfg.platformIcons).map(([key, icon]) => [PLATFORMS.find(p => p[0] === key)?.[1] || key, icon]), ...Object.entries(cfg.emojiIcons)].slice(0, 36);
    if (!entries.length) return home(msg, "Primero cargue los paquetes y elija algún icono.");
    try {
      await send(msg, `<b>Muestra Premium</b>\n\n${entries.map(([label, icon]) => `${tag(icon)} ${h(label)}`).join("\n")}`, [[{ ...button(session, "Botón con icono", "home"), icon_custom_emoji_id: entries[0][1].id, style: "success" }], homeButton(session)]);
      return send(msg, `Telegram aceptó la muestra. ${cfg.active ? "La configuración está activa." : "La configuración sigue pausada."}${lastFallback ? "\nAntes se detectó un rechazo de Premium; los mensajes afectados se enviaron con sus iconos normales." : ""}`);
    } catch (error) {
      if (!telegramEmojiError(error)) throw error;
      lastFallback = now();
      return send(msg, "Telegram rechazó los emojis Premium. Revise que la cuenta dueña del bot en BotFather tenga Premium activo. Sus elecciones siguen guardadas; vuelva a /iconos probar después de revisarlo.", [homeButton(session)]);
    }
  }

  async function allowed(msg) {
    if (!msg.from?.id || !(await isAdmin(msg.from.id))) { await send(msg, "Solo los administradores pueden configurar los iconos del bot."); return false; }
    if (msg.chat?.type !== "private") { await send(msg, "Para configurar los iconos, abra el chat privado de este bot y escriba /iconos."); return false; }
    return true;
  }
  function cancelSession(msg) { sessions.delete(scope(msg)); }
  async function guarded(msg, fn) {
    const key = scope(msg);
    if (busy.has(key)) { await send(msg, "Espere a que termine la operación anterior."); return true; }
    busy.add(key);
    try { await fn(); }
    catch (_) { await send(msg, "No se pudo completar la operación. No se confirmó ningún cambio nuevo. Vuelva a /iconos para revisar la configuración."); }
    finally { busy.delete(key); }
    return true;
  }
  async function handleMessage(msg) {
    const text = String(msg.text || msg.caption || "").trim();
    const command = /^\/iconos(?:@\w+)?(?:\s+(.*))?$/is.exec(text);
    let session = sessions.get(scope(msg));
    if (session && session.until < now()) { cancelSession(msg); session = null; }
    if (!command && /^\//.test(text)) { cancelSession(msg); return false; }
    if (!command && !session?.target) return false;
    if (!(await allowed(msg))) return true;
    return guarded(msg, async () => {
      if (command) {
        const rest = String(command[1] || "").trim(), verb = rest.split(/\s+/)[0].toLowerCase();
        if (verb === "cancelar") { cancelSession(msg); return send(msg, "Configuración de iconos cerrada."); }
        if (verb === "importar") { await loadConfig(true); return importPacks(msg); }
        if (verb === "plataformas") return targetList(msg, "p");
        if (verb === "generales") return targetList(msg, "g");
        if (verb === "probar") return test(msg);
        if (verb === "cambiar") {
          const alt = rest.slice(verb.length).trim();
          if (!cleanIcon({ id: "1", alt })) return send(msg, "Escriba /iconos cambiar seguido del emoji normal que quiere reemplazar. Ejemplo: /iconos cambiar 🔥");
          return choosePack(msg, { kind: "g", key: emojiKey(alt), label: alt });
        }
        return home(msg);
      }
      if (/^cancelar$/i.test(text)) { cancelSession(msg); return send(msg, "Configuración de iconos cerrada."); }
      const body = String(msg.text || msg.caption || ""), entities = (msg.entities || msg.caption_entities || []).filter(e => e.type === "custom_emoji");
      if (entities.length !== 1) return send(msg, "Envíe un solo emoji Premium para esta elección, o use los botones del paquete. /iconos cancelar para salir.");
      const entity = entities[0];
      return saveTarget(msg, session.target, { id: entity.custom_emoji_id, alt: body.slice(entity.offset, entity.offset + entity.length) });
    });
  }
  async function handleCallback(q) {
    const match = /^pico:([a-f0-9]+):([a-z]+):(.*)$/.exec(String(q.data || ""));
    if (!String(q.data || "").startsWith("pico:")) return false;
    const msg = { chat: q.message?.chat, from: q.from };
    if (!msg.chat?.id) return true;
    if (!(await allowed(msg))) return true;
    return guarded(msg, async () => {
      const session = sessions.get(scope(msg));
      if (!match || !session || session.nonce !== match[1] || session.until < now()) return send(msg, "Ese selector ya terminó. Abra uno nuevo con /iconos.");
      // Consume the view before any asynchronous write to prevent double clicks.
      sessions.delete(scope(msg));
      const [, , action, arg] = match;
      if (action === "home") return home(msg);
      if (action === "close") return send(msg, "Configuración de iconos cerrada.");
      if (action === "import") { await loadConfig(true); return importPacks(msg); }
      if (action === "platforms") return targetList(msg, "p");
      if (action === "general") return targetList(msg, "g");
      if (action === "page") return targetList(msg, session.kind, Number(arg));
      if (action === "target") {
        const target = session.list?.[Number(arg)];
        if (target) return choosePack(msg, { ...target, kind: session.kind });
      }
      if (action === "packs" && session.target) return choosePack(msg, session.target);
      if (action === "pack" && session.target) return packPage(msg, session.target, Number(arg));
      if (action === "packpage" && session.target) return packPage(msg, session.target, session.packIndex, Number(arg), session.icons);
      if (action === "pick" && session.target && session.icons?.[Number(arg)]) return saveTarget(msg, session.target, session.icons[Number(arg)]);
      if (action === "test") return test(msg);
      if (action === "off" || action === "on") { await updateConfig(msg.from.id, () => ({ active: action === "on" })); return home(msg); }
      return home(msg);
    });
  }
  const service = { loadConfig, handleMessage, handleCallback, cancelSession,
    platformTag(value) { const icon = cached.active && cleanIcon(cached.platformIcons?.[platformKey(value)]); return icon ? tag(icon) : ""; },
  };
  Object.defineProperty(bot, "__premiumIconsService", { value: service });
  return service;
}

module.exports = { createPremiumIcons, PACKS, GENERAL_ICONS, CONFIG_DOC, telegramEmojiError };
