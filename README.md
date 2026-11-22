# NS Gourmet — Cardápio Digital

Portal público de pedidos da NS Gourmet. O frontend é servido por Cloudflare Workers Static Assets e as rotas públicas de pedido são executadas pelo mesmo Worker. O banco e as regras de negócio continuam no Supabase.

## Arquitetura

- **Cloudflare Workers + Static Assets:** entrega de HTML, CSS, JavaScript e API.
- **Supabase PostgreSQL:** mantém cardápio, configurações, taxas de entrega, pedidos e itens.
- **RPCs existentes:** `public_order_menu()` e `create_public_order(p_order jsonb)`. O Worker chama essas funções pelo endpoint PostgREST.
- **Credenciais:** a URL do projeto é uma variável não secreta do Wrangler; `SUPABASE_SERVICE_ROLE_KEY` fica como secret do Worker. A chave privilegiada nunca é incluída nos arquivos públicos.

## Rotas do Worker

| Método | Rota | Função |
|---|---|---|
| GET | `/api/public-order/menu` | Lê o cardápio pela RPC `public_order_menu`. |
| POST | `/api/public-order/orders` | Registra pedido pela RPC `create_public_order`. |

O banco continua responsável por recalcular preços e frete, validar produtos disponíveis, horário de atendimento e idempotência. O Worker não aceita valores de total enviados pelo navegador.

## Configuração local

Requisitos: Node.js 20 ou superior.

```bash
npm install
npm run check
npm test
npx wrangler dev
```

Para testar as rotas localmente, copie `.dev.vars.example` para `.dev.vars` e preencha `SUPABASE_SERVICE_ROLE_KEY` com uma chave de desenvolvimento. Não use uma chave de produção em testes locais que possam gravar pedidos.

## Secret de produção

Depois de confirmar o Worker de destino, cadastre a chave privilegiada diretamente no Cloudflare:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

O comando solicita o valor interativamente. Não cole a chave no GitHub, em arquivos versionados ou no chat. A chave privilegiada do Supabase nunca deve aparecer no navegador.

## Publicação

```bash
npm run deploy:dry
npm run deploy
```

O primeiro comando valida o empacotamento sem publicar. Faça o deploy somente depois de configurar o secret no ambiente correto e validar a URL de preview.

## Compatibilidade com Supabase

Este projeto reutiliza o projeto Supabase **Omega** e as funções SQL já aplicadas. A migração do backend HTTP para Workers não exige recriar tabelas, copiar dados ou aplicar novas migrations. As políticas RLS e as permissões das RPCs existentes permanecem sob controle do banco.

## Limites conhecidos

- O portal público utiliza somente as duas rotas listadas acima. As rotas administrativas do mock-server local não são migradas por esta entrega.
- O formulário permite indicar bairro não cadastrado e estimativa de distância, mas a RPC atual do banco aceita somente bairros cadastrados em `public_order_delivery_rates`. Esse comportamento precisa de uma decisão e implementação específica no banco antes de oferecer frete por distância em produção.
- O estado atual da configuração Supabase está com `accepting_orders = false`; o banco rejeitará novos pedidos até que a loja seja reaberta pela configuração administrativa. Isso não foi alterado.
- O Worker valida origem, tipo e tamanho do corpo; configure uma regra de rate limiting no Cloudflare para `POST /api/public-order/orders` antes de tráfego público amplo.

## Desenvolvimento

O `mock-server.js` continua disponível apenas para demonstração local. A integração real em produção passa pelo Worker e pelas RPCs do Supabase.
