// ===== CONFIG =====
const CONFIG = {
  SUPABASE_URL: "https://soxneojhqbslioivsqcy.supabase.co", // EDITAR (sin /rest/v1/)
  SUPABASE_KEY: "sb_publishable_vHsONeA2xXzhEbuUAPwDIg_1AILLSIR", // EDITAR (llave pública)
  EMAIL_DOMAIN: "example.com", // EDITAR: dominio del correo interno de los usuarios
  BUCKET: "fotos",
  MAX_FOTOS: 3,
  NOMBRE_MAX: 20,
  CORTO_MAX: 15,
  MOSTRAR_DEBUG: true, // EDITAR: ponlo en false al terminar las pruebas
  IMG_VELA: "vela.png", IMG_FLOR: "flor.png", IMG_PAN: "pan.png", IMG_CALAVERA: "calaverita.png", // EDITAR
  IMG_FONDO: "fondo.png", IMG_FLORES: "", IMG_GUIRNALDA: "guirnalda.png",          // EDITAR
  IMG_TELAS: ["", "", "", ""],// EDITAR (opcional): tiras repetibles de tela, magenta/naranja/morado
  IMG_MARCOS: ["marco 1.png", "marco 2.png", "marco 3.png", "marco 4.png"], // EDITAR: PNG de cada marco (madera, dorado, talavera, cempasúchil)
  MARCO_HUECO: 8,               // % de margen entre el borde del marco y la foto (ver medidas abajo)
  ZOOM_MAX: 2.2,
};

const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
const S = { fase: "edicion", user: null, perfil: null, fotos: [], editando: null, modo: "entrar" };
const $ = s => document.querySelector(s);
const ls = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
};
const clave = n => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const corto = n => n.length > CONFIG.CORTO_MAX ? n.slice(0, CONFIG.CORTO_MAX - 1).trimEnd() + "…" : n;
const esAdmin = () => !!S.perfil?.es_admin;
const puedeEditar = f => S.user && (esAdmin() || (f.user_id === S.user.id && S.fase === "edicion"));
const publicUrl = ruta => sb.storage.from(CONFIG.BUCKET).getPublicUrl(ruta).data.publicUrl;
const TIPOS = {
  vela: { icono: "🕯️", nombre: "vela" }, flor: { icono: "🌼", nombre: "flor" },
  pan: { icono: "🍞", nombre: "pan de muerto" }, calavera: { icono: "💀", nombre: "calaverita" }
};
const puedeOfrendar = () => S.user && (esAdmin() || S.fase !== "cerrado");

const uuid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
};

function ver(id) {
  document.querySelectorAll("main > section").forEach(s => s.hidden = s.id !== id);
}
function msjError(e) {
  const m = e?.message || String(e);
  if (/already|registered/i.test(m)) return "Ese nombre ya está ocupado. Elige otro.";
  if (/invalid login/i.test(m)) return "Nombre o PIN incorrecto.";
  if (/row-level security|policy/i.test(m)) return "Ya no se puede hacer este cambio.";
  if (/duplicate key/i.test(m)) return "Esa ofrenda ya la usaste. Muévela desde la foto donde está.";
  if (/email/i.test(m) && /invalid/i.test(m)) return "Supabase rechazó el correo interno (revisa EMAIL_DOMAIN en CONFIG): " + m;
  return m;
}

// ===== Inicio =====
async function init() {
    document.documentElement.style.setProperty("--hueco", CONFIG.MARCO_HUECO + "%");
  const { data } = await sb.rpc("estado_altar");
  if (data) S.fase = data.fase;
  decorar();
  const { data: { session } } = await sb.auth.getSession();
  await setUser(session?.user);
  await cargar();
  const textos = {
    edicion: "Puedes subir tus fotos hasta el 30 de octubre.",
    velas: "Este altar permanece encendido hasta el 6 de noviembre.",
    cerrado: ""
  };
  $("#nota").textContent = textos[S.fase];
  if (CONFIG.MOSTRAR_DEBUG) $("#debug").textContent = "Fase actual: " + S.fase;
  if (new URLSearchParams(location.search).has("admin") && !S.user) return abrirAuth("admin");
  if (S.user || ls.get("acuerdo")) return ver("altar");
  ver(S.fase === "cerrado" ? "gracias" : "bienvenida");
}

