# WJERP — gestão empresarial SaaS conectada ao WJPDM e ao WJCAD (G7; fiscal/contábil G8)

Inspiração funcional:
- ERP brasileiro de mercado: módulos integrados, multiempresa/filial, parametrização, fluxos de
  aprovação, relatórios;
- sistemas de PDM: cofre, revisões, ciclo de vida, estrutura de produto.

Nada de nomes de módulos, telas, tabelas, códigos de rotina, dicionário de dados, linguagem de
customização ou layouts de terceiros: o modelo de dados e as telas são nossos.
"SAS" no pedido é tratado como **SaaS**: serviço multiempresa (multi-tenant) na nuvem, com o
cliente PWA nos três aparelhos.

---

## Estado da v1 (25/10/2026) — `erp/index.html`, `src/erp/` (dados neste aparelho)

✅ Gestão local (IndexedDB, offline), telas geradas por metadados (lista → ficha), regras puras
testadas em `scripts/teste-erp.ts`:
- cadastros: clientes e fornecedores (CPF/CNPJ com dígitos verificadores), itens com estrutura,
  armazéns, condições de pagamento; **importar itens e listas de materiais do WJPDM**;
- estoque: entradas, saídas, transferências e ajustes que nunca deixam saldo negativo, **custo
  médio móvel**, saldos por armazém, mínimo, ficha do item (kardex);
- compras: pedido com aprovação, **recebimento parcial** → entrada no estoque + contas a pagar
  pelas parcelas da condição;
- vendas: pedido com **análise de crédito** (limite e títulos vencidos), faturamento/expedição
  parcial limitado ao saldo → saída + contas a receber;
- produção: OP prevista → firme → apontamento que **consome os componentes da estrutura** e dá
  entrada no produto com o custo dos componentes;
- **MRP**: demanda dos pedidos e das OPs + estoque mínimo, explosão da estrutura por níveis,
  saldo/compras/OPs em aberto, lote mínimo e prazo → gera OPs e pedidos de compra;
- financeiro: títulos a pagar/receber com baixas parciais, vencidos, **fluxo de caixa** de 12 semanas;
- painel de indicadores; exportar listas em CSV; cópia de segurança (`.wjerp`); dados de exemplo.

🟡 Próximos (G7/G8): servidor multiempresa com usuários, permissões e alçadas; roteiros e centros
de trabalho; capacidade finita com o motor do WJCronProject; cotações; inventário; CRM e propostas;
conciliação bancária; nota fiscal e contabilidade (G8).

---

## 0. Arquitetura e conceitos comuns

- **Servidor**:
  - API em Cloudflare Workers (TypeScript);
  - banco D1 (SQLite) **por empresa** (isolamento de tenant);
  - R2 para arquivos (cofre PDM, anexos, XML fiscais);
  - Durable Objects para travas (check-out), filas de numeração e tempo real;
  - Queues para jobs (MRP, recálculo de custo, importações);
  - Cron Triggers para agendados.
- **Cliente**:
  - PWA (`apps/gestao`) com telas geradas a partir de **metadados**: cada entidade declara campos,
    validações, listas, relações e permissões;
  - consulta e edição seguem um padrão único (lista → ficha → abas);
  - cache local para leitura offline; lançamentos offline ficam em fila com validação no servidor.
- **Multiempresa / multifilial**:
  - cadastros compartilhados ou exclusivos por filial (configurável por entidade);
  - parâmetros por empresa/filial.
- **Usuários e permissões**:
  - papéis (perfis) com permissão por entidade/ação (ver, incluir, alterar, excluir, aprovar,
    exportar) e por campo (ocultar custo);
  - restrição por filial/centro de custo;
  - **alçadas de aprovação** por valor;
  - autenticação: e-mail + senha com 2FA (TOTP) e passkeys (WebAuthn); SSO ⏸.
- **Auditoria**: todo registro guarda criado/alterado por/em; log de alterações campo a campo
  (antes/depois) consultável; exclusão lógica.
- **Numeração**: sequenciais por filial e série (pedido, OP, nota), máscaras configuráveis,
  sem buracos onde a lei exige.
