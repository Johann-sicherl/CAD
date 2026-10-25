# WJCronProject — planejamento e controle de projetos (G6)

Inspiração funcional: gerenciador de projetos profissional com Gantt. Nomes, ícones e telas são nossos.
Arquivo nativo `.wjcron` (e projetos no servidor a partir da G5/G6).
Importa/exporta **MSPDI XML** (formato XML documentado), `.xlsx`/`.csv` (mapa de campos), exporta PDF.
O binário `.mpp` não é suportado: ele é proprietário; quem tiver deve salvar em XML.
Motor de agendamento puro em `@wj/agenda`, testado em Node (CPM, calendários, nivelamento, valor agregado).
Status de tudo: **G6** salvo indicação.

---

## Estado da v1 (25/10/2026) — `cronograma/index.html`, `src/cronograma/`, motor `src/agenda/`

✅ Motor de agendamento puro e testado (`scripts/teste-agenda.ts`):
- CPM com passagem para frente e para trás, folga total e livre, caminho crítico;
- vínculos TI/II/TT/IT com latência/antecipação em dias ou % (`5II+2d`, `7TT-25%`), também em
  resumos; ciclo detectado e avisado;
- restrições (as oito), data limite, tarefa inativa, marcos, resumos por nível de estrutura e EAP;
- calendário com dias úteis, feriados nacionais do Brasil (Páscoa calculada: Sexta-feira Santa;
  Carnaval e Corpus Christi opcionais) e folgas próprias;
- recursos de trabalho, material e custo: trabalho, custo e superalocação por dia.

✅ Aplicativo:
- tabela editável como planilha (Enter/Tab/setas, digitar direto, linhas vazias no fim criam
  tarefas), tabelas Entrada, Agenda (folgas, datas tardias, restrições) e Custo/linha de base;
- Gantt com escala dia/semana/mês, fins de semana e feriados sombreados, hoje e data de status,
  resumos, marcos, progresso, linha de base e caminho crítico em vermelho;
- arrastar barra move (restrição "não iniciar antes de"), puxar a ponta muda a duração, arrastar
  para outra linha vincula; recuar/recuar à esquerda, vincular/desvincular, recolher resumos;
- informações da tarefa (geral, predecessoras, recursos, avançado, anotações) e do projeto
  (início, data de status, calendário); filtros (críticas, marcos, atrasadas…);
- planilha de recursos com superalocados em vermelho; quadro de cartões por situação (arrastar
  muda o % concluído), bom para o celular;
- linha de base, estatísticas e valor agregado (VP, VA, CR, IDP, IDC, EAT);
- `.wjcron`, exportar CSV, exportar e abrir XML de projeto (MSPDI), imprimir, exemplo pronto,
  salvamento automático, offline.

🟡 Próximos: agendamento manual, durações decorridas, calendários por recurso, nivelamento,
uso da tarefa/recurso por período, diagrama de rede, linha do tempo, tarefas recorrentes,
campos personalizados com fórmulas, apontamento de horas, integração com ERP/PDM.

---

## 0. Modelo

- **Projeto**:
  - data de início (agendar a partir do início) ou de término (agendar a partir do término);
  - data de status; calendário do projeto; moeda;
  - opções de cálculo; campos personalizados; linhas de base 0–10.
- **Tarefa**:
  - Id, EDT/EAP (código automático 1.2.3 ou máscara personalizada), nome, nível de estrutura;
  - resumo / subtarefa / **marco**, ativa/inativa;
  - modo **agendado automaticamente** ou **manualmente**;
  - duração (min, h, d, sem, mês; "decorrida" `ed`; estimada `?`), início, término, trabalho, custo;
  - tipo: unidades fixas, duração fixa, trabalho fixo; **controlada pelo empenho**;
  - **restrição**: o mais cedo possível, o mais tarde possível, deve iniciar em, deve terminar em,
    não iniciar antes de, não iniciar depois de, não terminar antes de, não terminar depois de;
  - **data limite** (prazo, com indicador se ultrapassada);
  - prioridade 0–1000 (para nivelamento);
  - calendário da tarefa (ignorar calendário dos recursos);
  - % concluído, % trabalho concluído, % físico;
  - início/término reais, duração real/restante, trabalho real/restante, custo real;
  - anotações (texto rico), anexos, vínculos `wj://` (item PDM, OP do ERP, documento).
- **Vínculos**:
  - Término-Início (TI), Início-Início (II), Término-Término (TT), Início-Término (IT);
  - latência/antecipação em tempo ou % (`TI+2d`, `II-25%`);
  - entre projetos (externos).
