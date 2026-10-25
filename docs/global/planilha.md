# WJPlaniel — planilha eletrônica com fórmulas avançadas (G2)

Inspiração funcional: planilha eletrônica profissional de mercado. Nomes, ícones e telas são nossos.
Arquivo nativo `.wjpl`. Importa/exporta `.xlsx` (OOXML), `.ods`, `.csv`/`.tsv`, PDF (exporta).
Status de tudo: **G2** salvo indicação.

## Estado da v1 (25/10/2026) — `planilha/index.html`, `src/planilha/`, motor em `src/formulas/`

✅ **Motor de fórmulas** (`src/formulas/`, testado em `scripts/teste-formulas.ts`):
- sintaxe brasileira (`;`, vírgula decimal), referências A1/$A$1/folha/'folha com espaço', A:A e 1:3;
- nomes definidos, referência circular → `#CICLO!`, erros que se propagam;
- ~150 funções (matemática, estatística, lógica, procura incl. PROCX, texto, data e hora com
  dias úteis, informação, financeiras VPL/VF/VP/PGTO/TIR, CONVERTER de unidades de engenharia);
- cálculo sob demanda com memória; deslocar referências ao copiar; ajustar ao inserir/excluir.

✅ **Planilha**:
- grade em Canvas (só o visível; 1.048.576 × 16.384), zoom, painéis congelados, linhas de grade;
- edição na célula e na barra de fórmulas, autocompletar de funções com dica de sintaxe, modo
  apontar (clicar/setas inserem referências), F4 alterna $, parênteses fechados sozinhos;
- seleção com mouse, Shift, cabeçalhos, Ctrl+setas; Tab/Enter como nas planilhas de mercado;
- copiar/recortar/colar (fórmulas e formatos internos; TSV de fora), alça de preenchimento
  (séries numéricas, datas, "Item 1", fórmulas), Ctrl+D/Ctrl+R;
- formatação: fonte, tamanho, cores, bordas, alinhamento, quebrar texto, formatos de número
  (geral, número, moeda R$, %, data, hora, científico, texto), casas decimais, milhar;
- inserir/excluir linhas e colunas, largura/altura arrastando (duplo clique ajusta), classificar,
  remover duplicatas, AutoSoma, inserir função, gerenciador de nomes, caixa de nome, localizar;
- várias planilhas (renomear atualiza fórmulas, duplicar, mover, excluir), desfazer/refazer;
- arquivos `.wjpl`, importar/exportar CSV, salvamento automático, offline, celular/tablet/computador.

🟡 Próximos: gráficos, tabela dinâmica, formatação condicional, validação de dados, filtros,
mesclar células, matrizes dinâmicas, `.xlsx`, colaboração (G5).

Formato de cada comando: **Nosso nome** → caixas do painel → campos e opções (como no CAD).

---

## 0. Estrutura e limites

- **Pasta de trabalho** → **planilhas** (abas) → células.
- Limites:
  - 1.048.576 linhas × 16.384 colunas (A…XFD), por compatibilidade com `.xlsx`;
  - armazenamento esparso (só células usadas);
  - grade virtualizada em Canvas (rola milhões de linhas no celular).
- Tipos de valor:
  - número (double, 15 dígitos significativos);
  - texto;
  - lógico (VERDADEIRO/FALSO);
  - erro: `#DIV/0!`, `#N/D`, `#NOME?`, `#REF!`, `#VALOR!`, `#NÚM!`, `#NULO!`, `#ESPALHAR!`, `#CALC!`, `#CICLO!`;
  - matriz;
  - data/hora como número serial (sistema 1900, compatível com xlsx, incluindo o bug de 29/02/1900
    marcado como compatibilidade).
- Tipos de dados vinculados (G5/G7): célula contém um **objeto** (item do ERP, peça do CAD, tarefa,
  cliente) com campos acessíveis por `A1.Preço`, `A1.Massa`, `A1.Estoque`.

