# Desenho — ambiente de detalhamento (vistas 2D, cotas e tabelas)

Formato de cada comando: **Nosso nome** (referência) → caixas do painel → campos e opções.
Status: ✅ existe · 🟡 parcial · D-A…D-D etapa do roteiro de desenho · ⏸ fora do escopo atual.
Normas brasileiras como padrão: formatos ABNT NBR 10068 (A4–A0), legenda NBR 10582,
**1º diedro** NBR 10067 (3º diedro opcional), linhas NBR 8403, cotagem NBR 10126, unidade mm.

---

## 0. Conceitos

- **Arquivo de desenho** `.wjdrw` (formato `wjdrw`), aberto no WJCAD (Novo → Desenho, ou
  **Criar desenho** a partir da peça/montagem aberta). Salva no cofre como os outros arquivos.
- **Modelo referenciado**: peça `.wjcad` ou montagem `.wjasm` (id do arquivo no cofre + cópia
  embutida, como os componentes da montagem). As vistas são **associativas**: mudou o modelo,
  as vistas e as cotas se atualizam ao abrir/regenerar o desenho.
- **Folhas**: um desenho tem uma ou mais folhas; cada folha tem **formato** (tamanho, margem,
  legenda), **escala** padrão e **tipo de projeção** (1º/3º diedro).
- **Vistas**: cada vista é uma projeção do modelo (linhas visíveis e ocultas calculadas pelo
  kernel, HLR) numa orientação e escala, colocada na folha.
- **Anotações**: cotas, notas, balões, símbolos e tabelas, presos a uma vista (movem com ela)
  ou à folha.

## 1. Interface

- **Abas de comando** do desenho: **Vistas** (View Layout), **Anotação** (Annotation),
  **Folha** (Sheet) e **Esboço** (linhas livres na folha — ⏸).
- **Árvore**: nome do desenho; **Folha1** (formato, escala) com as **vistas** (nome, escala,
  modelo) e, dentro de cada vista, o modelo referenciado; **tabelas** (lista de materiais,
  revisões).
- **Folha no viewport**: fundo branco da folha sobre área cinza, zoom e pan como no esboço
  (dedo: 2 dedos zoom/pan; mouse: roda e botão do meio); vista sempre de frente (2D).
- Tocar uma vista seleciona (moldura tracejada) e mostra a barra de contexto: Mover, Escala,
  Estilo de exibição, Vista projetada, Seção, Detalhe, Excluir. Arrastar a vista move (as vistas
  projetadas ficam alinhadas com a vista mãe).

## 2. Aba Vistas — comandos

### 2.1 Vista do modelo (Model View) — ✅
- **Caixa "Peça/Montagem"**: do cofre, aberta no WJCAD, procurar no aparelho.
- **Caixa "Orientação"**: Frontal, Posterior, Superior, Inferior, Esquerda, Direita,
  Isométrica, Dimétrica ⏸, Trimétrica ⏸; **Vistas múltiplas** (marcar várias de uma vez).
- **Caixa "Estilo de exibição"**: **Linhas visíveis e ocultas** · **Linhas ocultas removidas**
  (só visíveis) · **Linhas ocultas visíveis** em tracejado · Sombreada ⏸.
- **Caixa "Escala"**: usar a escala da folha · personalizada (1:1, 1:2, 1:5, 1:10, 2:1, 5:1…
  ou valor livre).
- **Caixa "Configuração"** da peça e **Vista explodida** (montagens) — D-B.
- **Tangentes**: mostrar linhas de tangência (arestas suaves) — visíveis/ocultas ⏸.
- Toque na folha coloca a vista; ao colocar, segue o comando **Vista projetada** (como no CAD de
  referência).

### 2.2 Três vistas padrão (Standard 3 View) — ✅
- Escolhe o modelo e coloca **Frontal, Superior e Lateral** já alinhadas no diedro da folha
  (1º diedro: superior abaixo da frontal, lateral esquerda à direita), com escala automática para
  caber na folha. Opcional: **isométrica** no canto livre.

### 2.3 Vista projetada (Projected View) — ✅
- A partir de uma vista: arrastar/tocar para cima, baixo, esquerda, direita ou diagonal coloca
  a vista projetada correspondente, alinhada com a mãe (diagonal = isométrica).

### 2.4 Vista auxiliar (Auxiliary View) — D-C
- Projeção normal a uma aresta da vista (vista de face inclinada em verdadeira grandeza);
  seta e letra (VISTA A).

### 2.5 Vista de seção (Section View) — ✅ horizontal/vertical (alinhada, escalonada, parcial ⏸)
- **Linha de corte**: horizontal, vertical, alinhada (dois segmentos) ⏸ e escalonada ⏸, tocada
  sobre uma vista; letra (A-A) e sentido (inverter).
- **Hachura** (ABNT: 45°, espaçamento pela escala) nas faces cortadas; componentes da montagem
  com hachuras alternadas; **excluir da seção** (eixos, parafusos) ⏸.
