# Features — recursos de peça

Formato de cada comando: **Nosso nome** (referência) → caixas do painel → campos e opções.
Status: ✅ existe · 🟡 parcial · F3/F4/F5 fase · ⏸ fora do escopo.

---

## 1. Extrusão (Boss-Extrude / Ressalto-Base extrudado) — 🟡

✅ De, Direção 1/2, todas as condições finais (exceto as marcadas ⏸), inclinação, recurso fino e contornos selecionados.

Seleção inicial: se nada estiver selecionado, pede um **esboço** (ou plano/face para criar um).

**Caixa "De" (From)** — onde a extrusão começa
- Plano do esboço *(padrão)*
- Superfície/Face/Plano → campo de seleção da face/plano de início
- Vértice → campo de seleção do vértice
- Deslocamento (Offset) → distância + inverter

**Caixa "Direção 1"**
- Botão **Inverter direção**
- **Condição final**:
  - Cego (Blind) → profundidade D1
  - Até o próximo (Up To Next) → até a próxima face que fecha o perfil
  - Até o vértice (Up To Vertex) → vértice
  - Até a superfície (Up To Surface) → face/plano; opção "Inverter sentido da face"
  - Até o vértice / até a superfície / deslocamento da superfície: **o sentido vem da referência**
    (vai sozinho para o lado onde ela está; o botão Inverter direção some) ✅
  - Deslocamento da superfície (Offset From Surface) → face + distância + "Inverter deslocamento"
    + "Transladar superfície" (paralela) ou equidistante
  - Até o corpo (Up To Body) → corpo
  - Plano médio (Mid Plane) → profundidade total, simétrica ao plano do esboço
- **Direção da extrusão**: campo opcional (aresta/linha/eixo) — extrudar fora da normal
- Profundidade D1 (com seta de arrasto no viewport)
- **Mesclar resultado** (Merge result) — só ressalto, com mais de um corpo
- **Inclinação** liga/desliga → ângulo + "Inclinação para fora"

**Caixa "Direção 2"** (caixa de seleção no título)
- Mesmas condições finais da Direção 1 (exceto Plano médio)
- Profundidade D2, inclinação própria

**Caixa "Recurso fino"** (Thin Feature) (caixa de seleção no título)
- Tipo: Uma direção · Plano médio · Duas direções (T1, T2)
- Inverter lado da espessura
- Espessura T1 (e T2)
- **Filete nos cantos** (contorno aberto) → raio
- **Tampar extremidades** (contorno fechado) → espessura da tampa

**Caixa "Contornos selecionados"** (Selected Contours)
- Lista de regiões/contornos do esboço a usar (clicar nas regiões no viewport)

**Caixa "Escopo do recurso"** (multicorpo)
- Todos os corpos · Corpos selecionados (lista) · Seleção automática

## 2. Corte extrudado (Cut-Extrude) — 🟡

Igual à Extrusão, mais:
- Condições finais extras: **Passante (Through All)**, **Passante nos dois sentidos**
- **Inverter lado do corte** (Flip side to cut) — remove o material de fora do perfil
- **Corte normal** (chapa metálica) e **Vincular à espessura** (chapa) — ver chapa.md
- Recurso fino vira "corte fino" (ranhura com espessura)
- Sem "Mesclar resultado"; com "Escopo do recurso"

## 3. Revolução / Corte por revolução (Revolved Boss/Cut) — 🟡

✅ eixo (linha, aresta, eixo de referência), ângulo, plano médio, Direção 2 e recurso fino.

**Caixa "Eixo de revolução"**: linha de centro do esboço, aresta, eixo de referência
**Caixa "Direção 1"**
- Inverter direção
- Condição: Cego (ângulo) · Até o vértice · Até a superfície · Deslocamento da superfície · Plano médio
- Ângulo (padrão 360°)
- Mesclar resultado (ressalto)
**Caixa "Direção 2"**: condição + ângulo
**Caixa "Recurso fino"**: Uma direção / Plano médio / Duas direções, espessura(s)
**Caixa "Contornos selecionados"**, **Escopo do recurso**

## 4. Varredura / Corte por varredura (Swept Boss/Cut) — F3 (final)

**Caixa "Perfil e trajetória"**
- Tipo de perfil: **Perfil de esboço** · **Perfil circular** (diâmetro)
- Perfil (esboço), Trajetória (esboço/aresta/curva)
- Corte: opção **Varredura de corpo sólido** (ferramenta = corpo)
**Caixa "Opções"**
- Orientação do perfil: Seguir trajetória · Manter normal constante
- Torção do perfil: Nenhuma · Minimizar torção · Seguir trajetória e 1ª guia · Seguir 1ª e 2ª guias ·
  Especificar valor de torção (graus/radianos/voltas, sentido) · Especificar vetor de direção ·
  Tangente às faces adjacentes · Natural
