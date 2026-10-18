// ===== CONFIG =====
const CONFIG = {
  SUPABASE_URL: "https://soxneojhqbslioivsqcy.supabase.co", // EDITAR (sin /rest/v1/)
  SUPABASE_KEY: "sb_publishable_vHsONeA2xXzhEbuUAPwDIg_1AILLSIR", // EDITAR (llave pública)
  EMAIL_DOMAIN: "example.com", // EDITAR: dominio del correo interno de los usuarios
  BUCKET: "fotos",
  MAX_FOTOS: 3,
  NOMBRE_MAX: 20,
  CORTO_MAX: 15,
  MOSTRAR_DEBUG: false, // EDITAR: ponlo en false al terminar las pruebas
  IMG_VELA: "vela.png", IMG_FLOR: "flor.png", IMG_PAN: "pan.png", IMG_CALAVERA: "calaverita.png", // EDITAR
  IMG_FONDO: "fondo.webp", IMG_FLORES: "", IMG_GUIRNALDA: "guirnalda.png",          // EDITAR
  IMG_TELAS: ["", "", "", ""],// EDITAR (opcional): tiras repetibles de tela, magenta/naranja/morado
  IMG_MARCOS: ["marco 1.png", "marco 2.png", "marco 3.png", "marco 4.png"], // EDITAR: PNG de cada marco (madera, dorado, talavera, cempasúchil)
  MARCO_HUECO: 8,               // % de margen entre el borde del marco y la foto (ver medidas abajo)
  ZOOM_MAX: 2.2,
    PISTAS: ["audio/pista1.mp3", "audio/pista2.mp3", "audio/pista3.mp3"], // EDITAR: tus 3 pistas ("" para desactivar)
  VOLUMEN: 0.5,
  ADMIN_FUNCTION: "quick-handler", // Nombre de la Edge Function en Supabase
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

function msjError(err) {
  if (!err) return "Ocurrió un error inesperado.";
  const m = (typeof err === "string" ? err : err.message || err.error_description || "").toLowerCase();
  if (m.includes("invalid login credentials") || m.includes("invalid_grant")) {
    return "Contraseña o PIN incorrecto. Por favor verifica tus datos.";
  }
  if (m.includes("user already registered") || m.includes("already exists")) {
    return "Ya existe una cuenta con este nombre. Selecciona 'Entrar'.";
  }
  if (m.includes("password should be at least")) {
    return "El PIN debe tener al menos 6 dígitos.";
  }
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network")) {
    return "Error de conexión. Revisa tu internet e inténtalo de nuevo.";
  }
  if (m.includes("rate limit") || m.includes("too many requests") || m.includes("over_email_send_rate_limit")) {
    return "Demasiados intentos seguidos. Por favor espera unos minutos antes de intentar de nuevo.";
  }
  if (m.includes("storage") || m.includes("payload too large")) {
    return "La imagen es demasiado pesada. Elige otra foto más ligera.";
  }
  return typeof err === "string" ? err : err.message || "No se pudo completar la operación.";
}

function determinarFase(data) {
  if (new URLSearchParams(location.search).has("velas")) return "velas";
  if (data?.fase) {
    if (data.fase === "velas") return "velas";
    if (data.fase === "cerrado") return "cerrado";
  }
  try {
    const ahora = data?.ahora ? new Date(data.ahora) : new Date();
    const strMx = ahora.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }); // YYYY-MM-DD
    const [y, m, d] = strMx.split("-").map(Number);
    // 31 de Octubre a 6 de Noviembre: fase de velas
    if ((m === 10 && d >= 31) || (m === 11 && d <= 6)) return "velas";
    if ((m === 11 && d > 6) || m > 11) return "cerrado";
  } catch {}
  return data?.fase || "edicion";
}

const uuid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
};

function ver(id) {
  document.body.dataset.vista = id;
  document.querySelectorAll("main > section").forEach(s => s.hidden = s.id !== id);
  if (typeof actualizarEstadoPetalos === "function") actualizarEstadoPetalos();
}