async function setUser(user) {
  S.user = user || null;
  S.perfil = null;
  if (user) {
    const { data } = await sb.from("perfiles").select("*").eq("id", user.id).maybeSingle();
    S.perfil = data;
  }
  barra();
}

function barra() {
  const b = $("#barra");
  b.replaceChildren();
  const boton = (t, f) => { const x = document.createElement("button"); x.textContent = t; x.onclick = f; return x; };
  if (S.user) {
    b.append(txt("", esAdmin() ? "Administrador" : "Hola, " + (S.perfil?.nombre || "")), boton("Reglas", verReglas),
      boton("Salir", async () => { await sb.auth.signOut(); await setUser(null); await cargar(); ver("altar"); }));
  } else if (S.fase !== "cerrado") {
    b.append(boton("Reglas", verReglas), boton("Entrar", () => abrirAuth("entrar")));
  }
}

// ===== Bienvenida y acceso =====
$("#si").onclick = () => { ls.set("acuerdo", "si"); barra(); abrirAuth("registro"); };
$("#no").onclick = () => { ls.set("acuerdo", "no"); barra(); ver("altar"); };
$("#ya-tengo").onclick = e => { e.preventDefault(); abrirAuth("entrar"); };
$("#ver-altar").onclick = () => ver("altar");
$("#r-cerrar").onclick = () => ver("altar");
$("#a-cancelar").onclick = () => ver("altar");

function verReglas() {
  const acepto = ls.get("acuerdo") === "si" || !!S.user;
  $("#r-acepto").hidden = acepto;
  $("#r-volver").hidden = !acepto;
  ver("bienvenida");
  scrollTo(0, 0);
}

function abrirAuth(modo) {
  S.modo = modo;
  const admin = modo === "admin", reg = modo === "registro";
  $("#auth-titulo").textContent = admin ? "Acceso de administrador" : reg ? "Crea tu perfil" : "Entrar";
  $("#lbl-nombre").textContent = admin ? "Correo" : "Tu nombre";
  $("#lbl-pin").textContent = admin ? "Clave" : "PIN de 6 dígitos";
  $("#a-enviar").textContent = reg ? "Crear perfil" : "Entrar";
  $("#a-error").textContent = "";
  $("#form-auth").reset();
  const c = $("#a-cambiar");
  c.replaceChildren();
  if (!admin) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sec";
    b.textContent = reg ? "Ya tengo perfil: Entrar" : "Crear perfil nuevo";
    b.onclick = () => reg ? abrirAuth("entrar") : (ls.get("acuerdo") === "si" ? abrirAuth("registro") : verReglas());
    c.append(txt("sub", reg ? "¿Ya tienes perfil?" : "¿Aún no tienes perfil?"), b);
  }
  ver("auth");
}

$("#form-auth").onsubmit = async e => {
  e.preventDefault();
  const nombre = $("#a-nombre").value.trim(), pin = $("#a-pin").value;
  const err = t => $("#a-error").textContent = t;
  let r, email = nombre;
  if (S.modo !== "admin") {
    if (!/^\d{6}$/.test(pin)) return err("El PIN debe tener exactamente 6 dígitos.");
    const k = clave(nombre);
    if (!k || nombre.length > CONFIG.NOMBRE_MAX) return err("Escribe un nombre de hasta " + CONFIG.NOMBRE_MAX + " caracteres.");
    email = k + "@" + CONFIG.EMAIL_DOMAIN;
  }
  $("#a-enviar").disabled = true;
  try {
    if (S.modo === "registro") {
      r = await sb.auth.signUp({ email, password: pin, options: { data: { nombre } } });
      if (!r.error && !r.data.session) r = await sb.auth.signInWithPassword({ email, password: pin });
    } else {
      r = await sb.auth.signInWithPassword({ email, password: pin });
    }
    if (r.error) return err(msjError(r.error));
    await setUser(r.data.user);
    await cargar();
    ver("altar");
  } finally { $("#a-enviar").disabled = false; }
};