- Mesclar faces tangentes · Mostrar pré-visualização · Mesclar resultado · Alinhar com faces finais
**Caixa "Curvas-guia"**: lista (ordem ↑↓), mesclar faces suaves, mostrar seções (nº)
**Caixa "Tangência inicial/final"**: Nenhuma · Tangente à trajetória
**Caixa "Recurso fino"**, **Exibição de curvatura** (malha, zebra, pentes), **Escopo**

## 5. Loft / Corte por loft (Lofted Boss/Cut) — F3 (final)

**Caixa "Perfis"**: lista ordenada (↑↓), conectores (mapeamento de pontos) arrastáveis
**Caixa "Restrições de início/fim"**
- Padrão · Nenhuma · Vetor de direção (+ referência) · Normal ao perfil · Tangente à face ·
  Curvatura com a face
- Ângulo de inclinação, comprimento de tangência, aplicar a todos, inverter
**Caixa "Curvas-guia"**: lista, influência (até a próxima guia, até a próxima aresta viva,
  até a próxima aresta, global), tangência por guia
**Caixa "Parâmetros de linha de centro"**: curva de centro, nº de seções
**Caixa "Ferramentas de esboço"**: arrastar esboço
**Caixa "Opções"**: mesclar faces tangentes, fechar loft, mostrar pré-visualização,
  mesclar resultado, microtolerância
**Recurso fino**, **Exibição de curvatura**, **Escopo**

## 6. Ressalto/Corte por limite (Boundary) — ⏸

Direção 1 e 2 (curvas, tipo de tangência, alinhamento, influência, inclinação),
opções (mesclar tangentes, fechar, aparar pela direção 1), recurso fino, curvatura.

## 7. Filete (Fillet) — 🟡

✅ arestas/faces/recursos selecionados, propagação tangente, múltiplos raios, assimétrico. Raio variável e filete de face: pendentes.

Abas do painel: **Manual** · **Assistente** (sugere/organiza filetes — ⏸)

**Caixa "Tipo de filete"**: Tamanho constante · Tamanho variável · Filete de face · Arredondamento completo

**Tamanho constante**
- **Itens a filetar**: lista de arestas, faces, recursos, loops; barra de seleção rápida
  (arestas conectadas, do recurso, do loop, todas côncavas/convexas); **propagação tangente**;
  pré-visualização completa / parcial / nenhuma
- **Parâmetros**: Simétrico · Assimétrico (distância 1 e 2) · Raio / Comprimento de corda ·
  **Filete de múltiplos raios** (raio por aresta, editável no rótulo)
- **Perfil**: Circular · Cônico Rho · Cônico Raio · Curvatura contínua
- **Recuo** (Setback): distância, vértices de recuo, recuo por aresta
- **Opções**: selecionar através das faces · manter recursos · cantos arredondados ·
  transbordamento: Padrão / Manter superfície / Manter aresta

**Tamanho variável**: raios por vértice, nº de instâncias intermediárias, transição suave/reta
**Filete de face**: conjunto de faces 1 e 2, ponto de ajuda, linha de retenção, largura constante,
  curvatura contínua
**Arredondamento completo**: faces laterais 1, face central, faces laterais 2

## 8. Chanfro (Chamfer) — 🟡

✅ distância-distância, ângulo-distância, assimétrico, inverter, só nas arestas escolhidas.

**Caixa "Tipo de chanfro"**: Ângulo-distância · Distância-distância · Vértice · Deslocamento de face · Face-face
**Itens a chanfrar**: arestas/faces/vértices, propagação tangente, pré-visualização
**Parâmetros**
- Ângulo-distância: distância, ângulo, **inverter direção**
- Distância-distância: Simétrico (D) · Assimétrico (D1, D2)
- Vértice: D1, D2, D3, distâncias iguais
- Deslocamento de face: distância(s), inverter
- Face-face: conjuntos de faces, linha de retenção / largura de corda
**Opções**: selecionar através das faces, manter recursos

## 9. Furo assistido (Hole Wizard) — ✅ (simples, rebaixado, escareado, roscado ISO; avançado pendente)

Abas: **Tipo** · **Posições**

**Aba Tipo**
- **Tipo de furo**: Rebaixado (counterbore) · Escareado (countersink) · Furo simples (broca) ·
  Furo roscado reto · Furo roscado cônico (tubo) · Rasgo rebaixado · Rasgo escareado · Rasgo
- **Norma**: ISO, DIN (fase 3: **ISO métrico**; demais ⏸)
- **Tipo de fixador**: cabeça cilíndrica (ISO 4762), cabeça chata (ISO 10642), sextavado (ISO 4017)…
- **Especificações do furo**
  - Tamanho: M1,6 … M64
  - Ajuste: Apertado · Normal · Folgado (diâmetros de passagem conforme norma)
  - **Mostrar dimensionamento personalizado**: Ø passagem, Ø e profundidade do rebaixo,
    Ø e ângulo do escareado, ângulo da ponta
