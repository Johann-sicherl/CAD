// Viewport 3D com Three.js. Gestos de toque:
//   1 dedo = orbitar · 2 dedos = pinça (zoom) + arrastar (pan) · toque duplo = enquadrar
// Inclui planos de referência (Frontal, Superior, Lateral), origem, estilos de exibição
// e a tríade de eixos no canto inferior esquerdo (toque num eixo = olhar ao longo dele).

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { InfoReferencia, MalhaPeca } from "./kernel/regenerar";
import type { Topologia } from "./kernel/topologia";
import { coresCurvatura, coresEspessura, coresInclinacao, materialZebra, type Analise } from "./analises";
import type { Plano, Vec3 } from "./model";
import type { Referencial } from "./esboco/referencial";

export type Vista = "iso" | "frontal" | "traseira" | "superior" | "inferior" | "esquerda" | "direita";
export type EstiloExibicao = "sombreado-arestas" | "sombreado" | "arestas";
export type IdReferencia = Plano | "origem";

const DIRECOES_VISTA: Record<Vista, [number, number, number]> = {
  iso: [1, -1, 1],
  frontal: [0, -1, 0.0001],
  traseira: [0, 1, 0.0001],
  superior: [0, -0.0001, 1],
  inferior: [0, -0.0001, -1],
  esquerda: [-1, 0, 0.0001],
  direita: [1, 0, 0.0001],
};

const NORMAL_PLANO: Record<Plano, Vista> = { XY: "superior", XZ: "frontal", YZ: "direita" };

const COR_EIXO = { x: 0xd9443f, y: 0x3c9a4f, z: 0x2f7fd0 };
const COR_PLANO = 0x5b8fc7;
const COR_DESTAQUE = 0x2f7fd0;
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

