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

## 4. Varredura / Corte por varredura (Swept Boss/Base · Swept Cut) — 🟡

✅ Escopo definido pelo Johann: perfil de esboço / circular (diâmetro), trajetória (esboço ou
arestas), curvas-guia com ↑↓ e mesclar faces suaves, tangência inicial/final (Nenhuma / Tangente à
trajetória), recurso fino (uma direção, plano médio, duas direções). Orientação fixa em "seguir
trajetória" (torção mínima). Demais opções abaixo: não previstas por enquanto.

Leva um **perfil** ao longo de uma **trajetória**. Usos: tubos e mangueiras, cabos, molas e roscas
(com hélice), canais e rasgos curvos, perfis de vedação, corrimãos.

Seleção inicial: esboço fechado + esboço aberto/aresta já selecionados → vão para Perfil e
Trajetória (nessa ordem). Sem seleção, o primeiro campo rosa (Perfil) fica ativo.
Regra: o perfil deve estar **no início da trajetória**, de preferência num plano normal a ela
(aviso amarelo se não estiver; a varredura parte de onde o perfil está).

**Caixa "Perfil e trajetória"**
- **Tipo de perfil** (lista): Perfil de esboço *(padrão)* · Perfil circular
  - Perfil de esboço → campo rosa **Perfil**: esboço fechado, região/contorno de esboço ou face plana
    (perfil aberto só com Recurso fino)
  - Perfil circular → campo **Diâmetro** (mm) — o círculo é criado sozinho, normal à trajetória
- Campo azul **Trajetória**: linha/arco/spline de esboço (aberto ou fechado), aresta(s) do modelo,
  hélice/espiral, curva composta ou curva 3D
  - **Selecionar cadeia**: toque numa aresta pega as arestas tangentes encadeadas
- Corte: **Tipo** (lista) Perfil · **Corpo sólido** (ferramenta = sólido de revolução varrido;
  simula fresa/rebolo) — corpo sólido: ⏸

**Caixa "Opções"**
- **Orientação/torção do perfil** (lista):
  - Seguir trajetória *(padrão)* — perfil mantém o mesmo ângulo em relação à trajetória
  - Manter normal constante — perfil sempre paralelo ao plano inicial
  - Seguir trajetória e 1ª curva-guia *(com curvas-guia)*
  - Seguir 1ª e 2ª curvas-guia *(com 2 curvas-guia)*
- **Tipo de torção** (lista, trajetória 3D):
  - Nenhuma · **Minimizar torção** · Natural
  - **Especificar valor de torção** → unidade (lista: Graus · Radianos · Voltas) + valor + **Inverter**
  - **Especificar vetor de direção** → campo azul (plano, face plana, aresta reta, eixo): o perfil
    mantém o alinhamento com o vetor
  - **Tangente às faces adjacentes** — quando a trajetória corre sobre arestas do modelo
- **Mesclar faces tangentes** (caixa) — junta faces que ficariam tangentes em várias faces
- **Mostrar pré-visualização** (caixa)
- **Mesclar resultado** (caixa, ressalto) — une ao corpo existente
- **Alinhar com faces finais** (caixa) — estende/ajusta a varredura até as faces que ela encontra

**Caixa "Curvas-guia"** (caixa de seleção no título)
- Lista rosa de **curvas-guia** (esboços ou arestas que tocam o perfil) com **↑ ↓** (ordem) e remover
- O perfil **escala/deforma** para seguir as guias ao longo da trajetória
- **Mesclar faces suaves** (caixa) — desligado: faces separadas em cada segmento da guia
- **Mostrar seções** (olho + nº da seção) — inspeciona o perfil intermediário

**Caixa "Tangência de início/fim"**
- **Tangência inicial** (lista): Nenhuma · Tangente à trajetória
- **Tangência final** (lista): Nenhuma · Tangente à trajetória

**Caixa "Recurso fino"** (caixa no título) — como na extrusão: Uma direção · Plano médio ·
Duas direções; espessura T1 (T2); inverter lado. Perfil aberto exige recurso fino.

**Caixa "Exibição de curvatura"** — Pré-visualização de malha (densidade) · Listras zebra ·
Pentes de curvatura (direção 1/2, escala, densidade)

**Caixa "Escopo do recurso"** (corte/multicorpo) — Todos os corpos · Corpos selecionados ·
Seleção automática

Kernel: `BRepOffsetAPI_MakePipeShell` — Seguir trajetória (Frenet), Minimizar torção (Frenet
corrigido), Manter normal / Vetor de direção (direção fixa), Seguir 1ª guia (espinha auxiliar),
lei de escala; valor de torção = perfil girado em seções intermediárias; 2 guias e tangência
com faces adjacentes = seções calculadas por nós (mais trabalho).