- **Condição final**: Cego (profundidade, ângulo da ponta da broca) · Passante · Até o próximo ·
  Até o vértice · Até a superfície · Deslocamento da superfície
- **Rosca** (furos roscados): Ø broca de rosca e profundidade · profundidade da rosca
  (2×D, 1,5×D… ou valor) · **Rosca cosmética** (com/sem nota) · Remover rosca (furo do Ø nominal) ·
  classe de rosca
- **Opções**: folga de cabeça · escareado no lado próximo (Ø, ângulo) · escareado sob a cabeça ·
  escareado no lado distante · nota de rosca cosmética
- **Favoritos**: adicionar/atualizar/excluir/salvar/carregar
- **Escopo do recurso**

**Aba Posições**
- Selecionar face/plano → modo **ponto de esboço**: cada clique é um furo
- Posicionar com cotas e relações (é um esboço comum)

**Furo avançado** (pilha de elementos no lado próximo e distante) — ⏸
**Rosca modelada** (Thread): aresta de início, face de início, deslocamento; condição final
  (cego, nº de voltas, até a seleção); especificação (tipo, tamanho, Ø, passo, cortar/extrudar,
  espelhar perfil, girar); rosca à direita/esquerda, múltiplas entradas — F3 (final)

## 10. Casca (Shell) — ✅

**Parâmetros**: espessura · **faces a remover** (lista) · Casca para fora · mostrar pré-visualização
- Sem faces selecionadas = **casca fechada**: peça oca por dentro, parede de espessura constante
  (ver com Vista de seção) ✅. Para fora: a parede cresce para fora e o volume original vira o vazio ✅.
**Configurações de múltiplas espessuras**: espessura por face (lista de faces + valor)

## 11. Nervura (Rib) — ✅

Perfil: esboço aberto (linha/arcos)
**Parâmetros**
- Espessura: Primeiro lado · Ambos os lados · Segundo lado; valor
- Direção da extrusão: **Paralela ao esboço** · **Normal ao esboço**
- Inverter lado do material
- Inclinação liga/desliga → ângulo, para fora
- Tipo (normal ao esboço): Linear · Natural
**Contornos selecionados**

## 12. Inclinação (Draft) — ✅ (plano neutro)

Abas: Manual · Assistente (⏸)
**Tipo**: Plano neutro · Linha de partição · Inclinação em degrau (degraus cônicos / perpendiculares)
**Ângulo de inclinação**
**Plano neutro** (face/plano), inverter
**Faces a inclinar** (lista)
**Propagação**: Nenhuma · Ao longo da tangente · Todas as faces · Faces internas · Faces externas
**Permitir ângulo reduzido**

## 13. Outros recursos de corpo

| Comando | Campos principais | Fase |
|---|---|---|
| Domo (Dome) | faces, distância, inverter, ponto/esboço de restrição, direção, domo elíptico, contínuo | ⏸ |
| Envolver (Wrap) | tipo: gravar/em relevo/riscar; método analítico/spline; esboço, face, espessura | ⏸ |
| Combinar (Combine) | Adicionar · Subtrair · Comum; corpo principal; corpos a combinar | F3 |
| Dividir (Split) | ferramentas de corte, corpos resultantes, consumir corpos | ⏸ |
| Mover/Copiar corpos | transladar (Δ ou até vértice), girar (X,Y,Z), copiar (nº), modo restrições | ⏸ |
| Excluir/Manter corpo | excluir / manter corpos selecionados | F3 |
| Escala (Scale) | em torno do centroide/origem/sistema; uniforme ou X/Y/Z | ⏸ |
| Interseção, Recuo, Flexionar, Deformar, Forma livre | — | ⏸ |
| Rosca cosmética | aresta circular, padrão, tamanho, profundidade, nota | F3 |

## 14. Padrões

### Padrão linear (Linear Pattern) — ✅
**Direção 1**
- Referência de direção (aresta, cota, eixo, linha), **inverter**
- Modo: **Espaçamento e instâncias** · **Até a referência** (geometria de referência,
  deslocamento, centroide do recurso ou referência selecionada)
- Espaçamento, nº de instâncias
**Direção 2** (caixa no título): igual + **Padronizar somente a semente**
**Recursos e faces**: lista de recursos · lista de faces
**Corpos**: lista de corpos
**Instâncias a pular**: clicar nos pontos rosa no viewport
**Opções**: variar esboço · padrão de geometria · propagar propriedades visuais ·
  pré-visualização completa/parcial
**Instâncias a variar**: incremento de cotas por direção; modificar instância individual