## 1. Motor de fórmulas (`@wj/formulas`) — compartilhado por todas as faces

### 1.1 Linguagem
- Começa com `=`. Operadores:
  - aritméticos `+ - * / ^ %`;
  - texto `&`;
  - comparação `= <> < > <= >=`;
  - intervalo `:`, união `;` (separador PT-BR), interseção (espaço);
  - espalhamento `#` (ex.: `A1#`);
  - implícito `@`.
- Separador de argumentos `;` e decimal `,` (configuração regional). O arquivo guarda a forma
  canônica (`,` e `.`), convertida na exibição.
- Referências:
  - estilos A1 e L1C1 (alternável);
  - relativas, absolutas e mistas (`$A$1`, F4 alterna);
  - entre planilhas (`'Custos 2026'!B3`);
  - entre arquivos (`[Orçamento.wjpl]Resumo!B3`, com atualização de vínculos);
  - 3D (`Jan:Dez!B3`).
- **Nomes definidos** (pasta ou planilha): constante, intervalo ou fórmula. Gerenciador de nomes.
- **Tabelas estruturadas**: `Vendas[Valor]`, `Vendas[@Qtd]`, `Vendas[[#Totais];[Valor]]`.
- **Matrizes dinâmicas**: fórmulas que devolvem matriz espalham nas células vizinhas. Se houver
  bloqueio, dão `#ESPALHAR!` e a área bloqueada é destacada.
- `LET` (variáveis), `LAMBDA` (funções do usuário com nome) e funções auxiliares de lambda:
  MAP, REDUCE, SCAN, MAKEARRAY, BYROW, BYCOL.
- **Funções vinculadas ao ecossistema** (G5+):
  - `WJ.ITEM("cód";"campo")` e `WJ.ESTOQUE("cód";"armazém")`;
  - `WJ.CAD("arquivo";"Massa"|"Volume"|"D1@Esboço1")`;
  - `WJ.TAREFA("proj";"id";"Término")`;
  - `WJ.CONSULTA("nome")` (consulta salva do ERP, devolve matriz).

### 1.2 Cálculo
- Grafo de dependências com recálculo **incremental**: só recalcula o que depende do que mudou.
- Roda em Web Worker; a grade não trava.
- Modos: automático, automático exceto tabelas de dados, manual (F9 calcula; Shift+F9 só a planilha).
- Referência circular:
  - avisa e marca as células;
  - opção **cálculo iterativo** (máx. iterações, variação máxima).
- Funções voláteis (AGORA, HOJE, ALEATÓRIO, DESLOC, INDIRETO) recalculam a cada mudança.
- Precisão: "precisão como exibido" (opção da pasta).
- **Avaliar fórmula** passo a passo; **Rastrear precedentes/dependentes** (setas na grade);
  **Janela de inspeção** (células observadas).
- Verificação de erros em segundo plano: número como texto, fórmula inconsistente com as vizinhas,
  intervalo incompleto. Mostrada com triângulo no canto e menu de correção.

### 1.3 Biblioteca de funções (meta: ~450, nomes em PT-BR e EN; a forma canônica no arquivo é a EN)