## 5. Loft / Corte por loft (Lofted Boss/Base · Lofted Cut) — planejado

Transição suave entre **dois ou mais perfis** em planos diferentes. Usos: dutos e funis de
transição (quadrado → redondo), bicos, alças, cascos, peças de chapa grossa conformada.

Seleção inicial: perfis já selecionados (esboços/faces) entram na lista **na ordem de seleção**.

**Caixa "Perfis"**
- Lista rosa ordenada com **↑ ↓** e remover: esboços fechados, regiões de esboço, faces planas;
  **vértice/ponto** aceito como **primeiro ou último** perfil (loft até um ponto — bico)
- Tocar o perfil **perto do vértice** que deve se ligar ao vértice correspondente do outro perfil
  (define a sincronização)
- **Conectores** (linhas entre perfis com alças arrastáveis no viewport):
  - Mostrar conectores · arrastar alça ao longo do contorno · Adicionar conector · Excluir conector
  - Perfis com nº diferente de vértices: divisão automática das arestas

**Caixa "Restrição de início/fim"** (uma lista para o início e outra para o fim)
- Restrição (lista):
  - **Padrão** — aproxima uma parábola usando o 1º e o último perfil
  - **Nenhuma** — sem restrição de tangência
  - **Vetor de direção** → campo azul (plano, aresta, eixo) + Ângulo de inclinação + Comprimento da
    tangente + Inverter
  - **Normal ao perfil** → Ângulo de inclinação + Comprimento da tangente + Inverter
  - **Tangente à face** (perfil sobre face existente) → Comprimento da tangente
  - **Curvatura com a face** (continuidade de curvatura) → Comprimento da tangente
- **Aplicar a todos** (caixa) — desligado: uma alça de comprimento por segmento do perfil
- **Próxima face** (botão) — alterna a face de referência quando há mais de uma

**Caixa "Curvas-guia"** (caixa no título)
- Lista rosa de **curvas-guia** com **↑ ↓** — devem tocar todos os perfis (relação perfurar)
- **Influência da curva-guia** (lista): Até a próxima guia · Até a próxima aresta viva ·
  Até a próxima aresta · Global (linear)
- **Tangência** por guia (lista): Nenhuma · Normal ao perfil · Vetor de direção · Tangente à face +
  Ângulo de inclinação + Inverter

**Caixa "Parâmetros de linha de centro"** (alternativa às guias)
- Campo azul **Curva de linha de centro** (esboço/aresta) — os perfis seguem essa espinha
- **Número de seções** (deslizante) + Mostrar seções

**Caixa "Ferramentas de esboço"** — **Arrastar esboço** (move um perfil 3D e vê o loft mudar) ·
Desfazer arrasto

**Caixa "Opções"**
- **Mesclar faces tangentes** (caixa)
- **Fechar loft** (caixa) — liga o último perfil ao primeiro (anel; mín. 3 perfis)
- **Mostrar pré-visualização** (caixa)
- **Mesclar resultado** (caixa, ressalto)
- **Microtolerância** (caixa) — para perfis com arestas muito pequenas
- **Faces regradas** (caixa, nossa) — retas entre perfis em vez de transição suave

**Caixa "Recurso fino"** · **Caixa "Exibição de curvatura"** · **Caixa "Escopo do recurso"** —
como na varredura.

Kernel: `BRepOffsetAPI_ThruSections` — perfis, ponto inicial/final, faces regradas, suavização,
continuidade, fechar loft (repete o 1º perfil); conectores = escolhemos o vértice inicial e o
sentido de cada contorno. Restrições de início/fim, curvas-guia e linha de centro não existem
prontas: geramos seções intermediárias (amostrando guias/linha de centro) — mais trabalho.

## 6. Ressalto por contorno / Corte por contorno (Boundary Boss/Base · Boundary Cut) — ⏸ (fora do roteiro, decisão do Johann)

Sólido definido por uma **rede de curvas em duas direções**, com as duas direções de mesmo
peso e controle fino de tangência/curvatura nas bordas. Mais preciso e suave que o loft:
carcaças ergonômicas, cabos de ferramenta, carenagens, bocais. (Recurso **sólido**: entra em
Features; as superfícies continuam fora do escopo.)

Seleção inicial: curvas/esboços/arestas selecionados entram na **Direção 1**, em ordem.

**Caixa "Direção 1"**
- Lista rosa de **curvas** (esboços, arestas, bordas de face) com **↑ ↓** e remover; ponto aceito
  no início/fim
