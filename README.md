# NS Gourmet — Cardápio Digital e Portal de Pedidos

Projeto do cardápio online da **NS Gourmet**, desenvolvido para permitir que clientes consultem os produtos, montem seus pedidos e enviem as informações necessárias para atendimento. A proposta é integrar a experiência pública ao **Gestor de Pedidos Omega**, mantendo o gerenciamento da operação em um único sistema.

> **Estado atual:** esta versão é uma base de desenvolvimento com execução local e servidor demonstrativo. A integração real com o Omega, Supabase, impressão térmica e demais recursos administrativos depende da implementação e validação no ambiente correspondente. Não considere o projeto conectado à produção apenas por executar localmente.

## Objetivos do projeto

- Disponibilizar um portal de pedidos simples e responsivo para os clientes.
- Facilitar a escolha de produtos por categorias, com carrinho e totalização automática.
- Coletar os dados necessários para processar cada pedido.
- Preparar a integração com o Gestor Omega, evitando criar um segundo fluxo independente de gestão.
- Permitir evolução futura para configurações, relatórios e ferramentas administrativas da NS Gourmet.

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Estrutura da interface | HTML5 |
| Estilos e responsividade | CSS3 |
| Interações no navegador | JavaScript |
| Servidor da versão demonstrativa | Node.js + Express |
| Banco previsto para a integração | Supabase (PostgreSQL) |
| Hospedagem prevista | Vercel |

O servidor local demonstrativo utiliza os arquivos e dados do próprio projeto. A presença de referências a Supabase ou Vercel nesta documentação não significa que credenciais, banco ou hospedagem de produção estejam configurados.

## Funcionalidades da base atual

- Cardápio responsivo com categorias e busca.
- Carrinho de compras e cálculo automático de subtotal, frete e total.
- Layout desktop com catálogo e checkout em áreas independentes; resumo e dados do pedido ficam na lateral.
- Layout mobile com seleção de produtos e acesso ao checkout pelo ícone do carrinho, sem exigir que o cliente role até o fim do catálogo.
- Formulário do pedido com nome, telefone, endereço, modalidade de entrega ou retirada, forma de pagamento e observações.
- Campo de forma de pagamento obrigatório no fluxo de finalização.
- Estrutura de demonstração local para testar a navegação e o envio de pedidos.

Consulte os arquivos da aplicação para conferir o comportamento efetivamente disponível nesta versão.

## Organização dos arquivos

- `pedido.html` — estrutura da página pública do cardápio.
- `pedido.css` — estilos, identidade visual e responsividade.
- `pedido.js` — lógica do catálogo, carrinho e formulário.
- `mock-server.js` — servidor local para demonstração.
- `data/menu.json` — catálogo demonstrativo de produtos.
- `INTEGRACAO-OMEGA.md` — orientações para integração com o Gestor Omega.
- `INTEGRAR-OMEGA.ps1` — script auxiliar para copiar os arquivos de interface para uma cópia local do Omega.
- `LEIA-PRIMEIRO.txt` — instruções rápidas.

## Como executar localmente

**Requisitos:** Node.js 18 ou superior e npm.

1. Clone o repositório:
   ```bash
   git clone https://github.com/Olivzx/Ns_Gourmet_gestor_Omega.git
   ```
2. Entre na pasta:
   ```bash
   cd Ns_Gourmet_gestor_Omega
   ```
3. Instale as dependências:
   ```bash
   npm install
   ```
4. Inicie o servidor:
   ```bash
   npm run dev
   ```
