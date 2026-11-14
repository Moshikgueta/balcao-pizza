/**
 * Painel da Balcão — pedidos e cartão fidelidade por número de celular.
 * Cloudflare Worker + banco D1.
 *
 * Público (só o site da Balcão, pelo navegador do cliente):
 *   POST /pedido                 registra o pedido enviado pelo site (o WhatsApp continua igual)
 *   (Não existe consulta pública de selos: assim ninguém descobre se um número é cliente.
 *    O cliente pergunta os selos pelo WhatsApp e a pizzaria vê no painel.)
 *
 * Painel (exige a senha no cabeçalho  Authorization: Bearer SENHA):
 *   GET  /admin/pedidos?status=abertos|hoje|todos
 *   POST /admin/pedido/status    {"id","status"}   novo → preparo → pronto → retirado | cancelado
 *   GET  /admin/cliente?tel=...  selos, histórico e pedidos de um número
 *   POST /admin/selo             {"tel","delta":+1|-1,"motivo"}
 *   POST /admin/resgate          {"tel"}   usa um cartão cheio (desconta a meta)
 *   GET  /admin/clientes         números com selos (ranking)
 *
 * Regras:
 *   - O selo entra SÓ quando a pizzaria marca o pedido como "retirado" (nunca no envio),
 *     e uma única vez por pedido. Assim ninguém ganha selo sem comprar.
 *   - O total é recalculado aqui com a tabela PRECOS.
 *   - Dado pessoal guardado: nome e celular, só para o pedido e o cartão fidelidade.
 *
 * Configuração no painel da Cloudflare:
 *   - Binding D1   DB
 *   - Secret       ADMIN_KEY   (senha do painel; use uma senha longa)
 */

const ALLOWED_ORIGINS = ["https://moshikgueta.github.io"];
const META_SELOS = 10;                 // igual a CONFIG.loyaltyGoal no site
const PRECOS = {                       // centavos — MANTENHA IGUAL ao MENU do index.html
  "mussarela":    { nome: "Mussarela",             centavos: 4490 },
  "calabresa":    { nome: "Calabresa com Cebola",  centavos: 4490 },
  "tres-queijos": { nome: "Três Queijos",          centavos: 4490 },
  "margherita":   { nome: "Margherita",            centavos: 4790 },
  "diavola":      { nome: "Diavola",               centavos: 4990 },
  "gorgonzola":   { nome: "Gorgonzola & Cogumelo", centavos: 4990 },
};
const STATUS = ["novo", "preparo", "pronto", "retirado", "cancelado"];
const ID_RE = /^B\d{4}-\d{4}-[A-Z0-9]{4}$/;
const MAX_PEDIDOS_POR_IP_HORA = 12;

/* ---------- utilidades ---------- */
function cors(req, admin) {
  const o = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": admin ? "Content-Type, Authorization" : "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
const json = (req, body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(req, true) },
});
const agora = () => new Date().toISOString();

/** Celular brasileiro só com dígitos, com DDD, sem o 55. Ex.: "41999919434". */
export function normTel(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[1-9]{2}9?\d{8}$/.test(d) ? d : "";
}

async function igual(a, b) {                       // comparação sem vazar tempo
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y); let r = 0;
  for (let i = 0; i < u.length; i++) r |= u[i] ^ v[i];
  return r === 0;
}
async function admin(req, env) {
  const h = req.headers.get("Authorization") || "";
  const k = h.startsWith("Bearer ") ? h.slice(7) : "";
  return !!env.ADMIN_KEY && env.ADMIN_KEY.length >= 8 && !!k && await igual(k, env.ADMIN_KEY);
}
async function hashIp(req) {
  const ip = req.headers.get("CF-Connecting-IP") || "local";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("balcao:" + ip));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function selosDe(env, tel) {
  const r = await env.DB.prepare("SELECT COALESCE(SUM(delta),0) AS s FROM selos WHERE tel = ?").bind(tel).first();
  return Number(r ? r.s : 0);
}

