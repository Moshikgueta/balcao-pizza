CREATE TABLE IF NOT EXISTS pedidos (
  id            TEXT PRIMARY KEY,     -- código do pedido do site, ex.: B1411-1932-K7QZ (o mesmo da mensagem do WhatsApp)
  nome          TEXT NOT NULL,
  tel           TEXT,                 -- celular com DDD, só dígitos (só quando o cliente quer o selo)
  fid           INTEGER NOT NULL DEFAULT 0,
  itens         TEXT NOT NULL,        -- JSON com preços do servidor
  total         INTEGER NOT NULL,     -- centavos
  retirada      TEXT,
  pagamento     TEXT,
  obs           TEXT,
  status        TEXT NOT NULL,        -- novo | preparo | pronto | retirado | cancelado
  ip            TEXT,                 -- resumo (hash) do IP, só para limitar abuso
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS pedidos_status ON pedidos (status, criado_em);
CREATE INDEX IF NOT EXISTS pedidos_tel ON pedidos (tel);
CREATE INDEX IF NOT EXISTS pedidos_ip ON pedidos (ip, criado_em);

-- Cada linha é um movimento no cartão: +1 (pedido ou manual), -1 (correção) ou -10 (prêmio resgatado).
CREATE TABLE IF NOT EXISTS selos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tel        TEXT NOT NULL,
  delta      INTEGER NOT NULL,
  pedido_id  TEXT UNIQUE,             -- no máximo 1 selo por pedido
  motivo     TEXT,
  criado_em  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS selos_tel ON selos (tel);
