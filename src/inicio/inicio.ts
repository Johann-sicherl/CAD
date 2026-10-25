// Página inicial do WJProMaster: uma caixa para cada software do ecossistema.
// Leve de propósito (sem Three.js nem kernel): abre na hora; o WJCAD só é baixado quando
// o usuário entra nele. Roteiro e especificação de cada face: docs/global/.

import "./inicio.css";

interface Face {
  id: string;
  nome: string;
  descricao: string;
  /** Endereço (relativo à página inicial) quando já existe. */
  url?: string;
  /** Fase do roteiro global em que chega (docs/global/README.md §4). */
  fase?: string;
  icone: string;
}

const C = "#2f7fd0"; // traço de destaque (mesmo acento do app)
const svg = (corpo: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;

const FACES: Face[] = [
  {
    id: "cad", nome: "WJCAD", url: "cad/",
    descricao: "CAD paramétrico: esboço, recursos, chapa metálica, planificado e DXF.",
    icone: svg(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" stroke="${C}"/>`),
  },
  {
    id: "pdm", nome: "WJPDM", url: "pdm/",
    descricao: "Diretório do WJCAD: cofre, versões e revisões, aprovações, itens e lista de materiais.",
    icone: svg(`<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10.5l3 1.7v3.4L12 17.3l-3-1.7v-3.4z" stroke="${C}"/>`),
  },
  {
    id: "planilha", nome: "WJPlaniel", url: "planilha/",
    descricao: "Planilhas com fórmulas avançadas, tabelas dinâmicas, gráficos e otimizador.",
    icone: svg(`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/><path d="M12.5 17l2-5 2 3 2-4" stroke="${C}"/>`),
  },
  {
    id: "documentos", nome: "WJWord", url: "documento/",
    descricao: "Documentos com estilos, sumário, campos ligados aos projetos e controle de alterações.",
    icone: svg(`<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 11h6M9 14h6M9 17h4" stroke="${C}"/>`),
  },
  {
    id: "apresentacoes", nome: "WJApion", url: "apresentacao/",
    descricao: "Apresentações com temas, animações, modo apresentador e peças 3D do WJCAD.",
    icone: svg(`<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/><path d="M7 12l3-3 2 2 4-4" stroke="${C}"/>`),
  },
  {
    id: "cronograma", nome: "WJCronProject", url: "cronograma/",
    descricao: "Cronogramas com Gantt, caminho crítico, recursos, linhas de base e valor agregado.",
    icone: svg(`<path d="M4 4v16h16"/><path d="M7 7h6M10 11h7M8 15h5" stroke="${C}" stroke-width="2.4"/>`),
  },
  {
    id: "erp", nome: "WJERP", fase: "G7",
    descricao: "Gestão integrada ao WJPDM e ao WJCAD: compras, estoque, PCP/MRP, vendas e financeiro.",
    icone: svg(`<path d="M4 20V10l4-3v13M8 20V7l5 3v10M13 20v-7l7-3v10"/><path d="M3 20h18" stroke="${C}"/>`),
  },
];

/** Nome do último documento do WJCAD guardado neste aparelho (autosave). */
function ultimoDocumentoCad(): string | null {
  try {
    const d = JSON.parse(localStorage.getItem("jlscad:documento") ?? "null") as { nome?: string; features?: unknown[] } | null;
    return d?.features?.length ? d.nome ?? null : null;
  } catch {
    return null;
  }
}

function montarCaixas() {
  const lista = document.getElementById("caixas")!;
  const ultimo = ultimoDocumentoCad();
  for (const f of FACES) {
    const pronto = !!f.url;
    const el = document.createElement(pronto ? "a" : "div");
    el.className = `caixa${pronto ? "" : " em-breve"}`;
    if (el instanceof HTMLAnchorElement) el.href = f.url!;
    el.innerHTML = `
      <span class="caixa-icone">${f.icone}</span>
      <span class="caixa-texto">
        <strong>${f.nome}</strong>
        <span>${f.descricao}</span>
        ${pronto && f.id === "cad" && ultimo ? `<em class="caixa-nota">Continuar: ${ultimo.replace(/[<>&]/g, "")}</em>` : ""}
      </span>
      <span class="selo ${pronto ? "selo-ok" : ""}">${pronto ? "Abrir" : `Em breve · ${f.fase}`}</span>`;
    if (!pronto) el.title = `${f.nome}: em desenvolvimento (fase ${f.fase} do roteiro)`;
    lista.appendChild(el);
  }
}

/** Mostra no rodapé se o WJCAD já está guardado para uso sem internet neste aparelho. */
async function estadoOffline() {
  const alvo = document.getElementById("estado-offline")!;
  if (!("caches" in window)) return;
  try {
    for (const k of await caches.keys()) {
      if (!k.startsWith("jlscad-")) continue;
      const c = await caches.open(k);
      const tem = (await c.keys()).some((r) => /replicad.*\.wasm$/.test(r.url));
      if (tem) {
        alvo.textContent = "✓ WJCAD guardado neste aparelho: abre rápido e funciona sem internet.";
        return;
      }
    }
    alvo.textContent = "Na primeira vez, o WJCAD baixa o núcleo geométrico (~7 MB). Depois ele fica guardado no aparelho.";
  } catch {
    /* sem acesso ao cache: não mostra nada */
  }
}

montarCaixas();
void estadoOffline();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}
