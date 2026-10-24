# Sketch — esboço

Status: ✅ existe · 🟡 parcial · F3/F4/F5 fase · ⏸ fora do escopo.
"Painel" = painel do comando (substitui a árvore). Hoje o painel do esboço fica à direita (🟡).

---

## 0. Cabeçalho do Sketch e subfunções (definido pelo Johann, 24/10/2026) — 🟡

✅ Cabeçalhos de Features e Sketch com menus ▾ (botão = última subfunção usada; "em breve" nas
pendentes). ✅ Linha / Linha de centro / Linha de ponto médio · Retângulo de canto / pelo centro /
de canto por 3 pontos / pelo centro por 3 pontos / Paralelogramo · Rasgo reto / reto pelo centro /
em arco por 3 pontos / em arco pelo centro · Círculo / perimetral · Arco pelo centro / tangente /
3 pontos · Filete / Chanfro de esboço · Aparar / Estender · Converter entidades (aresta/vértice da
peça vira geometria fixa do esboço) · Padrão linear / circular de esboço · Exibir/Excluir relações ·
painéis completos de Polígono, Aparar, Offset, Espelhar e Padrões (abaixo).
✅ Elipse · Elipse parcial · Parábola.
Pendentes: Esboço 3D, Spline de estilo, Curva por equação, Cônica,
Texto, Entidades de silhueta, Curva de interseção.

Botões com **menu ▾** (o botão executa a última subfunção usada; a seta abre a lista):

| Botão | Subfunções |
|---|---|
| Esboço ▾ | Esboço · Esboço 3D |
| Cota ▾ | Cota inteligente |
| Linha ▾ | Linha · Linha de centro · Linha de ponto médio |
| Retângulo ▾ | De canto · Pelo centro · De canto por 3 pontos · Pelo centro por 3 pontos · Paralelogramo |
| Rasgo ▾ | Reto · Reto pelo centro · Em arco por 3 pontos · Em arco pelo centro |
| Círculo ▾ | Círculo · Círculo perimetral |
| Arco ▾ | Pelo centro · Tangente · 3 pontos |
| Polígono | — |
| Spline ▾ | Spline · Spline de estilo · Curva por equação |
| Elipse ▾ | Elipse · Elipse parcial · Parábola · Cônica |
| Filete ▾ | Filete de esboço · Chanfro de esboço |
| Texto | — |
| Ponto | — |
| Aparar ▾ | Aparar entidades · Estender entidades |
| Converter ▾ | Converter entidades · Entidades de silhueta · Curva de interseção |
| Offset | — |
| Espelhar | — |
| Padrão ▾ | Padrão linear de esboço · Padrão circular de esboço |
| Relações ▾ | Exibir/Excluir relações · Adicionar relação |

**Painel Polígono** — Opções: Para construção. Parâmetros: nº de lados · Círculo inscrito /
circunscrito · Centro X · Centro Y · Diâmetro do círculo · Ângulo · botão **Novo polígono**.

**Painel Texto de esboço** — Curvas (seleção; o texto segue a curva) · Texto (caixa) · Negrito ·
Itálico · Girar · Alinhar à esquerda / centro / direita / justificado · Inverter vertical /
horizontal · Largura (%) · Espaçamento (%) · Usar fonte do documento · Fonte…

**Painel Aparar** — Mensagem de instrução · Opções: Aparar potente (riscar) · Canto · Aparar
dentro · Aparar fora · Aparar até o mais próximo · Manter entidades aparadas como construção ·
Ignorar aparar geometria de construção.

**Painel Offset** — Distância · Adicionar cotas ✓ · Inverter · Selecionar cadeia ✓ · Bidirecional ·
Tampar extremidades (Arcos / Linhas) · Geometria de construção: Base · Offset.

