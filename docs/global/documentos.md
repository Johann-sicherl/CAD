# WJWord — processador de texto com propriedades avançadas (G3)

Inspiração funcional: processador de texto profissional de mercado. Nomes, ícones e telas são nossos.
Arquivo nativo `.wjdoc`. Importa/exporta `.docx` (OOXML), `.odt`, `.md`, `.html`, `.txt`, `.rtf` ⏸.
Exporta PDF (com marcadores, links, PDF/A ⏸).
Status de tudo: **G3** salvo indicação.

## Estado da v1 (25/10/2026) — `documento/index.html`, `src/documento/`

✅ Texto rico na folha com tamanho e margens reais (A4, Carta, Ofício, A5; retrato/paisagem;
margens em mm, padrão ABNT):
- estilos Normal, Título, Subtítulo, Título 1–3 (Ctrl+Alt+1..3), Citação e Código;
- fonte, tamanho, negrito/itálico/sublinhado/tachado, sobrescrito/subscrito, cor, realce;
- listas, recuos, alinhamentos, entrelinhas;
- tabelas (Tab entre células e nova linha no fim, menu de linhas/colunas), imagens (largura,
  alinhamento, texto alternativo), links, linha, quebra de página (Ctrl+Enter), campo de data;
- sumário com páginas aproximadas (inserir/atualizar), painel de navegação pelos títulos;
- localizar/substituir, contagem de palavras, ortografia do navegador em PT-BR;
- impressão/PDF com cabeçalho, rodapé e "Página X de Y"; marcas de fim de página na tela;
- colar de outros programas limpo (sem scripts/estilos estranhos);
- arquivos `.wjdoc`, abrir/exportar HTML e Markdown, abrir TXT, salvamento automático, offline.

🟡 Próximos: paginação real na tela (motor `@wj/paginacao`), estilos editáveis, notas de rodapé,
legendas e referências cruzadas, controle de alterações e comentários, mala direta, `.docx`.

---

## 0. Modelo do documento

- **Documento** → **seções** → blocos: parágrafo, tabela, imagem em linha, quebra, campo,
  sumário, equação, objeto vinculado.
- Cada seção tem:
  - página (tamanho, orientação, margens, colunas, numeração);
  - cabeçalho/rodapé (primeira página diferente, pares/ímpares diferentes, vinculado à anterior).
- Parágrafo → *runs* de texto com formatação de caractere.
- Objetos flutuantes ancorados ao parágrafo: imagem, forma, caixa de texto, gráfico, vista do CAD.
- Estilos em cascata: padrão do documento → estilo de parágrafo → estilo de caractere →
  formatação direta.
- Motor de paginação próprio (`@wj/paginacao`):
  - medição com as fontes reais (Canvas/OffscreenCanvas);
  - quebra de linha por Unicode (Intl.Segmenter) com hifenização PT-BR;
  - viúvas/órfãs, manter com o próximo, manter linhas juntas, quebra de página antes;
  - roda em Worker e repagina só a partir do ponto alterado.
- Modos de exibição:
  - **Layout de impressão** (páginas reais);
  - **Leitura** (colunas no tamanho da tela; padrão no celular);
  - **Web** (sem páginas);
  - **Estrutura de tópicos**;
  - **Rascunho**.

## 1. Interface

- Abas: Início, Inserir, Design, Layout, Referências, Correspondências, Revisão, Exibir.
- Painel lateral à esquerda (padrão do ecossistema):
  - **Navegação**: títulos com arrastar para reorganizar, páginas, resultados de busca;
  - ou o painel do comando ativo (✓/✕).
- Régua horizontal/vertical com recuos e tabulações arrastáveis.
- Barra de status: página X de Y, palavras, idioma, revisão, zoom, modos.
- Celular:
  - abre em **Leitura**; "Editar" muda para edição com barra de formatação acima do teclado;
  - estilos numa folha deslizante;
  - seleção com alças grandes; toque longo abre o menu.
- Tablet: caneta pode **anotar à mão** (camada de tinta) e converter escrita em texto ⏸.

## 2. Texto e formatação

- **Fonte**:
  - família, tamanho, negrito, itálico, sublinhado (estilos e cor), tachado (simples/duplo);
  - sobrescrito/subscrito, versalete, todas maiúsculas, oculto;
  - cor, realce, espaçamento entre caracteres, escala, posição, kerning;
  - efeitos de texto (contorno, sombra) simples.
