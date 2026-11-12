"use strict";
/* R196l · Nombres públicos. Regla del negocio: nunca se muestran los nombres de las personas detrás de las cuentas.
   «Naara» → «Sublicuentas» · «Libni» / «Libni Daniela» → «Relojes». Los usuarios internos (naara, libni) no cambian.
   Excepción: el titular legal de una cuenta bancaria («… VELÁSQUEZ BLANCO»), que el banco exige para transferir. */
const RE = /\b(naara|libni)\b(\s+(?:betzab[ée]|daniela))?/gi;
function publico(texto) {
  const s = String(texto == null ? "" : texto);
  if (!/naara|libni/i.test(s)) return s;
  return s.replace(RE, (m, nombre, _2, pos, todo) => (/^\s+vel[aá]squez/i.test(todo.slice(pos + m.length)) ? m : nombre.toLowerCase() === "naara" ? "Sublicuentas" : "Relojes"));
}
module.exports = { publico };
