CREATE TABLE IF NOT EXISTS pedidos (
  id            TEXT PRIMARY KEY,      -- código do pedido do site, ex.: B1411-1932-K7QZ
  pagarme_id    TEXT UNIQUE,           -- id do pedido no Pagar.me (or_...)
  nome          TEXT NOT NULL,
  itens         TEXT NOT NULL,         -- JSON com sabores, quantidades e preços do servidor
  total         INTEGER NOT NULL,      -- em centavos, calculado no servidor
  status        TEXT NOT NULL,         -- aguardando | pago | cancelado
  url           TEXT,                  -- página de pagamento
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS pedidos_criado ON pedidos (criado_em);