| Categoria | Funções (amostra obrigatória) |
|---|---|
| Matemática e trigonometria | SOMA, SOMASE, SOMASES, SOMARPRODUTO, PRODUTO, ARRED, ARREDONDAR.PARA.CIMA/BAIXO, TETO.MAT, ARREDMULTB.MAT, INT, TRUNCAR, RESTO, MOD, MDC, MMC, POTÊNCIA, RAIZ, EXP, LN, LOG, LOG10, PI, SEN/COS/TAN e inversas/hiperbólicas, GRAUS, RADIANOS, ALEATÓRIO, ALEATÓRIOENTRE, MATRIZ.ALEATÓRIA, SEQUÊNCIA, MATRIZ.MULT, MATRIZ.INVERSO, MATRIZ.DETERM, SUBTOTAL, AGREGAR, COMBIN, FATORIAL, ABS, SINAL |
| Estatística | MÉDIA, MÉDIASE, MÉDIASES, MED, MODO, CONT.NÚM, CONT.VALORES, CONT.SE, CONT.SES, CONTAR.VAZIO, MÁXIMO, MÍNIMO, MÁXIMOSES, MÍNIMOSES, MAIOR, MENOR, ORDEM, PERCENTIL, QUARTIL, DESVPAD.A/P, VAR.A/P, CORREL, COVARIÂNCIA, PREVISÃO.LINEAR, PREVISÃO.ETS, TENDÊNCIA, CRESCIMENTO, PROJ.LIN, INCLINAÇÃO, INTERCEPÇÃO, RQUAD, DIST.NORM.N, INV.NORM.N, DIST.T, TESTE.T, FREQUÊNCIA |
| Pesquisa e referência | PROCX, CORRESPX, PROCV, PROCH, ÍNDICE, CORRESP, ESCOLHER, ESCOLHERCOLS/LINS, DESLOC, INDIRETO, LIN, COL, LINS, COLS, FILTRO, CLASSIFICAR, CLASSIFICARPOR, ÚNICO, TRANSPOR, EMPILHARV/H, PARACOL, PARALIN, TOMAR, DESCARTAR, EXPANDIR, HIPERLINK, ENDEREÇO, AREAS |
| Lógica | SE, SES, E, OU, XOU, NÃO, SEERRO, SENÃODISP, PARÂMETRO (switch), VERDADEIRO, FALSO, LET, LAMBDA, MAP, REDUCE, SCAN, BYROW, BYCOL, MAKEARRAY |
| Texto | CONCAT, CONCATENAR, UNIRTEXTO, TEXTO, VALOR, ESQUERDA, DIREITA, EXT.TEXTO, NÚM.CARACT, LOCALIZAR, PROCURAR, SUBSTITUIR, MUDAR, ARRUMAR, MAIÚSCULA, MINÚSCULA, PRI.MAIÚSCULA, REPT, TEXTOANTES, TEXTODEPOIS, DIVIDIRTEXTO, LIMPAR, CARACT, CÓDIGO, UNICAR, VALORNUMÉRICO, EXATO, FIXO, MOEDA, REGEXTESTE/REGEXEXTRAIR/REGEXSUBST |
| Data e hora | HOJE, AGORA, DATA, HORA, TEMPO, DIA, MÊS, ANO, DIA.DA.SEMANA, NÚMSEMANA, NÚMSEMANAISO, DATAM, FIMMÊS, DIATRABALHO, DIATRABALHO.INTL, DIATRABALHOTOTAL(.INTL), DATADIF, FRAÇÃOANO, DIAS, DATA.VALOR, VALOR.TEMPO; calendário de feriados nacionais BR embutido como intervalo nomeado opcional |
| Financeiras | VPL, XVPL, TIR, XTIR, MTIR, VF, VP, PGTO, IPGTO, PPGTO, NPER, TAXA, EFETIVA, NOMINAL, SLN, BD, BDD, DPD, PREÇO, RENDIMENTO, DURAÇÃO |
| Engenharia | CONVERTER (unidades SI/imperial, incluindo mm, N, MPa, kgf), BIN/DEC/HEX/OCT entre si, COMPLEXO e IM* (complexos), DELTA, DEGRAU, FUNERRO, BESSELJ/Y/I/K |
| Informação | É.CÉL.VAZIA, ÉERRO, ÉERROS, ÉNÚM, ÉTEXTO, ÉLÓGICO, ÉNÃO.DISP, ÉFÓRMULA, TIPO, TIPO.ERRO, CÉL, INFORMAÇÃO, N, NÃO.DISP, FÓRMULATEXTO, PLAN, PLANS |
| Banco de dados | BDSOMA, BDMÉDIA, BDCONTAR, BDCONTARA, BDMÁX, BDMÍN, BDEXTRAIR, BDPRODUTO, BDDESVPA |
| Web/ecossistema | WJ.ITEM, WJ.ESTOQUE, WJ.CAD, WJ.TAREFA, WJ.CONSULTA, SERVIÇOWEB (só com permissão), FILTROXML ⏸ |