- **Recursos**:
  - tipos: **trabalho** (pessoa, máquina, centro de trabalho do ERP), **material** (com rótulo de
    unidade: kg, m, peça) e **custo** (viagem, frete);
  - unidades máximas (%) com disponibilidade por período;
  - calendário próprio; grupo; código; e-mail/usuário;
  - taxas padrão/hora extra, custo por uso, **tabelas de taxas A–E** com datas de vigência;
  - acumulação (início, rateado, término).
  - Pool de recursos compartilhado entre projetos (G5: recursos vêm do cadastro do ERP).
- **Atribuição**: recurso × tarefa com unidades, trabalho, perfil de distribuição (simples,
  carregado no fim/início, duplo pico, sino, tartaruga…), atraso de nivelamento/atribuição,
  tabela de taxa.
- **Calendários**:
  - semana útil (horários por dia), exceções (feriados BR nacionais incluídos; estaduais/municipais
    selecionáveis; recorrência anual), semanas de trabalho alternativas;
  - base: Padrão (seg–sex 8–12, 13–17), 24 horas, Turno da noite, personalizados;
  - opções: horas/dia, horas/semana, dias/mês (conversão de durações).

## 1. Motor de agendamento

- **CPM**:
  - passagem para frente (início/término mais cedo) e para trás (mais tarde);
  - folga total e folga livre;
  - **caminho crítico** (folga ≤ limite configurável; vários caminhos críticos; crítico por
    projeto ou por data limite).
- Ordem de cálculo: calendários → vínculos → restrições → datas limite → realizado.
  - Conflito de restrição gera aviso com opções: mover, manter, trocar a restrição.
- Fórmula do empenho:
  - Trabalho = Duração × Unidades, respeitando o tipo da tarefa;
  - controlada pelo empenho redistribui ao adicionar/remover recursos;
  - indicador "inteligente" pergunta a intenção (nome e texto nossos).
- **Tarefas de resumo** acumulam datas, trabalho e custo. Resumo do projeto (tarefa 0).
- **Agendamento manual**: datas do usuário são respeitadas; o motor só avisa (sublinhado vermelho)
  sobre conflitos.
- **Nivelamento de recursos**:
  - automático ou manual;
  - base: minuto/hora/dia/semana/mês;
  - ordem: só Id / padrão (folga, datas, prioridade, restrições) / prioridade+padrão;
  - nivelar dentro da folga disponível;
  - nivelamento pode ajustar atribuições individuais e dividir trabalho restante;
  - limpar nivelamento;
  - **Inspetor de tarefas**: por que a tarefa está nessa data (fatores de agendamento) e sugestões.
- Atualização do projeto:
  - reagendar trabalho não concluído para depois da data de status;
  - atualizar como agendado até a data.
- Recalcular é incremental, em Worker. Projetos de 10.000 tarefas recalculam em < 1 s no computador.

## 2. Modos de exibição

| Modo | Conteúdo |
|---|---|
| **Gantt** (padrão) | tabela à esquerda + barras: tarefas, resumos, marcos (losango), progresso, linhas de vínculo, linha de base (barra fina), folga, caminho crítico em vermelho, data de status e "hoje" |
| Gantt de controle | real × linha de base, variação |
| Gantt de várias linhas de base | comparar 0, 1, 2 |
| **Linha do tempo** | faixa resumida com tarefas/marcos escolhidos (vai para Documentos/Apresentações) |
| **Diagrama de rede** | caixas com campos configuráveis, layout automático, crítico destacado |
| Calendário | mês/semana com barras das tarefas |
| **Uso da tarefa** / **Uso do recurso** | trabalho por período (escala do tempo) com detalhes: trabalho, real, custo, superalocação, disponibilidade |
| Planilha de recursos | cadastro; superalocados em vermelho |
| Gráfico de recursos | histograma de alocação × disponibilidade |
| Planejador de equipe | linhas por recurso com tarefas arrastáveis entre pessoas |
| **Quadro (Kanban)** | colunas por status/campo; cartões = tarefas |
| Formulário de tarefa / recurso | painel inferior com atribuições, predecessoras e sucessoras |

- **Tabelas** (conjuntos de colunas): Entrada, Agenda, Custo, Trabalho, Controle, Variação, Valor
  agregado, Resumo, Uso — e tabelas personalizadas.
- **Filtros**: críticas, atrasadas, marcos, resumo, concluídas, incompletas, recurso X, intervalo
  de datas, personalizados com E/OU; realçar em vez de filtrar.