- **Padrão de tela** (vale para todos os cadastros e movimentos):
  - **Lista**: filtros salvos, busca, colunas configuráveis, agrupar, totalizar, exportar para a
    Planilha, ações em lote;
  - **Ficha**: abas, campos com validação imediata, consulta (F3/lupa) em campos relacionados,
    gatilhos (preencher campo a partir de outro), anexos, comentários, histórico, "Usado em";
  - legendas de status por cor + ícone (não só cor).
- **Personalização sem código**:
  - campos personalizados por entidade (tipo, máscara, lista, obrigatório, fórmula do motor comum);
  - regras de validação e gatilhos em **fórmula** (`SE([Valor]>10000;ERRO("Exige aprovação");OK)`);
  - telas: reorganizar campos e abas;
  - **scripts TypeScript** em área isolada para casos avançados.
- **Relatórios e painéis**:
  - consultas salvas (construtor visual de filtros/junções/agrupamentos) → tabela, gráfico,
    Planilha vinculada, Documento modelo;
  - painéis por papel (indicadores com metas);
  - relatórios agendados por e-mail (G5).
- **Integração externa**: API REST + webhooks; importação/exportação CSV/xlsx com mapeamento e
  conferência prévia.
- **LGPD**: base legal por cadastro de pessoa, consentimento, anonimização/exportação de dados do
  titular, retenção.

## 1. Engenharia (vem do WJPDM)

Cofre, versões/revisões, fluxos de aprovação, mudanças de engenharia (ECR/ECO), itens e lista de
materiais de engenharia são do **WJPDM** ([pdm.md](pdm.md)). O WJERP recebe do WJPDM:
- o **item** liberado (mesmo cadastro, campos de gestão completados aqui);
- a **EBOM**, convertida em **estrutura de manufatura** (MBOM) com perdas, fantasmas, alternativos,
  consumo de matéria-prima e vigência das mudanças;
- os arquivos de fabricação da revisão liberada (DXF, PDF) para as ordens de produção.

## 2. Cadastros básicos (G7)

- Empresas e filiais (CNPJ, IE, IM, regime tributário, endereços, certificados digitais — G8).
- **Clientes e fornecedores** (pessoa física/jurídica):
  - CPF/CNPJ com validação e consulta pública (ReceitaWS-like via provedor ⏸), IE, endereços
    (CEP com preenchimento);
  - contatos, condições comerciais, limite de crédito, classificação, bloqueio.
- **Produtos/Itens**: o mesmo item do PDM (seção 1.2) + dados de gestão:
  - fiscais: NCM, CEST, origem, CFOP padrão, tributação;
  - estoque: armazém padrão, lote/série, validade, mínimo/máximo, ponto de pedido;
  - custos: custo standard, médio, último;
  - compras: lead time, lote mínimo/múltiplo;
  - vendas: preço, comissão;
  - PCP: política (fabricar/comprar), roteiro.
- Unidades de medida e conversões (kg ↔ m² de chapa por espessura).
- Tabelas de preço (vigência, por cliente/região, fórmulas de preço = custo × markup).
- Condições de pagamento (parcelas, dias, % por parcela, dia fixo).
- Transportadoras, veículos, vendedores (comissão), centros de custo, naturezas financeiras,
  bancos/contas, plano de contas (G8), feriados, moedas e cotações.

## 3. Compras e suprimentos (G7)

- **Solicitação de compra** (manual, do MRP, do ponto de pedido) → aprovação por alçada.
- **Cotação**:
  - vários fornecedores por item;
  - envio do pedido de cotação (PDF/e-mail) e resposta (planilha ou portal do fornecedor ⏸);
  - **mapa de cotação** (preço, prazo, condição, frete, impostos) com sugestão do vencedor.
- **Pedido de compra**: itens, entregas parciais, aprovação por alçada, envio, acompanhamento (follow-up).
- Contratos/parcerias com saldo.
- **Recebimento**:
  - pré-nota a partir do XML da NF-e do fornecedor (G8) ou digitada;
  - conferência física (quantidade, lote);
  - amarração com o pedido e tolerâncias;
  - **inspeção de qualidade no recebimento** (seção 9);
  - entrada no estoque e no financeiro (título a pagar).
- Avaliação de fornecedores (prazo, qualidade, preço).

## 4. Estoque e custos (G7)