Ajuda: dica de argumentos ao digitar (assinatura com o argumento atual em negrito), lista
de funções com autocompletar, janela **Inserir função** (busca por categoria e por descrição, campos
por argumento com valor parcial).

## 2. Interface

- **Faixa de comandos** (abas nossas):
  - Início: área de transferência, fonte, alinhamento, número, estilos, células, edição;
  - Inserir;
  - Página;
  - Fórmulas;
  - Dados;
  - Revisão;
  - Exibir;
  - Automatizar.
- **Barra de fórmulas**:
  - caixa de nome (vai para célula/nome; cria nome);
  - botões ✕ ✓ fx;
  - expansível para várias linhas, com realce de sintaxe e parênteses coloridos;
  - referências coloridas: cada referência na fórmula tem a mesma cor da borda na grade, e a
    borda pode ser arrastada para mudar a referência.
- **Grade**:
  - cabeçalhos de linha e coluna;
  - congelar painéis;
  - dividir janela;
  - zoom 10–400 %;
  - linhas de grade;
  - quebra de página (modo de exibição Quebra de página);
  - Layout de página com régua.
- **Barra de status**: modo (Pronto/Digitar/Editar/Apontar), resumo da seleção configurável
  (Soma, Média, Contagem, Mín., Máx.), zoom, modos de exibição.
- Abas das planilhas: inserir, renomear, mover/copiar, cor, ocultar, proteger, agrupar várias.

### 2.1 Celular e tablet
- Toque seleciona. Alças nos cantos estendem a seleção. Toque duplo edita. Toque longo abre o menu.
- **Teclado de fórmulas próprio**: números, operadores, `( ) ; : $`, setas e "fx". Alterna com o
  teclado de texto do sistema.
- Funções recentes ficam na barra acima do teclado.
- Alça de preenchimento grande. Arrastar com 1 dedo rola; com caneta seleciona.
- Celular:
  - a barra de fórmulas vira uma linha fixa acima do teclado;
  - a faixa de comandos vira barra inferior com "⋯";
  - formatação em folha deslizante.

## 3. Edição e entrada

- Digitação com reconhecimento de tipo: número, data, hora, %, moeda e fração.
- **Preencher**:
  - alça de preenchimento: série linear, datas por dia/útil/mês/ano, listas personalizadas, copiar;
  - Ctrl+Enter preenche a seleção;
  - **Preenchimento relâmpago** (detecta padrão pelos exemplos digitados).
- Colar especial: valores, fórmulas, formatos, comentários, validação, larguras, transpor,
  operação (somar/subtrair/multiplicar/dividir), ignorar em branco, colar vínculo, colar como imagem.
- Localizar e substituir: em fórmulas, valores, comentários; diferenciar maiúsculas; célula
  inteira; na planilha ou na pasta; expressões regulares.
- **Ir para especial**: em branco, constantes, fórmulas (por tipo), diferenças de linha/coluna,
  precedentes, dependentes, última célula, visíveis, formatação condicional, validação.
- Inserir/excluir células (deslocando), linhas e colunas; ocultar/reexibir; agrupar e **estrutura de
  tópicos** (níveis 1–8, subtotais automáticos).
- Desfazer/refazer com histórico de 100 passos e lista.
- Verificar ortografia (dicionário PT-BR, G3 compartilhado).

## 4. Formatação

- **Formato de número**:
  - Geral, Número (casas, separador de milhar, negativos em vermelho), Moeda, Contábil, Data,
    Hora, Porcentagem, Fração, Científico, Texto, Especial (CEP, CPF, CNPJ, telefone);
  - **Personalizado** com códigos de formato (seções `positivo;negativo;zero;texto`, cores
    `[Vermelho]`, condições `[>1000]`, `0,0.. "mil"`), compatível com xlsx.