5. Abra no navegador:
   [http://localhost:3000/pedido](http://localhost:3000/pedido)

A execução local é destinada a desenvolvimento e demonstração. Os pedidos gerados nesse modo não devem ser tratados como pedidos reais da operação.

## Identidade visual

A referência visual registrada para o projeto inclui a seguinte paleta:

| Cor | Código |
|---|---|
| Roxo principal | `#3A12B1` |
| Cinza escuro | `#363944` |
| Magenta | `#AC348D` |
| Violeta | `#AE48F6` |
| Roxo claro | `#B559DC` |

A intenção é manter uma interface consistente e permitir, em uma etapa administrativa futura, personalizar cores e elementos sem precisar editar diretamente os arquivos de código.

## Catálogo de referência

O planejamento do cardápio organiza os produtos em categorias como **Doces**, **Salgados**, **Combos** e **Copos da Felicidade**. Entre os itens listados no material de referência estão:

- Doces: bombom de morango, bombom de uva, bolo nuvem, brownie, pudim e cone de chocolate.
- Salgados: enroladinho de presunto e queijo, bomba de calabresa e queijo, tortas salgadas e coxinhas.
- Copos da Felicidade: Morango com Brownie, Três Amores, Ferrero Rocher, Tentação, Morango e Sensação de Brownie.
- Combos: combinações de salgado, refrigerante e sobremesa.

Os nomes e preços de demonstração podem ser ajustados no catálogo. Antes de publicar, revise produtos, descrições, imagens e valores vigentes.

## Integração com o Gestor de Pedidos Omega

A integração planejada utiliza as rotas públicas do Omega:

- `GET /api/public-order/menu` — obter o cardápio disponibilizado pela loja.
- `POST /api/public-order/orders` — enviar um pedido criado pelo cliente.

O objetivo é que o portal público utilize o cardápio e o fluxo de pedidos do Omega, sem duplicar regras de negócio ou manter uma base paralela de pedidos.

Antes de integrar:

1. Trabalhe em uma cópia atualizada do repositório do Omega.
2. Leia `INTEGRACAO-OMEGA.md`.
3. Revise o script `INTEGRAR-OMEGA.ps1` antes de executá-lo.
4. Confirme os contratos das rotas, autenticação, validações e formato dos dados no backend atual.
5. Teste o fluxo em ambiente de desenvolvimento antes de qualquer publicação.

**Atenção:** o script auxiliar copia arquivos de interface. Ele não configura o Supabase, não cria tabelas, não altera variáveis de ambiente e não publica no Vercel.

## Requisitos planejados para próximas etapas

Os itens abaixo fazem parte do escopo e das ideias registradas para evolução do sistema. Eles **não devem ser considerados concluídos** sem implementação e teste específicos.

### Portal do cliente
- Confirmação do endereço informado, com apoio de Google Maps ou Apple Maps.
- Salvamento e reutilização de endereços, contatos e bairros, respeitando a privacidade do cliente.
- Exibição de uma mensagem de loja fechada e bloqueio de novos pedidos fora do expediente, com regra validada também no servidor.
- Notificação sonora/visual de novo pedido no ambiente de atendimento.

### Gestão no Omega
- Área própria para adicionar e editar produtos com facilidade.
- Cadastro e armazenamento de fotos dos produtos.
- Personalização de cores e elementos do site por configurações.
- Dashboard e área financeira com balanço mensal e análises por cliente e por produto.
- Relatórios semanais, mensais e anuais.
- Configurações de contato, Instagram, WhatsApp e perfil profissional.

### Entregas
- Portal exclusivo para entregadores.
- Visualização dos pedidos prontos para entrega.
- Confirmação de entrega e histórico de entregas.

### Operação e infraestrutura
- Configuração de impressora térmica e impressora de etiquetas.
- Integração com Supabase/PostgreSQL e hospedagem Vercel, conforme arquitetura do Omega.
- Controles de segurança, proteção contra ataques e tratamento adequado de dados pessoais conforme a LGPD.
- Informações de autoria e links do projeto.

## Segurança, privacidade e LGPD

Dados como nome, telefone e endereço são informações pessoais. Na integração e publicação, implemente controles de acesso, validação no servidor, proteção de credenciais, política de retenção e tratamento compatível com a LGPD.

- Nunca coloque chaves secretas do Supabase ou credenciais administrativas no JavaScript do navegador.
- Não envie arquivos `.env`, tokens ou senhas para o GitHub.
- Valide no backend os valores, disponibilidade, modalidade de entrega e forma de pagamento recebidos.
- Restrinja o acesso às áreas administrativas e do entregador.
- Use HTTPS na publicação e revise as políticas de acesso do banco (RLS, quando aplicável).

Esta seção descreve requisitos de implementação; não representa uma auditoria ou certificação de segurança.

## Publicação

A hospedagem prevista é Vercel, com o Omega e o Supabase como partes da arquitetura integrada. A publicação deve ser feita somente depois de validar a integração, as variáveis de ambiente, as permissões do banco e os fluxos de pedido.

**Não faça alterações em produção, no banco Supabase ou nas configurações do Vercel sem autorização explícita e validação prévia.**

## Repositório

GitHub: https://github.com/Olivzx/Ns_Gourmet_gestor_Omega

---

Projeto NS Gourmet — Cardápio Digital integrado ao Gestor de Pedidos Omega.