/** Face plana tocada na peça: ponto e normal para iniciar um esboço nela. */
export interface FacePlana {
  origem: Vec3;
  normal: Vec3;
}

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

  private renderer: THREE.WebGLRenderer;
  private cena = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controles: OrbitControls;
  private grupoPeca = new THREE.Group();
  private faces: Uint32Array = new Uint32Array();
  private gruposArestas: Uint32Array = new Uint32Array();
  private posArestas: Float32Array = new Float32Array();
  topologia: Topologia | null = null;
  private grupoDestaque = new THREE.Group();
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

    // CAD usa Z para cima
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
    this.camera.up.set(0, 0, 1);

    // registrado antes do OrbitControls: pode impedir que a navegação veja o evento
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      if (this.interceptador?.(e)) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    });

    this.controles = new OrbitControls(this.camera, this.renderer.domElement);
    this.controles.zoomToCursor = true; // pinça e roda do mouse aproximam onde se aponta
    this.modoEsboco(false);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.12;
    this.controles.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controles.addEventListener("change", () => {
      this.precisaRender = true;
      this.aoMudarCamera?.();
    });

    this.cena.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.7));
    const sol = new THREE.DirectionalLight(0xffffff, 1.3);
    sol.position.set(1, -1.5, 2);
    this.camera.add(sol); // luz acompanha a câmera, a peça nunca fica no escuro
    this.cena.add(this.camera);

    this.criarReferencias();
    this.grupoEsboco.renderOrder = 10;
    this.grupoDestaque.renderOrder = 5;
    this.cena.add(this.grupoPeca, this.grupoRefs, this.grupoRefsExtras, this.grupoSecao, this.grupoDestaque, this.grupoEsboco);
    this.renderer.domElement.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.aoMenuContexto?.(e);
    });
    this.criarTriade();

    this.renderer.domElement.addEventListener("dblclick", () => {
      if (!this.emEsboco) this.enquadrar();
    });
    this.escutarToques();
    new ResizeObserver(() => this.redimensionar()).observe(container);
    this.redimensionar();
    this.definirVista("iso", false);
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
    el.addEventListener("pointerdown", (e) => inicios.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() }));
    el.addEventListener("pointercancel", (e) => inicios.delete(e.pointerId));
    el.addEventListener("pointerup", (e) => {
      const ini = inicios.get(e.pointerId);
      inicios.delete(e.pointerId);
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
          this.definirVista(eixo === "x" ? "direita" : eixo === "y" ? "traseira" : "superior");
          return;
        }
      }
      this.aoToqueCurto?.(e);
    });
  }

  // ---------- esboço: navegação, conversões tela ↔ plano ----------

  private emEsboco = false;

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
    if (Math.abs(dir.z) > 0.999) dir.y -= 0.0001 * Math.sign(dir.z); // evita a câmera alinhada ao "para cima"
    const dist = Math.max(this.camera.position.distanceTo(this.controles.target), 150);
    this.moverCamera(alvo, alvo.clone().add(dir.normalize().multiplyScalar(dist)), true);
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
    const limite = hit ? hit.distance * 1.002 + this.raioCena * 0.004 : Infinity;
    const visivel = (p: THREE.Vector3) => this.estilo === "arestas" || p.distanceTo(this.camera.position) <= limite;
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
            // ponto da aresta mais próximo do raio (correto em perspectiva) para testar se está oculto
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

  /** Realça entidades selecionadas (azul forte) e a que está sob o cursor (azul claro). */
  destacarEntidades(sel: Entidade[], realce: Entidade | null = null) {
    for (const o of [...this.grupoDestaque.children]) {
      this.grupoDestaque.remove(o);
      (o as THREE.Mesh).geometry?.dispose();
      ((o as THREE.Mesh).material as THREE.Material)?.dispose();
    }
    const solido = this.grupoPeca.getObjectByName("solido") as THREE.Mesh | undefined;
    const itens = [...sel.map((e) => ({ e, cor: COR_SELECAO })), ...(realce ? [{ e: realce, cor: COR_REALCE }] : [])];
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
        g.add(quad, borda);
        this.grupoRefsExtras.add(g);
      } else {
        const a = new THREE.Vector3(...r.origem).addScaledVector(new THREE.Vector3(...r.dir), -r.comprimento / 2);
        const b = new THREE.Vector3(...r.origem).addScaledVector(new THREE.Vector3(...r.dir), r.comprimento / 2);
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ color: cor, dashSize: 4, gapSize: 2 }));
        l.computeLineDistances();
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
    // Usa o menor dos ângulos de visão (vertical ou horizontal): em retrato o horizontal manda
    const meioV = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const meioH = Math.atan(Math.tan(meioV) * this.camera.aspect);
    const dist = this.raioCena / Math.sin(Math.min(meioV, meioH)) * 1.15;
    this.moverCamera(centro, centro.clone().add(dir.multiplyScalar(dist)), animado);
  }

  definirVista(v: Vista, animado = true) {
    const alvo = this.controles.target.clone();
    const dist = Math.max(this.camera.position.distanceTo(alvo), 150);
    const dir = new THREE.Vector3(...DIRECOES_VISTA[v]).normalize();
    this.moverCamera(alvo, alvo.clone().add(dir.multiplyScalar(dist)), animado);
  }

  /** Olha perpendicularmente a um plano de referência. */
  vistaNormalA(p: Plano) {
    this.definirVista(NORMAL_PLANO[p]);
  }

  private animacao: { de: [THREE.Vector3, THREE.Vector3]; para: [THREE.Vector3, THREE.Vector3]; t0: number } | null = null;

  private moverCamera(alvo: THREE.Vector3, posicao: THREE.Vector3, animado: boolean) {
    if (!animado) {
      this.controles.target.copy(alvo);
      this.camera.position.copy(posicao);
      this.controles.update();
      this.precisaRender = true;
      return;
    }
    this.animacao = {
      de: [this.controles.target.clone(), this.camera.position.clone()],
      para: [alvo, posicao],
      t0: performance.now(),
    };
  }

  private redimensionar() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
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