// ===== Altar =====
const ANCHOS_EXTRA = 14; // px extra de ancho por cada nivel desde el cuarto
const COLORES_TELA = ["#6b2fa0", "#f58220", "#d9381e", "#2147c4"];
const svgURL = (w, h, cuerpo) => 'url("data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${cuerpo}</svg>`) + '")';

function fondoTela(i) {
  if (CONFIG.IMG_TELAS[i]) return `url("${CONFIG.IMG_TELAS[i]}")`;
  let p = "";
  for (let a = 0; a < 360; a += 60) p += `<ellipse cx='40' cy='17' rx='3.6' ry='7.5' transform='rotate(${a} 40 28)'/>`;
  const puntos = [8, 72].map(x => [12, 46].map(y => `<circle cx='${x}' cy='${y}' r='2.2'/>`).join("")).join("");
  const festón = [10, 30, 50, 70].map(x => `<circle cx='${x}' cy='64' r='9'/>`).join("");
  return svgURL(80, 64, `<rect width='80' height='64' fill='${COLORES_TELA[i]}'/><g fill='#1b1240' opacity='.85'><circle cx='40' cy='28' r='4'/>${p}${puntos}${festón}</g>`);
}

function guirnaldaSVG() {
  const cs = ["#d9381e", "#2147c4", "#f58220", "#f8c630"];
  const b = cs.map((c, i) => `<path d='M${i * 60 + 4} 8h52v30${"l-6.5 8l-6.5-8".repeat(4)}z' fill='${c}'/><circle cx='${i * 60 + 30}' cy='22' r='6' fill='#1b1240'/>`).join("");
  return svgURL(240, 50, `<path d='M0 5h240' stroke='#aaa' stroke-width='1.5'/>` + b);
}

function decorar() {
  const url = u => `url("${u}")`;
  $("#guirnalda").style.backgroundImage = CONFIG.IMG_GUIRNALDA ? url(CONFIG.IMG_GUIRNALDA) : guirnaldaSVG();
  if (CONFIG.IMG_FONDO) $("#fondo").style.backgroundImage = url(CONFIG.IMG_FONDO);
  if (CONFIG.IMG_FLORES) document.querySelectorAll(".flores").forEach(e => e.style.backgroundImage = url(CONFIG.IMG_FLORES));
  document.body.classList.toggle("fase-velas", S.fase === "velas");
  if (!matchMedia("(prefers-reduced-motion:reduce)").matches) {
    let t = 0;
    addEventListener("scroll", () => {
      if (!t) t = requestAnimationFrame(() => { document.documentElement.style.setProperty("--sy", scrollY); t = 0; });
    }, { passive: true });
  }
}

function vela() {
  const v = document.createElement("span");
  v.className = "vela";
  if (CONFIG.IMG_VELA) {
    const i = new Image();
    i.src = CONFIG.IMG_VELA; i.alt = "vela";
    v.append(i);
  } else v.classList.add("css");
  const l = document.createElement("i");
  l.className = "llama";
  l.style.setProperty("--d", (Math.random() * 1.7).toFixed(2) + "s");
  v.append(l);
  return v;
}

function icono(tipo) {
  if (tipo === "vela") return vela();
  const src = CONFIG["IMG_" + tipo.toUpperCase()];
  if (!src) return txt("emo", TIPOS[tipo].icono);
  const i = new Image();
  i.src = src; i.alt = TIPOS[tipo].nombre; i.className = "ic";
  return i;
}