- Fonte, tamanho, negrito/itálico/sublinhado/tachado, sobrescrito/subscrito, cor, preenchimento
  (sólido, padrão, gradiente), bordas (estilo/cor por lado e diagonais).
- Alinhamento: horizontal (incluindo centralizar na seleção e distribuído), vertical, recuo,
  orientação/ângulo do texto, quebrar texto, reduzir para caber, mesclar e centralizar.
- **Estilos de célula** (nossos, editáveis) e **temas** da pasta (cores e fontes).
- **Formatação condicional**:
  - regras: realçar (maior que, entre, texto contém, datas, duplicados), primeiros/últimos N ou %,
    acima/abaixo da média;
  - barras de dados, escalas de cor (2/3 cores), conjuntos de ícones (nossos ícones);
  - regra por **fórmula**;
  - gerenciador com ordem, "parar se verdadeiro" e intervalo de aplicação.
- Pincel de formatação (1 clique / duplo = fixo).
- Altura de linha e largura de coluna: manual, AutoAjuste (duplo clique na divisa), padrão.

## 5. Tabelas, dados e análise

- **Tabela** (formatar como tabela):
  - estilo, linha de cabeçalho, linha de totais (função por coluna), linhas em faixas;
  - colunas calculadas (a fórmula se propaga), nome, expansão automática;
  - segmentação (botões de filtro).
- **Classificar**: vários níveis por valor, cor da célula/fonte, ícone; lista personalizada;
  da esquerda para a direita; diferenciar maiúsculas.
- **Filtro**: AutoFiltro por coluna (valores, texto, número, data com hierarquia ano/mês/dia, cor,
  top 10) e **Filtro avançado** (intervalo de critérios, copiar para outro local, únicos).
- **Validação de dados**: qualquer valor, número inteiro/decimal, lista (intervalo ou fixa, com
  seta), data, hora, comprimento do texto, personalizada (fórmula). Mensagem de entrada e alerta de
  erro (parar/aviso/informação). Circular dados inválidos.
- Remover duplicatas; **Texto para colunas** (delimitado/largura fixa, tipos por coluna);
  consolidar (soma/média… por posição ou por rótulo, com vínculo).
- **Tabela dinâmica**:
  - fonte: intervalo, tabela, consulta, modelo de dados (várias tabelas relacionadas);
  - campos em Filtros/Colunas/Linhas/Valores;
  - resumo por soma/contagem/média/máx/mín/produto/desvpad/var;
  - mostrar valores como % do total/coluna/linha/pai, diferença de, % de, acumulado, classificação;
  - agrupamento de datas (anos/trimestres/meses/dias) e de números (intervalos), grupos manuais;
  - campos e itens calculados;
  - layout (compacto, tópicos, tabular), subtotais e totais gerais;
  - atualizar ao abrir;
  - **gráfico dinâmico** e segmentações/linha do tempo ligadas.
- **Consultas de dados** (nome nosso: "Obter e transformar"):
  - fontes: CSV/TXT, xlsx, JSON, pasta, web (com permissão), outra planilha, **ERP do WJProMaster** (G7);
  - etapas registradas: promover cabeçalho, alterar tipo, filtrar, remover colunas, dividir, mesclar
    consultas (junções), acrescentar, agrupar, dinamizar/despivotar, coluna personalizada (fórmula);
  - atualizar sob demanda ou ao abrir; carregar em tabela ou no modelo de dados.
- **Teste de hipóteses**:
  - Gerenciador de cenários (células variáveis, resumo);
  - **Atingir meta** (definir célula / para valor / alterando célula);
  - **Tabela de dados** de 1 e 2 variáveis.
- **Otimizador** (nome nosso para o solver):
  - definir objetivo (máx./mín./valor) e células variáveis;
  - restrições (≤, =, ≥, int, bin, dif);
  - métodos: Simplex LP e GRG não linear; evolucionário ⏸;
  - relatórios de resposta e sensibilidade.
