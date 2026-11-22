# Contrato de integração — Cardápio NS Gourmet / Omega

Esta base preserva os contratos presentes no `server.js` atual do Gestor Omega. Ela não exige um novo banco de dados nem novas tabelas para o cardápio público funcionar com o backend já existente.

## Leitura do cardápio

`GET /api/public-order/menu`

A API retorna `storeName`, `whatsapp`, `products`, `deliveryRates` e `businessHours`. A página pública usa IDs e valores retornados pelo servidor.

## Envio do pedido

`POST /api/public-order/orders`

O corpo contém `requestId` (UUID), `customerName`, `phone`, `address`, `neighborhood`, `fulfillmentType`, `paymentMethod`, `notes`, `items` (productId e quantity) e `origin`.

O servidor Omega deve recalcular preços e frete, validar horários, disponibilidade e idempotência, persistir o pedido e notificar a loja.

## Segurança

- Não adicionar SERVICE_ROLE_KEY, DATABASE_URL, tokens ou senhas no JavaScript do navegador.
- Não confiar em preço, desconto, taxa ou total enviados pelo navegador.
- Preservar requireSameOrigin, rate limit, validação de horário e idempotência do backend.
- Testar em cópia de desenvolvimento antes de publicar.
- Não publicar mock-server.js na Vercel; ele é somente para prévia local.