// === DECLARACIÓN GLOBAL DE err AQUÍ ===
const err = t => {
  const el = $("#a-error");
  if (!el) return;
  el.textContent = t;
  if (t) {
    el.hidden = false; // Muestra el cuadro y el triángulo de precaución solo si hay texto
    el.classList.remove("shake");
    void el.offsetWidth;
    el.classList.add("shake");
  } else {
    el.hidden = true;  // Lo oculta completamente si está vacío
  }
};

// ===== Inicio =====
async function init() {
  document.documentElement.style.setProperty("--hueco", CONFIG.MARCO_HUECO + "%");
  let estadoData = null;
  try {
    const { data } = await sb.rpc("estado_altar");
    estadoData = data;
  } catch {}
  S.fase = determinarFase(estadoData);
  decorar();
  iniciarPetalosCempasuchil();
  const { data: { session } } = await sb.auth.getSession();
  await setUser(session?.user);
  await cargar();
  pintarAviso(estadoData);
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
    b.append(txt("", esAdmin() ? "Admin" : "Hola, " + (S.perfil?.nombre || "")), boton("Reglas", verReglas),
      boton("Salir", async () => { await sb.auth.signOut(); await setUser(null); await cargar(); ver("altar"); }));
    if (esAdmin()) b.insertBefore(boton("Panel", abrirPanel), b.lastChild);

  } else if (S.fase !== "cerrado") {
    b.append(boton("Reglas", verReglas), boton("Entrar", () => abrirAuth("entrar")));
  }
}

