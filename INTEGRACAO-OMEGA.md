# Integração NS Gourmet — Cloudflare Workers + Supabase

## Contrato público

### GET /api/public-order/menu
O Worker chama `public.public_order_menu()` via `POST /rest/v1/rpc/public_order_menu` e retorna o JSON do cardápio.

### POST /api/public-order/orders
O Worker valida a origem, o Content-Type, o tamanho e a estrutura JSON. Em seguida chama `public.create_public_order(p_order jsonb)` via PostgREST e retorna o ID, o total calculado no banco e o indicador de duplicidade.

## Supabase

O projeto Supabase **Omega** e suas tabelas/dados existentes são preservados. Não é necessário criar tabelas nem reaplicar migrations para migrar os handlers HTTP.

As RPCs existentes continuam responsáveis por:
- horário e disponibilidade de pedidos;
- validação de dados, produtos e quantidades;
- cálculo de subtotal, taxa de entrega e total;
- prevenção de duplicidade por requestId;
- persistência de pedidos e itens.

O Worker usa `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY) como secrets. A chave privilegiada nunca pode ser enviada ao navegador.

## Secrets locais e produção

Local: copie os nomes para `.dev.vars` (arquivo ignorado pelo Git).

Produção: use `wrangler secret put` para cadastrar cada secret no Worker correto. Não inclua os valores no repositório nem em logs.

## Rotas e assets

O Worker executa primeiro em `/api/*). As demais requisições são atendidas pelo diretório `public/` via Workers Static Assets.

## Pontos a resolver antes de produção ampla

1. Criar uma regra de rate limiting para `POST /api/public-order/orders`.
2. Decidir se bairros não cadastrados devem ser aceitos. A UI atual calcula frete estimado por distância, mas a RPC atual exige uma taxa cadastrada e rejeita bairros fora da tabela.
3. Configurar secrets e validar os dois endpoints em preview com uma solicitação de teste controlada.