/* ---------- pedido vindo do site ---------- */
export function montarPedido(b) {
  if (!b || typeof b !== "object") throw new Error("pedido inválido");
  const id = String(b.id || "");
  if (!ID_RE.test(id)) throw new Error("código inválido");
  const nome = String(b.nome || "").trim().slice(0, 60);
  if (nome.length < 2) throw new Error("nome inválido");
  if (!Array.isArray(b.itens) || !b.itens.length || b.itens.length > 20) throw new Error("itens inválidos");
  const itens = b.itens.map(i => {
    const p = PRECOS[i && i.id], q = Number(i && i.qtd);
    if (!p) throw new Error("sabor desconhecido");
    if (!Number.isInteger(q) || q < 1 || q > 20) throw new Error("quantidade inválida");
    return { id: i.id, nome: p.nome, qtd: q, centavos: p.centavos, obs: String(i.obs || "").slice(0, 120) };
  });
  const fid = !!b.fid;
  const tel = normTel(b.tel);
  if (fid && !tel) throw new Error("celular inválido");
  return {
    id, nome, itens, fid, tel: tel || null,
    total: itens.reduce((s, i) => s + i.qtd * i.centavos, 0),
    retirada: String(b.retirada || "").slice(0, 40),
    pagamento: String(b.pagamento || "").slice(0, 40),
    obs: String(b.obs || "").slice(0, 300),
  };
}