function tarjeta(f) {
  const t = document.createElement("button");
  t.className = "tarjeta";
  t.style.setProperty("--n", f.ofrendas.filter(o => o.tipo === "vela").length);
  t.append(marco(f), repisa(f), txt("nombre", f.nombre_honrado), txt("quien", corto(f.perfiles?.nombre || "")));
  t.onclick = () => abrirFicha(f);
  return t;
}

async function cargar() {
  const { data } = await sb.from("fotos")
    .select("*, perfiles(nombre), ofrendas(*, perfiles(nombre))").order("creado_en");
  S.fotos = data || [];
  S.mias = S.fotos.flatMap(f => f.ofrendas.filter(o => o.user_id === S.user?.id));
  const g = $("#niveles");
  g.replaceChildren();
  $("#vacio").hidden = S.fotos.length > 0;
  for (let i = 0, k = 0; i < S.fotos.length; k++) {   // niveles de 1, 2, 3 y luego de 3 en 3
    const fila = S.fotos.slice(i, i + Math.min(k + 1, 3));
    i += fila.length;
    const nivel = document.createElement("div");
    nivel.className = "nivel";
    nivel.style.setProperty("--c", Math.min(k + 1, 3));
    nivel.style.setProperty("--ex", Math.min(Math.max(k - 2, 0), 4) * ANCHOS_EXTRA + "px");
    const fl = document.createElement("div");
    fl.className = "fila";
    fila.forEach(f => fl.append(tarjeta(f)));
    const tela = document.createElement("div");
    tela.className = "tela";
    tela.style.backgroundImage = fondoTela(k % 4);
    if (CONFIG.IMG_TELAS[k % 4]) tela.style.backgroundSize = "auto 100%";
    nivel.append(fl, tela);
    g.append(nivel);
  }
  const mias = S.fotos.filter(f => f.user_id === S.user?.id).length;
  const quedan = CONFIG.MAX_FOTOS - mias;
  const b = $("#b-agregar");
  b.hidden = !S.user || !(esAdmin() || (S.fase === "edicion" && quedan > 0));
  b.textContent = esAdmin() ? "Agregar foto" : "Agregar foto (" + quedan + ")";
  reserva();
}

function repisa(f) {
  const r = document.createElement("span");
  r.className = "repisa";
  for (const tipo of Object.keys(TIPOS)) {
    const n = f.ofrendas.filter(o => o.tipo === tipo).length;
    if (!n) continue;
    const g = document.createElement("span");
    g.className = "of";
    if (tipo === "vela") {                       // hasta 3 velas; el resto como +N
      for (let i = 0; i < Math.min(n, 3); i++) g.append(icono(tipo));
      if (n > 3) g.append(txt("mas", "+" + (n - 3)));
    } else {
      g.append(icono(tipo));
      if (n > 1) g.append(txt("mas", "+" + (n - 1)));
    }
    r.append(g);
  }
  return r;
}

function reserva() {
  const r = $("#reserva");
  r.replaceChildren();
  if (!S.user) return;
  r.append(txt("sub", "Tus ofrendas disponibles:"));
  for (const tipo of Object.keys(TIPOS)) {
    const s = document.createElement("span");
    s.className = "of" + (S.mias.some(o => o.tipo === tipo) ? " usada" : "");
    s.title = TIPOS[tipo].nombre;
    s.append(icono(tipo));
    r.append(s);
  }
}


function txt(clase, t) {
  const s = document.createElement("span");
  s.className = clase;
  s.textContent = t;
  return s;
}
function aplicarMarco(el, n) {
  el.className = "marco m" + n;
  const u = CONFIG.IMG_MARCOS[n - 1];
  el.classList.toggle("conimg", !!u);
  if (u) el.style.setProperty("--mi", `url("${u}")`);
}