- **Seção parcial/profundidade** ⏸.

### 2.6 Vista de detalhe (Detail View) — ✅ círculo (perfil livre ⏸)
- Círculo (ou perfil) desenhado na vista mãe; letra (DETALHE B); escala (padrão 2× a da mãe);
  borda (círculo, contorno, sem); rótulo com escala.

### 2.7 Vista interrompida (Break) — D-C
- Duas linhas de quebra (horizontais ou verticais) encurtam peças longas; a cota continua
  mostrando o valor real; estilo da quebra (reta, zigue-zague).

### 2.8 Vista de recorte (Crop View) e quebra parcial (Broken-out Section) — ⏸

### 2.9 Vista planificada (chapa metálica) — ✅ linhas de dobra (nota de dobra D-C)
- Vista do **padrão planificado** com linhas de dobra (para cima/para baixo) e a **nota de
  dobra** (ângulo, raio, sentido); usa o mesmo planificado do DXF.

## 3. Aba Anotação — comandos

### 3.1 Cota inteligente (Smart Dimension) — D-C
- Tocar arestas/vértices/círculos da **vista**:
  - uma linha → comprimento;
  - dois pontos/linhas paralelas → distância (horizontal, vertical ou alinhada pelo lugar onde
    se solta o número, como no esboço);
  - círculo → diâmetro (Ø); arco → raio (R);
  - duas linhas → ângulo.
- O valor é o **real do modelo** (dividido pela escala da vista), presa às arestas por
  assinatura: muda o modelo, a cota acompanha; aresta sumida → cota "pendente" (marrom).
- **Tolerância/precisão**: nenhuma, simétrica (±), bilateral, limite, ajuste ISO (H7/g6) ⏸;
  casas decimais; texto antes/depois (ex.: "4×").
- **Cota em linha de base** e **cota de coordenada** (Ordinate) — D-D.

### 3.2 Itens do modelo (Model Items) — D-D
- Importa as cotas dos esboços e recursos da peça para as vistas onde aparecem de verdade
  (sem duplicar).

### 3.3 Nota (Note) — 🟡 (texto e propriedades ✅; seta de chamada D-C)
- Texto livre com **ligação a propriedades** (`{codigo}`, `{descricao}`, `{material}`,
  `{revisao}`, `{massa}`), com ou sem **seta de chamada** (leader) presa a uma aresta.

### 3.4 Balão e Balões automáticos (Balloon / Auto Balloon) — D-C
- Balão com o **nº do item da lista de materiais** do componente tocado; automáticos: um por
  componente visível na vista, organizados em volta (quadrado/círculo).

### 3.5 Marca de centro e Linha de centro (Center Mark / Centerline) — 🟡 (marcas automáticas ✅; linha de centro D-C)
- **Marca de centro** em círculos/arcos (automática ao criar a vista: opção); **linha de centro**
  entre duas arestas ou em faces cilíndricas vistas de lado (traço-ponto, NBR 8403).

### 3.6 Símbolos — D-D
- **Acabamento superficial** (NBR ISO 1302: Ra, processo), **tolerância geométrica** (GD&T:
  planeza, paralelismo, perpendicularidade, posição…), **referência (datum)**, **solda** ⏸.

### 3.7 Hachura de área (Area Hatch) — ⏸

### 3.8 Tabela de lista de materiais (BOM Table) — D-C
- Ancorada no canto da legenda (acima, à direita, NBR 10582) ou livre.
- **Tipo**: somente nível superior · só peças · recuada (com submontagens).
- **Colunas**: ITEM, CÓDIGO, DESCRIÇÃO, MATERIAL, QTD (editáveis: adicionar coluna de
  propriedade do cartão do cofre).
- **Numeração** dos itens = número dos balões.
- Exportar CSV / abrir no WJPlan.

### 3.9 Tabela de revisões (Revision Table) — D-D
- Linhas REV, DESCRIÇÃO, DATA, APROVADO; nova revisão puxa do histórico do cofre (fluxo de
  trabalho do WJPDM).

### 3.10 Tabela de furos e de dobras (Hole/Bend Table) — ⏸

## 4. Aba Folha — comandos e propriedades

### 4.1 Propriedades da folha (Sheet Properties) — ✅
- **Nome** da folha · **escala** padrão · **tipo de projeção** (1º diedro ✅ padrão / 3º) ·
  **formato** (A4 retrato, A4/A3/A2/A1/A0 paisagem) · **próxima letra** de vista/seção.

### 4.2 Formato e legenda (Sheet Format / Title Block) — ✅ (editar formato D-D)
- Margem e moldura NBR 10068 (marcas de centro e de corte).
- **Legenda** (canto inferior direito, 175 mm de largura em A3/A2/…; A4 ocupa a largura útil):
  - empresa/logo (texto) · título (descrição do modelo) · código/número do desenho · material ·
    massa · escala · diedro (símbolo) · unidade (mm) · data · projetista · aprovado · revisão ·
    folha (1/2).
  - Os campos vêm das **propriedades do cartão** do modelo no cofre (código, descrição, material,
    projetista, revisão) e da folha (escala, folha); editáveis por desenho.
