# Balcão Pizza Napoletana — site

Landing page com cardápio e pedido pelo WhatsApp. É um único arquivo: `index.html` (as fotos estão embutidas nele).

## Editar
Abra `index.html`, procure o bloco `CONFIG` no início do `<script>`:

- `whatsapp` — número com DDI + DDD, só dígitos (ex.: `5511987654321`)
- `address`, `hours`, `instagram`, `minOrder`

Pizzas, preços e descrições ficam no bloco `MENU`, logo abaixo.

## Publicar
GitHub Pages: Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.