function marco(f) {
  const m = document.createElement("span");
  aplicarMarco(m, f.marco);
  const i = document.createElement("img");
  i.src = publicUrl(f.ruta_imagen);
  i.alt = "Foto de " + f.nombre_honrado;
  i.loading = "lazy";
  m.append(i);
  return m;
}

function abrirFicha(f, abierto = false) {
  const d = $("#ficha");
  const m = marco(f);
  m.onclick = () => abrirZoom(publicUrl(f.ruta_imagen));
  d.replaceChildren(m, txt("sub", "Toca la foto para ampliarla"), txt("nombre", f.nombre_honrado));
  if (f.mensaje) d.append(txt("msj", "“" + f.mensaje + "”"));
  d.append(txt("quien", "Compartida por " + (f.perfiles?.nombre || "")), txt("sec-t", "Ofrendas"),
    listaOfrendas(f), zonaParticipar(f, abierto));
  if (puedeEditar(f)) {
    const o = document.createElement("details");
    o.className = "opc";
    const s = document.createElement("summary");
    s.textContent = esAdmin() && f.user_id !== S.user.id ? "Opciones de administrador" : "Opciones de mi foto";
    const bs = document.createElement("div");
    bs.className = "botones";
    const e = document.createElement("button");
    e.textContent = "Editar foto";
    e.onclick = () => { d.close(); abrirForm(f); };
    const x = document.createElement("button");
    x.textContent = "Borrar foto";
    x.onclick = () => borrar(f);
    bs.append(e, x);
    o.append(s, bs);
    d.append(o);
  }
  const c = document.createElement("button");
  c.textContent = "Cerrar";
  c.onclick = () => d.close();
  d.append(c);
  if (!d.open) d.showModal();
}

function zonaParticipar(f, abierto) {
  const z = document.createElement("div");
  z.className = "participar";
  if (!S.user) { z.append(txt("sub", "Entra con tu perfil para dejar una ofrenda aquí.")); return z; }
  if (!puedeOfrendar()) return z;
  const cuatro = document.createElement("div");
  cuatro.className = "cuatro";
  cuatro.hidden = !abierto;
  const bt = document.createElement("button");
  bt.className = "primario";
  bt.textContent = "Dejar una ofrenda aquí";
  bt.onclick = () => { cuatro.hidden = !cuatro.hidden; };
  for (const [tipo, t] of Object.entries(TIPOS)) {
    const mia = S.mias.find(o => o.tipo === tipo);
    const c = document.createElement("div");
    const b = document.createElement("button");
    c.className = "ofc " + (!mia ? "libre" : mia.foto_id === f.id ? "aqui" : "otra");
    c.append(icono(tipo), txt("ofn", t.nombre));
    if (!mia) {
      c.append(txt("est", "Disponible"));
      b.textContent = "Dejar aquí"; b.className = "primario";
      b.onclick = () => formOfrenda(f, tipo, null);
    } else if (mia.foto_id === f.id) {
      c.append(txt("est", "✔ Ya la dejaste aquí"));
      b.textContent = "Editar mensaje";
      b.onclick = () => formOfrenda(f, tipo, mia);
    } else {
      const otra = S.fotos.find(x => x.id === mia.foto_id);
      c.append(txt("est", "Ya la dejaste en la foto de " + (otra?.nombre_honrado || "otra persona")));
      b.textContent = "Traerla aquí";
      b.onclick = () => mover(mia, f);
    }
    c.append(b);
    cuatro.append(c);
  }
  z.append(bt, cuatro);
  return z;
}