- Por curva selecionada na lista — **Tipo de tangência** (lista):
  - Padrão · Nenhuma
  - **Direção de tangência** → Alinhar com a próxima seção · Alinhar normal ao perfil · Vetor de
    direção (campo azul)
  - **Tangência com a face** · **Curvatura com a face** (curva sobre aresta de face existente)
  - Campos: **Comprimento da tangente** · **Ângulo de inclinação** · **Inverter** · **Aplicar a todos**
- **Conectores** — Mostrar · arrastar alças · Adicionar · Excluir (como no loft)

**Caixa "Direção 2"** (caixa no título)
- Lista azul de **curvas cruzando** as da Direção 1 (formam a rede)
- Mesmo **Tipo de tangência** por curva da Direção 1
- **Influência da curva** (lista, para curvas que não fecham a rede): Global · Até a próxima curva ·
  Até a próxima aresta viva · Até a próxima aresta · Linear

**Caixa "Opções e visualização"**
- **Mesclar faces tangentes** (caixa)
- **Fechar superfície** (caixa) — fecha a Direção 1 em anel
- **Mostrar pré-visualização** (caixa)
- **Aparar pela direção 1** (caixa) — corta o que as curvas da Direção 2 passarem além
- **Mesclar resultado** (caixa, ressalto)
- **Mostrar conectores** (caixa)

**Caixa "Recurso fino"** · **Caixa "Exibição de curvatura"** (malha, zebra, pentes por direção,
escala e densidade) · **Caixa "Escopo do recurso"** — como na varredura.

Kernel: `BRepOffsetAPI_MakeFilling` (preenchimento com restrições de borda C0/G1/G2 e curvas
internas = Direção 2) gera as faces; tampas planas + `Sewing` + `MakeSolid` fecham o sólido.
É o mais complexo dos três: implementar por último.

### Pré-requisitos para os três

- **Curvas** (seção 16): hélice/espiral, curva composta, curva por pontos XYZ, curva projetada —
  trajetórias e guias 3D
- **Esboço 3D** ou relação **Perfurar** no esboço (perfil tocando a trajetória/guia fora do plano)
- Seleção de **regiões** de esboço e **cadeias de arestas** (já existem em parte)

### Ordem
1. Varredura ✅ (escopo acima)
2. Loft (escopo definido pelo Johann)
3. Ressalto por contorno: fora do roteiro

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

**Pré-seleção (padrões e espelhar)** ✅: recursos selecionados na árvore antes do comando (vários
com Ctrl/Shift) entram direto na lista; plano/face, eixo ou aresta pré-selecionados vão para o
plano de espelho / direção / eixo. Com o comando aberto, tocar um recurso na árvore o põe ou tira
da lista sem ativar a caixa. A barra de contexto do recurso tem Espelhar / Padrão linear / circular.
Também usam pré-seleção: revolução (eixo), inclinação (plano neutro), plano (2 planos → médio;
plano + aresta → ângulo), eixo (2 planos, 2 vértices) e Medir.

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

## 16. Curvas — planejado junto com varredura/loft (hélice, composta, XYZ, projetada) / ⏸ (linha de partição)

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
| **Destaque do recurso** | selecionar um recurso na árvore pinta as faces dele na peça (outro tom); esboço selecionado destaca o recurso que o consome | ✅ |
| Pai/filho | lista de referências do recurso; **excluir o pai** abre "Confirmar exclusão" com os filhos (excluídos junto, padrão) e os absorvidos (esboço, opcional) | 🟡 (exclusão ✅) |
| Editar recurso / Editar esboço | menu de contexto, duplo clique mostra cotas no modelo | 🟡 (menu de contexto ✅) |
| **Instant3D** | arrastar faces/cotas com alças no viewport | F3 |
| Esboço como filho do recurso | árvore aninhada (Extrusão1 ▸ Esboço1); **seta ▸/▾** mostra os elementos usados: esboço absorvido, recursos (padrões/espelho), faces/arestas/vértices/planos/eixos escolhidos e o plano do esboço; toque destaca/seleciona; recolhido por padrão | ✅ |
| **Equações e variáveis globais** | nome = valor/expressão; usar em cotas; funções (if, sin, sqrt) | ✅ |
| Configurações / tabela de projeto | variações da peça | ⏸ |
| **Material** | biblioteca (aço, alumínio, inox…), densidade → massa | ✅ |
| Aparência | cor por peça/recurso/face | F3 |
| Propriedades personalizadas | código, descrição, material, massa | ⏸ |
| Erros de reconstrução | ✕ vermelho / ⚠ amarelo na árvore, "O que está errado" | 🟡 |
| Importar / exportar | STEP ✅, STL ✅; importar STEP, 3MF, DXF de face ⏸ | 🟡 |