- Armazéns (locais), **endereçamento** (rua/prédio/nível), lotes e números de série, validade, FIFO/FEFO.
- Movimentações:
  - entradas, saídas, transferências entre armazéns/filiais, requisições ao almoxarifado;
  - devoluções, ajustes;
  - motivos e centro de custo.
- **Saldo em tempo real** por item/armazém/lote/endereço; empenhado (OP/pedido), disponível, a receber.
- **Kardex** (ficha de movimentação valorizada).
- **Inventário**: contagens (cega, rotativa por curva ABC), conferência, acerto com aprovação.
- **Custo**:
  - médio móvel por filial;
  - standard (do roteiro + estrutura) e real;
  - fechamento mensal com recálculo;
  - custo de produção (material + mão de obra + máquina + rateio de gastos gerais);
  - análise standard × real.
- Curva ABC (consumo, valor), giro, cobertura.

## 5. PCP — Planejamento e controle da produção (G7)

- **Roteiro de fabricação** por item. Operações com:
  - centro de trabalho;
  - tempo de preparação, operação por peça, fila, movimentação;
  - ferramenta/dispositivo;
  - instrução de trabalho (Documento vinculado);
  - **tempos sugeridos a partir do CAD**:
    - corte a laser = comprimento de corte ÷ velocidade (por material/espessura) + nº de perfurações × tempo;
    - dobra = nº de dobras × tempo por golpe + preparação por ferramental.
- **Centros de trabalho**: capacidade, calendário, eficiência, custo-hora, recursos (pessoas/máquinas
  — compartilhados com o Cronograma).
- **MRP**:
  - demanda: pedidos de venda, previsão, estoque de segurança;
  - explode a estrutura (MBOM) por níveis;
  - abate saldos e ordens em aberto;
  - aplica lead times, lotes (mínimo, múltiplo, lote a lote, período fixo) e perdas;
  - sugere **OPs** e **solicitações de compra** com datas;
  - mensagens de ação (antecipar, postergar, cancelar);
  - simulação sem gravar.
- **Ordens de produção**:
  - firmar sugestões; OP manual;
  - **empenho** de materiais; separação;
  - documentos da OP (Documento modelo): ficha da OP, desenhos/DXF da revisão liberada do PDM,
    lista de corte, etiquetas;
  - liberação, encerramento.
- **Sequenciamento / capacidade**:
  - infinita (carga × capacidade por centro, gráfico);
  - **finita** com o motor do Cronograma (Gantt de máquinas, arrastar ordens, prioridade,
    datas prometidas).
- **Apontamento de produção**:
  - por operação: quantidade boa/refugo/retrabalho, tempos, operador, máquina, paradas com motivo;
  - pelo celular/tablet no chão de fábrica (leitura de QR Code da OP pela câmera).
- **Aninhamento de chapas** (nesting) dos DXFs da OP por material/espessura → programa de corte,
  aproveitamento, sobras reaproveitáveis — G7+ (motor próprio; pode exigir biblioteca: avaliar).
- Indicadores: OEE, aderência ao plano, lead time, WIP.

## 6. Vendas e faturamento (G7; nota fiscal na G8)

- **CRM simples**: contas, contatos, oportunidades (funil por etapa, probabilidade, previsão),
  atividades (ligações, visitas, tarefas com agenda), propostas.
- **Orçamento/Proposta**:
  - itens do catálogo ou **itens configurados**: produto parametrizado em que as opções do cliente
    escolhem a **configuração do CAD** (G7+, sobre as configurações da peça);
  - custo e formação de preço (markup, impostos, frete, comissão, margem alvo);
  - validade; aprovação por desconto/margem;
  - PDF gerado de modelo de Documento;
  - revisões da proposta.
- **Pedido de venda**:
  - liberação de crédito (limite, títulos vencidos) e de estoque;
  - reserva; entregas programadas;
  - gera demanda no MRP;
  - acompanhamento (carteira, atrasos).
- **Expedição**: separação (picking por endereço), conferência, volumes, romaneio, etiquetas.
- **Faturamento**: geração da nota (G8), cálculo de impostos, devoluções, comissões.
- Pós-venda/assistência técnica ⏸.

## 7. Financeiro (G7)

