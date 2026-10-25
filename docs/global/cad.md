# WJCAD dentro do WJProMaster

O WJCAD é o antigo JLSCAD (arquivos `.wjcad`; abre `.jlscad` e `.cadt`). A especificação funcional completa do CAD continua em `docs/funcional/`:
- [features](../funcional/features.md)
- [sketch](../funcional/sketch.md)
- [chapa](../funcional/chapa.md)
- [avaliar](../funcional/avaliar.md)
- [referência do guia](../funcional/referencia-introducao.md)

Aqui fica só o que o CAD precisa **expor ou receber** para fazer parte do ecossistema.

## 1. Migração para o monorepo (G0)
- `src/` atual → `apps/cad/src/`. Núcleo de UI comum (abas, painel ✓/✕, árvore, menus, barra de
  status, perfis de dispositivo, gaveta, lupa) extraído para `packages/nucleo`. Ícones vão para
  `packages/icones`.
- O kernel (replicad/OpenCascade) continua só no CAD, carregado sob demanda. As outras faces nunca
  o baixam.
- Testes atuais (`teste-kernel`, `teste-esboco`, `teste-recursos`) continuam passando sem mudança
  de comportamento.

## 2. O que o CAD expõe (G1/G5)
- **Propriedades da peça** (janela Arquivo → Propriedades): padrão e personalizadas.
  - Padrão: código, descrição, material, massa, volume, área, caixa delimitadora.
  - Personalizadas: valores ou fórmulas como `=Massa*1,1`.
  - Por configuração.
- **Objetos endereçáveis** `wj://cad/<arquivo>/…`: propriedade, cota (`D1@Esboço1`), parâmetro de
  recurso, configuração, vista salva, planificado, lista de corte.
- **Funções para o motor comum**: `WJ.CAD(arquivo; nome)`.
- **Exportações de liberação** (chamadas pelo PDM, em Worker, sem UI):
  - STEP, STL;
  - DXF do planificado;
  - PDF/PNG de vistas;
  - malha leve (glTF) para o visualizador 3D.
- **Cotas de inspeção** (G7+): marcar cota como característica crítica, com tolerância. Alimenta o
  plano de inspeção do ERP.

## 3. O que o CAD recebe
- Material com densidade e custo do cadastro do ERP. A lista de materiais atual vira o fallback offline.
- Itens comprados (parafusos, perfis, componentes) para inserir quando houver montagens ⏸.
- Valores de células da Planilha para variáveis globais e tabela de configurações.
- Estado do WJPDM (o diretório do WJCAD, ver [pdm.md](pdm.md)): estado/revisão no título, travado quando liberado, check-out/check-in pelo menu
  Arquivo.

## 4. Pendências do CAD que entram na G1
- Chapa: (canto automático, itens da árvore e dobra esboçada, junta e meia-esquadria ✅)
  cantos, desdobrar/dobrar, converter em chapa.
- Fase 5: propriedades de seção.
- Fase 3: filete variável/de face, furo avançado.