- **Parágrafo**:
  - alinhamento (esquerda, centro, direita, justificado);
  - recuos (esquerda, direita, primeira linha, deslocamento);
  - espaçamento antes/depois, entrelinhas (simples, 1,5, duplo, pelo menos, exatamente, múltiplos);
  - tabulações (esquerda, centro, direita, decimal, barra; preenchimento);
  - bordas e sombreamento;
  - quebras de linha e de página (viúvas/órfãs, manter com o próximo, manter linhas juntas,
    quebra de página antes, suprimir números de linha, não hifenizar).
- **Marcadores e numeração**:
  - listas de vários níveis, com biblioteca e definição de nova lista;
  - formato por nível (1., a), i., 1.1.1, Capítulo 1);
  - vinculação nível ↔ estilo de título (numeração de títulos automática);
  - reiniciar/continuar numeração.
- **Estilos**:
  - galeria, painel de estilos;
  - modificar (baseado em, próximo estilo, atualização automática);
  - estilos de parágrafo, caractere, vinculado, tabela e lista;
  - inspetor de estilo (mostra o que é estilo e o que é direto);
  - conjuntos de estilos e **temas** (cores, fontes, efeitos);
  - importar estilos de outro documento/modelo.
- Copiar/colar formatação, limpar formatação, colar especial (manter origem / mesclar / só texto /
  vínculo).
- Localizar e substituir: formatação, estilos, caracteres especiais (^p, ^t), curingas/regex;
  "Ir para" página/seção/linha/indicador/comentário/campo/tabela/título.
- Revisão de texto: ortografia e gramática PT-BR (dicionário próprio, Hunspell-compatível), sinônimos,
  contagem de palavras, idioma por trecho, AutoCorreção (lista editável), AutoFormatação ao digitar
  (aspas inteligentes, listas automáticas, travessão).

## 3. Inserir

- Páginas: folha de rosto (modelos nossos), página em branco, quebra de página.
- **Tabelas**:
  - inserir (grade, desenhar, converter texto↔tabela);
  - mesclar/dividir células, distribuir linhas/colunas, ajuste automático (ao conteúdo / à janela /
    largura fixa);
  - **repetir linha de cabeçalho**, permitir quebra de linha entre páginas;
  - alinhamento e direção do texto na célula, margens da célula;
  - estilos de tabela com opções (cabeçalho, total, faixas, primeira/última coluna);
  - classificar;
  - **fórmulas na célula** com o motor comum (`=SOMA(ACIMA)`, referências A1 da tabela).
- Imagens:
  - do aparelho, câmera (celular/tablet), web;
  - cortar (inclusive em forma e proporção), girar, brilho/contraste, cor, transparência;
  - **disposição do texto**: alinhado, quadrado, comprimido, através, atrás, na frente, superior e
    inferior; posição relativa (página/margem/parágrafo/coluna), mover com o texto, travar âncora;
  - texto alternativo.
- Formas e caixas de texto (vinculadas em cadeia), ícones (biblioteca nossa), diagramas (organograma,
  processo, ciclo, hierarquia — nome nosso "Diagramas").
- Gráfico (`@wj/graficos`) com dados embutidos ou **vinculados a uma Planilha**.
- **Objetos vinculados do ecossistema**:
  - vista de peça do CAD (vista, escala, estilo de exibição, revisão);
  - intervalo de planilha;
  - tarefa ou Gantt do cronograma;
  - ficha de item do ERP;
  - todos atualizáveis (seção 8).
- Links (URL, lugar no documento, e-mail, objeto `wj://`), indicadores, referência cruzada.
- Cabeçalho, rodapé, número de página (posição, formato, iniciar em, por capítulo "2-5").
- **Campos**:
  - data/hora, autor, título, página, NUMPÁGS, SEÇÃO, nome do arquivo;
  - propriedades do documento e **propriedades personalizadas**;
  - **propriedade de objeto do ecossistema** (`{WJ Item "12-0034" Descrição}`, `{WJ CAD "Suporte.jlscad" Massa}`);
  - fórmula, SE, sequência (SEQ), referência (REF);
  - atualizar campos (F9), alternar código (Shift+F9), bloquear campo.
- Símbolos e caracteres especiais. **Equações**: editor visual (frações, raízes, matrizes,
  integrais, somatórios) com entrada linear tipo LaTeX; numeração de equações.
- Marca-d'água, cor e bordas de página.

## 4. Layout

- Margens (predefinidas e personalizadas, medianiz), orientação, tamanho (A4, A3, Carta, Ofício,
  personalizado).