- **Contas a pagar / receber**:
  - títulos (manuais, de notas, de pedidos com adiantamento);
  - parcelas, juros/multa/desconto, baixas parciais;
  - compensação; renegociação; previsões.
- **Bancos**: contas, movimento bancário, transferências, **conciliação** (importar OFX; CNAB G8).
- **Cobrança e pagamentos**:
  - boletos e **PIX** (QR dinâmico) via API bancária/provedor;
  - remessa/retorno CNAB 240/400 — G8.
- **Fluxo de caixa**: realizado × previsto, por natureza/centro de custo, projeção diária/mensal,
  cenários (vinculado à Planilha).
- Centro de custo e rateios; orçamento financeiro (previsto × realizado).
- DRE gerencial (por natureza) — a contábil fica na G8.

## 8. Fiscal e contábil (G8 — exige conformidade legal)

- **Motor fiscal**: ICMS (próprio, ST, DIFAL, FCP), IPI, PIS/COFINS (cumulativo/não cumulativo),
  ISS, retenções; regras por NCM/UF/CFOP/regime; e a **reforma tributária (IBS/CBS/IS)** com a
  convivência da transição.
- **NF-e / NFC-e / NFS-e / CT-e** ⏸ (CT-e só se houver transporte próprio):
  - emissão, cancelamento, carta de correção, inutilização, contingência;
  - DANFE;
  - XML guardado no R2;
  - certificado A1;
  - comunicação com a SEFAZ **por provedor homologado ou biblioteca auditada**. A decisão é do
    Johann, por responsabilidade legal.
- Entrada de XML de fornecedores (manifestação do destinatário, importação para pré-nota).
- Livros fiscais, apuração, **SPED Fiscal (EFD ICMS/IPI)**, **EFD-Contribuições**, ECD/ECF
  (contábil) — por provedor ou módulo próprio validado contra o PVA.
- **Contabilidade**:
  - plano de contas;
  - lançamentos automáticos (regras por evento: compra, venda, baixa, produção) e manuais;
  - lotes; encerramento;
  - balancete, razão, diário, balanço, DRE.
- Ativo fixo ⏸ (depreciação), folha de pagamento/RH ⏸ (fora do escopo: integração com sistema de
  terceiros via arquivo).

## 9. Qualidade (G7)

- Plano de inspeção por item/fornecedor:
  - características a medir com tolerância;
  - cotas críticas marcadas no CAD (G7+: cota com "característica de inspeção" gera o plano);
  - amostragem (NBR 5426).
- Inspeção no recebimento e em processo; laudos; liberação/rejeição/aprovação condicional.
- **Não conformidade** (RNC):
  - origem, disposição, causa (5 porquês/Ishikawa), ação corretiva com prazos;
  - as ações viram tarefas no Cronograma.
- Calibração de instrumentos ⏸.

## 10. Telas por dispositivo

- **Computador**: todas as funções; listas com muitas colunas; atalhos (F3 consulta, F12 opções,
  Ctrl+Enter confirmar, Esc cancelar).
- **Tablet**: todas as funções, fichas em 1–2 colunas; chão de fábrica (apontamentos, inspeção com
  fotos, consulta de desenho no visualizador 3D/PDF).
- **Celular**:
  - aprovações (pedidos, OPs, mudanças de engenharia);
  - consulta de estoque/preço/cliente;
  - apontamento por QR Code; inventário com câmera; fotos para RNC;
  - CRM (visitas, check-in com localização opcional);
  - painéis.

## 11. Integrações específicas (detalhe em integracoes.md)

- **CAD → PDM → ERP**: peça liberada vira item com propriedades, estrutura, consumo de material e
  tempos sugeridos de roteiro; DXF da revisão liberada vai para a OP.
- **ERP → CAD**: CAD consulta itens comprados (parafusos, perfis) do cadastro para inserir;
  material da peça vem do cadastro (densidade e custo); custo estimado da peça aparece em Avaliar.
- **Planilha**: consultas vivas, `WJ.ITEM`, importação de listas.
- **Documentos/Apresentações**: modelos com campos dos registros (proposta, OP, relatório, painel).
- **Cronograma**: projetos, capacidade finita, recursos, apontamentos, ações de qualidade.
