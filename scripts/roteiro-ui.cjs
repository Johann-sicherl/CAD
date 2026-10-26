// Roteiro de modelagem real pela interface do WJCAD (como um usuário): esboço com cliques,
// sair, extrusão com profundidade digitada, toque numa aresta do modelo, filete, corte por
// esboço na face de cima, massa, desfazer/refazer, salvar e reabrir. Usa o Playwright do ambiente.
//   node scripts/roteiro-ui.cjs [computador|tablet|celular]
const { chromium } = require("playwright");
const fs = require("fs");

const URL = process.env.URL_WJCAD ?? "http://localhost:5199/cad/";
const perfil = process.argv[2] ?? "computador";
let falhas = 0;
const ok = (nome, cond, extra = "") => {
  if (!cond) falhas++;
  console.log(`${cond ? "ok  " : "FALHA"} ${nome}${extra ? ` (${extra})` : ""}`);
};

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const tam = perfil === "celular" ? { width: 412, height: 860 } : { width: 1366, height: 860 };
  const ctx = await b.newContext({ viewport: tam, hasTouch: perfil !== "computador", acceptDownloads: true });
  const p = await ctx.newPage();
  const errosJs = [];
  p.on("pageerror", (e) => errosJs.push(e.message));
  await p.addInitScript((d) => localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: d, caixaFlutuante: false })), perfil);
  await p.goto(URL);
  await p.waitForTimeout(2500);
  const pronto = async () => {
    for (let i = 0; i < 100; i++) {
      await p.waitForTimeout(150);
      if (!(await p.evaluate(() => /Reconstruindo/i.test(document.body.innerText)))) break;
    }
    await p.waitForTimeout(250);
  };
  const volume = async () => {
    const t = await p.locator("footer").last().innerText();
    const m = t.match(/Volume: ([\d.,]+)/);
    return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : NaN;
  };
  const botao = (rot) => p.locator(`#faixa-comandos button[title^="${rot}"], #faixa-comandos button:has(span:text-is("${rot}"))`).first();
  const aba = (rot) => p.locator("#abas button", { hasText: rot }).first().click();
  const feats = () => p.evaluate(() => window.__cad.doc().features.map((f) => ({ tipo: f.tipo, nome: f.nome })));
  const gaveta = async (aberta) => {
    if (perfil !== "celular") return;
    const esta = await p.evaluate(() => document.body.classList.contains("lateral-aberta"));
    if (esta !== aberta) await p.locator("#btn-lateral").click();
    await p.waitForTimeout(200);
  };
  let cv;
  const naTela = (fx, fy) => [cv.x + cv.width * fx, cv.y + cv.height * fy];
  const tocar = async (fx, fy) => {
    const [x, y] = naTela(fx, fy);
    if (perfil === "computador") await p.mouse.click(x, y);
    else await p.touchscreen.tap(x, y);
    await p.waitForTimeout(Number(process.env.PAUSA ?? 450)); // ritmo de gente (toques rápidos e perto viram toque duplo)
  };
  const tocarMundo = async (ponto) => {
    const t = await p.evaluate((q) => window.__cad.viewport.mundoParaTela(q), ponto);
    const x = cv.x + t.x, y = cv.y + t.y;
    if (perfil === "computador") await p.mouse.click(x, y);
    else await p.touchscreen.tap(x, y);
    await p.waitForTimeout(200);
  };

  await p.evaluate(() => window.__cad.abrir({ formato: "wjcad", versao: 3, nome: "Roteiro", features: [] }));
  await pronto();
  cv = await p.locator("#viewport canvas").first().boundingBox();

  // 1. esboço no Plano Frontal: retângulo e círculo dentro
  await gaveta(true);
  await p.locator("#arvore li", { hasText: "Plano Frontal" }).first().click();
  await gaveta(false);
  await aba("Sketch");
  await botao("Esboço").click();
  await pronto();
  await botao("Retângulo").click();
  await tocar(0.35, 0.35);
  await tocar(0.65, 0.65);
  await p.keyboard.press("Escape");
  await botao("Círculo").click();
  await tocar(0.5, 0.5);
  await tocar(0.58, 0.5);
  await p.keyboard.press("Escape");
  const esb = await p.evaluate(() => window.__cad.doc().features.find((f) => f.tipo === "esboco"));
  ok("esboço com retângulo e círculo", esb && esb.geos.filter((g) => g.tipo === "linha").length === 4 && esb.geos.some((g) => g.tipo === "circulo"), `${esb?.geos.length} geometrias`);
  await aba("Sketch");
  await p.locator("#faixa-comandos button").first().click(); // Sair do esboço
  await pronto();

  // 2. extrusão de 25 mm (contorno com furo)
  await aba("Features");
  await botao("Extrusão").click();
  await pronto();
  const prof = p.locator("#painel-comando .campo", { hasText: "Profundidade" }).locator("input").first();
  await gaveta(true);
  await prof.fill("25");
  await prof.press("Enter");
  await pronto();
  await p.locator("#painel-comando .pc-ok").first().click();
  await pronto();
  await gaveta(false);
  const xs = esb.pontos.map((q) => q.x), ys = esb.pontos.map((q) => q.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const circ = esb.geos.find((g) => g.tipo === "circulo");
  const area = (x1 - x0) * (y1 - y0) - Math.PI * circ.r * circ.r;
  const v1 = await volume();
  if (process.env.DEPURAR) console.log(JSON.stringify(await p.evaluate(() => window.__cad.doc().features.map((f) => f.tipo === "esboco" ? { geos: f.geos, pontos: f.pontos } : f))).slice(0, 1500));
  ok("extrusão 25 mm: volume = área × 25", Math.abs(v1 - (area * 25) / 1000) < 0.02 * (area * 25) / 1000 + 0.01, `${v1} cm³ × esperado ${((area * 25) / 1000).toFixed(2)}`);

  // 3. toque na aresta de cima da face da frente e filete R3
  await p.evaluate(() => window.__cad.viewport.enquadrar(false));
  await p.waitForTimeout(300);
  if (process.env.DEPURAR) {
    const t = await p.evaluate((q) => window.__cad.viewport.mundoParaTela(q), [(x0 + x1) / 2, y1, 25]);
    const ref = await p.evaluate(([x, y]) => window.__cad.viewport.picarReferencia(x, y, 9), [cv.x + t.x, cv.y + t.y]);
    console.log("ponto", t, "ref", JSON.stringify(ref), "aresta", y1, x0, x1);
    await p.screenshot({ path: process.env.DEPURAR, clip: { x: cv.x + t.x - 150, y: cv.y + t.y - 100, width: 300, height: 200 } });
  }
  await tocarMundo([(x0 + x1) / 2, y1, 25]);
  const st = await p.locator("footer").last().innerText();
  const selecao = await p.evaluate(() => document.querySelector(".pc-chip, #barra-contexto:not([hidden])") !== null);
  ok("tocar a aresta no modelo seleciona a aresta (não o plano)", /aresta|1 entidade/i.test(st) && !/Plano/.test(st) && selecao, st.split("\n")[0]);
  await botao("Filete").click();
  await pronto();
  const raio = p.locator("#painel-comando .campo", { hasText: "Raio" }).locator("input").first();
  await gaveta(true);
  if (await raio.count()) {
    await raio.fill("3");
    await raio.press("Enter");
    await pronto();
  }
  await p.locator("#painel-comando .pc-ok").first().click();
  await pronto();
  await gaveta(false);
  const v2 = await volume();
  const esperadoFilete = ((9 - (Math.PI * 9) / 4) * (x1 - x0)) / 1000;
  ok("filete R3 tira (1 − π/4)·R²·L", Math.abs(v1 - v2 - esperadoFilete) < 0.02, `${(v1 - v2).toFixed(3)} × ${esperadoFilete.toFixed(3)} cm³`);
  const erros = await p.evaluate(() => [...document.querySelectorAll(".prop-erro")].map((x) => x.textContent));
  ok("árvore sem recurso com erro", !erros.length, erros.join(" | "));

  // 4. massa
  await aba("Avaliar");
  await botao("Massa").click();
  await pronto();
  await p.locator("#janela:not([hidden])").waitFor({ timeout: 8000 }).catch(() => {});
  const massa = await p.locator("#janela-corpo").innerText().catch(() => "");
  ok("propriedades de massa abrem", /Volume|Massa/i.test(massa));
  await p.keyboard.press("Escape");
  await p.locator("#janela-fechar").click().catch(() => {});
  await p.locator("#painel-comando .pc-cancelar").first().click().catch(() => {});

  // 5. desfazer / refazer
  const n = (await feats()).length;
  await p.keyboard.press("Control+z");
  await pronto();
  const nDesf = (await feats()).length;
  await p.keyboard.press("Control+y");
  await pronto();
  ok("desfazer tira o filete e refazer devolve", nDesf === n - 1 && (await feats()).length === n, `${n} → ${nDesf} → ${(await feats()).length}`);

  // 6. salvar e reabrir: mesmo volume
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 8000 }).catch(() => null), p.keyboard.press("Control+s")]);
  if (dl) {
    const caminho = await dl.path();
    const doc = JSON.parse(fs.readFileSync(caminho, "utf8"));
    await p.evaluate((d) => window.__cad.abrir(d), doc);
    await pronto();
    const v3 = await volume();
    ok("salvar e reabrir: mesmo volume", Math.abs(v3 - v2) < 1e-3, `${v2} → ${v3}`);
  } else ok("salvar baixa o arquivo .wjcad", false);

  ok("nenhum erro de JavaScript", !errosJs.length, errosJs.join(" | "));
  console.log(falhas ? `\n${perfil}: ${falhas} falha(s)` : `\n${perfil}: roteiro ok`);
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
