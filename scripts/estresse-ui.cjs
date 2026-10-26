// Testador "clica em tudo" do WJCAD (navegador). Usa o Playwright do ambiente (não é dependência
// do projeto). Precisa do servidor de desenvolvimento: pnpm dev --port 5199
//   node scripts/estresse-ui.cjs [computador|tablet|celular] [rapido]
// Para cada aba: abre cada comando (e cada subfunção dos menus ▾), mexe em todos os campos do
// painel (cada opção de cada lista, caixas, botões ±, inverter) e cancela; no esboço usa cada
// ferramenta desenhando no viewport; passa pelos menus, barra de vistas e menu de contexto.
// Relata erros de JavaScript, erros no console e mensagens de recurso com falha.
const { chromium } = require("playwright");

const URL = process.env.URL_WJCAD ?? "http://localhost:5199/cad/";
const perfil = process.argv[2] ?? "computador";
const rapido = process.argv.includes("rapido");

(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const tam = perfil === "celular" ? { width: 412, height: 860 } : perfil === "tablet" ? { width: 1280, height: 800 } : { width: 1440, height: 900 };
  const ctx = await b.newContext({ viewport: tam, hasTouch: perfil !== "computador", acceptDownloads: true });
  const p = await ctx.newPage();
  const achados = [];
  let onde = "início";
  const achar = (tipo, msg) => {
    const linha = `[${tipo}] ${onde}: ${String(msg).slice(0, 300)}`;
    if (!achados.includes(linha)) achados.push(linha);
  };
  p.on("pageerror", (e) => achar("JS", e.message));
  p.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && achar("console", m.text()));
  p.on("dialog", (d) => d.accept());
  await p.addInitScript((d) => {
    localStorage.setItem("jlscad:interface", JSON.stringify({ dispositivo: d }));
    window.__avisos = [];
    new MutationObserver(() => {
      const a = document.getElementById("aviso");
      if (a && !a.hidden && a.textContent) window.__avisos.push(a.textContent);
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
  }, perfil);
  await p.goto(URL);
  await p.waitForTimeout(2500);

  const pronto = async (max = 60) => {
    for (let i = 0; i < max; i++) {
      await p.waitForTimeout(150);
      const ocupado = await p.evaluate(() => /Reconstruindo|Carregando/i.test(document.querySelector("footer:last-of-type")?.textContent ?? ""));
      if (!ocupado) break;
    }
    await p.waitForTimeout(150);
  };
  const avisosSuspeitos = async () => {
    const a = await p.evaluate(() => window.__avisos.splice(0));
    for (const t of a) if (/undefined|null|NaN|TypeError|is not|Cannot|\[object/i.test(t)) achar("aviso", t);
  };
  const errosArvore = async () => {
    const t = await p.evaluate(() => [...document.querySelectorAll(".prop-erro")].map((x) => x.textContent));
    for (const x of t) if (/undefined|null|NaN|TypeError|is not|Cannot|\[object|WebAssembly|This shape|has not type/i.test(x)) achar("erro de recurso", x);
  };
  const fecharTudo = async () => {
    for (let i = 0; i < 3; i++) {
      await p.keyboard.press("Escape").catch(() => {});
      await p.waitForTimeout(80);
    }
    if (await p.locator("#janela").isVisible()) await p.locator("#janela-fechar").click().catch(() => {});
    await p.evaluate(() => document.querySelectorAll(".fundo-dialogo").forEach((x) => x.remove()));
    const cancelar = p.locator("#painel-comando:not([hidden]) .pc-cancelar");
    if (await cancelar.count()) await cancelar.first().click().catch(() => {});
    await pronto();
  };
  const abrirExemplo = async () => {
    await p.evaluate(() => window.__cad.abrirExemplo());
    await pronto(100);
  };
  const aba = async (rot) => {
    const b = p.locator("#abas button", { hasText: rot }).first();
    if (!(await b.isVisible())) {
      achar("interface", `as abas sumiram da tela (foto: estresse-${perfil}-abas.png)`);
      await p.screenshot({ path: `estresse-${perfil}-abas.png` });
      await fecharTudo();
      await abrirExemplo();
    }
    await b.click({ timeout: 5000 });
    await p.waitForTimeout(150);
  };
  /** Lista os comandos da faixa: [rótulo, índice do botão, rótulo da subfunção?]. */
  const comandos = async () => {
    const r = [];
    const n = await p.locator("#faixa-comandos > *").count();
    for (let i = 0; i < n; i++) {
      const el = p.locator("#faixa-comandos > *").nth(i);
      const cls = await el.getAttribute("class");
      if (cls?.includes("cmd-menu")) {
        await el.locator(".cmd-seta").click();
        await p.waitForTimeout(100);
        const itens = await p.locator(".popover button").allInnerTexts();
        await p.keyboard.press("Escape");
        await p.mouse.click(5, tam.height - 5);
        for (let k = 0; k < itens.length; k++) r.push({ i, sub: k, nome: itens[k].trim() });
      } else if (cls?.includes("cmd") && (await el.getAttribute("aria-disabled")) !== "true") {
        r.push({ i, nome: (await el.getAttribute("title")) ?? `#${i}` });
      }
    }
    return r;
  };
  const executar = async (c) => {
    const el = p.locator("#faixa-comandos > *").nth(c.i);
    if (c.sub === undefined) await el.click({ timeout: 3000 });
    else {
      await el.locator(".cmd-seta").click({ timeout: 3000 });
      await p.waitForTimeout(100);
      await p.locator(".popover button").nth(c.sub).click({ timeout: 3000 });
    }
    await p.waitForTimeout(250);
    await pronto();
  };

  /** Mexe em todos os campos do painel do comando (uma passada por campo). */
  const docAberto = () => p.evaluate(() => !/Nenhum documento aberto/.test(document.querySelector("footer:last-of-type")?.textContent ?? ""));
  let ultimaAcao = "";
  const conferir = async (acao) => {
    ultimaAcao = acao;
    if (!(await docAberto())) {
      achar("estado", `o documento foi fechado depois de: ${acao}`);
      await abrirExemplo();
      throw new Error("documento fechado");
    }
  };
  const exercitarPainel = async (sel = "#painel-comando:not([hidden])") => {
    const painel = p.locator(sel);
    if (!(await painel.count())) return;
    // listas: cada opção
    const nSel = await painel.locator("select").count();
    for (let s = 0; s < nSel && s < 12; s++) {
      const lista = painel.locator("select").nth(s);
      if (!(await lista.isVisible().catch(() => false))) continue;
      const valores = await lista.locator("option").evaluateAll((os) => os.map((o) => o.value));
      for (const v of (rapido ? valores.slice(0, 2) : valores).slice(0, 10)) {
        await painel.locator("select").nth(s).selectOption(v).catch(() => {});
        await pronto();
        await conferir(`lista ${s} = ${v}`);
        await errosArvore();
      }
    }
    // caixas de seleção (inclusive as que abrem caixas opcionais), uma vez cada
    const nCb = await painel.locator('input[type="checkbox"]').count();
    for (let k = 0; k < nCb && k < 15; k++) {
      const cb = painel.locator('input[type="checkbox"]').nth(k);
      if (!(await cb.isVisible().catch(() => false))) continue;
      await cb.click({ timeout: 1500 }).catch(() => {});
      await pronto();
      await conferir(`caixa ${k}`);
      await errosArvore();
    }
    // botões + e − dos números e inverter
    const nNum = await painel.locator(".num").count();
    for (let k = 0; k < nNum && k < 15; k++) {
      const g = painel.locator(".num").nth(k);
      if (!(await g.isVisible().catch(() => false))) continue;
      await g.locator("button").last().click({ timeout: 1500 }).catch(() => {});
      await pronto();
      await g.locator("button").first().click({ timeout: 1500 }).catch(() => {});
      await pronto();
      await conferir(`± do número ${k}`);
      // valores extremos digitados
      if (!rapido) {
        for (const v of ["0", "-5", "99999", "abc", "=1/0"]) {
          const inp = painel.locator(".num").nth(k).locator("input");
          if (!(await inp.isVisible().catch(() => false))) break;
          await inp.fill(v).catch(() => {});
          await inp.press("Enter").catch(() => {});
          await pronto();
          await conferir(`número ${k} = ${v}`);
          await errosArvore();
        }
      }
    }
    const nInv = await painel.locator(".pc-inverter").count();
    for (let k = 0; k < nInv && k < 6; k++) {
      await painel.locator(".pc-inverter").nth(k).click({ timeout: 1500 }).catch(() => {});
      await pronto();
    }
    await avisosSuspeitos();
  };

  // ---------- 1. comandos de recurso (Features, Sheet Metal, Avaliar) ----------
  for (const nomeAba of ["Features", "Sheet Metal", "Avaliar"]) {
    await abrirExemplo();
    await aba(nomeAba);
    const lista = await comandos();
    console.log(`${nomeAba}: ${lista.length} comandos`);
    for (const c of lista) {
      onde = `${perfil} › ${nomeAba} › ${c.nome}`;
      if (process.env.SO && !c.nome.includes(process.env.SO)) continue;
      if (process.env.VERBOSO) console.log(onde);
      await aba(nomeAba);
      try {
        await executar(c);
        await exercitarPainel();
        if (await p.locator("#caixa-flutuante, .caixa-flutuante:not([hidden])").count()) await exercitarPainel(".caixa-flutuante:not([hidden])");
      } catch (e) {
        achar("teste", e.message.split("\n")[0]);
      }
      await avisosSuspeitos();
      await fecharTudo();
      // documento ainda íntegro?
      const ok = await p.evaluate(() => !!window.__cad.doc()?.features);
      if (!ok) achar("estado", "documento sumiu");
    }
  }

  // ---------- 2. esboço: cada ferramenta desenhando ----------
  await abrirExemplo();
  onde = `${perfil} › Sketch › abrir`;
  await p.locator("#arvore li", { hasText: "Plano Frontal" }).first().click().catch(() => {});
  await aba("Sketch");
  const cmdsEsb = await comandos();
  await executar(cmdsEsb[0]); // Esboço
  await pronto();
  const cv = await p.locator("#viewport canvas").first().boundingBox();
  const pt = (fx, fy) => [cv.x + cv.width * fx, cv.y + cv.height * fy];
  const toque = async (fx, fy) => {
    const [x, y] = pt(fx, fy);
    await p.mouse.click(x, y);
    await p.waitForTimeout(60);
  };
  const lista = await comandos();
  console.log(`Sketch: ${lista.length} comandos`);
  for (const c of lista.slice(1)) {
    onde = `${perfil} › Sketch › ${c.nome}`;
    try {
      await aba("Sketch");
      await executar(c);
      // 4 toques em forma de losango e um arraste (cobre linha, arco, círculo, polígono, spline…)
      await toque(0.45, 0.45);
      await toque(0.6, 0.45);
      await toque(0.6, 0.62);
      await toque(0.45, 0.62);
      const [x0, y0] = pt(0.3, 0.3), [x1, y1] = pt(0.38, 0.38);
      await p.mouse.move(x0, y0);
      await p.mouse.down();
      await p.mouse.move(x1, y1, { steps: 4 });
      await p.mouse.up();
      await exercitarPainel();
      await p.keyboard.press("Escape");
      await p.keyboard.press("Escape");
      await p.waitForTimeout(150);
    } catch (e) {
      achar("teste", e.message.split("\n")[0]);
    }
    await avisosSuspeitos();
  }
  onde = `${perfil} › Sketch › sair e extrudar`;
  await aba("Sketch");
  await executar((await comandos())[0]); // sair do esboço
  await pronto(100);
  await aba("Features");
  await executar((await comandos())[0]); // Extrusão com o esboço novo
  await p.locator("#painel-comando .pc-ok, .caixa-flutuante .pc-ok").first().click().catch(() => {});
  await pronto(100);
  await errosArvore();
  await avisosSuspeitos();

  // ---------- 3. menus, barra de vistas, menu de contexto, desfazer/refazer ----------
  onde = `${perfil} › menus`;
  for (const acao of ["equacoes", "material", "cotas", "reconstruir", "atalhos", "sobre", "salvar", "step", "stl"]) {
    onde = `${perfil} › menu › ${acao}`;
    await p.evaluate((a) => document.querySelector(`[data-acao="${a}"][role="menuitem"]`)?.click() ?? document.querySelector(`[data-acao="${a}"]`)?.click(), acao);
    await pronto(100);
    await avisosSuspeitos();
    await fecharTudo();
  }
  onde = `${perfil} › barra de vistas`;
  const seta = p.locator("#barra-vistas button").first();
  await seta.click().catch(() => {});
  const nV = await p.locator("#barra-vistas button").count();
  for (let k = 1; k < nV; k++) {
    await p.locator("#barra-vistas button").nth(k).click({ timeout: 1500 }).catch(() => {});
    await p.waitForTimeout(200);
    const nPop = await p.locator(".popover button").count();
    for (let j = 0; j < nPop && j < 12; j++) {
      await p.locator(".popover button").nth(j).click({ timeout: 1500 }).catch(() => {});
      await p.waitForTimeout(150);
      await p.locator("#barra-vistas button").nth(k).click({ timeout: 1500 }).catch(() => {});
      await p.waitForTimeout(100);
    }
    await fecharTudo();
  }
  onde = `${perfil} › menu de contexto`;
  const [cx, cy] = pt(0.5, 0.5);
  await p.mouse.click(cx, cy, { button: "right" });
  await p.waitForTimeout(200);
  const nCtx = await p.locator("#barra-contexto button").count();
  for (let j = 0; j < nCtx; j++) {
    const rot = await p.locator("#barra-contexto button").nth(j).getAttribute("title");
    if (/Excluir/.test(rot ?? "")) continue;
    onde = `${perfil} › menu de contexto › ${rot}`;
    await p.locator("#barra-contexto button").nth(j).click({ timeout: 1500 }).catch(() => {});
    await pronto();
    await fecharTudo();
    await p.mouse.click(cx, cy, { button: "right" });
    await p.waitForTimeout(200);
  }
  onde = `${perfil} › desfazer/refazer`;
  for (let k = 0; k < 15; k++) await p.keyboard.press("Control+z");
  await pronto(100);
  for (let k = 0; k < 15; k++) await p.keyboard.press("Control+y");
  await pronto(100);
  await errosArvore();

  console.log(`\n${perfil}: ${achados.length} achado(s)`);
  for (const a of achados) console.log(a);
  await b.close();
  process.exit(achados.length ? 1 : 0);
})();