function pintarAviso(e) {
  const a = $("#aviso");
  if (!e) return;
  const mx = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  const dias = f => Math.round((Date.parse(mx(f)) - Date.parse(mx(e.ahora))) / 864e5);
  const fecha = f => new Date(f).toLocaleDateString("es-MX", { day: "numeric", month: "long", timeZone: "America/Mexico_City" });
  let t = "", s = "";
  if (e.fase === "edicion") {
    const n = dias(e.cierre_fotos);
    t = (n <= 0 ? "Hoy es el último día" : n === 1 ? "Mañana es el último día" : "Quedan " + n + " días") + " para subir tus fotos";
    s = "Hasta el " + fecha(e.cierre_fotos) + " a las 11:59 p. m. · El " + fecha(Date.parse(e.cierre_fotos) + 864e5) + " se encienden las velas";
  } else if (e.fase === "velas") {
    const n = dias(e.fin_velas);
    t = "🕯️ Las velas están encendidas";
    s = "Hasta el " + fecha(e.fin_velas) + " · " + (n <= 0 ? "hoy es el último día" : n === 1 ? "mañana es el último día" : "quedan " + n + " días") + " para dejar ofrendas";
  } else {
    t = "Gracias por participar";
    s = "El altar descansa hasta el próximo año";
  }
  const b = document.createElement("b"), sm = document.createElement("small");
  b.textContent = t; sm.textContent = s;
  a.replaceChildren(b, sm);
  a.hidden = false;
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
  $("#lbl-nombre").textContent = admin ? "Correo electrónico" : "Tu nombre";
  $("#lbl-pin").textContent = admin ? "Clave" : "PIN de 6 dígitos";
  $("#a-enviar").textContent = reg ? "Crear perfil" : "Entrar";
  err(""); // Esto limpia el texto y aplica hidden = true automáticamente
  $("#form-auth").reset();

  const nombreInp = $("#a-nombre");
  const pinInp = $("#a-pin");
  nombreInp.maxLength = admin ? 60 : CONFIG.NOMBRE_MAX;
  nombreInp.placeholder = admin ? "admin@ejemplo.com" : "Ej. Juan Carlos";
  pinInp.maxLength = admin ? 40 : 6;
  pinInp.placeholder = admin ? "Tu clave" : "6 dígitos numéricos";

  // Contador de caracteres para nombre
  const contNom = $("#a-nombre-cont");
  if (contNom) {
    const actCont = () => {
      if (admin) {
        contNom.textContent = "";
      } else {
        const act = nombreInp.value.length;
        const max = CONFIG.NOMBRE_MAX;
        const quedan = max - act;
        contNom.textContent = quedan <= 5 ? `Te quedan ${quedan} de ${max} caracteres` : `${act}/${max} caracteres`;
        contNom.classList.toggle("poco", quedan <= 5);
      }
    };
    nombreInp.oninput = actCont;
    actCont();
  }

  

  // Contador o ayuda para PIN
  const contPin = $("#a-pin-cont");
  if (contPin) {
    const actPin = () => {
      if (admin) {
        contPin.textContent = "";
      } else {
        const n = pinInp.value.length;
        contPin.textContent = n === 6 ? "✓ 6 dígitos" : `${n}/6 dígitos`;
        contPin.classList.toggle("poco", n > 0 && n < 6);
      }
    };
    pinInp.oninput = actPin;
    actPin();
  }

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
  const nombreInput = $("#a-nombre");
  const pinInput = $("#a-pin");
  const nombre = nombreInput.value.trim();
  const pin = pinInput.value.trim();
  
  err("");

  if (S.modo === "admin") {
    if (!nombre || !nombre.includes("@")) {
      return err("Por favor escribe un correo de administrador válido.");
    }
    if (!pin) {
      return err("Por favor escribe la clave de administrador.");
    }
    $("#a-enviar").disabled = true;
    try {
      const r = await sb.auth.signInWithPassword({ email: nombre, password: pin });
      if (r.error || !r.data?.user) {
        return err("Correo o clave de administrador incorrectos.");
      }
      await setUser(r.data.user);
      await cargar();
      ver("altar");
    } catch (x) {
      err(msjError(x));
    } finally {
      $("#a-enviar").disabled = false;
    }
    return;
  }

  // --- MODO USUARIO NORMAL ---
  // 1. Validaciones del nombre
  if (!nombre) {
    return err("Por favor escribe tu nombre.");
  }
  if (nombre.length > CONFIG.NOMBRE_MAX) {
    return err(`El nombre de usuario es demasiado largo (máximo ${CONFIG.NOMBRE_MAX} caracteres; has escrito ${nombre.length}).`);
  }
  if (nombre.length < 2) {
    return err("El nombre de usuario debe tener al menos 2 caracteres.");
  }
  const k = clave(nombre);
  if (!k) {
    return err("El nombre debe contener al menos letras o números válidos.");
  }

  // 2. Validaciones del PIN
  if (!pin) {
    return err("Por favor escribe tu PIN de 6 dígitos.");
  }
  if (!/^\d+$/.test(pin)) {
    return err("El PIN solo debe contener números del 0 al 9 (sin letras ni símbolos).");
  }
  if (pin.length !== 6) {
    return err(`El PIN debe tener exactamente 6 dígitos (has ingresado ${pin.length}).`);
  }

  const email = k + "@" + CONFIG.EMAIL_DOMAIN;
  $("#a-enviar").disabled = true;

  try {
    // Buscar perfiles en la base de datos
    const { data: perfiles, error: errPerfiles } = await sb
      .from("perfiles")
      .select("id, nombre");

    const perfilEncontrado = perfiles?.find(p =>
      clave(p.nombre) === k || p.nombre.trim().toLowerCase() === nombre.toLowerCase()
    );

    if (S.modo === "entrar") {
      // 1. Error si la cuenta o perfil no está en la base de datos
      if (!perfilEncontrado) {
        return err("Este perfil o cuenta no existe en el altar. Verifica cómo escribiste tu nombre o selecciona 'Crear perfil nuevo'.");
      }

      // 2. El perfil sí existe en la base de datos: intentamos autenticar
      const r = await sb.auth.signInWithPassword({ email, password: pin });
      if (r.error) {
        const msg = (r.error.message || "").toLowerCase();
        // Si las credenciales fallaron habiendo verificado que existe el usuario, fue la contraseña/PIN
        if (msg.includes("invalid login credentials") || msg.includes("invalid_grant")) {
          return err("Contraseña o PIN incorrecto. Por favor verifica tus 6 dígitos.");
        }
        return err(msjError(r.error));
      }
      if (!r.data?.user) {
        return err("No se pudo iniciar sesión. Verifica tu nombre y tu PIN.");
      }
      await setUser(r.data.user);
      await cargar();
      ver("altar");

    } else if (S.modo === "registro") {
      // Si el perfil ya existe al intentar registrarse
      if (perfilEncontrado) {
        return err(`Ya existe una cuenta con el nombre '${perfilEncontrado.nombre}'. Si es tu cuenta, selecciona 'Entrar'.`);
      }

      let r = await sb.auth.signUp({ email, password: pin, options: { data: { nombre } } });
      if (r.error) {
        const msg = (r.error.message || "").toLowerCase();
        if (msg.includes("already registered") || msg.includes("already exists")) {
          return err("Ya existe una cuenta registrada con este nombre. Selecciona 'Ya tengo perfil, entrar'.");
        }
        return err(msjError(r.error));
      }
      if (!r.data.session) {
        r = await sb.auth.signInWithPassword({ email, password: pin });
      }
      if (r.error || !r.data?.user) {
        return err("Se creó el perfil, pero ocurrió un detalle al iniciar sesión. Prueba seleccionando 'Entrar' con tu PIN.");
      }
      await setUser(r.data.user);
      await cargar();
      ver("altar");
    }
  } catch (x) {
    err(msjError(x));
  } finally {
    $("#a-enviar").disabled = false;
  }
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

// ===== Pétalos de Cempasúchil (Ambiente de Día de Muertos) =====
const petalosAnim = {
  canvas: null,
  ctx: null,
  lista: [],
  activo: false,
  rafId: null,
  ultTiempo: 0
};

const COLORES_CEMPASUCHIL = [
  { brillo: "#ffe082", cuerpo: "#ff8f00", borde: "#e65100" }, // Marigold tradicional
  { brillo: "#ffecb3", cuerpo: "#ffa000", borde: "#ef6c00" }, // Dorado cálido
  { brillo: "#ffd54f", cuerpo: "#ff6f00", borde: "#d84315" }, // Naranja vivo
  { brillo: "#fff8e1", cuerpo: "#ffb300", borde: "#f57c00" }, // Flor de muerto amarilla
  { brillo: "#ffcc80", cuerpo: "#f4511e", borde: "#bf360c" }  // Tono ámbar rojizo
];

function crearPetalo(ancho, alto, inicial = false) {
  const col = COLORES_CEMPASUCHIL[Math.floor(Math.random() * COLORES_CEMPASUCHIL.length)];
  const tam = Math.floor(Math.random() * 8) + 11; // 11 a 19px
  return {
    x: Math.random() * ancho,
    y: inicial ? Math.random() * alto : -tam - Math.random() * 30,
    tam,
    vy: Math.random() * 0.7 + 0.65, // Caída serena y respetuosa
    sway: Math.random() * Math.PI * 2,
    swayVel: Math.random() * 0.02 + 0.015,
    swayAmp: Math.random() * 1.2 + 0.6,
    rot: Math.random() * Math.PI * 2,
    rotVel: (Math.random() - 0.5) * 0.03,
    flip: Math.random() * Math.PI * 2,
    flipVel: Math.random() * 0.035 + 0.02,
    opacidad: Math.random() * 0.25 + 0.75,
    colorBrillo: col.brillo,
    color: col.cuerpo,
    colorBorde: col.borde
  };
}

function iniciarPetalosCempasuchil() {
  const canvas = $("#canvas-petalos");
  if (!canvas) return;
  petalosAnim.canvas = canvas;
  petalosAnim.ctx = canvas.getContext("2d");

  const redimensionar = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  redimensionar();
  window.addEventListener("resize", redimensionar, { passive: true });
  actualizarEstadoPetalos();
}

function actualizarEstadoPetalos() {
  const debeEstarActivo =
    document.body.classList.contains("fase-velas") &&
    document.body.dataset.vista === "altar" &&
    !document.hidden &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (debeEstarActivo && !petalosAnim.activo) {
    petalosAnim.activo = true;
    const canvas = petalosAnim.canvas;
    if (!canvas) return;
    const ancho = canvas.width || window.innerWidth;
    const alto = canvas.height || window.innerHeight;
    const totalPetalos = window.innerWidth < 640 ? 18 : 30;
    if (petalosAnim.lista.length === 0) {
      for (let i = 0; i < totalPetalos; i++) {
        petalosAnim.lista.push(crearPetalo(ancho, alto, true));
      }
    }
    petalosAnim.ultTiempo = performance.now();
    petalosAnim.rafId = requestAnimationFrame(animarPetalos);
  } else if (!debeEstarActivo && petalosAnim.activo) {
    petalosAnim.activo = false;
    if (petalosAnim.rafId) {
      cancelAnimationFrame(petalosAnim.rafId);
      petalosAnim.rafId = null;
    }
    if (petalosAnim.ctx && petalosAnim.canvas) {
      petalosAnim.ctx.clearRect(0, 0, petalosAnim.canvas.width, petalosAnim.canvas.height);
    }
  }
}

function animarPetalos(tiempo) {
  if (!petalosAnim.activo) return;
  const ctx = petalosAnim.ctx;
  const canvas = petalosAnim.canvas;
  if (!ctx || !canvas) return;

  const ancho = canvas.width;
  const alto = canvas.height;
  ctx.clearRect(0, 0, ancho, alto);

  const delta = Math.min((tiempo - (petalosAnim.ultTiempo || tiempo)) / 16.67, 2.0);
  petalosAnim.ultTiempo = tiempo;

  for (let i = 0; i < petalosAnim.lista.length; i++) {
    const p = petalosAnim.lista[i];
    p.sway += p.swayVel * delta;
    p.x += Math.sin(p.sway) * p.swayAmp * delta;
    p.y += p.vy * delta;
    p.rot += p.rotVel * delta;
    p.flip += p.flipVel * delta;

    if (p.y > alto + p.tam + 10 || p.x < -40 || p.x > ancho + 40) {
      petalosAnim.lista[i] = crearPetalo(ancho, alto, false);
      continue;
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    const escalaX = Math.cos(p.flip);
    ctx.scale(escalaX, 1);
    ctx.globalAlpha = p.opacidad;

    const w = p.tam * 0.48;
    const h = p.tam;

    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.bezierCurveTo(w * 0.85, h * 0.15, w * 0.95, -h * 0.25, 0, -h * 0.5);
    ctx.bezierCurveTo(-w * 0.95, -h * 0.25, -w * 0.85, h * 0.15, 0, h * 0.5);
    ctx.closePath();

    const grad = ctx.createRadialGradient(0, -h * 0.1, 1, 0, 0, h * 0.65);
    grad.addColorStop(0, p.colorBrillo);
    grad.addColorStop(0.6, p.color);
    grad.addColorStop(1, p.colorBorde);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.restore();
  }

  petalosAnim.rafId = requestAnimationFrame(animarPetalos);
}

document.addEventListener("visibilitychange", () => {
  if (typeof actualizarEstadoPetalos === "function") actualizarEstadoPetalos();
});

function decorar() {
  const url = u => `url("${u}")`;
  $("#guirnalda").style.backgroundImage = CONFIG.IMG_GUIRNALDA ? url(CONFIG.IMG_GUIRNALDA) : guirnaldaSVG();
  if (CONFIG.IMG_FONDO) $("#fondo").style.backgroundImage = url(CONFIG.IMG_FONDO);
  if (CONFIG.IMG_FLORES) document.querySelectorAll(".flores").forEach(e => e.style.backgroundImage = url(CONFIG.IMG_FLORES));
  const esVelas = S.fase === "velas" || new URLSearchParams(location.search).has("velas");
  document.body.classList.toggle("fase-velas", esVelas);
  if (typeof actualizarEstadoPetalos === "function") actualizarEstadoPetalos();
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
    const s = document.createElement("span");
    s.className = "of ranura";
    if (n) {
      s.append(icono(tipo));
      if (n > 1) s.append(txt("mas", "+" + (n - 1)));
    }
    r.append(s);
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
    bt.textContent = abierto ? "Ocultar ofrendas" : "Dejar una ofrenda aquí";
  bt.onclick = () => {
    cuatro.hidden = !cuatro.hidden;
    bt.textContent = cuatro.hidden ? "Dejar una ofrenda aquí" : "Ocultar ofrendas";
  };
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
  contador(ta);
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
let urlBlobVisor = null;
function limpiarBlobVisor() {
  if (urlBlobVisor) {
    try { URL.revokeObjectURL(urlBlobVisor); } catch {}
    urlBlobVisor = null;
  }
}

$("#b-agregar").onclick = () => abrirForm(null);
$("#f-cancelar").onclick = () => {
  limpiarBlobVisor();
  $("#f-foto").close();
};

function abrirForm(f) {
  limpiarBlobVisor();
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
    S.conts?.forEach(a => a());
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
    const blob = await new Promise(r => base.toBlob(r, "image/jpeg", .88));
    const img = $("#visor-img");
    img.removeAttribute("style");
    limpiarBlobVisor();
    urlBlobVisor = URL.createObjectURL(blob);
    img.src = urlBlobVisor;
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
    sincMarco();
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
  if (ev.target.name === "marco") aplicarMarco($("#f-marco"), ev.target.value);
  if (ev.target.name === "archivo" && ev.target.files[0]) elegirArchivo(ev.target.files[0]);
});

const sincMarco = () => aplicarMarco($("#f-marco"), $("#form-foto").marco.value);
$("#form-foto").addEventListener("input", ev => { if (ev.target.name === "marco") sincMarco(); });

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
    limpiarBlobVisor();
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

   async function vigilarFase() {
     const { data } = await sb.rpc("estado_altar");
     if (data && data.fase !== S.fase) location.reload();
   }
   setInterval(vigilarFase, 300000);
   document.addEventListener("visibilitychange", () => { if (!document.hidden) vigilarFase(); });

// ===== Música y botón de regreso =====
const audio = $("#audio"), pistas = CONFIG.PISTAS.filter(Boolean);
let pista = 0, iniciada = false;
const contMusica = $("#cont-musica");
if (contMusica) contMusica.hidden = !pistas.length;
if (pistas.length <= 1) {
  if ($("#b-ant-pista")) $("#b-ant-pista").hidden = true;
  if ($("#b-sig-pista")) $("#b-sig-pista").hidden = true;
  if ($("#pista-num")) $("#pista-num").hidden = true;
}

function normalizarPista(n) {
  if (!pistas.length) return 0;
  return ((n % pistas.length) + pistas.length) % pistas.length;
}

function cargarPista() {
  if (!pistas.length) return;
  pista = normalizarPista(pista);
  audio.src = pistas[pista];
  const num = $("#pista-num");
  if (num) num.textContent = `${pista + 1}/${pistas.length}`;
}

function pintarMusica() {
  const b = $("#b-musica");
  const icono = $("#icono-musica");
  const barras = $("#barras-musica");
  const num = $("#pista-num");
  if (num && pistas.length) num.textContent = `${normalizarPista(pista) + 1}/${pistas.length}`;
  if (!b) return;

  const sonando = iniciada && !audio.paused && !audio.muted;

  if (!iniciada) {
    if (icono) { icono.hidden = false; icono.textContent = "🎵"; }
    if (barras) barras.hidden = true;
    b.setAttribute("aria-label", "Activar música");
  } else if (audio.muted) {
    if (icono) { icono.hidden = false; icono.textContent = "🔇"; }
    if (barras) barras.hidden = true;
    b.setAttribute("aria-label", "Activar sonido");
  } else if (audio.paused) {
    if (icono) { icono.hidden = false; icono.textContent = "🔇"; }
    if (barras) barras.hidden = true;
    b.setAttribute("aria-label", "Reanudar música");
  } else {
    // Reproduciendo con sonido: barras en movimiento
    if (icono) icono.hidden = true;
    if (barras) barras.hidden = false;
    b.setAttribute("aria-label", "Silenciar música");
  }
}

async function iniciarMusica() {
  if (iniciada || !pistas.length) return;
  try {
    cargarPista();
    audio.volume = CONFIG.VOLUMEN;
    await audio.play();
    iniciada = true;
    $("#b-musica")?.classList.remove("pulso");
    pintarMusica();
    ["pointerup", "keydown"].forEach(t => document.removeEventListener(t, alToque, true));
  } catch {}
}

async function saltarPista(delta) {
  if (!pistas.length) return;
  pista = normalizarPista(pista + delta);
  cargarPista();
  if (!iniciada) {
    await iniciarMusica();
  } else {
    try {
      await audio.play();
    } catch {}
    pintarMusica();
  }
}

function alToque(ev) {
  if (!ev.target.closest?.("#cont-musica, #b-musica")) iniciarMusica();
}
["pointerup", "keydown"].forEach(t => document.addEventListener(t, alToque, true));

audio.onended = () => {
  pista = normalizarPista(pista + 1);
  cargarPista();
  audio.play().catch(() => {});
  pintarMusica();
};
audio.onplay = pintarMusica;
audio.onpause = pintarMusica;
audio.onerror = () => {
  if (!iniciada || !pistas.length) return;
  setTimeout(() => {
    pista = normalizarPista(pista + 1);
    cargarPista();
    audio.play().catch(() => {});
    pintarMusica();
  }, 1000);
};

let tMin;
function despertarMusica() {
  contMusica.classList.remove("min");
  clearTimeout(tMin);
  tMin = setTimeout(() => contMusica.classList.add("min"), 4000);
}
$("#b-musica").onclick = () => {
  const estabaMin = contMusica.classList.contains("min");
  despertarMusica();
  if (!iniciada) return iniciarMusica();
  if (!estabaMin) { audio.muted = !audio.muted; pintarMusica(); }
};

const btnAnt = $("#b-ant-pista");
if (btnAnt) btnAnt.onclick = () => { despertarMusica(); saltarPista(-1); };

const btnSig = $("#b-sig-pista");
if (btnSig) btnSig.onclick = () => { despertarMusica(); saltarPista(1); };

document.addEventListener("visibilitychange", () => {
  if (!iniciada) return;
  if (document.hidden) audio.pause(); else audio.play().catch(() => {});
});

pintarMusica();

const arriba = $("#b-arriba");
let scrollTicking = false;
addEventListener("scroll", () => {
  if (!scrollTicking) {
    requestAnimationFrame(() => {
      if (arriba) arriba.hidden = scrollY < 600;
      scrollTicking = false;
    });
    scrollTicking = true;
  }
}, { passive: true });
arriba.onclick = () => scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth" });

// ===== Panel de administrador =====
async function llamarAdmin(accion, datos = {}) {
  const nombreFuncion = CONFIG.ADMIN_FUNCTION || "quick-handler";
  const { data, error } = await sb.functions.invoke(nombreFuncion, { body: { accion, ...datos } });
  if (error) {
    let m = error.message;
    try { m = (await error.context.json()).error || m; } catch {}
    throw new Error(m);
  }
  return data;
}

async function abrirPanel() {
  if (!esAdmin()) return;
  ver("panel");
  const est = $("#p-estado");
  est.textContent = "Conectando con el servidor…";
  try { await llamarAdmin("ping"); est.textContent = "Servidor conectado ✓"; }
  catch (e) { est.textContent = "Servidor no disponible: " + e.message; }
  const { data, error } = await sb.from("perfiles").select("id,nombre,es_admin").order("creado_en");
  const lista = $("#p-lista");
  lista.replaceChildren();
  if (error) { lista.append(txt("error", "Error al cargar usuarios: " + error.message)); return; }
  const pl = (n, s, p) => n + " " + (n === 1 ? s : p);
  const personas = (data || []).filter(p => !p.es_admin).length;
  const totalOfr = S.fotos.reduce((n, f) => n + (f.ofrendas || []).length, 0);
  $("#p-resumen").textContent = pl(personas, "persona", "personas") + " · " + pl(S.fotos.length, "foto", "fotos") + " · " + pl(totalOfr, "ofrenda", "ofrendas");
  for (const p of data || []) {
    const fotos = S.fotos.filter(f => f.user_id === p.id).length;
    const ofr = S.fotos.flatMap(f => f.ofrendas || []).filter(o => o.user_id === p.id).length;
    const fila = document.createElement("div");
    fila.className = "fila-u";
    const t = document.createElement("div");
    t.append(txt("quien2", p.nombre + (p.es_admin ? " (administrador)" : "")),
      txt("sub", pl(fotos, "foto", "fotos") + " · " + pl(ofr, "ofrenda", "ofrendas")));
    fila.append(t);
    if (!p.es_admin) {
      const acc = document.createElement("div");
      acc.className = "acciones";
      const a = document.createElement("button");
      a.textContent = "Restablecer PIN";
      a.onclick = () => resetPin(p);
      const b = document.createElement("button");
      b.textContent = "Borrar cuenta";
      b.onclick = () => borrarCuenta(p, fotos, ofr);
      acc.append(a, b);
      fila.append(acc);
    }
    lista.append(fila);
  }
}

async function resetPin(p) {
  const pin = prompt("Nuevo PIN de 6 dígitos para " + p.nombre + ":");
  if (pin === null) return;
  if (!/^\d{6}$/.test(pin.trim())) return alert("El PIN debe tener exactamente 6 dígitos.");
  try {
    await llamarAdmin("reset_pin", { user_id: p.id, pin: pin.trim() });
    alert("Listo. El nuevo PIN de " + p.nombre + " es " + pin.trim());
  } catch (e) { alert("No se pudo: " + e.message); }
}

async function borrarCuenta(p, fotos, ofr) {
  const t = prompt("Se borrarán " + fotos + " fotos y " + ofr + " ofrendas de " + p.nombre + ". No se puede deshacer.\nEscribe su nombre para confirmar:");
  if (t === null) return;
  if (t.trim().toLowerCase() !== p.nombre.trim().toLowerCase()) return alert("El nombre no coincide. No se borró nada.");
  try { await llamarAdmin("delete_user", { user_id: p.id }); await cargar(); await abrirPanel(); }
  catch (e) { alert("No se pudo: " + e.message); }
}

$("#p-vaciar").onclick = async () => {
  if (!confirm("Se borrarán TODAS las fotos y ofrendas de todos. Las cuentas se conservan. ¿Continuar?")) return;
  if (prompt("Escribe BORRAR TODO para confirmar:") !== "BORRAR TODO") return alert("No se borró nada.");
  try { await llamarAdmin("wipe_all"); await cargar(); await abrirPanel(); alert("El altar quedó en blanco."); }
  catch (e) { alert("No se pudo: " + e.message); }
};
$("#p-volver").onclick = () => ver("altar");


function contador(campo) {
  const c = document.createElement("small");
  c.className = "cont";
  campo.insertAdjacentElement("afterend", c);
  const act = () => {
    const n = campo.maxLength - campo.value.length;
    c.textContent = "Te quedan " + n + " de " + campo.maxLength + " caracteres";
    c.classList.toggle("poco", n <= 10);
  };
  campo.addEventListener("input", act);
  act();
  return act;
}
S.conts = [contador($("#form-foto").honrado), contador($("#form-foto").mensaje)];


init();


