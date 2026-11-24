"use strict";
/* R207 · Textos de promociones y avisos para socios.
   Antes, clean() convertía los saltos de línea en espacios y la promoción llegaba como un solo párrafo
   («✅ … 🔑 … 📱 …»). Aquí se conservan las líneas y, si alguien pegó todo en una línea con emojis
   como viñetas, se separa una viñeta por línea. Solo se ordena el formato: no cambia ni una palabra. */
const EMOJI_INICIO = /\s+(?=(?:\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|[0-9#*]️?⃣))/u;
const EMOJI_INICIO_G = new RegExp(EMOJI_INICIO.source, "gu");

function limpiarTexto(v, max = 1200) {
  return String(v == null ? "" : v)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim().slice(0, max);
}

/** Una viñeta por línea cuando una línea trae 2 o más emojis usados como viñetas. */
function ordenarLineas(v) {
  return String(v || "").split("\n").map((linea) => {
    const partes = linea.split(EMOJI_INICIO_G).map((x) => x.trim()).filter(Boolean);
    return partes.length >= 3 || (partes.length === 2 && /^\P{L}/u.test(linea.trim())) ? partes.join("\n") : linea;
  }).join("\n");
}

const textoPromo = (v, max = 1200) => ordenarLineas(limpiarTexto(v, max)).slice(0, max);

module.exports = { limpiarTexto, ordenarLineas, textoPromo };
