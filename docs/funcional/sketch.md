# Sketch — esboço

Status: ✅ existe · 🟡 parcial · F3/F4/F5 fase · ⏸ fora do escopo.
"Painel" = painel do comando (substitui a árvore). Hoje o painel do esboço fica à direita (🟡).

---

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
| Contornos sombreados | regiões fechadas preenchidas (mostra o que vira perfil) | F3 |
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

### Retângulo — ✅ (canto) / F3 (demais)
- **Tipo**: De canto ✅ · Central · 3 pontos de canto · 3 pontos central · Paralelogramo
- **Opções**: Para construção ✅ · **Adicionar linhas de construção**: dos cantos / dos pontos médios
- **Parâmetros**: X/Y de cada um dos 4 cantos e do centro

### Rasgo (Slot) — ✅ (reto) / F3 (demais)
- **Tipo**: Reto ✅ · Reto pelo centro · Em arco 3 pontos · Em arco pelo centro
- **Opções**: Adicionar cotas · **Cota**: centro a centro / total · Para construção ✅
- **Parâmetros**: centro X/Y, comprimento, largura, ângulo

### Círculo — ✅ (centro) / F3 (perimetral)
- **Tipo**: Pelo centro ✅ · Perimetral (3 pontos)
- **Parâmetros**: centro X/Y, raio

### Arco — ✅ (3 pontos) / F3 (demais)
- **Tipo**: Centro-pontas · Tangente · 3 pontos ✅
- **Parâmetros**: centro X/Y, início X/Y, fim X/Y, raio, ângulo

### Polígono — ✅
- **Opções**: Para construção ✅
- **Parâmetros**: nº de lados ✅ · **Círculo inscrito / circunscrito** (hoje inscrito; F3 ambos) ·
  centro X/Y · diâmetro · ângulo · botão **Novo polígono**

### Spline — ✅ (passagem por pontos)
- **Opções**: Para construção ✅ · Exibir pente de curvatura · Manter continuidade interna
- **Parâmetros por ponto**: nº do ponto, X/Y, peso de tangência 1/2, direção radial/polar da
  tangência, **tangência acionadora**, redefinir alça / todas, **Relaxar spline**, **Proporcional**
- Spline fechada ✅ (tocando no primeiro ponto)
- **Spline de estilo** (grau 3/5/7, polígono de controle) ⏸ · **Spline de equação**
  (explícita y=f(x) / paramétrica x(t),y(t), t1, t2, travar extremidades) ⏸ · **Ajustar spline** ⏸

### Elipse, elipse parcial, parábola, cônica — ⏸ (elipse F3 se necessário)
Parâmetros: centro, raios maior/menor, ângulos; cônica: rho.

### Ponto — F3 (necessário para o Furo assistido)
Parâmetros: X/Y.

### Texto do esboço — ⏸
Curvas de apoio, texto, alinhamento, inverter, fator de largura, espaçamento, fonte.

## 3. Ferramentas

### Filete de esboço — F3
- Entidades a filetar (cantos/vértices) · raio · **Manter cantos com restrição** ·
  **Cotar cada filete** · filetes iguais
### Chanfro de esboço — F3
- Ângulo-distância · Distância-distância · Distâncias iguais; D1, D2, ângulo

### Offset de entidades — ✅ (básico)
- Distância ✅ · **Adicionar cotas** ✅ (1ª linha) · **Inverter** ✅ ("Lado oposto")
- **Selecionar cadeia** ✅ (automático) · **Bidirecional** F3 · **Tampar extremidades**
  (arcos / linhas) F3
- **Geometria de construção**: entidades base / entidades deslocadas F3
- Pré-visualização antes de aplicar F3

### Converter entidades (projetar arestas do modelo) — F3
- Entidades a converter (arestas, faces, esboços) · Selecionar cadeia · Loops internos

### Interseção de curvas — ⏸
### Segmento (dividir em N partes com pontos) — ⏸

### Aparar entidades — ✅ (aparar o mais próximo)
- **Opções**: Aparar potente (riscar várias) F3 · Canto F3 · Aparar dentro F3 · Aparar fora F3 ·
  **Aparar o mais próximo** ✅
- **Manter entidades aparadas como construção** F3 · Ignorar aparar geometria de construção F3

### Estender entidades — F3
### Dividir entidades (ponto de divisão) — F3

### Mover / Copiar / Girar / Dimensionar / Esticar — F3
- Entidades · **Manter relações** · Copiar
- Mover/Copiar: De-Para (ponto base) / X-Y (ΔX, ΔY), repetir
- Girar: centro de rotação, ângulo
- Dimensionar: ponto base, fator de escala, copiar (nº)
- Esticar: entidades, ponto base/ΔXY

### Espelhar entidades — ✅
- Entidades a espelhar ✅ (seleção) · **Copiar** (sempre copia hoje) · **Espelhar em torno de** ✅
  (linha ou eixo) · relações de simetria ✅
- Espelhamento dinâmico (desenhar e espelhar ao mesmo tempo) ⏸

### Padrão linear de esboço — F3
- **Direção 1/2**: inverter, espaçamento, **cota de espaçamento X/Y**, nº de instâncias,
  exibir contagem, ângulo, **fixar direção do eixo X**
- Entidades a padronizar · Instâncias a pular

### Padrão circular de esboço — F3
- Centro (X/Y ou ponto), inverter, ângulo, **espaçamento igual**, nº de instâncias,
  raio, ângulo do arco, cotar raio/ângulo
- Entidades · Instâncias a pular

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
- Valor ✅ · aceita **expressão** ✅ (`20/2`) · **variável global** / equação (F3)
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
| Em arestas do modelo / no ponto do modelo | referências externas | F3 |

### Adicionar relação (painel) — ✅ (via menu)
- **Entidades selecionadas** (lista) ✅
- **Relações existentes** (lista + estado) ✅
- **Adicionar relações**: só as aplicáveis à seleção ✅
- Opção **Para construção** e **Fixar** no mesmo painel F3

### Exibir/Excluir relações — 🟡
- **Filtro**: Todas no esboço · Penduradas · **Superdefinindo/Não resolvidas** · Externas ·
  Definidas no contexto · Travadas · Quebradas · **Entidades selecionadas** (✅ hoje só este)
- **Informações**: estado de cada relação (Satisfeita · Superdefinindo · Não resolvida ·
  Pendurada), entidades envolvidas
- Excluir ✅ · Excluir todas · Desfazer · Substituir entidade · Fixar
- Selos de relação no desenho ✅ (mostrar/ocultar ✅)

## 6. Entrada (tablet e computador) — ✅

- Caneta desenha; dedo navega; sem caneta o dedo desenha com encaixes maiores e **lupa** ✅
- Computador: botão esquerdo desenha, meio arrasta, direito gira, roda aproxima ✅
- Atalhos ✅: L linha · R retângulo · C círculo · A arco · S spline · P polígono · T aparar ·
  D cota · O offset · M espelhar · V selecionar · Enter conclui · Esc cancela · Delete exclui
- Planejado (F3): **tecla S → barra de atalhos de contexto**, **gestos de mouse** (botão direito
  + arrastar → menu radial), **menu de contexto** do botão direito no esboço
