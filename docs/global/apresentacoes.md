# WJApion — apresentações com propriedades avançadas (G4)

Inspiração funcional: software de apresentações profissional de mercado. Nomes, ícones e telas são nossos.
Arquivo nativo `.wjapn`. Importa/exporta `.pptx` (OOXML) e `.odp`. Exporta PDF (com ou sem notas,
folhetos), imagens PNG/SVG por slide e vídeo MP4/WebM (WebCodecs).
Reaproveita `@wj/texto-rico` (caixas de texto), `@wj/graficos`, `@wj/formulas` e `@wj/visualizador-3d`.
Status de tudo: **G4** salvo indicação.

---

## Estado da v1 (25/10/2026) — `apresentacao/index.html`, `src/apresentacao/`

✅ Editor de slides com miniaturas (arrastar reordena; menu com duplicar, ocultar, excluir):
- layouts Título, Título e conteúdo, Duas colunas, Seção, Só título e Em branco, com espaços
  reservados ("Clique duas vezes para adicionar…") que somem na apresentação se vazios;
- caixas de texto ricas (tamanho, negrito/itálico/sublinhado, cor, marcadores, numeração,
  alinhamento); formas retângulo, arredondado, elipse, triângulo, seta, estrela e linha
  (preenchimento, contorno, texto dentro); imagens;
- mover com encaixe no centro do slide, alças de redimensionar (Shift mantém a proporção),
  setas do teclado, copiar/recortar/colar/duplicar, ordem (frente/trás), centralizar;
- seis temas próprios, plano de fundo por slide, tamanho 16:9 ou 4:3;
- transições por slide (aplicar a todos) e animações de entrada por objeto, em sequência;
- apresentação em tela cheia (F5 / Shift+F5, setas, toque deslizando, B/W tela preta/branca),
  modo do apresentador (cronômetro, próximo slide, anotações), anotações do orador;
- imprimir/PDF um slide por página; arquivo `.wjapn`, salvamento automático, offline.

🟡 Próximos: mestre de slides editável, tabelas e gráficos (`@wj/graficos`), vista 3D do WJCAD,
grupos e rotação, linha do tempo de animações, folhetos, `.pptx`/`.odp`, exportar vídeo.

---

## 0. Modelo

- **Apresentação** → **mestre de slides** (1+) → **layouts** (Título, Título e conteúdo, Duas
  colunas, Comparação, Só título, Em branco, Seção, Imagem com legenda, personalizados) → **slides**.
- Slide:
  - objetos com posição, tamanho, rotação, ordem Z e grupo;
  - **espaços reservados** herdados do layout;
  - plano de fundo;
  - transição;
  - linha do tempo de animações;
  - **anotações do orador**;
  - comentários.
- **Tema**: 12 cores nomeadas (texto/fundo escuro e claro, 6 de destaque, hiperlink e visitado),
  par de fontes (títulos/corpo), efeitos, estilos de plano de fundo, variantes.
- Tamanho do slide: 16:9 (padrão), 4:3, A4, personalizado; ao mudar, maximizar ou ajustar o conteúdo.
- Seções de slides (agrupar, recolher, mover juntas).

## 1. Interface

- Abas: Início, Inserir, Desenhar, Design, Transições, Animações, Apresentação, Revisão, Exibir.
- Esquerda: **miniaturas** (arrastar para reordenar, duplicar, ocultar, seções) ou painel de comando
  (✓/✕).
- Centro: slide em edição com guias inteligentes (alinha a bordas/centros e mostra espaçamentos
  iguais), régua, grade, guias arrastáveis.
- Embaixo: anotações do orador (recolhível) e barra de status (slide X de Y, idioma, zoom, modos).
- Modos:
  - Normal;
  - Estrutura de tópicos (texto dos slides como lista editável);
  - Classificação de slides;
  - Leitura;
  - Página de anotações;
  - **Mestre** (slides, folhetos, anotações).
- Celular:
  - edição simplificada (texto, imagens, ordem, tema);
  - modo principal = **apresentar** e **controle remoto** de uma apresentação aberta em outro aparelho (G5).
- Tablet: caneta para desenhar/anotar no slide (aba Desenhar), converter tinta em forma e em texto ⏸.

## 2. Objetos

- **Caixa de texto** (texto rico completo):
  - autoajuste (reduzir texto ao transbordar / redimensionar forma / não ajustar);
  - colunas, margens internas, ancoragem vertical, direção do texto;
  - marcadores com níveis (Tab/Shift+Tab).
- **Formas**:
  - biblioteca própria: retângulos, básicas, setas, fluxograma, estrelas, textos explicativos,
    conectores com roteamento que se reconecta ao mover;
  - mesclar formas: unir, combinar, fragmentar, interseção, subtrair;
  - editar pontos (Bézier).
- Estilo de forma:
  - preenchimento (sólido, gradiente linear/radial com paradas, imagem, textura, padrão, transparência);
  - contorno (cor, espessura, traço, extremidades/setas);
  - efeitos (sombra, reflexo, brilho, bordas suaves, bisel 3D simples ⏸).
- **Imagens**:
  - cortar (em forma, proporção, preencher/ajustar), remover plano de fundo (assistido), correções,
    cor, transparência, efeitos artísticos ⏸, compactar;
  - **substituir imagem** mantendo tamanho/formato;
  - texto alternativo.