### Padrão circular (Circular Pattern) — ✅
**Direção 1**: eixo (eixo, aresta circular, face cilíndrica, cota angular), inverter ·
  **Espaçamento das instâncias** (ângulo entre elas) ou **Espaçamento igual** (ângulo total) ·
  nº de instâncias
**Direção 2**: simétrica
**Recursos e faces · Corpos · Instâncias a pular · Opções · Instâncias a variar** (como no linear)

### Espelhar (Mirror) — ✅
**Face/plano de espelho**
**Recursos a espelhar** · **Faces a espelhar** · **Corpos a espelhar** (mesclar sólidos, costurar superfícies)
**Opções**: padrão de geometria, propagar propriedades visuais, pré-visualização completa/parcial

### Outros padrões — ⏸ (registrados)
- Orientado por curva: curva, nº, espaçamento/igual, método (transformar/deslocar curva),
  alinhamento (tangente/ao original), normal à face
- Orientado por esboço: esboço de referência, ponto de referência (centroide/ponto)
- Orientado por tabela: tabela X/Y, sistema de coordenadas, ponto de referência
- Padrão de preenchimento: limite, layout (perfuração/concêntrico/quadrado/polígono),
  espaçamento, ângulo de escalonamento, margens, semente (círculo, quadrado, losango, polígono)
- Padrão variável: tabela de variações

## 15. Geometria de referência — ✅ plano e eixo; demais pendentes

- Planos e eixos são **selecionáveis no viewport** ✅: borda de qualquer plano (prioridade sobre a
  peça); área de plano criado pelo usuário quando está na frente da peça; planos principais pela
  área só onde não há peça. Mostra a barra de contexto (Esboço, Normal a, Ocultar…), serve para
  "Novo esboço" e para campos de comando que aceitam plano/eixo.

### Plano
- **Primeira / Segunda / Terceira referência**: cada uma com seleção + restrição:
  Coincidente · Paralelo · Perpendicular · Projetar · Paralelo à tela · Tangente ·
  **Distância** (valor, inverter) · **Ângulo** (valor, inverter) · Plano médio
- Nº de planos (para distância/ângulo repetidos)
- Status: "Totalmente definido" quando as referências bastam

### Eixo
Uma linha/aresta/eixo · Dois planos · Dois pontos/vértices · Face cilíndrica/cônica · Ponto e face/plano

### Sistema de coordenadas
Origem (vértice/ponto), eixos X, Y, Z (arestas/direções), inverter cada eixo;
ou posição/rotação numéricas

### Ponto
Centro de arco · Centro da face · Interseção · Projeção · No ponto ·
Ao longo da curva (distância / porcentagem / distribuir igualmente, nº de pontos)

### Centro de massa · Caixa delimitadora — 🟡 (mostrados em Avaliar → Massa)

## 16. Curvas — F3 (hélice) / ⏸ (demais)

- **Hélice e espiral**: definido por (passo e revolução · altura e revolução · altura e passo ·
  espiral); passo constante/variável; altura; revoluções; ângulo inicial; horário/anti-horário;
  hélice cônica (ângulo, para fora)
- Linha de partição (silhueta, projeção, interseção)
- Curva projetada (esboço em faces / esboço em esboço; bidirecional)
- Curva composta · Curva por pontos XYZ · Curva por pontos de referência

## 17. Gerais da peça

| Função | Campos / comportamento | Fase |
|---|---|---|
| **Barra de retrocesso** | arrastar na árvore; inserir recursos no meio; rolar para frente/trás | ✅ |
| Reordenar recursos | arrastar na árvore (✅ hoje com ▲▼) | 🟡 |
| Suprimir / Reativar | por recurso (✅) e por configuração (⏸) | 🟡 |
| Pai/filho | lista de referências do recurso; **excluir o pai** abre "Confirmar exclusão" com os filhos (excluídos junto, padrão) e os absorvidos (esboço, opcional) | 🟡 (exclusão ✅) |
| Editar recurso / Editar esboço | menu de contexto, duplo clique mostra cotas no modelo | 🟡 (menu de contexto ✅) |
| **Instant3D** | arrastar faces/cotas com alças no viewport | F3 |
| Esboço como filho do recurso | árvore aninhada (Extrusão1 ▸ Esboço1) | ✅ |
| **Equações e variáveis globais** | nome = valor/expressão; usar em cotas; funções (if, sin, sqrt) | ✅ |
| Configurações / tabela de projeto | variações da peça | ⏸ |
| **Material** | biblioteca (aço, alumínio, inox…), densidade → massa | ✅ |
| Aparência | cor por peça/recurso/face | F3 |
| Propriedades personalizadas | código, descrição, material, massa | ⏸ |
| Erros de reconstrução | ✕ vermelho / ⚠ amarelo na árvore, "O que está errado" | 🟡 |
| Importar / exportar | STEP ✅, STL ✅; importar STEP, 3MF, DXF de face ⏸ | 🟡 |
