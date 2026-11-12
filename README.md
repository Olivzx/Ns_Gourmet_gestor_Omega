# NS Gourmet — Base do cardápio público

Base inicial do cardápio online da NS Gourmet, preparada para execução local no VS Code e integração posterior ao Gestor Omega existente.

## Executar

Requer Node.js 18 ou superior.

```bash
npm run dev
```

Acesse http://localhost:3000/pedido.

## Funcionalidades

- Cardápio responsivo com categorias e busca.
- Carrinho e cálculo automático de subtotal, frete e total.
- Desktop: catálogo com rolagem independente e checkout fixo na lateral.
- Celular: seleção de produtos e checkout em gaveta acionada pelo carrinho.
- Dados do cliente, entrega/retirada, endereço, pagamento obrigatório e observações.
- Horários e bloqueio de pedidos fora do expediente.
- Servidor local demonstrativo; não conecta ao Supabase nem altera produção.

## Integração Omega

A página foi preparada para consumir as rotas públicas existentes do Omega (`GET /api/public-order/menu` e `POST /api/public-order/orders`). Antes de integrar, atualize uma cópia local do Omega e siga `INTEGRACAO-OMEGA.md` e `INTEGRAR-OMEGA.ps1`. Não substitua o backend nem credenciais de produção.

Veja `LEIA-PRIMEIRO.txt` para início rápido.