function listaOfrendas(f) {
  const box = document.createElement("div");
  box.className = "ofrendas";
  if (!f.ofrendas.length) box.append(txt("sub", "Aún no hay ofrendas en esta foto."));
  for (const o of f.ofrendas) {
    const propia = o.user_id === S.user?.id;
    const fila = document.createElement("div");
    fila.className = "fila" + (propia ? " propia" : "");
    const cuerpo = document.createElement("div");
    cuerpo.append(txt("quien2", (o.perfiles?.nombre || "") + (propia ? " (Tú)" : "")));
    if (o.mensaje) cuerpo.append(txt("msj", "“" + o.mensaje + "”"));
    const ic = txt("ico", ""); ic.append(icono(o.tipo));
    fila.append(ic, cuerpo);
    if (propia && puedeOfrendar()) {
      const e = document.createElement("button");
      e.textContent = "Editar";
      e.onclick = () => formOfrenda(f, o.tipo, o);
      fila.append(e);
    }
    if ((propia && puedeOfrendar()) || esAdmin()) {
      const x = document.createElement("button");
      x.textContent = "Quitar";
      x.onclick = () => quitarOfrenda(o, f);
      fila.append(x);
    }
    box.append(fila);
  }
  return box;
}



function formOfrenda(f, tipo, o) {
  const form = document.createElement("form");
  const l = document.createElement("label");
  l.textContent = TIPOS[tipo].icono + " " + TIPOS[tipo].nombre + " para " + f.nombre_honrado + ". Tu mensaje (opcional)";
  const ta = document.createElement("textarea");
  ta.maxLength = 120; ta.rows = 3; ta.value = o?.mensaje || "";
  l.append(ta);
  const err = txt("error", "");
  const bs = document.createElement("div");
  bs.className = "botones";
  const ok = document.createElement("button");
  ok.className = "primario"; ok.textContent = "Guardar";
  const no = document.createElement("button");
  no.type = "button"; no.textContent = "Volver"; no.onclick = () => abrirFicha(f, true);
  bs.append(ok, no);
  form.append(l, err, bs);
  form.onsubmit = async e => {
    e.preventDefault();
    ok.disabled = true;
    const mensaje = ta.value.trim() || null;
    const r = o
      ? await sb.from("ofrendas").update({ mensaje }).eq("id", o.id).select()
      : await sb.from("ofrendas").insert({ foto_id: f.id, tipo, mensaje }).select();
    ok.disabled = false;
    if (r.error || !r.data.length) { err.textContent = r.error ? msjError(r.error) : "Ya no se puede hacer este cambio."; return; }
    await refrescar(f);
  };
  $("#ficha").replaceChildren(form);
}

async function mover(o, f) {
  const { data, error } = await sb.from("ofrendas").update({ foto_id: f.id }).eq("id", o.id).select();
  if (error || !data.length) return alert(error ? msjError(error) : "Ya no se puede hacer este cambio.");
  await refrescar(f);
}

async function quitarOfrenda(o, f) {
  if (!confirm("¿Quitar esta ofrenda?")) return;
  const { data, error } = await sb.from("ofrendas").delete().eq("id", o.id).select();
  if (error || !data.length) return alert(error ? msjError(error) : "Ya no se puede quitar.");
  await refrescar(f);
}

async function refrescar(f) {
  await cargar();
  const nueva = S.fotos.find(x => x.id === f.id);
  if (nueva) abrirFicha(nueva, true); else $("#ficha").close();
}

// ===== Agregar, editar y borrar fotos =====
$("#b-agregar").onclick = () => abrirForm(null);
$("#f-cancelar").onclick = () => $("#f-foto").close();

function abrirForm(f) {
  S.editando = f; S.enc = null;
  const form = $("#form-foto"), img = $("#visor-img");
  form.reset();
  $("#f-titulo").textContent = f ? "Editar foto" : "Agregar foto";
  $("#f-archivo").hidden = !!f;
  $("#f-previa").hidden = !f;
  $("#f-zoomlbl").hidden = !!f;
  $("#f-ayuda").hidden = !!f;
  $("#f-error").textContent = "";
  img.removeAttribute("style");
  img.removeAttribute("src");
  if (f) {
    form.honrado.value = f.nombre_honrado;
    form.mensaje.value = f.mensaje || "";
    form.marco.value = String(f.marco);
    img.src = publicUrl(f.ruta_imagen);
    img.style.cssText = "width:100%;height:100%;left:0;top:0;object-fit:cover";
  }
 aplicarMarco($("#f-marco"), f ? f.marco : 1);
  $("#f-foto").showModal();
}

