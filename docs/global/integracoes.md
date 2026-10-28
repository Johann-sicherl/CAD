# Integrações entre as faces do WJProMaster

Regra geral: **vínculo por URI, nunca cópia silenciosa**.
- O objeto de destino guarda `wj://<face>/<arquivo|tabela>/<id>` e a versão/revisão usada.
- Atualização: automática, manual ou travada numa revisão.
- Todo vínculo aparece no painel **Usado em** do objeto de origem.
- Excluir algo que é usado avisa quem depende dele.

## 1. Serviços comuns que permitem as integrações

| Serviço | Pacote | Fase |
|---|---|---|
| URI global, resolução de objetos, "Usado em" | `@wj/dados` | G0 (local) / G5 (servidor) |
| Motor de fórmulas único e funções `WJ.*` | `@wj/formulas` | G2 |
| Texto rico e campos | `@wj/texto-rico` | G3 |
| Gráficos | `@wj/graficos` | G2 |
| Visualizador 3D leve (sem kernel) | `@wj/visualizador-3d` | G5 |
| Área de transferência rica entre faces | `@wj/nucleo` | G2 |
| Contas, permissões, notificações, comentários | `servidor/` | G5 |
| Eventos (pub/sub): "item liberado", "OP encerrada", "tarefa concluída" | `servidor/` | G5 |

## 2. Matriz de interações (origem → destino)

| De \ Para | WJCAD | WJPlan | WJWrite | WJApresentation | WJCronProject | WJPDM / WJERP |
|---|---|---|---|---|---|---|
| **WJCAD** | — | propriedades de massa, lista de corte, tabela de configurações, cotas como valores | vistas vinculadas, propriedades em campos, tabela de cotas | modelo 3D interativo, vistas | progresso de modelagem ⏸ | item, propriedades, revisão, estrutura, DXF/STEP de liberação, tempos de roteiro |
| **WJPlan** | variáveis globais/equações e tabela de configurações vindas de células | — | tabelas e gráficos vinculados | tabelas e gráficos vinculados | importar tarefas e recursos | importar listas (preços, itens, inventário) com conferência |
| **WJWrite** | — | — | — | gerar slides da estrutura de tópicos | comentários viram tarefas | modelos para propostas, OP, laudos; instruções de trabalho vinculadas às operações |
| **WJApresentation** | — | — | exportar folhetos/roteiro | — | — | — |
| **WJCronProject** | — | exportar tarefas, curva S | relatório de status, linha do tempo vinculada | linha do tempo, Gantt vinculados | — | projetos ↔ pedidos, capacidade finita, recursos, custos |
| **WJPDM / WJERP** | itens comprados para inserir, material com densidade/custo, custo estimado | consultas vivas, `WJ.ITEM` | dados de registros em modelos (mala direta) | painéis vinculados | OPs, apontamentos, recursos e calendários, ações de RNC | — |

## 3. Fluxos ponta a ponta (cenários de aceitação)

### F1 — Peça de chapa do projeto à fábrica
1. CAD: o engenheiro modela a peça de chapa e preenche as propriedades. Faz check-in no PDM
   (versão 1), estado *Em trabalho*.
2. PDM: "Enviar para aprovação" → o aprovador vê no celular (visualizador 3D, medir) → aprova.
   - Ação automática: revisão A; PDF + DXF do planificado + STEP gerados; item `12-0034` criado/
     atualizado no ERP com massa, material, espessura, área planificada, comprimento de corte e
     nº de dobras.
3. ERP:
   - MBOM: consumo de chapa = área × t × densidade × (1 + perda);
   - roteiro sugerido: corte laser (tempo calculado) → dobra (nº de dobras) → pintura;
   - custo standard calculado.
4. Pedido de venda com 50 peças → MRP sugere OP + compra de chapa → OP firmada; documentos da OP
   trazem o DXF da **revisão A** (travado).
5. Chão de fábrica (tablet): leitura do QR da OP, consulta ao 3D, apontamentos. O custo real fecha
   na OP. O Cronograma do projeto do cliente mostra a tarefa "Fabricação" com o progresso vindo dos
   apontamentos.

### F2 — Mudança de engenharia
1. ECR aberto a partir de uma RNC. Itens afetados mostram onde são usados, o estoque e as OPs abertas.
2. ECO liberada: revisão B no PDM; estrutura do ERP com vigência; disposição do estoque antigo.
3. Documentos vinculados à revisão A continuam presos nela. Os de "última liberada" avisam "atualizar".

### F3 — Proposta técnica-comercial
1. CRM: oportunidade → Proposta escolhe produto configurável → as opções escolhem a configuração do
   CAD → custo e preço.
2. Documento da proposta gerado do modelo:
   - campos do cliente/itens;
   - vista 3D da configuração;
   - tabela de preços vinculada à Planilha de formação de preço.
3. Apresentação comercial gerada (vistas, gráficos de prazo/custo). O cronograma preliminar vem de um
   modelo de projeto.

### F4 — Gestão do projeto
1. Pedido ganho → projeto criado no Cronograma do modelo (engenharia, compras, fabricação, montagem,
   entrega).
2. Tarefas de engenharia ligadas a itens do PDM: o marco "Liberação" fecha sozinho quando o fluxo
   libera a revisão.
3. Tarefas de fabricação ligadas às OPs (datas da capacidade finita); custos reais do ERP alimentam
   o valor agregado.
4. Relatório semanal: Documento modelo com a linha do tempo vinculada e indicadores (IDP/IDC) → PDF
   para o cliente.

### F5 — Planilha como painel de engenharia
1. Planilha com `=WJ.CAD("Suporte.jlscad";"Massa")` em linhas por peça e `=WJ.ITEM(A2;"Custo")`.
2. Tabela de configurações do CAD vinculada à mesma pasta: mudar a célula `D1@Esboço1` da
   configuração "Longa" e a peça regenera ao abrir o CAD.
3. Gráfico de massa por variante colado (vinculado) no relatório técnico.

## 4. Regras de consistência

- Escrita entre faces sempre por **ação explícita** do usuário ou por **fluxo aprovado** (nunca
  efeito colateral silencioso). Exemplo: a Planilha lê o ERP à vontade; gravar no ERP exige
  "Importar…" com conferência e permissão.
- Revisão liberada é **imutável**. Mudar exige ECR/ECO.
- Conflitos de sincronização:
  - arquivos colaborativos: CRDT (sem conflito);
  - registros do ERP: versionamento otimista ("o registro foi alterado por X; recarregar e
    reaplicar?").
- Permissões são verificadas na origem: um vínculo não mostra dados que o leitor não pode ver
  (aparece "🔒 sem permissão").
- Unidades: o vínculo leva a unidade junto (`kg`, `mm`, `R$`). As conversões são explícitas pelo
  motor de fórmulas (`CONVERTER`).
