# Migração do cardápio público para o repositório Omega

## Escopo desta branch

A branch `feature/ns-gourmet-redesign` recebeu a interface do cardápio público desenvolvida no repositório Gestor de Pedidos Alpha:

- `pedido.html`, `pedido.css` e `pedido.js`: interface, identidade visual, responsividade, filtros, carrinho, checkout e acessibilidade.
- `public-order-ui.test.js`: testes estáticos da interface e do fluxo de pedido.
- `package.json`: comandos de verificação e testes.

## Compatibilidade e limites verificados

- A interface consome `GET /api/public-order/menu` e `POST /api/public-order/orders`, caminhos já implementados no servidor demonstrativo deste repositório.
- O servidor atual continua sendo `mock-server.js`, com dados locais de demonstração. O banner de demonstração é exibido quando a API retorna `demo: true`.
- Na confirmação de um pedido demonstrativo, a interface informa que o pedido não foi enviado à loja e não exibe botão de WhatsApp sem uma URL real fornecida pela API.
- O link do cabeçalho aponta para o Instagram da NS Gourmet, pois a rota raiz deste repositório também abre o cardápio e não é uma área de gestor.

## O que não foi feito

- Nenhuma alteração na branch `main`.
- Nenhuma alteração em Supabase, banco de produção, segredos, variáveis ou integrações reais.
- Nenhum deploy ou publicação na Vercel.
- Nenhuma substituição do servidor demonstrativo por uma API de produção.

## Próximas validações antes de publicar

1. Conectar a API real do Gestor Omega e validar o contrato de menu e pedidos.
2. Confirmar cálculo de preços/frete, idempotência e bloqueio de horário no servidor real.
3. Configurar ambiente Preview isolado, sem credenciais de produção.
4. Executar testes automatizados e validação visual em navegador/dispositivos.
5. Revisar esta branch antes de qualquer merge ou publicação.