- **Análise de dados** (ferramentas): estatística descritiva, histograma, regressão,
  correlação, média móvel, amostragem, teste t, ANOVA de fator único.
- **Previsão**: planilha de previsão a partir de série temporal (ETS), com intervalo de confiança.

## 6. Gráficos (`@wj/graficos`, compartilhado)

- Tipos:
  - coluna, barra, linha, área (empilhados e 100 %), pizza, rosca;
  - dispersão (XY), bolhas, radar, ações (OHLC), superfície ⏸;
  - histograma, pareto, caixa (boxplot), cascata (ponte), funil, combinação, mapa de árvore,
    explosão solar.
- Elementos: títulos, eixos (mín./máx./unidade, log, datas), legenda, rótulos de dados (valor,
  % ou de células), linhas de grade, barras de erro, linhas de tendência (linear, exp, log, polinomial,
  potência, média móvel; equação e R²), eixo secundário.
- Painel de formatação à esquerda (padrão do ecossistema) com caixas por elemento.
- Filtros de gráfico, alternar linha/coluna, selecionar dados (séries e categorias).
- **Minigráficos** dentro da célula (linha, coluna, ganho/perda).
- Gráfico vinculado pode ser colado em Documentos/Apresentações e continua atualizando (ver integracoes.md).

## 7. Página e impressão

- Margens, orientação, tamanho, área de impressão, títulos a imprimir (linhas/colunas repetidas).
- Ajustar para N páginas de largura × M de altura, escala.
- Cabeçalho/rodapé com campos (página, total, data, arquivo, planilha, imagem).
- Quebras manuais; ordem das páginas. Visualizar impressão; exportar PDF (`@wj/paginacao`).

## 8. Revisão e proteção

- Comentários em thread com menções; anotações simples.
- Proteger planilha (o que é permitido: selecionar, formatar, inserir, classificar, filtro,
  tabela dinâmica) com células desbloqueadas; proteger a estrutura da pasta; intervalos editáveis
  por pessoa (G5).
- Controle de versões e coautoria (seção 5.3 do README).
- Acessibilidade: verificador (texto alternativo, contraste, células mescladas).

## 9. Automatizar

- **Scripts** em TypeScript/JavaScript, numa área isolada (Worker, sem acesso à rede salvo
  permissão), com API de objetos da pasta (`pasta.planilha("X").intervalo("A1:B9").valores`).
  Substitui as macros de linguagem proprietária. Arquivos `.xlsm` têm as macros ignoradas e o
  usuário é avisado.
- **Gravador de ações** que gera o script.
- Botões e formulários simples na planilha disparando scripts.
- Gatilhos: ao abrir, ao alterar intervalo, agendado (G5, no servidor).

## 10. Integrações específicas (detalhe em integracoes.md)

- **CAD**:
  - tabela de configurações do CAD = intervalo da planilha (linhas = configurações, colunas =
    parâmetros `D1@Esboço1`);
  - variáveis globais do CAD vinculadas a células;
  - exportar propriedades de massa e lista de corte para a planilha.
- **ERP**: consultas, `WJ.ITEM`, gravação de volta somente por ação explícita (importar lista de
  preços, ajuste de inventário) com conferência e permissão.
- **Cronograma**: exportar/importar tarefas; gráficos de curva S.

## 11. Atalhos (computador)

- F2 editar · F4 alterna `$` · F9 calcular · Ctrl+; data · Ctrl+Shift+; hora · Alt+= AutoSoma.
- Ctrl+setas vão até a borda dos dados · Ctrl+Shift+setas selecionam.
- Ctrl+Espaço coluna · Shift+Espaço linha · Ctrl+T tabela · Ctrl+1 formatar células.
- Ctrl+D/R preencher abaixo/direita · Ctrl+E preenchimento relâmpago · Alt+Enter quebra na célula.
- Ctrl+PgUp/PgDn troca de planilha.