- **Editar formato**: campos e textos fixos da empresa — D-D.

### 4.3 Folhas — ✅ (reordenar ⏸)
- **Adicionar folha**, **renomear**, **excluir**, **reordenar**; abas das folhas embaixo do
  viewport.

## 5. Exportar, imprimir — 🟡 (PDF/impressão e SVG ✅; DXF D-C)

- **PDF** vetorial (tamanho real da folha, espessuras de linha NBR 8403) — exportar e imprimir ✅ (Imprimir / PDF do navegador, todas as folhas); **SVG** da folha em mm ✅.
- **DXF** (cada tipo de linha numa camada: VISIVEL, OCULTA, CENTRO, COTA, HACHURA, FORMATO) — D-C.
- **PNG** (imagem da folha) para anexar no WJWrite/WJApresentation ⏸.

## 6. Associatividade e atualização — 🟡 (vistas recalculadas do cofre ao abrir ✅; cotas D-C)

- Ao abrir o desenho, as vistas são recalculadas do modelo (cofre: última versão ou a versão
  fixada). Cotas presas por assinatura; o que não for reencontrado vira "pendente" e é listado.
- **Desenho desatualizado**: o modelo mudou desde o último salvar → aviso e botão **Atualizar**.

## 7. Integração com o WJPDM e os outros apps

- **Tabela de referências**: o desenho registra o modelo que detalha (tipo `desenho`) — o WJPDM
  mostra o desenho em "Onde é usado" da peça.
- **Legenda** puxa o cartão do cofre; a **revisão** do desenho segue o fluxo de trabalho do cofre.
- **WJERP**: o PDF do desenho anexa ao item (G5) ⏸.

## 8. Atalhos (computador)

- **F** enquadrar a folha · roda: zoom · botão do meio: pan · **D** cota inteligente ·
  **Delete** excluir · **Ctrl+P** imprimir/PDF · **Esc** sai do comando.

## 8.1 Como ficou (D-A)

- Página `cad/desenho/` (`src/desenho/main.ts`), modelo puro `src/desenho/modelo.ts` e projeção no
  kernel `src/kernel/projecao.ts` (HLR do OpenCascade no worker, sem as emendas de cilindros/cones;
  faces da mesma superfície unidas antes de projetar). Testes em `scripts/teste-desenho.ts`.
- A posição de cada vista é o ponto da folha onde cai a origem do modelo: vistas projetadas
  ficam alinhadas por construção e acompanham a mãe ao mover.
- A peça e a montagem têm **Criar desenho** no menu; o desenho abre o modelo (barra de contexto
  da vista) e o botão **Desenho** na peça/montagem volta a ele, com as vistas atualizadas.

## 8.2 Como ficou (D-B)

- **Seção**: o kernel corta cada sólido pelo plano (sai o lado de quem olha) e devolve as faces
  cortadas como laços no plano da vista; a hachura é um padrão SVG a 45° com 2,5 mm de passo na
  folha, sentidos alternados entre componentes. Na mãe: linha de corte traço-ponto com pontas
  grossas, setas para onde se olha e as letras (sem I, O, Q). A seção fica alinhada como uma
  projetada, do lado tocado.
- **Detalhe**: mesma câmera da mãe em escala 1,5×–5× (padrão 2×), recortada pelo círculo;
  círculo e letra na mãe; rótulo DETALHE B ESCALA 4:1.
- **Planificada**: o kernel regenera a peça com o planificado (mesmo do DXF) e devolve as linhas
  de dobra; a vista olha de cima da maior face plana.
- **Explodida**: vista de montagem com os passos da vista explodida (propriedades da vista ou
  botão Vista explodida); a posição real da montagem não muda.

## 9. Roteiro do desenho

| Etapa | Conteúdo | Status |
|---|---|---|
| D-A | arquivo `.wjdrw`, Novo → Desenho / Criar desenho do modelo, folha com formato ABNT e legenda do cofre, Vista do modelo, Três vistas padrão, Vista projetada, estilos (visíveis e ocultas), escala, mover vistas, propriedades da folha, várias folhas, notas, marcas de centro, PDF/SVG | ✅ |
| D-B | vista de seção (hachura), vista de detalhe, vista planificada da chapa, vista explodida da montagem, atualização associativa | ✅ 29/10/2026 |
| D-C | cota inteligente nas vistas, notas, marcas e linhas de centro, balões, tabela de lista de materiais, vista auxiliar e interrompida, PDF e DXF, impressão | — |
| D-D | itens do modelo, cotas de base/coordenada, símbolos (acabamento, GD&T, datum), tabela de revisões, editar formato | — |
