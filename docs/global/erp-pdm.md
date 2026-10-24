# Gestão e Engenharia — ERP + PDM conectados ao CAD (G5 PDM, G7 ERP, G8 fiscal/contábil)

Inspiração funcional:
- ERP brasileiro de mercado: módulos integrados, multiempresa/filial, parametrização, fluxos de
  aprovação, relatórios;
- sistemas de PDM: cofre, revisões, ciclo de vida, estrutura de produto.

Nada de nomes de módulos, telas, tabelas, códigos de rotina, dicionário de dados, linguagem de
customização ou layouts de terceiros: o modelo de dados e as telas são nossos.
"SAS" no pedido é tratado como **SaaS**: serviço multiempresa (multi-tenant) na nuvem, com o
cliente PWA nos três aparelhos.

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

## 1. PDM — Engenharia de produto (G5)

### 1.1 Cofre e arquivos
- Pastas por empresa/projeto. Arquivos de todas as faces (`.jlscad`, `.sgplan`, `.sgdoc`, …)
  e externos (PDF, DXF, STEP, imagens).
- **Check-out / check-in**:
  - trava exclusiva por usuário (Durable Object);
  - check-in com comentário cria **versão** (1, 2, 3…);
  - desfazer check-out;
  - edição offline com check-out prévio.
- Versão ≠ **revisão**:
  - versões são salvamentos de trabalho;
  - revisões (A, B, C… ou 00, 01; esquema configurável) são liberações formais.
- Visualização leve (`@sg/visualizador-3d`) no navegador, sem abrir o CAD: orbitar, medir, cortar,
  marcar (anotações em 3D) — também no celular.
- Busca por propriedades, conteúdo e geometria simples (dimensões da caixa, massa, material).

### 1.2 Itens e propriedades
- **Item** (código do produto) é o objeto central compartilhado com o ERP:
  - código (numeração automática por família/máscara, ex.: `12-0034`), descrição, descrição técnica;
  - tipo: produto acabado, semiacabado, peça fabricada, comprado, matéria-prima, consumível, serviço;
  - unidade, família/grupo, material, massa, acabamento/tratamento;
  - **propriedades personalizadas**.
- **Vínculo item ↔ arquivo CAD**: propriedades do `.jlscad` mapeadas para campos do item, nos dois
  sentidos:
  - massa, volume, material, dimensões da caixa;
  - espessura e planificado (chapa), comprimento de corte, nº de dobras.
- Item comprado: fabricante, código do fabricante, fornecedores homologados (ERP).

### 1.3 Ciclo de vida e fluxos
- Estados configuráveis. Padrão: Em trabalho → Em revisão → Aprovado/Liberado → Obsoleto, com
  Cancelado.
- Transições com:
  - condições (propriedades obrigatórias preenchidas, filhos já liberados, desenho anexo);
  - aprovadores (pessoa, papel, maioria/todos);
  - ações automáticas: incrementa revisão, gera PDF/DXF/STEP de liberação, trava edição,
    notifica, cria item no ERP.
- **Solicitação de mudança (ECR)** → **Ordem de mudança (ECO)**:
  - itens afetados, motivo, impacto (estoque, OPs em aberto, pedidos);
  - efetividade (data ou lote);
  - disposição do estoque antigo (usar, retrabalhar, sucatear);
  - ao liberar, a estrutura do ERP é atualizada com data de vigência.
- Histórico completo e comparação entre revisões (propriedades, estrutura, geometria: realce do que
  mudou no visualizador).

### 1.4 Estrutura de produto (BOM)
- **Estrutura de engenharia** (EBOM):
  - pai → filhos com quantidade, unidade, posição/balão, observação;
  - montagens do CAD quando existirem; até lá, montada à mão na ficha do item ou por planilha.
- **Onde é usado** (where-used) em todos os níveis.
- Comparar estruturas (revisões ou itens).
- Exportar estrutura indentada para a Planilha.
- **Transferência para o ERP**: EBOM → **estrutura de manufatura** (MBOM) com:
  - perdas (%);
  - itens fantasmas;
  - alternativos;
  - consumo de matéria-prima por peça (ex.: chapa: área planificada × espessura × densidade + perda
    do aninhamento);
  - roteiro de fabricação.

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
- **Planilha**: consultas vivas, `SG.ITEM`, importação de listas.
- **Documentos/Apresentações**: modelos com campos dos registros (proposta, OP, relatório, painel).
- **Cronograma**: projetos, capacidade finita, recursos, apontamentos, ações de qualidade.