**Painel Espelhar** — Mensagem ("selecione as entidades e uma linha do esboço, aresta linear do
modelo, plano ou face plana") · Entidades a espelhar (seleção) · Copiar ✓ · Espelhar em relação a
(seleção).

**Painel Padrão linear de esboço** — Direção 1: direção (eixo X padrão; linha/aresta) · espaçamento ·
Cotar espaçamento X · nº de instâncias · Exibir nº de instâncias ✓ · ângulo · Fixar direção do eixo X ✓.
Direção 2: direção (eixo Y) · espaçamento · Cotar espaçamento Y · nº de instâncias (1 = desligada) ·
Exibir nº de instâncias · ângulo (90°) · Cotar ângulo entre eixos. Entidades a padronizar (seleção) ·
Instâncias a pular.

**Painel Padrão circular de esboço** — Parâmetros: centro (seleção de ponto; origem padrão) ·
Centro X · Centro Y · ângulo total (360°) · Espaçamento igual ✓ · Cotar raio · Cotar espaçamento
angular · nº de instâncias · Exibir nº de instâncias ✓ · Raio · Ângulo do arco. Entidades a
padronizar (seleção) · Instâncias a pular.

Pontos de atenção: **Texto** precisa de fonte livre (OFL) embutida para funcionar offline;
**Cônica** geral não existe no solver (PlaneGCS tem elipse, arco de elipse e parábola);
**Esboço 3D**, **Spline de estilo** e **Entidades de silhueta** são os maiores — por último.

## 1. Entrar, sair e ambiente

| Função | Comportamento | Status |
|---|---|---|
| Esboço | em plano de referência ✅, face plana ✅, plano criado (F3) | 🟡 |
| Vista normal ao entrar | gira para normal ao plano ✅; ao sair volta à vista anterior | 🟡 |
| Sair do esboço | botão na aba ✅, canto de confirmação ✓/✕ (✕ = descartar alterações) | 🟡 |
| Editar esboço | painel do esboço ✅, menu de contexto, duplo clique | 🟡 |
| Editar plano do esboço | trocar plano/face de suporte mantendo a geometria | F3 |
| Esboço 3D | — | ⏸ |
| Barra de status | coordenadas X/Y do cursor, estado (Sub/Totalmente/Superdefinido) ✅ | 🟡 |
| Cores | azul = livre ✅, preto = definido ✅, vermelho = conflito ✅, construção tracejada ✅ | ✅ |
| Contornos sombreados | regiões fechadas preenchidas (mostra o que vira perfil) | ✅ |
| Grade e encaixe | exibir grade, espaçamento maior/menor, escala automática, encaixar na grade | F3 |
| Encaixes rápidos | ponto ✅, ponto médio ✅, sobre curva ✅, H/V ✅; centro, quadrante, interseção, tangente, perpendicular, paralelo, comprimento | 🟡 |
| Linhas de inferência | pontilhadas alinhando com pontos existentes (H/V a distância) | F3 |
| Relações automáticas | ícone da relação junto ao cursor ✅ (texto), opção liga/desliga | 🟡 |
| Opções do esboço | relações automáticas, resolver automaticamente, detectar superdefinição | F3 |

## 2. Entidades

Todos os painéis de entidade têm, além dos campos abaixo:
**Relações existentes** (lista + estado) · **Adicionar relações** (botões aplicáveis) ·
**Opções**: Para construção · **Parâmetros** numéricos editáveis (coordenadas).

### Linha — ✅ (painel 🟡)
- **Orientação**: Como esboçada ✅ · Horizontal · Vertical · Ângulo
- **Opções**: Para construção ✅ · Comprimento infinito · Linha de ponto médio
- **Parâmetros**: comprimento, ângulo
- **Parâmetros adicionais**: X/Y inicial, X/Y final, ΔX, ΔY
- Encadeamento ✅, terminar com duplo toque/Esc ✅, transição para **arco tangente** ao voltar
  o cursor ao último ponto (F3)
- Variantes: **Linha de centro** (construção) ✅ via opção · **Linha de ponto médio** F3

### Retângulo — ✅ (canto, centro, 3 pontos inclinado)
- **Tipo**: De canto ✅ · Central · 3 pontos de canto · 3 pontos central · Paralelogramo
- **Opções**: Para construção ✅ · **Adicionar linhas de construção**: dos cantos / dos pontos médios
- **Parâmetros**: X/Y de cada um dos 4 cantos e do centro

### Rasgo (Slot) — ✅ (reto, reto pelo centro) / demais pendentes
- **Tipo**: Reto ✅ · Reto pelo centro · Em arco 3 pontos · Em arco pelo centro
- **Opções**: Adicionar cotas · **Cota**: centro a centro / total · Para construção ✅
- **Parâmetros**: centro X/Y, comprimento, largura, ângulo

### Círculo — ✅ (centro, perimetral)
- **Tipo**: Pelo centro ✅ · Perimetral (3 pontos)
- **Parâmetros**: centro X/Y, raio

### Arco — ✅ (3 pontos, centro-pontas, tangente)
- **Tipo**: Centro-pontas · Tangente · 3 pontos ✅
- **Parâmetros**: centro X/Y, início X/Y, fim X/Y, raio, ângulo

### Polígono — ✅
- **Opções**: Para construção ✅
- **Parâmetros**: nº de lados ✅ · **Círculo inscrito / circunscrito** ✅ ambos ·
  centro X/Y ✅ · diâmetro ✅ · ângulo ✅ (editam o último polígono criado) · botão **Novo polígono** ✅

### Spline — ✅ (passagem por pontos)
- **Opções**: Para construção ✅ · Exibir pente de curvatura · Manter continuidade interna
- **Parâmetros por ponto**: nº do ponto, X/Y, peso de tangência 1/2, direção radial/polar da
  tangência, **tangência acionadora**, redefinir alça / todas, **Relaxar spline**, **Proporcional**
- Spline fechada ✅ (tocando no primeiro ponto)
- **Spline de estilo** (grau 3/5/7, polígono de controle) ⏸ · **Spline de equação**
  (explícita y=f(x) / paramétrica x(t),y(t), t1, t2, travar extremidades) ⏸ · **Ajustar spline** ⏸

### Elipse, elipse parcial, parábola — ✅ · cônica — ⏸
- **Elipse**: centro → ponta do eixo maior → eixo menor. Cria os **eixos maior e menor como linhas
  de construção** presas à curva (solver PlaneGCS): cotar o comprimento de cada eixo dá os
  diâmetros; relação horizontal/vertical ou cota de ângulo no eixo maior dá a orientação.
- **Elipse parcial**: centro → eixo maior → eixo menor e início → fim (anti-horário).
- **Parábola**: foco → vértice → início → fim. Vira Bézier quadrática exata no kernel.
- Ponto sobre a curva (coincidente), tangência numa ponta comum, copiar/girar/mover, espelhar e
  padrões ✅; arrastar a curva move a peça inteira, arrastar as pontas dos eixos muda tamanho e giro.
- Perfil exato no kernel (elipse/arco de elipse e parábola do OpenCascade) ✅; na varredura a
  elipse é aproximada por B-spline.
- Pendentes: painel de parâmetros (centro, raios, ângulos), aparar/estender elipse e parábola
  (hoje aparar apaga a curva inteira), offset delas; **cônica** (rho) não existe no PlaneGCS.

### Ponto — ✅
Parâmetros: X/Y.

### Texto do esboço — ⏸
Curvas de apoio, texto, alinhamento, inverter, fator de largura, espaçamento, fonte.

## 3. Ferramentas

### Filete de esboço — ✅
- Entidades a filetar (cantos/vértices) · raio · **Manter cantos com restrição** ·
  **Cotar cada filete** · filetes iguais
### Chanfro de esboço — ✅ (distância igual)
- Ângulo-distância · Distância-distância · Distâncias iguais; D1, D2, ângulo

### Offset de entidades — ✅
- Distância ✅ · **Adicionar cotas** ✅ (uma por lado) · **Inverter** ✅
- **Selecionar cadeia** ✅ (desligado: entidade por entidade) · **Bidirecional** ✅ ·
  **Tampar extremidades** (arcos / linhas) ✅
- **Geometria de construção**: geometria base / geometria do offset ✅
- Pré-visualização tracejada antes de aplicar ✅

### Converter entidades (projetar arestas do modelo) — 🟡
- ✅ Tocar aresta ou vértice da peça no esboço (Selecionar) cria a **referência do modelo**:
  geometria de construção fixa, em roxo, projetada no plano; "Alternar construção" a torna perfil.
- ✅ Encaixe das ferramentas de desenho em **vértice do modelo** e **sobre aresta do modelo**.
- ✅ Ao abrir o esboço, as referências acompanham a peça atual (entidade mais parecida).
- Pendente: faces inteiras/esboços de uma vez · Selecionar cadeia · Loops internos ·
  círculos inclinados (projetam como elipse)

### Interseção de curvas — ⏸
### Segmento (dividir em N partes com pontos) — ⏸

### Aparar entidades — ✅
- **Opções**: Aparar potente (arrastar riscando; um toque também apara) ✅ · Canto (duas linhas) ✅ ·
  Aparar dentro ✅ · Aparar fora ✅ (dois limites, depois as entidades; linhas e arcos) ·
  **Aparar até o mais próximo** ✅
- **Manter entidades aparadas como construção** ✅ · Ignorar aparar geometria de construção ✅
- Pendente: canto entre linha e arco; aparar potente estendendo ao arrastar pela ponta

### Estender entidades — ✅
### Dividir entidades (ponto de divisão) — F3

### Mover / Copiar / Girar / Dimensionar / Esticar — ✅ mover, copiar, girar; demais pendentes
- Entidades · **Manter relações** · Copiar
- Mover/Copiar: De-Para (ponto base) / X-Y (ΔX, ΔY), repetir
- Girar: centro de rotação, ângulo
- Dimensionar: ponto base, fator de escala, copiar (nº)
- Esticar: entidades, ponto base/ΔXY

### Espelhar entidades — ✅
- Entidades a espelhar ✅ (campo de seleção) · **Copiar** ✅ · **Espelhar em relação a** ✅
  (linha do esboço, eixo ou aresta reta da peça) · relações de simetria ✅ · pré-visualização ✅
- Pendente: plano/face como espelho
- Espelhamento dinâmico (desenhar e espelhar ao mesmo tempo) ⏸

### Padrão linear de esboço — ✅
- **Direção 1/2** ✅: direção (eixo, linha do esboço ou aresta da peça), inverter, espaçamento,
  **cotar espaçamento X/Y** (cota entre a semente e a 2ª instância), nº de instâncias, ângulo
- Entidades a padronizar ✅ · Instâncias a pular ✅ ("3, 2-2") · pré-visualização ✅
- Pendente: cotar ângulo entre eixos; instâncias amarradas entre si por relações

### Padrão circular de esboço — ✅
- Centro (ponto do esboço ou X/Y; origem padrão) ✅, inverter ✅, ângulo ✅, **espaçamento igual** ✅,
  nº de instâncias ✅, raio e ângulo do arco (leitura) ✅, cotar raio ✅
- Entidades ✅ · Instâncias a pular ✅ · pré-visualização ✅
- Pendente: cotar espaçamento angular; editar raio/ângulo do arco

### Outras — ⏸
Bloco (criar, inserir, editar, explodir) · Imagem de esboço · Linha de deslocamento (jog) ·
Fazer trajetória · Reparar esboço · **Verificar esboço para recurso** (F3: tipo de contorno
esperado × encontrado — hoje o erro aparece na feature ✅)

### Totalmente definir esboço — F3
- **Relações a aplicar** (todas / selecionadas) · **Cotas**: referência horizontal e vertical
  (origem por padrão), esquema: base / cadeia / coordenada; posição acima/abaixo, esquerda/direita

### Alternar construção — ✅

## 4. Cotas

### Cota inteligente — ✅
- Aceita **arestas e vértices da peça** (viram referência do modelo, em roxo) ✅ — ex.: centro do
  círculo até a aresta da face onde está o esboço.
- **Distanciador automático** ✅: enquanto posiciona, a cota segue o cursor (prévia) e a linha de
  cota vai sozinha para a distância padrão da geometria; mais longe encaixa em múltiplos dessa
  distância (cotas paralelas igualmente espaçadas); entre as linhas de chamada o número fica
  centrado. O mesmo vale ao arrastar uma cota existente.
O tipo depende do que se seleciona e de **onde se solta o número**:

| Seleção | Cota | Status |
|---|---|---|
| Linha | comprimento (alinhada) | ✅ |
| Linha + posição fora do vão | horizontal/vertical da linha | F3 |
| 2 pontos | alinhada · horizontal · vertical (pela posição) | ✅ |
| Ponto + linha | distância perpendicular | ✅ |
| 2 linhas paralelas | distância | ✅ |
| 2 linhas não paralelas | ângulo (setor pela posição) | ✅ |
| Círculo | diâmetro | ✅ |
| Arco | raio | ✅ |
| Arco + Shift / opção | comprimento do arco | F3 |
| Círculo + círculo | centro a centro ✅ · mín/máx (Shift) F3 | 🟡 |
| Linha de centro + entidade | cota de diâmetro "por revolução" (dobro) | F3 |

Outros tipos — F3/⏸: horizontal/vertical dedicadas, linha de base, cadeia, coordenadas (ordinate),
chanfro.

### Diálogo "Modificar" (ao criar e ao editar) — 🟡
- Valor ✅ · aceita **expressão** ✅ (`20/2`) · **variável global** / equação ✅ (`=nome`)
- ✓ salvar ✅ · ✕ cancelar ✅ (Esc) · **Reconstruir** · setas ± com incremento · inverter sentido ·
  marcar para desenho

### Painel da cota — 🟡
**Aba Valor**
- Estilo de cota (favoritos) ⏸
- **Tolerância/Precisão**: tipo (nenhuma, básica, bilateral, limite, simétrica, mín, máx, ajuste),
  valores, nº de casas (F5 junto com Avaliar/desenho)
- **Valor primário**: nome (`D1@Esboço1`), valor ✅, **Acionadora/Acionada** ✅ ("cota de referência")
- Texto da cota (prefixo/sufixo) ⏸ · unidade dupla ⏸
**Aba Linhas de chamada** — F3 (visual)
- Setas: fora/dentro/inteligente · estilo de seta · raio/diâmetro/linear · chamada curvada ·
  quebrar linhas · posição do texto
**Aba Outros** — ⏸ (fonte, camada, substituir unidades)

## 5. Relações

### Lista de relações e combinações válidas

| Relação | Seleções aceitas | Status |
|---|---|---|
| Horizontal | 1+ linhas · 2+ pontos | ✅ |
| Vertical | 1+ linhas · 2+ pontos | ✅ |
| Colinear | 2+ linhas | ✅ (2) |
| Coradial | 2+ arcos/círculos (mesmo centro e raio) | F3 |
| Perpendicular | 2 linhas | ✅ |
| Paralela | 2+ linhas | ✅ |
| Paralela HV (3D) | — | ⏸ |
| Tangente | linha+arco/círculo · arco+arco · spline+linha/arco | ✅ (sem spline) |
| Concêntrica | 2+ arcos/círculos · ponto+arco | ✅ (arco/círculo) |
| Ponto médio | ponto + linha | ✅ |
| Interseção | 2 linhas + 1 ponto | F3 |
| Coincidente | ponto + linha/arco/círculo · ponto + ponto | ✅ |
| Igual | 2+ linhas · 2+ arcos/círculos | ✅ |
| Simétrica | linha de centro + 2 pontos/linhas/arcos | ✅ (2 pontos) |
| Fixa | qualquer entidade | ✅ |
| Perfurar (pierce) | ponto + curva fora do plano | ⏸ |
| Mesclar pontos | 2 pontos (vira 1) | ✅ (encaixe) |
| Em arestas do modelo / no ponto do modelo | referências externas | ✅ (via referência do modelo) |

### Caixinha de relações no ponteiro — ✅
- Ao selecionar entidades (Selecionar), abre ao lado do ponteiro uma caixinha com os **símbolos**
  das relações aplicáveis (H, V, ∥, ⊥, =, ⫽, T, ◎, ½, ⇹, ◉, ⚲); toque aplica. Some ao limpar a seleção.

### Adicionar relação (painel) — ✅ (via menu)
- **Entidades selecionadas** (lista) ✅
- **Relações existentes** (lista + estado) ✅
- **Adicionar relações**: só as aplicáveis à seleção ✅
- Opção **Para construção** e **Fixar** no mesmo painel F3

### Exibir/Excluir relações — ✅
- **Filtro** ✅: Todas no esboço · Superdefinindo / redundantes · Externas (peça) · Fixas ·
  Entidades selecionadas (tocar entidades no desenho filtra por elas)
- **Informações** ✅: estado de cada relação (Satisfeita · Superdefinindo · Redundante); tocar a
  relação destaca as entidades envolvidas
- Excluir ✅ · Excluir todas (do filtro) ✅ · Desfazer (Ctrl+Z) ✅ · Substituir entidade ⏸
- Selos de relação no desenho ✅ (mostrar/ocultar ✅)

## 6. Entrada (tablet e computador) — ✅

- Caneta desenha; dedo navega; sem caneta o dedo desenha com encaixes maiores e **lupa** ✅
- Computador: botão esquerdo desenha, meio arrasta, direito gira, roda aproxima ✅
- Atalhos ✅: L linha · R retângulo · C círculo · A arco · S spline · P polígono · T aparar ·
  D cota · O offset · M espelhar · V selecionar · Enter conclui · Esc cancela · Delete exclui
- Planejado (F3): **tecla S → barra de atalhos de contexto**, **gestos de mouse** (botão direito
  + arrastar → menu radial), **menu de contexto** do botão direito no esboço
