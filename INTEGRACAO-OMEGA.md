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

A URL do projeto fica em `SUPABASE_URL` (variável não secreta no Wrangler). A chave privilegiada fica exclusivamente em `SUPABASE_SERVICE_ROLE_KEY), como secret do Worker. Nunca envie essa chave ao navegador, ao GitHub ou a logs.

## Secrets locais e produção

Local: copie `.dev.vars.example` para `.dev.vars` e preencha a chave privilegiada usando credenciais de desenvolvimento. O arquivo `.dev.vars` é ignorado pelo Git.

Produção: configure a chave diretamente no Worker correto com:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

O comando solicita o valor interativamente. Não inclua o valor em argumentos, arquivos versionados ou no chat.

## Rotas e assets

O Worker executa primeiro em `/api/*). As demais requisições são atendidas pelo diretório `public/` via Workers Static Assets.

## Pontos a resolver antes de produção ampla

1. Criar uma regra de rate limiting para `POST /api/public-order/orders`.
2. Decidir se bairros não cadastrados devem ser aceitos. A UI atual calcula frete estimado por distância, mas a RPC atual exige uma taxa cadastrada e rejeita bairros fora da tabela.
3. Cadastrar o secret e validar os dois endpoints em preview com uma solicitação de teste controlada.