export async function handle(req, env) {
  const url = new URL(req.url), path = url.pathname;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, true) });

  /* público */
  if (req.method === "POST" && path === "/pedido") {
    if (!ALLOWED_ORIGINS.includes(req.headers.get("Origin") || "")) return json(req, { error: "origem" }, 403);
    let p; try { p = montarPedido(await req.json()); } catch (e) { return json(req, { error: e.message }, 400); }
    const ip = await hashIp(req);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE ip = ? AND criado_em > ?")
      .bind(ip, new Date(Date.now() - 3600e3).toISOString()).first();
    if (n && n.n >= MAX_PEDIDOS_POR_IP_HORA) return json(req, { error: "muitos pedidos" }, 429);
    await env.DB.prepare(`INSERT OR IGNORE INTO pedidos (id,nome,tel,fid,itens,total,retirada,pagamento,obs,status,ip,criado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(p.id, p.nome, p.tel, p.fid ? 1 : 0, JSON.stringify(p.itens), p.total,
      p.retirada, p.pagamento, p.obs, "novo", ip, agora()).run();
    return json(req, { ok: true, id: p.id });
  }
  if (req.method === "GET" && path === "/") return json(req, { ok: true, api: "painel-balcao" });

  /* painel */
  if (!path.startsWith("/admin/")) return json(req, { error: "não encontrado" }, 404);
  if (!(await admin(req, env))) return json(req, { error: "senha" }, 401);

  if (req.method === "GET" && path === "/admin/pedidos") {
    const f = url.searchParams.get("status") || "abertos";
    const desde = new Date(Date.now() - 18 * 3600e3).toISOString();      // "hoje" = últimas 18 horas (cobre a noite toda)
    const sql = f === "todos" ? "SELECT * FROM pedidos ORDER BY criado_em DESC LIMIT 200"
      : f === "hoje" ? "SELECT * FROM pedidos WHERE criado_em > ? ORDER BY criado_em DESC"
      : "SELECT * FROM pedidos WHERE status IN ('novo','preparo','pronto') ORDER BY criado_em ASC";
    const st = env.DB.prepare(sql);
    const { results } = await (f === "hoje" ? st.bind(desde) : st).all();
    return json(req, { pedidos: results.map(r => ({ ...r, ip: undefined, fid: !!r.fid, itens: JSON.parse(r.itens) })) });
  }

  if (req.method === "POST" && path === "/admin/pedido/status") {
    const b = await req.json().catch(() => ({}));
    if (!ID_RE.test(String(b.id || "")) || !STATUS.includes(b.status)) return json(req, { error: "dados" }, 400);
    const p = await env.DB.prepare("SELECT * FROM pedidos WHERE id = ?").bind(b.id).first();
    if (!p) return json(req, { error: "pedido não existe" }, 404);
    await env.DB.prepare("UPDATE pedidos SET status = ?, atualizado_em = ? WHERE id = ?").bind(b.status, agora(), b.id).run();
    let selo = null;
    if (p.fid && p.tel) {
      if (b.status === "retirado") {                                         // 1 selo por pedido, só na retirada
        const r = await env.DB.prepare("INSERT OR IGNORE INTO selos (tel,delta,pedido_id,motivo,criado_em) VALUES (?,1,?,?,?)")
          .bind(p.tel, p.id, "pedido retirado", agora()).run();
        selo = (r.meta ? r.meta.changes : r.changes) ? "+1" : "já marcado";
      } else if (p.status === "retirado") {                                  // desfez a retirada: tira o selo do pedido
        await env.DB.prepare("DELETE FROM selos WHERE pedido_id = ?").bind(p.id).run();
        selo = "removido";
      }
    }
    return json(req, { ok: true, selo, selos: p.tel ? await selosDe(env, p.tel) : null });
  }

  if (req.method === "GET" && path === "/admin/cliente") {
    const tel = normTel(url.searchParams.get("tel"));
    if (!tel) return json(req, { error: "celular inválido" }, 400);
    const s = await selosDe(env, tel);
    const hist = (await env.DB.prepare("SELECT delta, motivo, pedido_id, criado_em FROM selos WHERE tel = ? ORDER BY criado_em DESC LIMIT 50").bind(tel).all()).results;
    const peds = (await env.DB.prepare("SELECT id, nome, total, status, criado_em FROM pedidos WHERE tel = ? ORDER BY criado_em DESC LIMIT 20").bind(tel).all()).results;
    return json(req, { tel, selos: s, meta: META_SELOS, podeResgatar: s >= META_SELOS, historico: hist, pedidos: peds, nome: peds[0] ? peds[0].nome : "" });
  }

  if (req.method === "POST" && path === "/admin/selo") {
    const b = await req.json().catch(() => ({}));
    const tel = normTel(b.tel), d = Number(b.delta);
    if (!tel || ![1, -1].includes(d)) return json(req, { error: "dados" }, 400);
    if (d === -1 && (await selosDe(env, tel)) <= 0) return json(req, { error: "sem selos" }, 400);
    await env.DB.prepare("INSERT INTO selos (tel,delta,pedido_id,motivo,criado_em) VALUES (?,?,NULL,?,?)")
      .bind(tel, d, String(b.motivo || (d > 0 ? "selo manual" : "correção")).slice(0, 80), agora()).run();
    return json(req, { ok: true, selos: await selosDe(env, tel) });
  }

  if (req.method === "POST" && path === "/admin/resgate") {
    const b = await req.json().catch(() => ({}));
    const tel = normTel(b.tel);
    if (!tel) return json(req, { error: "celular inválido" }, 400);
    if ((await selosDe(env, tel)) < META_SELOS) return json(req, { error: "cartão ainda não está cheio" }, 400);
    await env.DB.prepare("INSERT INTO selos (tel,delta,pedido_id,motivo,criado_em) VALUES (?,?,NULL,?,?)")
      .bind(tel, -META_SELOS, "prêmio resgatado", agora()).run();
    return json(req, { ok: true, selos: await selosDe(env, tel) });
  }

  if (req.method === "GET" && path === "/admin/clientes") {
    const { results } = await env.DB.prepare(`SELECT s.tel, SUM(s.delta) AS selos, MAX(s.criado_em) AS ultimo,
        (SELECT nome FROM pedidos p WHERE p.tel = s.tel ORDER BY criado_em DESC LIMIT 1) AS nome
      FROM selos s GROUP BY s.tel HAVING SUM(s.delta) > 0 ORDER BY selos DESC, ultimo DESC LIMIT 200`).all();
    return json(req, { meta: META_SELOS, clientes: results });
  }

  return json(req, { error: "não encontrado" }, 404);
}

export default { fetch: (req, env) => handle(req, env) };