- **Grupos**: por recurso, prioridade, status, campo personalizado; intervalos.
- **Escala de tempo**: até 3 níveis (ano/semestre/trimestre/mês/semana/dia/hora), formatos,
  zoom ajustado ao projeto.
- Formatar barras:
  - estilos por tipo de tarefa (cor, forma, padrão, texto nas barras);
  - linhas de grade;
  - layout (tipo de linha de vínculo, altura, datas arredondadas).
- Celular:
  - **lista de tarefas com cartões** ("Minhas tarefas": atualizar %, apontar horas, comentar);
  - Gantt em leitura com pinça para zoom;
  - edição de estrutura no tablet/computador.
- Tablet: arrastar barras com o dedo ou a caneta (mover, alongar, vincular puxando de uma barra à outra).

## 3. Edição

- Inserir tarefa, marco, resumo, tarefa recorrente (diária/semanal/mensal com fim por data ou número).
- Recuar/recuar à esquerda (estrutura), mover, mostrar subtarefas, nível de estrutura.
- Vincular (Ctrl+F2) / desvincular, informações da tarefa (caixa completa: Geral, Predecessoras,
  Recursos, Avançado, Anotações, Campos personalizados).
- Atribuir recursos (painel com filtro e disponibilidade), substituir recurso, equipe.
- Dividir tarefa (interrupção), inativar, agendar manualmente ↔ automaticamente.
- Copiar/colar entre projetos e para a Planilha (mantém colunas).
- Desfazer múltiplo (100 passos).

## 4. Controle e linhas de base

- Definir linha de base (projeto inteiro ou tarefas selecionadas; acumular nos resumos); limpar;
  **plano provisório** (só datas).
- Atualizar tarefas (% concluído rápido 0/25/50/75/100, real, restante), atualizar projeto, mover projeto.
- **Apontamento de horas** (timesheet) por recurso/semana — vem do celular e do ERP (G7);
  aprovação pelo gerente.
- Variação de início/término/duração/trabalho/custo.
- **Valor agregado**:
  - VP (BCWS), VA (BCWP), CR (ACWP), VPR/VA, VC, VAC, EAC (ONT), IDC (CPI), IDP (SPI), IDPT (TCPI);
  - método por % concluído ou % físico;
  - data de status como referência;
  - curva S (gráfico).
- Relatórios:
  - visão geral, custo, trabalho, tarefas atrasadas, marcos, recursos superalocados, fluxo de caixa;
  - painéis personalizáveis (gráficos e tabelas do `@wj/graficos`);
  - exportar para Documentos/Apresentações (vinculados).

## 5. Campos personalizados

- Tipos: texto, número, custo, data, início, término, duração, sinalizador, código de estrutura
  (com máscara e lista).
- Valor por **fórmula do motor comum**, por exemplo `SE([Variação de término]>5;"Atrasada";"Ok")`
  ou `DIATRABALHO([Início];10)`.
- Indicadores gráficos (ícones nossos por condição) e cálculo para linhas de resumo (soma, máx., média,
  fórmula).
- Listas de valores (pesquisa) e campos obrigatórios (G5).

## 6. Vários projetos

- Subprojetos inseridos (vinculados), projeto mestre.
- Pool de recursos compartilhado; vínculos entre projetos.
- **Portfólio** (G7): lista de projetos com saúde (IDP/IDC), recursos por período, priorização.

## 7. Integrações específicas (detalhe em integracoes.md)

- ERP:
  - projeto ligado a pedido de venda/contrato;
  - tarefas de fabricação geradas das **ordens de produção** (operações/roteiro);
  - recursos = colaboradores e centros de trabalho com custo-hora;
  - apontamentos e custos reais voltam do ERP;
  - capacidade finita usa o mesmo motor.
- PDM: tarefa de engenharia ligada ao item/revisão; marco "Liberação de projeto" fecha quando o
  fluxo de aprovação libera a revisão.
- Planilha: exportar/importar; curva S.
- Documentos/Apresentações: relatório de status gerado de modelo; linha do tempo vinculada.
- Comentários de qualquer face podem virar tarefa.

## 8. Atalhos (computador)

- Ins nova tarefa · Alt+Shift+→/← recuar/recuar à esquerda · Ctrl+F2 vincular · Ctrl+Shift+F2 desvincular.
- Shift+F2 informações da tarefa · Alt+F10 atribuir recursos · Ctrl+Shift+F5 rolar até a tarefa.
- F9 calcular (no modo manual) · Alt+Home/End início/fim do projeto.