- **Tabelas** (estilos, mesclar, bordas, sombreamento, fórmulas simples do motor comum).
- **Gráficos** (`@wj/graficos`) com dados embutidos ou **vinculados à Planilha**; animar por série
  ou categoria.
- **Diagramas** (nome nosso):
  - layouts de lista, processo, ciclo, hierarquia, relação, matriz, pirâmide;
  - texto pelo painel de tópicos;
  - converter lista ↔ diagrama.
- Ícones, modelos 3D:
  - **peça do CAD** com orbitar ao apresentar, vistas salvas e cortes;
  - arquivos glTF/STL também aceitos.
- Vídeo:
  - aparar, iniciar (automático / ao clicar / em sequência), repetir, tela inteira, marcadores;
  - áudio (trilha de fundo em vários slides).
- **Equações** (mesmo editor dos Documentos), símbolos, WordArt-like "Texto estilizado" (nome nosso).
- Links e **ações** (ir para slide, primeiro/último, apresentação personalizada, URL, arquivo,
  executar animação), zoom de slide/seção/resumo (navegação não linear).
- Objetos vinculados do ecossistema:
  - tabela do ERP (consulta);
  - Gantt/linha do tempo do cronograma;
  - campo de propriedade (`{WJ Item … Preço}`).

## 3. Organizar

- Alinhar e distribuir (ao slide / aos objetos selecionados), girar e inverter, agrupar e desagrupar,
  ordem Z, painel de **seleção e visibilidade** (nomear, ocultar, reordenar), tamanho e posição exatos
  (painel de formatação), bloquear objeto.
- Pincel de formatação e de animação.

## 4. Design

- Galeria de temas próprios + variantes; personalizar cores/fontes do tema; salvar tema.
- Formatar plano de fundo (sólido, gradiente, imagem, padrão; aplicar a todos; ocultar gráficos do mestre).
- **Designer de slide** (sugestões de layout a partir do conteúdo) — ⏸ (depende do assistente).

## 5. Transições

- Tipos (nossos nomes e implementação):
  - sutis: cortar, esmaecer, empurrar, revelar, dividir, forma;
  - empolgantes: cubo, virar, galeria, cortina ⏸;
  - **Transformação** (nome nosso): anima objetos de mesmo nome entre slides consecutivos —
    posição, tamanho, cor, rotação e texto por palavra/letra.
- Opções de efeito (direção), duração, som, avançar ao clicar e/ou após tempo, aplicar a todos.

## 6. Animações

- Categorias:
  - **entrada** (aparecer, esmaecer, voar, flutuar, dividir, revelar, forma, roda, zoom, saltar);
  - **ênfase** (pulsar, girar, crescer/encolher, cor do texto, transparência, sublinhar);
  - **saída** (espelho das entradas);
  - **trajetórias** (linha, arco, curva, forma, personalizada desenhada; editar pontos; orientar).
- Opções de efeito: direção, sequência (como objeto único / por parágrafo / palavra / letra; por série
  em gráficos).
- Início: ao clicar, com a anterior, após a anterior; atraso; duração; repetir; retroceder ao terminar.
- **Gatilhos**: ao clicar em objeto, ao chegar a marcador de vídeo.
- **Painel de animações** com linha do tempo (barras arrastáveis), reordenar, visualizar.

## 7. Apresentação

- Do início / do slide atual (F5 / Shift+F5); apresentações personalizadas; ocultar slide;
  ensaiar intervalos; gravar narração e tinta ⏸.
- **Modo do apresentador**:
  - slide atual, próximo, anotações com zoom, cronômetro e relógio;
  - caneta/realce/apontador laser, apagar;
  - ir para slide (miniaturas), zoom em área, tela preta/branca;
  - legendas ao vivo ⏸.
  - Segunda tela pela Window Management/Presentation API (computador). No tablet, o espelhamento
    (cast) mostra o slide e o tablet fica com as notas.
- **Controle remoto**: celular conectado à mesma apresentação (G5, Durable Object): avançar,
  voltar, ver notas, apontador.
- Configurar: apresentada por orador / navegada em janela / quiosque (repete); com ou sem
  animações e narração; resolução.
- Apresentar on-line para participantes por link (só exibição sincronizada) — G5.

## 8. Revisão e arquivo

- Comentários, comparar apresentações, coautoria (G5), proteção, verificar acessibilidade
  (ordem de leitura, texto alternativo, contraste).
- Imprimir/exportar: slides, páginas de anotações, **folhetos** (1, 2, 3, 4, 6, 9 por página),
  estrutura de tópicos; molduras; escala de cinza.
- Reutilizar slides de outra apresentação (manter ou não a formatação de origem).
- **Gerar slides a partir de**:
  - estrutura de tópicos de um Documento (Título 1 = slide);
  - relatório de status do Cronograma;
  - painel do ERP;
  - vistas de uma peça do CAD (uma por slide).

## 9. Atalhos (computador)

- F5/Shift+F5 apresentar · Ctrl+M novo slide · Ctrl+D duplicar · Ctrl+G/Ctrl+Shift+G agrupar/desagrupar.
- Setas movem (Ctrl = fino) · Shift mantém a proporção · Alt desliga o encaixe.
- No modo apresentação: N/P próximo/anterior, número+Enter vai ao slide, B/W tela preta/branca,
  Ctrl+P caneta, Ctrl+L laser, E apaga.
