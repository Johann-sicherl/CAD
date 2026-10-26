// Viewport 3D com Three.js, em projeção ortográfica (sem ponto de fuga, como nos CADs).
// Gestos de toque:
//   1 dedo = orbitar · 2 dedos = pinça (zoom) + arrastar (pan) · toque duplo = enquadrar
// Inclui planos de referência (Frontal, Superior, Lateral), origem, estilos de exibição
// e a tríade de eixos no canto inferior esquerdo (toque num eixo = olhar ao longo dele).

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { InfoReferencia, MalhaPeca, MalhaSimples } from "./kernel/regenerar";
import type { Topologia } from "./kernel/topologia";
import { coresCurvatura, coresEspessura, coresInclinacao, materialZebra, type Analise } from "./analises";
import type { Plano, Vec3 } from "./model";
import type { Referencial } from "./esboco/referencial";

export type Vista = "iso" | "frontal" | "traseira" | "superior" | "inferior" | "esquerda" | "direita";
export type EstiloExibicao = "sombreado-arestas" | "sombreado" | "arestas";
export type IdReferencia = Plano | "origem";

// Y para cima: frontal olha de +Z, superior de +Y, direita de +X; isométrica de (1, 1, 1)
const DIRECOES_VISTA: Record<Vista, [number, number, number]> = {
  iso: [1, 1, 1],
  frontal: [0, 0.0001, 1],
  traseira: [0, 0.0001, -1],
  superior: [0, 1, 0.0001],
  inferior: [0, -1, 0.0001],
  esquerda: [-1, 0.0001, 0],
  direita: [1, 0.0001, 0],
};

const NORMAL_PLANO: Record<Plano, Vista> = { XY: "frontal", XZ: "superior", YZ: "direita" };

const COR_EIXO = { x: 0xd9443f, y: 0x3c9a4f, z: 0x2f7fd0 };
const COR_PLANO = 0x5b8fc7;
const COR_DESTAQUE = 0x2f7fd0;
const COR_CURVA = 0xb0561c; // curvas 3D (hélice, por pontos…)
const TAM_TRIADE = 112; // px CSS

interface Referencia {
  grupo: THREE.Group;
  preenchimento?: THREE.MeshBasicMaterial;
  contorno: THREE.LineBasicMaterial;
  visivel: boolean;
}

export type TipoEntidade = "face" | "aresta" | "vertice";
/** Entidade da peça na tela: índice em `topologia.faces/arestas/vertices`. */
export interface Entidade {
  tipo: TipoEntidade;
  indice: number;
}

const COR_SELECAO = 0x1f78d1;
const COR_REALCE = 0x7fb8ef;
/** Faces do recurso selecionado na árvore: outro tom, para ver onde ele está na peça. */
const COR_RECURSO = 0x2bb3a3;
/** Prévia do recurso em edição: faces que ele cria (âmbar) e material que ele tira (vermelho). */
const COR_PREVIA = 0xf0a020;
const COR_REMOVIDO = 0xd9443a;

/** Face plana tocada na peça: ponto e normal para iniciar um esboço nela. */
export interface FacePlana {
  origem: Vec3;
  normal: Vec3;
}

/** Comprimento das setas de arrasto na tela (px). */
const COMPR_ALCA_PX = 46;

export class Viewport {
  /**
   * Chamado antes da navegação em cada pointerdown. Devolvendo true, o evento é do esboço
   * (caneta desenhando, mouse esquerdo…) e a câmera não se mexe.
   */
  interceptador: ((e: PointerEvent) => boolean) | null = null;
  /** Toque/clique curto que a navegação não usou (ex.: escolher face, limpar seleção). */
  aoToqueCurto: ((e: PointerEvent) => void) | null = null;
  /** Depois de cada quadro desenhado (posicionar rótulos HTML, lupa). */
  aposDesenhar: (() => void) | null = null;
  /** Câmera mudou (zoom/órbita): a camada do esboço refaz setas na escala certa. */
  aoMudarCamera: (() => void) | null = null;
  readonly grupoEsboco = new THREE.Group();
  /** Botão direito (ou toque longo): menu de contexto. */
  aoMenuContexto: ((e: MouseEvent) => void) | null = null;
  /** Toque longo (caneta ou dedo parado), em ms; 0 desliga. Fora do esboço abre o menu de contexto. */
  tempoToqueLongo = 600;
  /** Clique/toque duplo (fora da tríade). */
  aoToqueDuplo: ((e: PointerEvent) => void) | null = null;
  /** Outros interessados em mudanças de câmera (rótulos de cotas no modelo). */
  readonly ouvintesCamera = new Set<() => void>();
  /** Alça arrastada: `delta` em mm ao longo da direção da alça desde o início do arraste. */
  aoArrastarAlca: ((id: string, delta: number, fim: boolean) => void) | null = null;
  private alcas: { id: string; pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  private grupoAlcas = new THREE.Group();

  private renderer: THREE.WebGLRenderer;
  private cena = new THREE.Scene();
  /** Ortográfica: `zoom` = pixels por mm (frustum em pixels da tela). */
  private camera: THREE.OrthographicCamera;
  /** Distância da câmera ao alvo: só precisa ficar fora da peça (não muda o tamanho na tela). */
  private distCam = 2000;
  private controles: OrbitControls;
  private grupoPeca = new THREE.Group();
  private faces: Uint32Array = new Uint32Array();
  private gruposArestas: Uint32Array = new Uint32Array();
  private posArestas: Float32Array = new Float32Array();
  topologia: Topologia | null = null;
  private grupoDestaque = new THREE.Group();
  private grupoPrevia = new THREE.Group();
  private grupoRefsExtras = new THREE.Group();
  private grupoSecao = new THREE.Group();
  private secao: THREE.Plane | null = null;
  private analise: Analise | null = null;
  /** Último resultado de análise (texto para o painel). */
  infoAnalise = "";
  private grupoRefs = new THREE.Group();
  private refs = new Map<IdReferencia, Referencia>();
  private destaque: IdReferencia | null = null;
  private estilo: EstiloExibicao = "sombreado-arestas";
  private raioCena = 60;
  private precisaRender = true;

  // tríade
  private cenaTriade = new THREE.Scene();
  private cameraTriade = new THREE.OrthographicCamera(-1.7, 1.7, 1.7, -1.7, 0.1, 20);
  private rotulosTriade: THREE.Sprite[] = [];

  private materialSolido = new THREE.MeshStandardMaterial({
    color: 0xd0d7df,
    metalness: 0.1,
    roughness: 0.6,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  private materialArestas = new THREE.LineBasicMaterial({ color: 0x1f2a35 });

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
    this.renderer.localClippingEnabled = true;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // poupa GPU do tablet
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    // Y para cima, como nos CADs profissionais
    THREE.Object3D.DEFAULT_UP.set(0, 1, 0);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 4000);
    this.camera.up.set(0, 1, 0);

    // registrado antes do OrbitControls: pode impedir que a navegação veja o evento
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      if (this.pegarAlca(e)) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      if (this.interceptador?.(e)) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    });

    this.controles = new OrbitControls(this.camera, this.renderer.domElement);
    this.controles.zoomToCursor = true; // pinça e roda do mouse aproximam onde se aponta
    this.controles.minZoom = 1e-4;
    this.controles.maxZoom = 1e5;
    this.modoEsboco(false);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.12;
    this.controles.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controles.addEventListener("change", () => {
      this.precisaRender = true;
      this.aoMudarCamera?.();
      this.ouvintesCamera.forEach((f) => f());
    });