async function cargarBase(file) {          // foto ya girada y reducida, para encuadrar
  const img = await leerImagen(file);
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const k = Math.min(1, 1600 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}

async function elegirArchivo(file) {
  $("#f-error").textContent = "";
  try {
    const base = await cargarBase(file);
    const blob = await new Promise(r => base.toBlob(r, "image/jpeg", .9));
    const img = $("#visor-img");
    img.removeAttribute("style");
    img.src = URL.createObjectURL(blob);
    await img.decode();
    S.enc = { base };
    $("#f-previa").hidden = false;
    $("#f-zoom").value = 1;
    const v = $("#visor");
    Object.assign(S.enc, { W: v.clientWidth, H: v.clientHeight, z: 1 });
    S.enc.s0 = Math.max(S.enc.W / base.width, S.enc.H / base.height);
    S.enc.ox = (S.enc.W - base.width * S.enc.s0) / 2;
    S.enc.oy = (S.enc.H - base.height * S.enc.s0) * .3;   // un poco hacia arriba, donde suelen estar las caras
    pintar();
  } catch { $("#f-error").textContent = "No se pudo leer esta imagen. Prueba con una foto en JPG o PNG."; }
}

function pintar() {
  const e = S.enc, s = e.s0 * e.z, iw = e.base.width * s, ih = e.base.height * s;
  e.ox = Math.min(0, Math.max(e.W - iw, e.ox));
  e.oy = Math.min(0, Math.max(e.H - ih, e.oy));
  const i = $("#visor-img");
  i.style.width = iw + "px"; i.style.height = ih + "px";
  i.style.left = e.ox + "px"; i.style.top = e.oy + "px";
}

$("#f-zoom").oninput = ev => {
  const e = S.enc;
  if (!e) return;
  const cx = (e.W / 2 - e.ox) / (e.s0 * e.z), cy = (e.H / 2 - e.oy) / (e.s0 * e.z);   // centro, para acercar sin moverlo
  e.z = +ev.target.value;
  e.ox = e.W / 2 - cx * e.s0 * e.z;
  e.oy = e.H / 2 - cy * e.s0 * e.z;
  pintar();
};

(() => {
  const v = $("#visor");
  let p = null;
  v.onpointerdown = ev => { if (!S.enc) return; p = { x: ev.clientX, y: ev.clientY, ox: S.enc.ox, oy: S.enc.oy }; v.setPointerCapture(ev.pointerId); v.style.cursor = "grabbing"; };
  v.onpointermove = ev => { if (!p) return; S.enc.ox = p.ox + ev.clientX - p.x; S.enc.oy = p.oy + ev.clientY - p.y; pintar(); };
  v.onpointerup = v.onpointercancel = () => { p = null; v.style.cursor = "grab"; };
})();

$("#form-foto").addEventListener("change", ev => {
  if (ev.target.name === "marco") $aplicarMarco($("#f-marco"), ev.target.value);
  if (ev.target.name === "archivo" && ev.target.files[0]) elegirArchivo(ev.target.files[0]);
});

async function recortar() {                 // lo que se ve en el visor, a 900×1200
  const e = S.enc, s = e.s0 * e.z;
  const c = document.createElement("canvas");
  c.width = 900; c.height = 1200;
  c.getContext("2d").drawImage(e.base, -e.ox / s, -e.oy / s, e.W / s, e.H / s, 0, 0, 900, 1200);
  let q = .88, b;
  do { b = await new Promise(r => c.toBlob(r, "image/jpeg", q)); q -= .08; } while (b.size > 350000 && q > .4);
  return b;
}

$("#form-foto").onsubmit = async e => {
  e.preventDefault();
  const form = e.target, err = t => $("#f-error").textContent = t;
  const campos = { nombre_honrado: form.honrado.value.trim(), mensaje: form.mensaje.value.trim() || null, marco: +form.marco.value };
  $("#f-guardar").disabled = true;
  try {
    if (S.editando) {
      const { data, error } = await sb.from("fotos").update(campos).eq("id", S.editando.id).select();
      if (error) throw error;
      if (!data.length) throw new Error("Ya no se puede hacer este cambio.");
    } else {
      if (!S.enc) return err("Elige una foto.");
      const blob = await recortar();
      const ruta = S.user.id + "/" + uuid() + ".jpg";
      const up = await sb.storage.from(CONFIG.BUCKET).upload(ruta, blob, { contentType: "image/jpeg" });
      if (up.error) throw up.error;
      const { error } = await sb.from("fotos").insert({ ...campos, ruta_imagen: ruta });
      if (error) { await sb.storage.from(CONFIG.BUCKET).remove([ruta]); throw error; }
    }
    $("#f-foto").close();
    await cargar();
  } catch (x) { err(msjError(x)); }
  finally { $("#f-guardar").disabled = false; }
};

async function leerImagen(file) {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch {}
  try { return await createImageBitmap(file); } catch {}
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 10000); }
}



