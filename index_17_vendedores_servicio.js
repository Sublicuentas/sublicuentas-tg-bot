"use strict";

/**
 * Modelo de vendedor por servicio.
 *
 * `cliente.vendedor` se conserva únicamente como compatibilidad con datos y
 * pantallas antiguas. La fuente autoritativa es cada elemento de
 * `cliente.servicios[]`.
 */

function clean(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normVendedor(value = "") {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalVendedor(value = "") {
  const raw = clean(value);
  const norm = normVendedor(raw);
  if (!norm) return "";
  if (norm === "geissel" || norm === "geisell") return "Geisell";
  return raw;
}

function normCanonico(value = "") {
  const norm = normVendedor(value);
  return norm === "geissel" ? "geisell" : norm;
}

function vendedorEfectivoServicio(servicio = {}, cliente = {}) {
  const vendedor = canonicalVendedor(
    servicio?.vendedor ||
    servicio?.vendedorNombre ||
    cliente?.vendedor ||
    (Array.isArray(cliente?.vendedores) ? cliente.vendedores[0] : "") ||
    ""
  );
  const vendedorNormRaw = normVendedor(
    servicio?.vendedor_norm ||
    servicio?.vendedorNorm ||
    vendedor ||
    cliente?.vendedor_norm ||
    ""
  );
  const vendedorNorm = vendedorNormRaw === "geissel" ? "geisell" : vendedorNormRaw;
  const vendedorTelefono = clean(
    servicio?.vendedorTelefono ||
    servicio?.vendedor_telefono ||
    (vendedorNorm && vendedorNorm === normCanonico(cliente?.vendedor_norm || cliente?.vendedor || "")
      ? cliente?.vendedorTelefono
      : "") ||
    ""
  );
  return { vendedor, vendedor_norm: vendedorNorm, vendedorTelefono };
}

function heredarVendedorServicios(servicios = [], cliente = {}) {
  return (Array.isArray(servicios) ? servicios : []).map((servicio) => {
    const original = { ...(servicio || {}) };
    const efectivo = vendedorEfectivoServicio(original, cliente);
    if (!efectivo.vendedor) return original;
    return {
      ...original,
      vendedor: efectivo.vendedor,
      vendedor_norm: efectivo.vendedor_norm,
      ...(efectivo.vendedorTelefono ? { vendedorTelefono: efectivo.vendedorTelefono } : {}),
    };
  });
}

function resumenVendedoresCliente(servicios = [], cliente = {}) {
  const porNorm = new Map();
  for (const servicio of Array.isArray(servicios) ? servicios : []) {
    const efectivo = vendedorEfectivoServicio(servicio, cliente);
    if (!efectivo.vendedor_norm) continue;
    if (!porNorm.has(efectivo.vendedor_norm)) porNorm.set(efectivo.vendedor_norm, efectivo);
  }

  if (!porNorm.size) {
    const heredado = vendedorEfectivoServicio({}, cliente);
    if (heredado.vendedor_norm) porNorm.set(heredado.vendedor_norm, heredado);
  }

  const vendedores = Array.from(porNorm.values());
  const legacyNorm = normCanonico(cliente?.vendedor_norm || cliente?.vendedor || "");
  const principal = vendedores.find((v) => v.vendedor_norm === legacyNorm) || vendedores[0] || {
    vendedor: "",
    vendedor_norm: "",
    vendedorTelefono: "",
  };

  return {
    vendedores: vendedores.map((v) => v.vendedor),
    vendedores_norm: vendedores.map((v) => v.vendedor_norm),
    clienteCompartido: vendedores.length > 1,
    principal,
  };
}

function camposResumenVendedores(servicios = [], cliente = {}) {
  const resumen = resumenVendedoresCliente(servicios, cliente);
  const legacyNorm = normCanonico(cliente?.vendedor_norm || cliente?.vendedor || "");
  return {
    vendedores: resumen.vendedores,
    vendedores_norm: resumen.vendedores_norm,
    clienteCompartido: resumen.clienteCompartido,
    vendedor: resumen.principal.vendedor || "",
    vendedor_norm: resumen.principal.vendedor_norm || "",
    vendedorTelefono: resumen.principal.vendedorTelefono || (
      resumen.principal.vendedor_norm && resumen.principal.vendedor_norm === legacyNorm
        ? clean(cliente?.vendedorTelefono || "")
        : ""
    ),
  };
}

function servicioPerteneceAVendedor(servicio = {}, cliente = {}, vendedor = "") {
  const buscado = normCanonico(vendedor);
  if (!buscado) return false;
  return vendedorEfectivoServicio(servicio, cliente).vendedor_norm === buscado;
}

function clientePerteneceAVendedor(cliente = {}, vendedor = "") {
  const buscado = normCanonico(vendedor);
  if (!buscado) return false;
  const servicios = Array.isArray(cliente?.servicios) ? cliente.servicios : [];
  // Si ya existen cuentas, su vendedor es la fuente autoritativa. El campo
  // superior puede estar desactualizado y no debe volver a exponer la ficha.
  if (servicios.length) {
    return servicios.some((servicio) => servicioPerteneceAVendedor(servicio, cliente, buscado));
  }
  return normCanonico(cliente?.vendedor_norm || cliente?.vendedor || "") === buscado;
}

function filtrarClienteParaVendedor(cliente = {}, vendedor = "") {
  const buscado = normCanonico(vendedor);
  const servicios = [];
  (Array.isArray(cliente?.servicios) ? cliente.servicios : []).forEach((servicio, indexOriginal) => {
    if (!servicioPerteneceAVendedor(servicio, cliente, buscado)) return;
    const efectivo = vendedorEfectivoServicio(servicio, cliente);
    servicios.push({
      ...(servicio || {}),
      ...efectivo,
      servicioIndexOriginal: indexOriginal,
      _servicioIndexOriginal: indexOriginal,
    });
  });

  const vendedorVisible = servicios.length
    ? vendedorEfectivoServicio(servicios[0], cliente)
    : vendedorEfectivoServicio({}, cliente);
  return {
    ...cliente,
    servicios,
    vendedor: vendedorVisible.vendedor || canonicalVendedor(vendedor),
    vendedor_norm: vendedorVisible.vendedor_norm || buscado,
    vendedorTelefono: vendedorVisible.vendedorTelefono || "",
    vendedores: vendedorVisible.vendedor ? [vendedorVisible.vendedor] : [],
    vendedores_norm: buscado ? [buscado] : [],
    clienteCompartido: false,
  };
}

module.exports = {
  normVendedor,
  canonicalVendedor,
  vendedorEfectivoServicio,
  heredarVendedorServicios,
  resumenVendedoresCliente,
  camposResumenVendedores,
  servicioPerteneceAVendedor,
  clientePerteneceAVendedor,
  filtrarClienteParaVendedor,
};