    this.cena.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.7));
    const sol = new THREE.DirectionalLight(0xffffff, 1.3);
    sol.position.set(1, -1.5, 2);
    this.camera.add(sol); // luz acompanha a câmera, a peça nunca fica no escuro
    this.cena.add(this.camera);

    this.criarReferencias();
    this.grupoEsboco.renderOrder = 10;
    this.grupoDestaque.renderOrder = 5;
    this.grupoAlcas.renderOrder = 30;
    this.ouvintesCamera.add(() => { if (this.alcas.length) this.desenharAlcas(); });
    this.grupoPrevia.renderOrder = 4;
    this.cena.add(this.grupoPeca, this.grupoRefs, this.grupoRefsExtras, this.grupoSecao, this.grupoDestaque, this.grupoPrevia, this.grupoEsboco, this.grupoAlcas);
    this.renderer.domElement.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // toque longo nativo do Android: quem decide é o nosso temporizador (tempo configurável)
      if (this.dedoOuCanetaNaTela) return;
      this.aoMenuContexto?.(e);
    });
    this.criarTriade();

    this.escutarToques();
    new ResizeObserver(() => this.redimensionar()).observe(container);
    this.redimensionar();
    this.definirVista("iso", false);
    this.enquadrar(false);
    this.loop();
  }

  // ---------- geometria de referência ----------

  private criarReferencias() {
    const planos: [Plano, THREE.Euler][] = [
      ["XY", new THREE.Euler(0, 0, 0)],
      ["XZ", new THREE.Euler(Math.PI / 2, 0, 0)],
      ["YZ", new THREE.Euler(0, Math.PI / 2, 0)],
    ];
    for (const [id, rot] of planos) {
      const grupo = new THREE.Group();
      grupo.rotation.copy(rot);
      const preenchimento = new THREE.MeshBasicMaterial({
        color: COR_PLANO, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false,
      });
      const contorno = new THREE.LineBasicMaterial({ color: COR_PLANO, transparent: true, opacity: 0.7 });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), preenchimento);
      quad.renderOrder = 2;
      quad.userData.idRef = { tipo: "plano", id };
      const borda = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, -0.5, 0),
          new THREE.Vector3(0.5, 0.5, 0), new THREE.Vector3(-0.5, 0.5, 0),
        ]),
        contorno,
      );
      grupo.add(quad, borda);
      this.grupoRefs.add(grupo);
      this.refs.set(id, { grupo, preenchimento, contorno, visivel: true });
    }

    // Origem: três segmentos curtos coloridos e um ponto
    const grupo = new THREE.Group();
    const contorno = new THREE.LineBasicMaterial({ color: 0x33414f });
    (["x", "y", "z"] as const).forEach((eixo, i) => {
      const fim = new THREE.Vector3().setComponent(i, 1);
      const linha = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), fim]),
        new THREE.LineBasicMaterial({ color: COR_EIXO[eixo] }),
      );
      grupo.add(linha);
    });
    const ponto = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]),
      new THREE.PointsMaterial({ color: 0x33414f, size: 7, sizeAttenuation: false }),
    );
    grupo.add(ponto);
    this.grupoRefs.add(grupo);
    this.refs.set("origem", { grupo, contorno, visivel: true });

    this.ajustarTamanhoReferencias(50);
  }

  /** Os planos acompanham o tamanho da peça (como em qualquer CAD). */
  private ajustarTamanhoReferencias(meioLado: number) {
    for (const [id, r] of this.refs) {
      const s = id === "origem" ? meioLado * 0.3 : meioLado * 2;
      r.grupo.scale.setScalar(s);
    }
  }

  definirVisibilidadeReferencia(id: IdReferencia, visivel: boolean) {
    const r = this.refs.get(id)!;
    r.visivel = visivel;
    this.atualizarReferencias();
  }

  /** Destaca um plano/origem (selecionado na árvore). Destacado aparece mesmo se oculto. */
  destacarReferencia(id: IdReferencia | null) {
    this.destaque = id;
    this.atualizarReferencias();
  }

  private atualizarReferencias() {
    for (const [id, r] of this.refs) {
      const ativo = id === this.destaque;
      r.grupo.visible = r.visivel || ativo;
      if (r.preenchimento) {
        r.preenchimento.color.setHex(ativo ? COR_DESTAQUE : COR_PLANO);
        r.preenchimento.opacity = ativo ? 0.22 : 0.08;
        r.contorno.color.setHex(ativo ? COR_DESTAQUE : COR_PLANO);
        r.contorno.opacity = ativo ? 1 : 0.7;
      }
    }
    this.precisaRender = true;
  }

  // ---------- tríade ----------

  private criarTriade() {
    const eixos: ["x" | "y" | "z", THREE.Vector3][] = [
      ["x", new THREE.Vector3(1, 0, 0)],
      ["y", new THREE.Vector3(0, 1, 0)],
      ["z", new THREE.Vector3(0, 0, 1)],
    ];
    const cabeca = new THREE.ConeGeometry(0.12, 0.32, 16);
    const haste = new THREE.CylinderGeometry(0.035, 0.035, 1, 8);
    for (const [nome, dir] of eixos) {
      const mat = new THREE.MeshBasicMaterial({ color: COR_EIXO[nome] });
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const h = new THREE.Mesh(haste, mat);
      h.quaternion.copy(q);
      h.position.copy(dir).multiplyScalar(0.5);
      const c = new THREE.Mesh(cabeca, mat);
      c.quaternion.copy(q);
      c.position.copy(dir).multiplyScalar(1.1);
      const rotulo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texturaRotulo(nome.toUpperCase(), COR_EIXO[nome]), depthTest: false }));
      rotulo.position.copy(dir).multiplyScalar(1.5);
      rotulo.scale.setScalar(0.5);
      rotulo.userData.eixo = nome;
      this.rotulosTriade.push(rotulo);
      this.cenaTriade.add(h, c, rotulo);
    }
    const centro = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshBasicMaterial({ color: 0x55606b }));
    this.cenaTriade.add(centro);
  }

  /** Toques curtos: na tríade orientam a vista; fora dela vão para `aoToqueCurto`. */
  private escutarToques() {
    const el = this.renderer.domElement;
    const inicios = new Map<number, { x: number; y: number; t: number }>();
    let ultimo: { x: number; y: number; t: number } | null = null;
    // toque longo: só caneta/dedo, um ponteiro só, parado (até 8 px) pelo tempo configurado
    let longo: { id: number; timer: number } | null = null;
    let consumido = -1; // ponteiro cujo toque longo já abriu o menu: o soltar não vale como toque
    const pararLongo = () => {
      if (longo) clearTimeout(longo.timer);
      longo = null;
    };
    el.addEventListener("pointerdown", (e) => {
      inicios.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
      if (e.pointerType !== "mouse") this.ponteirosToque++;
      pararLongo();
      if (e.pointerType === "mouse" || this.emEsboco || this.tempoToqueLongo <= 0 || inicios.size > 1) return;
      const { clientX, clientY } = e;
      longo = {
        id: e.pointerId,
        timer: window.setTimeout(() => {
          longo = null;
          consumido = e.pointerId;
          this.controles.enabled = false; // o dedo continua na tela: não girar ao soltar
          this.aoMenuContexto?.(new MouseEvent("contextmenu", { clientX, clientY }));
          navigator.vibrate?.(15);
        }, this.tempoToqueLongo),
      };
    });
    el.addEventListener("pointermove", (e) => {
      const ini = inicios.get(e.pointerId);
      if (longo?.id === e.pointerId && ini && Math.hypot(e.clientX - ini.x, e.clientY - ini.y) > 8) pararLongo();
    });
    const fimLongo = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") this.ponteirosToque = Math.max(0, this.ponteirosToque - 1);
      if (longo?.id === e.pointerId) pararLongo();
      if (consumido === e.pointerId) {
        this.controles.enabled = true;
        return true;
      }
      return false;
    };
    el.addEventListener("pointercancel", (e) => {
      inicios.delete(e.pointerId);
      if (fimLongo(e)) consumido = -1;
    });
    el.addEventListener("pointerup", (e) => {
      const ini = inicios.get(e.pointerId);
      inicios.delete(e.pointerId);
      if (fimLongo(e)) {
        consumido = -1;
        return;
      }
      // só o botão esquerdo é "toque" (o direito abre o menu de contexto; o do meio gira)
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!ini || Math.hypot(e.clientX - ini.x, e.clientY - ini.y) > 8 || performance.now() - ini.t > 600) return;
      if (inicios.size) return; // ainda há outro dedo na tela: era gesto
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = r.bottom - e.clientY;
      if (px <= TAM_TRIADE && py <= TAM_TRIADE) {
        const ndc = new THREE.Vector2((px / TAM_TRIADE) * 2 - 1, (py / TAM_TRIADE) * 2 - 1);
        const ray = new THREE.Raycaster();
        ray.setFromCamera(ndc, this.cameraTriade);
        const alvo = ray.intersectObjects(this.rotulosTriade)[0];
        if (alvo) {
          const eixo = alvo.object.userData.eixo as "x" | "y" | "z";
          this.definirVista(eixo === "x" ? "direita" : eixo === "y" ? "superior" : "frontal");
          return;
        }
      }
      // segundo toque curto logo depois e perto do primeiro: toque duplo
      const agora = performance.now();
      if (ultimo && agora - ultimo.t < 380 && Math.hypot(e.clientX - ultimo.x, e.clientY - ultimo.y) < (e.pointerType === "touch" ? 28 : 8)) {
        ultimo = null;
        if (this.aoToqueDuplo) this.aoToqueDuplo(e);
        else if (!this.emEsboco) this.enquadrar();
        return;
      }
      ultimo = { x: e.clientX, y: e.clientY, t: agora };
      this.aoToqueCurto?.(e);
    });
  }

  // ---------- esboço: navegação, conversões tela ↔ plano ----------

  private emEsboco = false;

  /** Algum dedo/caneta encostado no viewport (o toque longo é tratado pelo nosso temporizador). */
  private get dedoOuCanetaNaTela() {
    return this.ponteirosToque > 0;
  }
  private ponteirosToque = 0;

  /**
   * Mouse como nos CADs profissionais: botão do meio gira (Ctrl + meio arrasta), roda aproxima,
   * direito abre o menu de contexto. Fora do esboço o esquerdo arrastado no vazio também gira
   * (útil em touchpad); no esboço o esquerdo é só do desenho.
   */
  modoEsboco(ativo: boolean) {
    this.emEsboco = ativo;
    this.controles.mouseButtons = ativo
      ? { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: null };
  }

  private raio(clientX: number, clientY: number): THREE.Raycaster {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray;
  }

  /** Ponto da tela → coordenadas (x, y) no plano do esboço. */
  telaParaPlano(clientX: number, clientY: number, ref: Referencial): { x: number; y: number } | null {
    const n = new THREE.Vector3(...ref.normal);
    const plano = new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(...ref.origem));
    const p = this.raio(clientX, clientY).ray.intersectPlane(plano, new THREE.Vector3());
    if (!p) return null;
    const d = p.sub(new THREE.Vector3(...ref.origem));
    return { x: d.dot(new THREE.Vector3(...ref.x)), y: d.dot(new THREE.Vector3(...ref.y)) };
  }

  /** Ponto do mundo → pixel (relativo ao canto do viewport). */
  mundoParaTela(p: Vec3): { x: number; y: number } {
    const t = this.paraTela(new THREE.Vector3(...p));
    return { x: t.x, y: t.y };
  }

  /** Retângulo da peça na tela (pixels relativos ao viewport); null sem peça. */
  retanguloDaPeca(): { x0: number; y0: number; x1: number; y1: number } | null {
    const caixa = new THREE.Box3().setFromObject(this.grupoPeca);
    if (caixa.isEmpty()) return null;
    const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let i = 0; i < 8; i++) {
      const t = this.mundoParaTela([i & 1 ? caixa.max.x : caixa.min.x, i & 2 ? caixa.max.y : caixa.min.y, i & 4 ? caixa.max.z : caixa.min.z]);
      r.x0 = Math.min(r.x0, t.x); r.y0 = Math.min(r.y0, t.y);
      r.x1 = Math.max(r.x1, t.x); r.y1 = Math.max(r.y1, t.y);
    }
    return r;
  }

  /** Coordenadas do plano → pixel (relativo ao canto do viewport). */
  planoParaTela(ref: Referencial, x: number, y: number): { x: number; y: number } {
    const p = new THREE.Vector3(...ref.origem)
      .addScaledVector(new THREE.Vector3(...ref.x), x)
      .addScaledVector(new THREE.Vector3(...ref.y), y)
      .project(this.camera);
    const { clientWidth: w, clientHeight: h } = this.container;
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
  }

  /** Quantos mm do plano cabem num pixel perto do ponto (para tolerâncias de toque). */
  mmPorPixel(ref: Referencial, x = 0, y = 0): number {
    const t = this.planoParaTela(ref, x, y);
    const r = this.renderer.domElement.getBoundingClientRect();
    const a = this.telaParaPlano(r.left + t.x, r.top + t.y, ref);
    const b = this.telaParaPlano(r.left + t.x + 10, r.top + t.y, ref);
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) / 10 : 0.1;
  }

  /** Olha o plano de frente, com o Y do esboço para cima quando possível. */
  olharPlano(ref: Referencial) {
    const n = new THREE.Vector3(...ref.normal);
    const o = new THREE.Vector3(...ref.origem);
    const alvo = this.controles.target.clone();
    alvo.sub(n.clone().multiplyScalar(alvo.clone().sub(o).dot(n))); // projeta o alvo no plano
    const dir = n.clone();
    // plano horizontal (normal ≈ Y, o "para cima" da câmera): inclina um fio para o y do esboço
    // ficar para cima na tela (no Superior, o −Z do mundo)
    if (Math.abs(dir.y) > 0.999) dir.addScaledVector(new THREE.Vector3(...ref.y), -0.0001);
    this.moverCamera(alvo, alvo.clone().add(dir.normalize().multiplyScalar(this.distCam)), true);
  }

  /** Face plana da peça sob o ponto da tela (null se não houver peça ou a face for curva). */
  picarFace(clientX: number, clientY: number): FacePlana | null {
    const solido = this.grupoPeca.getObjectByName("solido") as THREE.Mesh | undefined;
    if (!solido || !solido.visible) return null;
    const hit = this.raio(clientX, clientY).intersectObject(solido)[0];
    if (!hit || hit.faceIndex == null) return null;
    const idx = hit.faceIndex * 3;
    const geo = solido.geometry;
    const normais = geo.getAttribute("normal") as THREE.BufferAttribute;
    const indices = geo.getIndex()!;
    for (let i = 0; i < this.faces.length; i += 3) {
      const ini = this.faces[i], qtd = this.faces[i + 1];
      if (idx < ini || idx >= ini + qtd) continue;
      // face plana: todas as normais iguais
      const n0 = new THREE.Vector3().fromBufferAttribute(normais, indices.getX(ini));
      for (let k = ini; k < ini + qtd; k++) {
        const nk = new THREE.Vector3().fromBufferAttribute(normais, indices.getX(k));
        if (nk.dot(n0) < 0.9999) return null;
      }
      const n = n0.normalize();
      return { origem: hit.point.toArray() as Vec3, normal: n.toArray() as Vec3 };
    }
    return null;
  }

  /** Canvas WebGL (a lupa copia dele logo depois de cada quadro). */
  canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  tamanho(): { w: number; h: number } {
    return { w: this.container.clientWidth, h: this.container.clientHeight };
  }

  pedirRender() {
    this.precisaRender = true;
  }

  // ---------- peça ----------

  mostrarMalha(m: MalhaPeca | null, topo: Topologia | null = null) {
    this.topologia = topo;
    this.gruposArestas = m?.gruposArestas ?? new Uint32Array();
    this.posArestas = m?.arestas ?? new Float32Array();
    this.destacarEntidades([]);
    this.grupoPeca.children.forEach((o) => {
      (o as THREE.Mesh).geometry?.dispose();
    });
    this.grupoPeca.clear();
    if (m) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(m.vertices, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(m.normais, 3));
      geo.setIndex(new THREE.BufferAttribute(m.triangulos, 1));
      const solido = new THREE.Mesh(geo, this.materialSolido);
      solido.name = "solido";
      this.grupoPeca.add(solido);

      const geoA = new THREE.BufferGeometry();
      geoA.setAttribute("position", new THREE.BufferAttribute(m.arestas, 3));
      const arestas = new THREE.LineSegments(geoA, this.materialArestas);
      arestas.name = "arestas";
      this.grupoPeca.add(arestas);
    }
    this.faces = m?.faces ?? new Uint32Array();
    this.aplicarEstilo();
    this.aplicarAnalise();
    this.aplicarSecao();

    const caixa = new THREE.Box3().setFromObject(this.grupoPeca);
    let meio = 50;
    if (!caixa.isEmpty()) {
      const ext = Math.max(...caixa.min.toArray().map(Math.abs), ...caixa.max.toArray().map(Math.abs));
      meio = Math.max(20, ext * 1.15);
    }
    this.ajustarTamanhoReferencias(meio);
    // câmera sempre fora da peça e dos planos; o far cobre a peça inteira atrás do alvo
    const d = Math.max(2000, meio * 20);
    if (d > this.distCam) {
      this.distCam = d;
      const dir = this.camera.position.clone().sub(this.controles.target).normalize();
      this.camera.position.copy(this.controles.target).addScaledVector(dir, d);
      this.camera.far = 2 * d;
      this.camera.updateProjectionMatrix();
    }
    this.precisaRender = true;
  }

  definirEstilo(e: EstiloExibicao) {
    this.estilo = e;
    this.aplicarEstilo();
  }

  private aplicarEstilo() {
    const solido = this.grupoPeca.getObjectByName("solido");
    const arestas = this.grupoPeca.getObjectByName("arestas");
    if (solido) solido.visible = this.estilo !== "arestas";
    if (arestas) arestas.visible = this.estilo !== "sombreado";
    this.precisaRender = true;
  }

  // ---------- seleção de faces, arestas e vértices ----------

  private solido(): THREE.Mesh | null {
    const s = this.grupoPeca.getObjectByName("solido") as THREE.Mesh | undefined;
    return s && s.visible ? s : null;
  }

  /** Distância do ponto ao plano da câmera, ao longo da direção de visão. */
  private profundidade(p: THREE.Vector3): number {
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    return p.clone().sub(this.camera.position).dot(dir);
  }

  private paraTela(p: THREE.Vector3): { x: number; y: number; z: number } {
    const q = p.clone().project(this.camera);
    const { clientWidth: w, clientHeight: h } = this.container;
    return { x: ((q.x + 1) / 2) * w, y: ((1 - q.y) / 2) * h, z: q.z };
  }

  /**
   * Entidade sob o ponteiro, respeitando o filtro. Prioridade: vértice, aresta, face
   * (como nos CADs). `tolPx` maior para o dedo.
   */
  picarEntidade(clientX: number, clientY: number, filtro: Set<TipoEntidade>, tolPx = 10): Entidade | null {
    const topo = this.topologia;
    if (!topo) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const mx = clientX - r.left, my = clientY - r.top;
    const ray = this.raio(clientX, clientY);
    const solido = this.solido();
    const hit = solido ? ray.intersectObject(solido)[0] : undefined;
    // ortográfica: a origem do raio fica no plano da câmera, então hit.distance é a profundidade
    const limite = hit ? hit.distance + this.raioCena * 0.004 + 1e-3 : Infinity;
    const visivel = (p: THREE.Vector3) => this.estilo === "arestas" || this.profundidade(p) <= limite;
    const v = new THREE.Vector3();

    if (filtro.has("vertice")) {
      let melhor = -1, dm = tolPx;
      topo.vertices.forEach((q, i) => {
        v.set(...q);
        const t = this.paraTela(v);
        const d = Math.hypot(t.x - mx, t.y - my);
        if (d < dm && t.z < 1 && visivel(v)) { dm = d; melhor = i; }
      });
      if (melhor >= 0) return { tipo: "vertice", indice: melhor };
    }
    if (filtro.has("aresta")) {
      let melhor = -1, dm = tolPx;
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      for (let g = 0; g < this.gruposArestas.length / 2; g++) {
        const ini = this.gruposArestas[g * 2], qtd = this.gruposArestas[g * 2 + 1];
        for (let k = ini; k + 1 < ini + qtd; k += 2) {
          a.fromArray(this.posArestas, k * 3);
          b.fromArray(this.posArestas, (k + 1) * 3);
          const ta = this.paraTela(a), tb = this.paraTela(b);
          const dx = tb.x - ta.x, dy = tb.y - ta.y;
          const l2 = dx * dx + dy * dy;
          const t = l2 ? Math.max(0, Math.min(1, ((mx - ta.x) * dx + (my - ta.y) * dy) / l2)) : 0;
          const d = Math.hypot(ta.x + dx * t - mx, ta.y + dy * t - my);
          if (d < dm) {
            // ponto da aresta mais próximo do raio, para testar se está oculto
            ray.ray.distanceSqToSegment(a, b, undefined, v);
            if (visivel(v)) { dm = d; melhor = g; }
          }
        }
      }
      if (melhor >= 0) return { tipo: "aresta", indice: melhor };
    }
    if (filtro.has("face") && hit && hit.faceIndex != null) {
      const idx = hit.faceIndex * 3;
      for (let i = 0; i < this.faces.length; i += 3) {
        if (idx >= this.faces[i] && idx < this.faces[i] + this.faces[i + 1]) return { tipo: "face", indice: i / 3 };
      }
    }
    return null;
  }

  /**
   * Plano (principal ou criado) ou eixo de referência sob o ponteiro. Planos: toque dentro do
   * retângulo visível; eixos: perto da linha. A peça na frente tem prioridade (teste de profundidade).
   */
  picarReferencia(clientX: number, clientY: number, tolPx = 10): { tipo: "plano" | "eixo" | "curva"; id: string; borda: boolean } | null {
    const ray = this.raio(clientX, clientY);
    const r = this.renderer.domElement.getBoundingClientRect();
    const mx = clientX - r.left, my = clientY - r.top;
    const visivel = (o: THREE.Object3D) => {
      for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
      return true;
    };
    const solido = this.solido();
    const hitPeca = solido ? ray.intersectObject(solido)[0]?.distance ?? Infinity : Infinity;
    // eixos primeiro (são finos): distância na tela até o segmento
    let melhorEixo: string | null = null, dm = tolPx;
    this.grupoRefsExtras.traverse((o) => {
      const id = o.userData.idRef;
      if (!id || id.tipo !== "eixo" || !visivel(o)) return;
      const pos = ((o as THREE.Line).geometry.getAttribute("position") as THREE.BufferAttribute);
      const a = this.paraTela(new THREE.Vector3().fromBufferAttribute(pos, 0));
      const b = this.paraTela(new THREE.Vector3().fromBufferAttribute(pos, 1));
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const k = l2 ? Math.max(0, Math.min(1, ((mx - a.x) * dx + (my - a.y) * dy) / l2)) : 0;
      const d = Math.hypot(a.x + dx * k - mx, a.y + dy * k - my);
      if (d < dm) { dm = d; melhorEixo = id.id; }
    });
    if (melhorEixo) return { tipo: "eixo", id: melhorEixo, borda: true };
    // curvas 3D: distância na tela até a polilinha
    let melhorCurva: string | null = null, dc = tolPx;
    this.grupoRefsExtras.traverse((o) => {
      const id = o.userData.idRef;
      if (!id || id.tipo !== "curva" || !visivel(o)) return;
      const pos = ((o as THREE.Line).geometry.getAttribute("position") as THREE.BufferAttribute);
      let ant = this.paraTela(new THREE.Vector3().fromBufferAttribute(pos, 0));
      for (let i = 1; i < pos.count; i++) {
        const b = this.paraTela(new THREE.Vector3().fromBufferAttribute(pos, i));
        const dx = b.x - ant.x, dy = b.y - ant.y, l2 = dx * dx + dy * dy;
        const k = l2 ? Math.max(0, Math.min(1, ((mx - ant.x) * dx + (my - ant.y) * dy) / l2)) : 0;
        const d = Math.hypot(ant.x + dx * k - mx, ant.y + dy * k - my);
        if (d < dc) { dc = d; melhorCurva = id.id; }
        ant = b;
      }
    });
    if (melhorCurva) return { tipo: "curva", id: melhorCurva, borda: true };
    // peça sob o toque ou a até tolPx dele (arestas da silhueta ficam bem na borda da malha)
    let perto: boolean | null = null;
    const pecaPerto = () => {
      if (perto !== null) return perto;
      perto = hitPeca < Infinity;
      for (const [dx, dy] of [[tolPx, 0], [-tolPx, 0], [0, tolPx], [0, -tolPx]]) {
        if (perto || !solido) break;
        perto = this.raio(clientX + dx, clientY + dy).intersectObject(solido).length > 0;
      }
      return perto;
    };
    const quads: THREE.Mesh[] = [];
    for (const g of [this.grupoRefs, this.grupoRefsExtras]) {
      g.traverse((o) => { if (o.userData.idRef?.tipo === "plano" && visivel(o)) quads.push(o as THREE.Mesh); });
    }
    // borda do plano (como nos CADs): perto do contorno na tela, mesmo com a peça atrás
    let melhorBorda: string | null = null, db = tolPx;
    for (const q of quads) {
      const pos = q.geometry.getAttribute("position") as THREE.BufferAttribute; // PlaneGeometry: 0 1 / 2 3
      const w = [0, 1, 3, 2].map((i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(q.matrixWorld));
      const c = w.map((p) => this.paraTela(p));
      // plano visto de perfil vira uma linha que atravessa a peça: aí a peça tem prioridade
      const area = Math.abs(c.reduce((s, p, i) => s + p.x * c[(i + 1) % 4].y - c[(i + 1) % 4].x * p.y, 0)) / 2;
      const lado = Math.max(...c.map((p, i) => Math.hypot(c[(i + 1) % 4].x - p.x, c[(i + 1) % 4].y - p.y)));
      if (area < lado * 2 && pecaPerto()) continue;
      for (let i = 0; i < 4; i++) {
        const a = c[i], b = c[(i + 1) % 4];
        const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        const k = l2 ? Math.max(0, Math.min(1, ((mx - a.x) * dx + (my - a.y) * dy) / l2)) : 0;
        const d = Math.hypot(a.x + dx * k - mx, a.y + dy * k - my);
        if (d >= db) continue;
        // borda escondida atrás da peça não conta
        const pw = w[i].clone().lerp(w[(i + 1) % 4], k);
        if (this.profundidade(pw) > hitPeca + this.raioCena * 0.004 + 1e-3) continue;
        db = d;
        melhorBorda = q.userData.idRef.id;
      }
    }
    if (melhorBorda) return { tipo: "plano", id: melhorBorda, borda: true };
    const hit = ray.intersectObjects(quads, false).find((h) => h.distance <= hitPeca + 1e-3);
    return hit ? { tipo: "plano", id: hit.object.userData.idRef.id, borda: false } : null;
  }

  /**
   * Todas as entidades sob o cursor, da frente para trás (para "Selecionar outro"): faces que o
   * raio atravessa, arestas e vértices perto do cursor, inclusive os escondidos.
   */
  entidadesSobCursor(clientX: number, clientY: number, tolPx = 10): (Entidade & { prof: number })[] {
    const topo = this.topologia;
    const solido = this.grupoPeca.getObjectByName("solido") as THREE.Mesh | undefined;
    if (!topo || !solido) return [];
    const r = this.renderer.domElement.getBoundingClientRect();
    const mx = clientX - r.left, my = clientY - r.top;
    const ray = this.raio(clientX, clientY);
    const out: (Entidade & { prof: number })[] = [];
    const v = new THREE.Vector3();
    topo.vertices.forEach((q, i) => {
      v.set(...q);
      const t = this.paraTela(v);
      if (Math.hypot(t.x - mx, t.y - my) < tolPx && t.z < 1) out.push({ tipo: "vertice", indice: i, prof: this.profundidade(v) });
    });
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let g = 0; g < this.gruposArestas.length / 2; g++) {
      const ini = this.gruposArestas[g * 2], qtd = this.gruposArestas[g * 2 + 1];
      let melhor = Infinity, prof = 0;
      for (let k = ini; k + 1 < ini + qtd; k += 2) {
        a.fromArray(this.posArestas, k * 3);
        b.fromArray(this.posArestas, (k + 1) * 3);
        const ta = this.paraTela(a), tb = this.paraTela(b);
        const dx = tb.x - ta.x, dy = tb.y - ta.y, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((mx - ta.x) * dx + (my - ta.y) * dy) / l2)) : 0;
        const d = Math.hypot(ta.x + dx * t - mx, ta.y + dy * t - my);
        if (d < melhor) {
          melhor = d;
          ray.ray.distanceSqToSegment(a, b, undefined, v);
          prof = this.profundidade(v);
        }
      }
      if (melhor < tolPx) out.push({ tipo: "aresta", indice: g, prof });
    }
    const vistas = new Set<number>();
    // faces de trás também (o material só desenha a frente; para o raio, os dois lados)
    const lado = this.materialSolido.side;
    this.materialSolido.side = THREE.DoubleSide;
    const hits = ray.intersectObject(solido);
    this.materialSolido.side = lado;
    for (const hit of hits) {
      if (hit.faceIndex == null) continue;
      const idx = hit.faceIndex * 3;
      for (let i = 0; i < this.faces.length; i += 3) {
        if (idx >= this.faces[i] && idx < this.faces[i] + this.faces[i + 1] && !vistas.has(i / 3)) {
          vistas.add(i / 3);
          out.push({ tipo: "face", indice: i / 3, prof: hit.distance });
        }
      }
    }
    return out.sort((x, y) => x.prof - y.prof);
  }

  /** Centro da caixa envolvente de um conjunto de faces (para pôr rótulos sobre um recurso). */
  centroFaces(indices: number[]): Vec3 | null {
    const solido = this.grupoPeca.getObjectByName("solido") as THREE.Mesh | undefined;
    const idx = solido?.geometry.getIndex();
    const pos = solido?.geometry.getAttribute("position");
    if (!idx || !pos) return null;
    const caixa = new THREE.Box3(), v = new THREE.Vector3();
    for (const f of indices) {
      const ini = this.faces[f * 3], qtd = this.faces[f * 3 + 1];
      for (let k = ini; k < ini + qtd; k++) caixa.expandByPoint(v.fromBufferAttribute(pos, idx.getX(k)));
    }
    if (caixa.isEmpty()) return null;
    const c = caixa.getCenter(new THREE.Vector3());
    return [c.x, c.y, c.z];
  }

  // ---------- alças de arrasto (profundidade, ângulo) ----------

  /** Setas no viewport que o usuário arrasta para mudar um valor do comando. */
  mostrarAlcas(alcas: { id: string; pos: Vec3; dir: Vec3 }[]) {
    this.alcas = alcas.map((a) => ({ id: a.id, pos: new THREE.Vector3(...a.pos), dir: new THREE.Vector3(...a.dir).normalize() }));
    this.desenharAlcas();
  }

  /** Setas com tamanho constante na tela (refeitas quando o zoom muda): haste grossa e ponta. */
  private desenharAlcas() {
    for (const o of [...this.grupoAlcas.children]) {
      this.grupoAlcas.remove(o);
      o.traverse((x) => {
        (x as THREE.Mesh).geometry?.dispose();
        ((x as THREE.Mesh).material as THREE.Material)?.dispose?.();
      });
    }
    const mm = 1 / this.camera.zoom; // mm por pixel
    for (const a of this.alcas) {
      const mat = () => new THREE.MeshBasicMaterial({ color: 0xe08a00, depthTest: false, transparent: true, opacity: 0.95 });
      const g = new THREE.Group();
      const haste = new THREE.Mesh(new THREE.CylinderGeometry(2.2 * mm, 2.2 * mm, COMPR_ALCA_PX * 0.62 * mm, 12), mat());
      haste.position.y = COMPR_ALCA_PX * 0.31 * mm;
      const ponta = new THREE.Mesh(new THREE.ConeGeometry(8 * mm, COMPR_ALCA_PX * 0.38 * mm, 16), mat());
      ponta.position.y = COMPR_ALCA_PX * 0.81 * mm;
      const base = new THREE.Mesh(new THREE.SphereGeometry(4.5 * mm, 16, 12), mat());
      g.add(haste, ponta, base);
      g.position.copy(a.pos);
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.dir);
      g.renderOrder = 30;
      g.traverse((x) => (x.renderOrder = 30));
      this.grupoAlcas.add(g);
    }
    this.precisaRender = true;
  }

  private pegarAlca(e: PointerEvent): boolean {
    if (!this.alcas.length || (e.pointerType === "mouse" && e.button !== 0)) return false;
    const r = this.renderer.domElement.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const mm = 1 / this.camera.zoom;
    const tol = e.pointerType === "touch" ? 26 : 14;
    const alca = this.alcas.find((a) => {
      // da base à ponta da seta
      const t0 = this.paraTela(a.pos), t1 = this.paraTela(a.pos.clone().addScaledVector(a.dir, COMPR_ALCA_PX * mm));
      const dx = t1.x - t0.x, dy = t1.y - t0.y, l2 = dx * dx + dy * dy;
      const k = l2 ? Math.max(0, Math.min(1, ((mx - t0.x) * dx + (my - t0.y) * dy) / l2)) : 0;
      return Math.hypot(t0.x + dx * k - mx, t0.y + dy * k - my) < tol;
    });
    if (!alca) return false;
    // direção da seta na tela: pixels por mm ao longo dela
    const t0 = this.paraTela(alca.pos), t1 = this.paraTela(alca.pos.clone().add(alca.dir));
    const sx = t1.x - t0.x, sy = t1.y - t0.y, s2 = sx * sx + sy * sy;
    if (s2 < 1e-6) return false; // seta apontando para a tela: não dá para arrastar
    const x0 = e.clientX, y0 = e.clientY;
    const el = this.renderer.domElement;
    el.setPointerCapture(e.pointerId);
    const delta = (ev: PointerEvent) => ((ev.clientX - x0) * sx + (ev.clientY - y0) * sy) / s2;
    const mover = (ev: PointerEvent) => this.aoArrastarAlca?.(alca.id, delta(ev), false);
    const soltar = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", mover);
      el.removeEventListener("pointerup", soltar);
      el.removeEventListener("pointercancel", soltar);
      this.aoArrastarAlca?.(alca.id, delta(ev), true);
    };
    el.addEventListener("pointermove", mover);
    el.addEventListener("pointerup", soltar);
    el.addEventListener("pointercancel", soltar);
    return true;
  }

  /** Realça entidades selecionadas (azul forte) e a que está sob o cursor (azul claro). */
  /** Prévia do material que o recurso em edição tira (sólido translúcido vermelho). */
  mostrarPrevia(m: MalhaSimples | null | undefined) {
    for (const o of [...this.grupoPrevia.children]) {
      this.grupoPrevia.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
      ((o as THREE.Mesh).material as THREE.Material)?.dispose();
    }
    if (m) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(m.vertices, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(m.normais, 3));
      geo.setIndex(new THREE.BufferAttribute(m.triangulos, 1));
      const corpo = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: COR_REMOVIDO, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide,
        clippingPlanes: this.secao ? [this.secao] : [],
      }));
      const geoA = new THREE.BufferGeometry();
      geoA.setAttribute("position", new THREE.BufferAttribute(m.arestas, 3));
      const arestas = new THREE.LineSegments(geoA, new THREE.LineBasicMaterial({ color: COR_REMOVIDO, transparent: true, opacity: 0.9, depthTest: false }));
      this.grupoPrevia.add(corpo, arestas);
    }
    this.precisaRender = true;
  }

  destacarEntidades(sel: Entidade[], realce: Entidade | null = null, doRecurso: Entidade[] = [], previa: Entidade[] = []) {
    for (const o of [...this.grupoDestaque.children]) {
      this.grupoDestaque.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
      ((o as THREE.Mesh).material as THREE.Material)?.dispose();
    }
    const solido = this.grupoPeca.getObjectByName("solido") as THREE.Mesh | undefined;
    const itens = [
      ...previa.map((e) => ({ e, cor: COR_PREVIA })),
      ...doRecurso.map((e) => ({ e, cor: COR_RECURSO })),
      ...sel.map((e) => ({ e, cor: COR_SELECAO })),
      ...(realce ? [{ e: realce, cor: COR_REALCE }] : []),
    ];
    const { w, h } = this.tamanho();
    for (const { e, cor } of itens) {
      if (e.tipo === "face" && solido) {
        const ini = this.faces[e.indice * 3], qtd = this.faces[e.indice * 3 + 1];
        const src = solido.geometry;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", src.getAttribute("position"));
        geo.setAttribute("normal", src.getAttribute("normal"));
        geo.setIndex(Array.from((src.getIndex()!.array as Uint32Array).subarray(ini, ini + qtd)));
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: cor, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
          clippingPlanes: this.secao ? [this.secao] : [],
        }));
        this.grupoDestaque.add(m);
      } else if (e.tipo === "aresta") {
        const ini = this.gruposArestas[e.indice * 2], qtd = this.gruposArestas[e.indice * 2 + 1];
        const geo = new LineSegmentsGeometry();
        geo.setPositions(Array.from(this.posArestas.subarray(ini * 3, (ini + qtd) * 3)));
        const mat = new LineMaterial({ color: cor, linewidth: 4, depthTest: false, transparent: true });
        mat.resolution.set(w, h);
        const l = new LineSegments2(geo, mat);
        l.renderOrder = 6;
        this.grupoDestaque.add(l);
      } else if (e.tipo === "vertice" && this.topologia) {
        const p = this.topologia.vertices[e.indice];
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...p)]);
        const pt = new THREE.Points(geo, new THREE.PointsMaterial({ color: cor, size: 12, sizeAttenuation: false, depthTest: false }));
        pt.renderOrder = 7;
        this.grupoDestaque.add(pt);
      }
    }
    this.precisaRender = true;
  }

  // ---------- planos e eixos criados pelo usuário ----------

  mostrarReferenciasExtras(refs: InfoReferencia[], visivel: (id: string) => boolean, destaque: string | null) {
    for (const o of [...this.grupoRefsExtras.children]) {
      this.grupoRefsExtras.remove(o);
      o.traverse((x) => {
        (x as THREE.Mesh).geometry?.dispose();
        ((x as THREE.Mesh).material as THREE.Material)?.dispose?.();
      });
    }
    for (const r of refs) {
      if (!visivel(r.id) && r.id !== destaque) continue;
      const ativo = r.id === destaque;
      const cor = ativo ? COR_DESTAQUE : COR_PLANO;
      if (r.tipo === "plano") {
        const g = new THREE.Group();
        g.matrixAutoUpdate = false;
        const { origem, x, y, normal } = r.ref;
        g.matrix.makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...normal)).setPosition(...origem);
        const L = r.tamanho;
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(L, L), new THREE.MeshBasicMaterial({
          color: cor, transparent: true, opacity: ativo ? 0.22 : 0.08, side: THREE.DoubleSide, depthWrite: false,
        }));
        const borda = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3((a * L) / 2, (b * L) / 2, 0))),
          new THREE.LineBasicMaterial({ color: cor }),
        );
        quad.userData.idRef = { tipo: "plano", id: r.id };
        g.add(quad, borda);
        this.grupoRefsExtras.add(g);
      } else if (r.tipo === "curva") {
        // curva 3D: traço contínuo e mais grosso que um eixo (tocável como referência)
        const g = new THREE.Group();
        for (const pl of r.linhas) {
          const l = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pl.map((p) => new THREE.Vector3(...p))),
            new THREE.LineBasicMaterial({ color: ativo ? COR_DESTAQUE : COR_CURVA }),
          );
          l.userData.idRef = { tipo: "curva", id: r.id };
          g.add(l);
        }
        this.grupoRefsExtras.add(g);
      } else {
        const a = new THREE.Vector3(...r.origem).addScaledVector(new THREE.Vector3(...r.dir), -r.comprimento / 2);
        const b = new THREE.Vector3(...r.origem).addScaledVector(new THREE.Vector3(...r.dir), r.comprimento / 2);
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ color: cor, dashSize: 4, gapSize: 2 }));
        l.computeLineDistances();
        l.userData.idRef = { tipo: "eixo", id: r.id };
        this.grupoRefsExtras.add(l);
      }
    }
    this.precisaRender = true;
  }

  // ---------- aparência, seção e análises ----------

  definirCorPeca(cor: number) {
    this.materialSolido.color.setHex(cor);
    this.precisaRender = true;
  }

  /** Vista de seção: corta a exibição pelo plano (normal aponta para o lado que some). */
  definirSecao(plano: { normal: Vec3; ponto: Vec3 } | null) {
    this.secao = plano
      ? new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...plano.normal).negate(), new THREE.Vector3(...plano.ponto))
      : null;
    this.aplicarSecao();
  }

  private aplicarSecao() {
    const planos = this.secao ? [this.secao] : [];
    this.materialSolido.clippingPlanes = planos;
    this.materialArestas.clippingPlanes = planos;
    const solido = this.grupoPeca.getObjectByName("solido") as THREE.Mesh | undefined;
    if (solido && solido.material !== this.materialSolido) (solido.material as THREE.Material).clippingPlanes = planos;
    for (const o of [...this.grupoSecao.children]) {
      this.grupoSecao.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
      ((o as THREE.Mesh).material as THREE.Material)?.dispose();
    }
    if (this.secao && solido) {
      // tampa da seção pela técnica do stencil: conta faces de trás/frente cortadas
      const base = { depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, clippingPlanes: planos };
      const tras = new THREE.Mesh(solido.geometry, new THREE.MeshBasicMaterial({
        ...base, side: THREE.BackSide, stencilFail: THREE.IncrementWrapStencilOp, stencilZFail: THREE.IncrementWrapStencilOp, stencilZPass: THREE.IncrementWrapStencilOp,
      }));
      const frente = new THREE.Mesh(solido.geometry, new THREE.MeshBasicMaterial({
        ...base, side: THREE.FrontSide, stencilFail: THREE.DecrementWrapStencilOp, stencilZFail: THREE.DecrementWrapStencilOp, stencilZPass: THREE.DecrementWrapStencilOp,
      }));
      tras.renderOrder = frente.renderOrder = 1;
      const tam = this.raioCena * 8;
      const tampa = new THREE.Mesh(new THREE.PlaneGeometry(tam, tam), new THREE.MeshStandardMaterial({
        color: 0xe0a23a, metalness: 0.1, roughness: 0.7, stencilWrite: true, stencilRef: 0,
        stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
      }));
      tampa.renderOrder = 1.1;
      this.secao.coplanarPoint(tampa.position);
      tampa.lookAt(tampa.position.clone().sub(this.secao.normal));
      tampa.onAfterRender = (r) => r.clearStencil();
      this.grupoSecao.add(tras, frente, tampa);
    }
    this.precisaRender = true;
  }

  definirAnalise(a: Analise | null) {
    this.analise = a;
    this.aplicarAnalise();
  }

  private aplicarAnalise() {
    const solido = this.grupoPeca.getObjectByName("solido") as THREE.Mesh | undefined;
    this.infoAnalise = "";
    if (!solido) return;
    if (solido.material !== this.materialSolido) (solido.material as THREE.Material).dispose();
    solido.material = this.materialSolido;
    const a = this.analise;
    if (!a) {
      this.precisaRender = true;
      return;
    }
    const geo = solido.geometry;
    const comCores = (cores: Float32Array) => {
      geo.setAttribute("color", new THREE.BufferAttribute(cores, 3));
      solido.material = new THREE.MeshLambertMaterial({ vertexColors: true, clippingPlanes: this.secao ? [this.secao] : [] });
    };
    if (a.tipo === "inclinacao") {
      comCores(coresInclinacao(geo, new THREE.Vector3(...a.direcao), a.angulo));
      this.infoAnalise = `Verde: inclinação ≥ ${a.angulo}° · Vermelho: negativa · Amarelo: precisa de inclinação`;
    } else if (a.tipo === "curvatura") {
      const r = coresCurvatura(geo);
      comCores(r.cores);
      this.infoAnalise = r.maxima > 0 ? `Raio mínimo aprox.: ${(1 / r.maxima).toFixed(2)} mm (vermelho)` : "Sem faces curvas";
    } else if (a.tipo === "espessura") {
      const r = coresEspessura(solido, a.alvo);
      comCores(r.cores);
      this.infoAnalise = `Espessura mínima encontrada: ${Number.isFinite(r.minima) ? r.minima.toFixed(2) : "—"} mm (alvo ${a.alvo} mm)`;
    } else {
      solido.material = materialZebra(a.listras);
      this.infoAnalise = "Listras contínuas = faces tangentes/curvatura contínua";
    }
    this.precisaRender = true;
  }

  // ---------- câmera ----------

  /** Ajusta a câmera para a peça caber na tela. */
  enquadrar(animado = true) {
    const caixa = new THREE.Box3().setFromObject(this.grupoPeca);
    const centro = new THREE.Vector3();
    if (caixa.isEmpty()) {
      this.raioCena = 60;
    } else {
      caixa.getCenter(centro);
      this.raioCena = Math.max(caixa.getSize(new THREE.Vector3()).length() / 2, 5);
    }
    const dir = this.camera.position.clone().sub(this.controles.target).normalize();
    // a esfera da peça cabe no menor lado da tela (em retrato manda a largura)
    const { clientWidth: w, clientHeight: h } = this.container;
    const zoom = Math.min(w || 800, h || 600) / (2 * this.raioCena * 1.15);
    this.moverCamera(centro, centro.clone().add(dir.multiplyScalar(this.distCam)), animado, zoom);
  }

  /** Zoom por área: o retângulo da tela (coordenadas do cliente) passa a ocupar a vista. */
  ampliarArea(x0: number, y0: number, x1: number, y1: number) {
    const r = this.container.getBoundingClientRect();
    const w = r.width, h = r.height;
    const rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
    if (rw < 4 || rh < 4 || !w || !h) return;
    // deslocamento do centro do retângulo ao centro da tela, em mm, nos eixos da câmera
    const dx = ((x0 + x1) / 2 - r.left - w / 2) / this.camera.zoom;
    const dy = -((y0 + y1) / 2 - r.top - h / 2) / this.camera.zoom;
    const direita = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const cima = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const d = direita.multiplyScalar(dx).add(cima.multiplyScalar(dy));
    const zoom = this.camera.zoom * Math.min(w / rw, h / rh);
    this.moverCamera(this.controles.target.clone().add(d), this.camera.position.clone().add(d), true, zoom);
  }

  definirVista(v: Vista, animado = true) {
    const alvo = this.controles.target.clone();
    const dir = new THREE.Vector3(...DIRECOES_VISTA[v]).normalize();
    this.moverCamera(alvo, alvo.clone().add(dir.multiplyScalar(this.distCam)), animado);
  }

  /** Olha perpendicularmente a um plano de referência. */
  vistaNormalA(p: Plano) {
    this.definirVista(NORMAL_PLANO[p]);
  }

  private animacao: { de: [THREE.Vector3, THREE.Vector3, number]; para: [THREE.Vector3, THREE.Vector3, number]; t0: number } | null = null;

  private moverCamera(alvo: THREE.Vector3, posicao: THREE.Vector3, animado: boolean, zoom = this.camera.zoom) {
    if (!animado) {
      this.controles.target.copy(alvo);
      this.camera.position.copy(posicao);
      this.camera.zoom = zoom;
      this.camera.updateProjectionMatrix();
      this.controles.update();
      this.precisaRender = true;
      this.aoMudarCamera?.();
      this.ouvintesCamera.forEach((f) => f());
      return;
    }
    this.animacao = {
      de: [this.controles.target.clone(), this.camera.position.clone(), this.camera.zoom],
      para: [alvo, posicao, zoom],
      t0: performance.now(),
    };
  }

  private redimensionar() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    // frustum em pixels: o zoom (px/mm) não muda ao girar o tablet
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
    this.precisaRender = true;
  }

  private desenhar() {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.clear();
    this.renderer.render(this.cena, this.camera);

    // tríade: mesma orientação da câmera principal, num quadrado no canto inferior esquerdo
    this.cameraTriade.position.set(0, 0, 6).applyQuaternion(this.camera.quaternion);
    this.cameraTriade.quaternion.copy(this.camera.quaternion);
    this.renderer.clearDepth();
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(0, 0, TAM_TRIADE, TAM_TRIADE);
    this.renderer.setViewport(0, 0, TAM_TRIADE, TAM_TRIADE);
    this.renderer.render(this.cenaTriade, this.cameraTriade);
    this.renderer.setScissorTest(false);
    this.aposDesenhar?.();
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    if (this.animacao) {
      const t = Math.min((performance.now() - this.animacao.t0) / 350, 1);
      const k = 1 - Math.pow(1 - t, 3);
      this.controles.target.lerpVectors(this.animacao.de[0], this.animacao.para[0], k);
      this.camera.position.lerpVectors(this.animacao.de[1], this.animacao.para[1], k);
      // zoom interpolado em escala logarítmica (aproximação uniforme)
      this.camera.zoom = this.animacao.de[2] * Math.pow(this.animacao.para[2] / this.animacao.de[2], k);
      this.camera.updateProjectionMatrix();
      this.aoMudarCamera?.();
      this.ouvintesCamera.forEach((f) => f());
      if (t >= 1) this.animacao = null;
      this.precisaRender = true;
    }
    if (this.controles.update()) this.precisaRender = true;
    // Só desenha quando algo mudou: economiza bateria no tablet
    if (this.precisaRender) {
      this.desenhar();
      this.precisaRender = false;
    }
  };
}

function texturaRotulo(texto: string, cor: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "bold 44px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#" + cor.toString(16).padStart(6, "0");
  g.fillText(texto, 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