async function borrar(f) {
  if (!confirm("¿Borrar esta foto y sus ofrendas?")) return;
  const { data, error } = await sb.from("fotos").delete().eq("id", f.id).select();
  if (error || !data.length) return alert(error ? msjError(error) : "Ya no se puede borrar esta foto.");
  await sb.storage.from(CONFIG.BUCKET).remove([f.ruta_imagen]);
  $("#ficha").close();
  await cargar();
}
function abrirZoom(src) {
  const d = $("#zoom"), i = $("#zi"), v = $("#zv"), MAX = CONFIG.ZOOM_MAX;
  const z = { s: 1, x: 0, y: 0 }, ptr = new Map();
  let d0 = 0, s0 = 1, ult = 0;
  const poner = () => {
    const mx = (z.s - 1) * i.clientWidth / 2, my = (z.s - 1) * i.clientHeight / 2;
    z.x = Math.max(-mx, Math.min(mx, z.x)); z.y = Math.max(-my, Math.min(my, z.y));
    i.style.transform = `translate(${z.x}px,${z.y}px) scale(${z.s})`;
  };
  const dist = () => { const [a, b] = [...ptr.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  i.src = src;
  i.style.transform = "";
  d.showModal();
  v.onpointerdown = e => {
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    v.setPointerCapture(e.pointerId);
    if (ptr.size === 2) { d0 = dist(); s0 = z.s; }
  };
  v.onpointermove = e => {
    const p = ptr.get(e.pointerId);
    if (!p) return;
    if (ptr.size === 2) {
      ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
      z.s = Math.min(MAX, Math.max(1, s0 * dist() / d0));
    } else {
      z.x += e.clientX - p.x; z.y += e.clientY - p.y;
      ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    poner();
  };
  v.onpointerup = v.onpointercancel = e => {
    ptr.delete(e.pointerId);
    if (e.type === "pointerup" && !ptr.size) {          // doble toque: 1× ↔ 2×
      const t = Date.now();
      if (t - ult < 300) { z.s = z.s > 1 ? 1 : Math.min(2, MAX); z.x = z.y = 0; poner(); }
      ult = t;
    }
  };
  v.onwheel = e => { e.preventDefault(); z.s = Math.min(MAX, Math.max(1, z.s - e.deltaY * .002)); poner(); };
}
$("#zc").onclick = () => $("#zoom").close();

init();