- Colunas (1–n, larguras, linha entre, quebra de coluna).
- **Quebras de seção**: próxima página, contínua, página par, página ímpar.
- Números de linha (contínuo, reiniciar por página/seção).
- Hifenização automática/manual (zona, limite de hifens consecutivos).
- Organizar objetos: alinhar, agrupar, trazer para frente/enviar para trás, painel de seleção.

## 5. Referências

- **Sumário** automático (níveis, tabulação com preenchimento, links, estilos de sumário), atualizar
  só números ou tudo; sumário personalizado por estilos.
- **Notas de rodapé e de fim** (numeração, posição, continuar/reiniciar, converter entre tipos).
- **Citações e bibliografia** (fontes: livro, artigo, norma técnica, site; estilos ABNT NBR 6023,
  APA, IEEE; gerenciador de fontes).
- **Legendas** (Figura, Tabela, Equação, rótulos próprios; numeração com capítulo) e **Índice de
  ilustrações**.
- **Índice remissivo** (marcar entrada/subentrada, referência cruzada, colunas).
- Índice de autoridades ⏸.
- Referência cruzada a título, indicador, nota, legenda (texto, número, página, "acima/abaixo").

## 6. Correspondências (mala direta)

- Fonte de dados:
  - Planilha do ecossistema, CSV;
  - **consulta do ERP** (clientes, fornecedores, pedidos, itens);
  - lista digitada.
- Campos de mesclagem, regras (SE…ENTÃO, perguntar, pular registro, próximo registro),
  realçar campos, visualizar resultados, verificar erros.
- Saída: documento único, documentos separados, PDF por registro, e-mail ⏸ (G5 com servidor).
- Envelopes e etiquetas (fabricantes de etiquetas brasileiros comuns: modelos A4 por medidas).

## 7. Revisão

- **Controlar alterações**:
  - inserções, exclusões, formatação e movimentações, com autor/data e cor por autor;
  - exibir: marcação simples / toda a marcação / sem marcação / original;
  - balões ou em linha;
  - aceitar/rejeitar (um a um, todos, por autor), bloquear controle com senha.
- **Comentários** em thread com menções, resolver; exportar lista.
- **Comparar** dois documentos (gera documento com alterações) e **combinar** revisões de vários
  autores.
- Restringir edição: só leitura, só comentários, só formulários, exceções por pessoa/região.
- Proteção por senha; inspecionar documento (metadados, comentários ocultos) antes de enviar.
- Acessibilidade: verificador, leitura em voz alta (Web Speech API), ditado (onde o navegador permitir).

## 8. Vínculos vivos (G5+)

- Todo objeto vinculado guarda URI `wj://…` + versão/revisão usada.
- Ao abrir: "Há N vínculos desatualizados" → atualizar todos / revisar / manter.
- Opções por vínculo: automático, manual, travado numa revisão (ex.: documento técnico aprovado
  fica preso à revisão B da peça).

## 9. Formulários e modelos

- Controles de conteúdo: texto, texto rico, lista suspensa, caixa de combinação, data, caixa de
  seleção, imagem, seção repetitiva; vinculação a propriedades/XML personalizado.
- Modelos (`.wjdot`):
  - modelos nossos: relatório técnico, memorial descritivo, proposta comercial, ata, procedimento
    (POP), especificação técnica, laudo;
  - **modelos da empresa** (G5) com estilos travados.
- **Documento gerado pelo ERP**: proposta, ordem de produção, instrução de trabalho, certificado ⏸.
  O modelo é um `.wjdoc` com campos e regiões repetitivas preenchidos com os dados do registro.

## 10. Exibir e navegação

- Painel de navegação; régua; linhas de grade; zoom (página inteira, largura, várias páginas).
- Nova janela / dividir / lado a lado com rolagem sincronizada (computador).
- Modo foco (sem distrações); leitura imersiva (largura de linha, espaçamento, leitura em voz alta).

## 11. Atalhos (computador)

- Ctrl+N/B/I/U · Ctrl+E/L/R/J alinhamento · Ctrl+1/2/5 entrelinhas · Ctrl+Shift+N estilo Normal.
- Alt+Ctrl+1..3 Título 1..3 · Ctrl+K link · Ctrl+Enter quebra de página · Shift+Enter quebra de linha.
- F7 ortografia · Ctrl+Shift+E controlar alterações · F9 atualizar campo · Ctrl+H substituir.
- Ctrl+Shift+C/V copiar/colar formatação.
