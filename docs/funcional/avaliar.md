# Avaliar — medições e análises (Fase 5)

Área de comando nova (aba **Avaliar**), definida pelo Johann em 22/10/2026.
Status: entregue antecipadamente junto com a Fase 3 (itens marcados ✅). Pendentes: Propriedades
de seção e os itens ⏸.

---

## 1. Medir (Measure) — ✅
Janela flutuante (não bloqueia o modelo), resultados atualizam a cada clique.
- **Seleções**: lista de entidades (faces, arestas, vértices, pontos de esboço, eixos, planos,
  origem); limpar seleções
- **Resultados** conforme a seleção:
  - 1 aresta: comprimento · 1 arco/círculo: raio, diâmetro, comprimento, centro
  - 1 face: área, perímetro · face cilíndrica: raio/diâmetro, eixo
  - 1 vértice/ponto: X, Y, Z
  - 2 entidades: **distância** (normal), ΔX, ΔY, ΔZ, ângulo (entre faces/arestas/planos)
- **Distância entre arcos/círculos**: Centro a centro · **Mínima** · **Máxima** · Personalizada
  (para cada lado)
- **Medições XYZ**: mostrar ΔX/ΔY/ΔZ como cotas no viewport
- **Projetado em**: Nenhum · Tela · Plano/face selecionado
- **Unidades/precisão**: mm/pol, casas decimais, ângulo em graus/radianos
- **Histórico** de medições · **Criar sensor** (⏸)
- Medidas desenhadas temporariamente no viewport (rótulos)

## 2. Propriedades de massa (Mass Properties) — ✅
- **Itens selecionados**: corpos (padrão: peça inteira) · incluir corpos ocultos
- **Material/densidade**: do material da peça (ver features.md §17) ou densidade informada
- **Relatar coordenadas relativas a**: sistema de coordenadas (padrão: origem)
- **Substituir propriedades de massa**: massa, centro de massa, momentos de inércia
- **Criar recurso de centro de massa** (ponto na árvore)
- **Resultados**:
  - densidade · **massa** · **volume** · **área de superfície**
  - **centro de massa** (X, Y, Z)
  - eixos principais de inércia e momentos principais (Ix, Iy, Iz) no centro de massa
  - momentos de inércia no centro de massa alinhados ao sistema de saída (Lxx…Lzz)
  - momentos de inércia no sistema de saída (Ixx…Izz)
- Botões: **Recalcular** · **Copiar para a área de transferência** · Imprimir · Opções
  (unidades, precisão, origem das propriedades do material)
- Tríade de inércia exibida no viewport no centro de massa
- 🟡 Hoje: só o **volume** aparece na barra de status.

## 3. Propriedades de seção (Section Properties) — F5 (pendente)
Para uma face plana ou região de esboço: área, centroide, momentos de inércia de área
(no centroide e na origem), eixos principais, momento polar.

## 4. Vista de seção (Section View) — ✅
Corte apenas visual (não altera a peça).
- **Seção 1**: plano (Frontal/Superior/Lateral/face/plano), **deslocamento**, girar X / girar Y,
  inverter lado
- **Seção 2** e **Seção 3** (combinadas)
- **Seção por zona** (escolher quais zonas mostrar) · seção somente gráfica
- **Mostrar tampa da seção** (cor da tampa, manter cor) · transparência dos corpos cortados
- Alça de arrasto no viewport para o plano · salvar vista
- Botão na barra de vistas (liga/desliga)

## 5. Verificar (Check) — geometria — ✅
- **Verificar**: geometria sólida · superfície · verificação rigorosa
- **Encontrar**: faces inválidas · arestas inválidas · arestas curtas (limite) ·
  raio mínimo de curvatura · folga máxima de aresta/vértice
- **Resultados**: lista clicável, destaque no modelo

## 6. Análise de geometria (Geometry Analysis)
Arestas pequenas (comprimento mín.) · faces descontínuas · arestas afiadas (ângulo) ·
faces estreitas (largura) → lista e destaque.

## 7. Análise de inclinação (Draft Analysis) — moldagem/fundição — ✅
- **Direção de extração** (face/plano/aresta), inverter
- **Ângulo de inclinação** desejado
- **Classificação**: por face · transição gradual
- **Cores**: inclinação positiva · negativa · requer inclinação · faces divididas (straddle);
  contagem de faces por categoria

## 8. Análise de espessura (Thickness Analysis) — ✅
- **Espessura alvo** · mostrar regiões **finas** / **grossas** · limite de espessura grossa
- Resolução (baixa/média/alta) · tratar cantos como espessura zero · escala de cores
- Uso: verificar casca, nervuras, peças injetadas

## 9. Listras zebra (Zebra Stripes) — ✅
Nº de listras · largura · precisão · horizontal/esférico · cor das listras e do fundo.
Avalia continuidade (tangência/curvatura) entre faces.

## 10. Curvatura (Curvature) — ✅
Faces coloridas pela curvatura (escala de cores, raio mínimo), pentes de curvatura em arestas.

## 11. Análise de rebaixos (Undercut) e linha de partição — ⏸
Direção de extração, linha de partição; cores para faces visíveis por cima/baixo/rebaixadas.

## 12. Verificação de simetria — ⏸
Plano de simetria → faces simétricas / não simétricas / únicas.

## 13. Comparar — ⏸
Comparar documentos / recursos / geometria entre duas versões da peça.

## 14. Detecção de interferência (multicorpo) — ⏸
Corpos selecionados, ignorar coincidências, volumes de interferência listados.

## 15. Desempenho da reconstrução (Feature statistics) — ✅
- Tempo total de reconstrução e **tempo de cada recurso** (ordenável), nº de recursos/sólidos
- 🟡 Hoje: tempo total na barra de status. Útil para manter o app leve no tablet.

## Fora do escopo
Custeio, simulação, sustentabilidade, verificação de projeto para fabricação (DFM) automática.
