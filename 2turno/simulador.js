/* Radar Eleitoral · 2º turno · SIMULADOR DO RESULTADO FINAL (bloco embaixo da apuração ao vivo)
 *
 * Módulo ES sem dependências, montado pelo app.js num contêiner irmão do da apuração.
 * - Lê o simulador.json que o processador do Mac (scripts/simulador_apuracao.py) manda a cada ~60 s ao ramo
 *   `mercados` do site: projeção município a município, faixa, chance, transferência medida dos votos do
 *   1º turno, virada por estado, cidades que mais pesam no que falta e a série da noite.
 * - Arquivo marcado "teste": true é ignorado, salvo com ?simteste=1 (ou ?simulador=/caminho/do/site.json).
 * - Arquivo com mais de 3 min: aviso discreto, e a apuração por estado (acima) segue sozinha.
 * - Antes das 17h de 25/10 (ou sem arquivo): explica o que vai aparecer e oferece "Ver simulação", que
 *   repete a apuração real de 2022 com o mesmo modelo (marcada SIMULAÇÃO). A simulação da apuração acima
 *   (?sim=1 ou o botão dela) liga esta também.
 */

const CFG = {
  url: 'https://raw.githubusercontent.com/douglora/douglora.github.io/mercados/simulador.json',
  // ?v= muda quando a demonstração for refeita (o navegador guarda a anterior).
  demo: '/2turno/simulador_demo.json?v=2',
  // a cada 15 s (antes 30): o arquivo novo do Mac só aparece ~90 s depois de gerado, então cada segundo de espera aqui pesa
  cadaMs: 15000,
  velhoMs: 3 * 60 * 1000,
  fechamento: '2026-10-25T17:00:00-03:00',
  // Antes disto a página não pede nada ao ramo (o processador só começa às 16h50 de 25/10).
  inicio: '2026-10-25T16:50:00-03:00',
  simMs: 120000,
  simPassoMs: 1000,
  rotacaoMs: 8000,
};
// sqcand das fotos dos outros candidatos do 1º turno (mesmas fotos da página).
const OUTROS_FOTOS = [
  { nome: 'Cury', sq: '280002551547' },
  { nome: 'Renan', sq: '280002540694' },
  { nome: 'Caiado', sq: '280002551932' },
];
const GRADE = {
  RR: [1, 1], AP: [2, 1],
  AM: [1, 2], PA: [2, 2], MA: [3, 2], CE: [4, 2], RN: [5, 2],
  AC: [1, 3], RO: [2, 3], TO: [3, 3], PI: [4, 3], PB: [5, 3], PE: [6, 3],
  MT: [2, 4], GO: [3, 4], BA: [4, 4], SE: [5, 4], AL: [6, 4],
  MS: [2, 5], DF: [3, 5], MG: [4, 5], ES: [5, 5],
  PR: [2, 6], SP: [3, 6], RJ: [4, 6],
  SC: [2, 7],
  RS: [2, 8],
};
// Cores: tudo vem das variáveis CSS do site (modo escuro); os valores abaixo só valem se a variável faltar.
const TEMA_PADRAO = {
  cartao: '#171a21', sobreTinta: '#0f1115', tinta: '#eceef2', tinta2: '#b9bfca', suave: '#1b1f27',
  lulaTexto: '#ff7b8a', flavioTexto: '#8fb0ff', chanceVerde: '#176b3d', chanceVermelho: '#a83a38',
};
const TEMA_VARS = {
  cartao: '--cartao', sobreTinta: '--sobre-tinta', tinta: '--tinta', tinta2: '--tinta-2', suave: '--suave',
  lulaTexto: '--lula-texto', flavioTexto: '--flavio-texto', chanceVerde: '--chance-verde', chanceVermelho: '--chance-vermelho',
};
let temaCache = null;
let temaEm = 0;
function tema() {
  const agora = Date.now();
  if (temaCache && agora - temaEm < 5000) return temaCache;
  const t = {};
  let cs = null;
  try {
    cs = getComputedStyle(document.documentElement);
  } catch {
    cs = null;
  }
  for (const [k, v] of Object.entries(TEMA_VARS)) {
    const x = cs ? String(cs.getPropertyValue(v) || '').trim() : '';
    t[k] = hexRgbOuNulo(x) ? x : TEMA_PADRAO[k];
  }
  temaCache = t;
  temaEm = agora;
  return t;
}
const EXPLICA = {
  simulador:
    'Projeção do resultado final feita município a município, antes de 100% apurado. Parte do 1º turno de 2026 de cada cidade (quem votou em Lula, em Flávio, nos outros, branco/nulo e quem não foi votar), mede na apuração para onde cada grupo foi no 2º turno e projeta o que falta. Roda num computador à parte e atualiza a cada minuto. Resultado oficial é só o do TSE.',
  faixa:
    'Faixa de 80%: em 8 de cada 10 noites parecidas, o resultado final cai dentro dela. A largura foi calibrada repetindo as apurações reais de 2018, 2022 e do 1º turno de 2026, na ordem em que os boletins chegaram ao TSE, e usa a noite mais difícil das três. No começo, a chance tem teto: no máximo 90% com menos de 5% do eleitorado no modelo e 97% com menos de 15%, a não ser que a conta já esteja fechada.',
  transferencia:
    'Fração de cada grupo de eleitores do 1º turno de 2026 que foi para Lula, para Flávio, para branco/nulo ou não votou no 2º turno. É medida comparando, cidade a cidade, o 2º turno já apurado com a composição do 1º turno (regressão ecológica com encolhimento: com pouco dado, fica perto do padrão de 2022).',
  virada:
    'Quanto cada estado andou, em pontos do par Lula × Flávio, em relação ao 2º turno de 2022 (Lula × Jair Bolsonaro). Cor vermelha: andou para Lula; azul: para Flávio. Tracejado: estado ainda sem contagem, vale a prévia.',
  ordem:
    'As primeiras seções de cada cidade não são uma amostra aleatória: nos boletins de 2022 e de 2026 elas pendiam para o candidato da direita, e o fim da contagem compensava. O modelo mede isso na própria noite (a mesma cidade em duas leituras) e desconta.',
};

let C = null;
const S = {
  raiz: null,
  modo: null, // 'pre' | 'espera' | 'vivo' | 'sim' | 'teste'
  doc: null,
  docEm: 0,
  erro: null,
  timers: [],
  visivel: false,
  demo: null,
  demoErro: null,
  quadro: 0,
  simInicio: 0,
  simFim: false,
  rot: 0,
  ufSel: null,
  mostrarLeais: false,
  esqueleto: null,
  apurSim: false,
  ultimoBom: 0,
};

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const reduz = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};
const $ = (sel) => S.raiz?.querySelector(sel);
const $$ = (sel) => Array.from(S.raiz?.querySelectorAll(sel) || []);
const pct1 = (v) => (fin(v) ? `${C.fNum(v, 1)}%` : '—');
const pct2 = (v) => (fin(v) ? `${C.fNum(v, 2)}%` : '—');
function votosCurto(v) {
  if (!fin(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `${C.fNum(a / 1e6, a >= 1e7 ? 1 : 2)} ${a / 1e6 < 2 ? 'milhão' : 'milhões'}`;
  if (a >= 1e3) return `${C.fNum(a / 1e3, 0)} mil`;
  return C.fInt(a);
}
const chanceTxt = (p) => {
  if (!fin(p)) return '—';
  const v = p * 100;
  if (v > 0 && v < 1) return '<1%';
  if (v > 99 && v < 100) return '>99%';
  return `${C.fNum(v, 0)}%`;
};
function hexRgbOuNulo(s) {
  const x = String(s ?? '').trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(x);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/i.exec(x);
  return m ? [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])] : null;
}
const hexRgb = (hx) => hexRgbOuNulo(hx) ?? [0, 0, 0];
function misturar(a, b, t) {
  const p = hexRgb(a);
  const q = hexRgb(b);
  return p.map((v, i) => Math.round(v + (q[i] - v) * t));
}
const rgb = (c) => `rgb(${c.join(',')})`;
function luminancia(c) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
const contraste = (a, b) => {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
// A tinta do texto sobre um fundo: a clara (--tinta) ou a escura (--sobre-tinta), a de maior contraste.
function tintaSobre(fundoRgb) {
  const T = tema();
  return contraste(fundoRgb, hexRgb(T.tinta)) >= contraste(fundoRgb, hexRgb(T.sobreTinta)) ? T.tinta : T.sobreTinta;
}
function corChance(p) {
  const T = tema();
  if (!fin(p)) return { fundo: T.suave, tinta: T.tinta };
  const forca = Math.pow(Math.min(1, Math.abs(p - 0.5) * 2), 0.8);
  const c = misturar(T.suave, p >= 0.5 ? T.chanceVerde : T.chanceVermelho, forca);
  return { fundo: rgb(c), tinta: tintaSobre(c) };
}
function animar(el, para, fmt) {
  if (!el) return;
  const de = el._v;
  el._v = para;
  if (!fin(de) || !fin(para) || de === para || reduz()) {
    el.textContent = fmt(para);
    return;
  }
  const t0 = performance.now();
  cancelAnimationFrame(el._raf);
  const passo = (agora) => {
    const k = Math.min(1, (agora - t0) / 900);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(de + (para - de) * e);
    if (k < 1) el._raf = requestAnimationFrame(passo);
  };
  el._raf = requestAnimationFrame(passo);
}
function texto(sel, v) {
  const el = $(sel);
  if (el && el.textContent !== v) el.textContent = v;
}
function htmlEm(sel, conteudo) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (!el) return;
  const s = C.emHtml(conteudo);
  if (el._h !== s) {
    el._h = s;
    el.innerHTML = s;
  }
}
const iSim = (termo, rot) =>
  C.h`<button type="button" class="i" data-sim-termo="${termo}" aria-label="O que é ${rot}?"><span aria-hidden="true">i</span></button>`;

/* ================================================================ nomes */

function rot() {
  const r = obj(S.modo === 'sim' ? S.demo?.rotulos : null) || {};
  return {
    sim: S.modo === 'sim',
    lula: r.lula || C.curto('lula'),
    flavio: r.flavio || C.curto('flavio'),
    outros: r.outros || 'Cury, Renan, Caiado e outros',
    ano: r.ano || '2026',
    anterior: r.ano_anterior || '2022',
    flavioFoto: r.flavio_foto || null,
  };
}
function candSim(id) {
  const c = { ...C.cand(id) };
  const r = rot();
  if (r.sim && id === 'flavio') {
    c.nome = r.flavio;
    c.foto = r.flavioFoto;
  }
  return c;
}

/* ================================================================ dados */

function urlArquivo() {
  const q = C.params;
  const local = q.get('simulador');
  if (local && local.startsWith('/') && !local.startsWith('//')) return local;
  return CFG.url;
}
const aceitaTeste = () => C.params.get('simteste') !== null || !!C.params.get('simulador');

// Texto de erro para a tela: sempre em português e curto ("Failed to fetch", "HTTP 503" e afins nunca aparecem). O texto
// técnico fica só no console.
function msgErro(e) {
  const m = String(e?.message || e || '');
  const http = /HTTP\s*(\d{3})/.exec(m);
  if (http) {
    const st = Number(http[1]);
    if (st === 404) return 'o arquivo do simulador ainda não foi publicado';
    if (st === 429) return 'o simulador pediu uma pausa';
    if (st >= 500) return 'o servidor do simulador está instável';
    return 'o simulador recusou o pedido';
  }
  if (/formato inesperado/i.test(m)) return 'o arquivo do simulador veio em formato inesperado';
  if (/sem quadros/i.test(m)) return 'a demonstração veio sem quadros';
  if (/unexpected|json|syntax|incompleto/i.test(m)) return 'o arquivo do simulador veio incompleto';
  if (e?.name === 'AbortError' || /abort|timeout|demorou/i.test(m)) return 'o simulador demorou a responder';
  if (/failed to fetch|load failed|network|fetch|conex/i.test(m)) return 'sem conexão com o simulador neste momento';
  return 'falha ao ler o simulador';
}

async function pegar(u) {
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (!obj(d) || d.schema !== 'radar2t/simulador@1' || !obj(d.projecao)) throw new Error('formato inesperado');
  return d;
}
// Nome do arquivo de um minuto (horário de Brasília, UTC−3 fixo desde 2019): sim/AAAAMMDD-HHMM.json
function balde(ms) {
  const x = new Date(ms - 3 * 3600e3).toISOString();
  return `sim/${x.slice(0, 4)}${x.slice(5, 7)}${x.slice(8, 10)}-${x.slice(11, 13)}${x.slice(14, 16)}.json`;
}
const faltam = new Set();

async function lerArquivo() {
  const base = urlArquivo();
  let d = null;
  let erro = null;
  try {
    d = await pegar(base);
  } catch (e) {
    erro = msgErro(e);
    console.debug('[simulador] leitura', e?.message || e);
  }
  if (d && fin(d.gerado_ms) && !d.teste && d.gerado_ms > (S.ultimoBom ?? 0)) S.ultimoBom = d.gerado_ms;
  // O raw do GitHub guarda cada endereço por ~5 min (e ignora parâmetros). Na noite, o processador grava também
  // um arquivo por minuto (sim/AAAAMMDD-HHMM.json): endereços novos, sem cópia velha no caminho. Regras para não
  // gerar "não encontrado": só depois das 16h50 de 25/10, só com o simulador.json real (não de teste) já lido, só
  // minutos depois do último arquivo bom e que já passaram há 90 s, e no máximo dois pedidos por leitura.
  const real = d && !d.teste;
  if (base === CFG.url && real && Date.now() >= C.msDe(CFG.inicio)) {
    const dir = base.replace(/simulador\.json$/, '');
    const ultimoMin = Math.floor((S.ultimoBom ?? 0) / 60000);
    const agoraMin = Math.floor((Date.now() - 90000) / 60000);
    let pedidos = 0;
    for (let m = agoraMin; m > ultimoMin && pedidos < 2; m--) {
      const nome = balde(m * 60000);
      if (faltam.has(nome)) continue;
      pedidos += 1;
      try {
        const x = await pegar(dir + nome);
        if (!x.teste && fin(x.gerado_ms) && x.gerado_ms > (d.gerado_ms ?? 0)) {
          d = x;
          S.ultimoBom = Math.max(S.ultimoBom ?? 0, x.gerado_ms);
        }
        break;
      } catch {
        faltam.add(nome);
      }
    }
  }
  if (d && d.teste && !aceitaTeste()) {
    S.erro = 'teste';
    return null;
  }
  S.erro = d ? null : erro;
  return d;
}

async function lerDemo() {
  if (S.demo) return S.demo;
  try {
    const r = await fetch(CFG.demo);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (!Array.isArray(d?.quadros) || !d.quadros.length) throw new Error('sem quadros');
    S.demo = d;
    return d;
  } catch (e) {
    S.demoErro = msgErro(e);
    console.debug('[simulador] demonstração', e?.message || e);
    return null;
  }
}

/* ============================================================ maturidade */

// O simulador só fala grosso (chance, "já aponta", "o modelo espera") quando já tem chão e parou de andar: 30% ou
// mais das seções apuradas e a projeção de Lula mexendo no máximo 0,6 ponto nos últimos 10 min. Na noite de 25/10/2026
// ele dava 100% a Lula com 10% apurado enquanto a própria projeção caía 2 pontos em 20 min (54,4 → 52,4): a faixa
// calibrada nas noites de 2018 e 2022 não valia para esta. A apuração (apuracao.js) usa a mesma régua, repassada
// junto com o arquivo (publicar), para decidir se o simulador entra na chance.
const MADURO = { secoes: 30, janelaMs: 10 * 60000, mexeu: 0.6 };
function maduro(d, serie = arr(d?.serie)) {
  const a = obj(d?.apuracao) || {};
  const secoes = fin(a.secoes_pct) ? a.secoes_pct : 0;
  if (secoes >= 100) return { ok: true, secoes, mexeu: 0, min: 0 };
  const s = serie.filter((x) => x && fin(x.t) && fin(x.lula));
  const ult = s[s.length - 1];
  const jan = ult ? s.filter((x) => x.t >= ult.t - MADURO.janelaMs) : [];
  const vals = jan.map((x) => x.lula);
  const mexeu = vals.length ? Math.max(...vals) - Math.min(...vals) : null;
  const min = jan.length ? (ult.t - jan[0].t) / 60000 : 0;
  // série com menos de 8 min não prova que parou de andar
  const longa = !!ult && ult.t - s[0].t >= MADURO.janelaMs * 0.8;
  return { ok: secoes >= MADURO.secoes && longa && mexeu !== null && mexeu <= MADURO.mexeu, secoes, mexeu, min };
}

/* ============================================================ insights */

function insights(d) {
  const h = C.h;
  const out = [];
  const r = rot();
  const p = obj(d.projecao) || {};
  const a = obj(d.apuracao) || {};
  const cont = obj(a.contagem) || {};
  const nome = (id) => (id === 'lula' ? r.lula : r.flavio);
  const lp = fin(p.lula_pct) ? (p.lula_pct >= 50 ? 'lula' : 'flavio') : null;
  const lc = fin(cont.lula_pct) ? (cont.lula_pct >= 50 ? 'lula' : 'flavio') : null;
  const aberta = fin(a.secoes_pct) && a.secoes_pct > 0 && a.secoes_pct < 100;
  const m = maduro(d, serieAtual());
  if (aberta && lp && lc && lp !== lc) {
    // Mesma régua da faixa "Virada à vista" da apuração: afirmar só com 80% de chance ou mais para quem a projeção aponta,
    // e só com o simulador maduro; antes disso ele diz quanto ainda está andando.
    const chL = C.num(p.chance?.lula);
    const chLp = chL === null ? null : lp === 'lula' ? chL : 1 - chL;
    out.push(
      !m.ok
        ? { id: 'virada-proj', p: 88, html: h`O simulador projeta <b>${C.fNum(p.lula_pct, 1)}%</b> para ${r.lula}, mas ainda está se ajustando${fin(m.mexeu) && m.mexeu >= 0.1 ? h`: mexeu <b>${C.fNum(m.mexeu, 1)} ${m.mexeu < 2 ? 'ponto' : 'pontos'}</b> nos últimos ${C.fNum(Math.max(1, m.min), 0)} min` : ''}. Ele só entra na chance com 30% das seções apuradas no modelo e a projeção parada.` }
        : chLp !== null && chLp < 0.8
          ? { id: 'virada-proj', p: 88, html: h`Disputa aberta: <b>${nome(lc)}</b> lidera a contagem, e o simulador dá a <b>${nome(lp)}</b> ${C.fNum(100 * chLp, 0)}% de chance de terminar à frente.` }
          : { id: 'virada-proj', p: 95, tom: 'forte', html: h`O simulador já aponta <b>${nome(lp)}</b>, embora <b>${nome(lc)}</b> lidere a contagem: o que falta apurar é mais favorável a ${nome(lp)}.` },
    );
  }
  const v = obj(d.virar);
  if (aberta && v && fin(v.precisa_pct)) {
    out.push({
      id: 'virar',
      p: 85,
      html: v.impossivel
        ? h`${nome(v.atras)} não alcança mais: precisaria de mais votos do que os que faltam contar.`
        : h`Para <b>${nome(v.atras)}</b> virar, precisaria de <b>${C.fNum(v.precisa_pct, 1)}%</b> dos ${votosCurto(v.faltam_validos)} de votos válidos que faltam${m.ok && fin(v.esperado_pct) ? h`; o modelo espera <b>${C.fNum(v.esperado_pct, 1)}%</b>` : ''}.`,
    });
  }
  const g = arr(d.transferencia?.grupos).find((x) => x?.id === 'outros');
  if (aberta && g && fin(g.lula) && fin(g.flavio) && (g.apurado_pct ?? 0) >= 1) {
    const dif = g.flavio - g.lula;
    out.push({
      id: 'transf-outros',
      p: 80,
      html: h`Dos eleitores de ${r.outros}, <b>${C.fNum(g.flavio, 0)}%</b> foram para ${r.flavio} e <b>${C.fNum(g.lula, 0)}%</b> para ${r.lula} até agora${fin(g.flavio_2022) ? h` (em ${r.anterior}: ${C.fNum(g.flavio_2022, 0)}% × ${C.fNum(g.lula_2022, 0)}%)` : ''}.${Math.abs(dif) >= 15 ? h` Saldo de <b>${C.fNum(Math.abs(dif), 0)} pontos</b> para ${dif > 0 ? r.flavio : r.lula}.` : ''}`,
    });
  }
  const ab = arr(d.transferencia?.grupos).find((x) => x?.id === 'abstencao');
  if (aberta && ab && fin(ab.abst) && (ab.apurado_pct ?? 0) >= 1) {
    const voltaram = 100 - ab.abst;
    out.push({
      id: 'transf-abst',
      p: 62,
      html: h`Dos que não votaram no 1º turno, <b>${C.fNum(voltaram, 0)}%</b> apareceram agora: ${C.fNum(ab.lula, 1)}% em ${r.lula}, ${C.fNum(ab.flavio, 1)}% em ${r.flavio}${fin(ab.abst_2022) ? h` (em ${r.anterior}, voltaram ${C.fNum(100 - ab.abst_2022, 0)}%)` : ''}.`,
    });
  }
  const pesa = arr(d.pesam)[0];
  if (aberta && pesa && fin(pesa.saldo)) {
    out.push({
      id: `pesa-${pesa.nome}`,
      p: 70,
      html: h`Maior estoque de votos por contar: <b>${nomeCidade(pesa.nome)} (${pesa.uf})</b>, ${C.fNum(pesa.apurado_pct, 0)}% apurado; deve render <b>+${votosCurto(Math.abs(pesa.saldo))}</b> a ${pesa.saldo >= 0 ? r.lula : r.flavio}.`,
    });
  }
  if (aberta && a.secoes_pct < 5) {
    out.push({
      id: 'comeco',
      p: 90,
      html: h`Com menos de 5% apurado, a projeção ainda oscila: nas repetições de 2018 e 2022, o erro nesse trecho foi de <b>0,7 ponto</b> em média, e caiu para 0,1 ponto depois dos 5%.`,
    });
  }
  const pv = obj(d.previa);
  if (fin(pv?.lula_pct) && fin(p.lula_pct) && aberta) {
    const dd = p.lula_pct - pv.lula_pct;
    out.push({
      id: 'previa',
      p: 45,
      html: h`Antes da apuração, a média das pesquisas dava <b>${C.fNum(pv.lula_pct, 1)}%</b> a ${r.lula}; o simulador agora projeta <b>${C.fNum(p.lula_pct, 1)}%</b> (${dd >= 0 ? '+' : '−'}${C.fNum(Math.abs(dd), 1)} ${Math.abs(dd) < 2 ? 'ponto' : 'pontos'}).`,
    });
  }
  if (fin(p.comparecimento_pct) && aberta) {
    out.push({ id: 'comp', p: 40, html: h`Comparecimento projetado: <b>${C.fNum(p.comparecimento_pct, 1)}%</b> do eleitorado.` });
  }
  if (a.secoes_pct >= 100 || (fin(p.sd_pp) && p.sd_pp === 0 && a.secoes_pct > 99)) {
    out.unshift({ id: 'fim', p: 100, tom: 'forte', html: h`Com tudo apurado, a projeção é o próprio resultado: ${r.lula} <b>${pct2(p.lula_pct)}</b> × ${r.flavio} <b>${pct2(p.flavio_pct)}</b>. Resultado oficial: TSE.` });
  }
  // Antes de maduro, nada que dependa da projeção do simulador vai para os destaques (25/10/2026: "São Paulo deve render
  // +690 mil a Lula", da capital, ao lado de "SP deve render +3,1 milhões a Flávio", do estado; transferência e
  // comparecimento de 10% das seções; "Para Flávio virar" com Flávio à frente na contagem, porque o "atrás" do simulador
  // é o da projeção dele). Só o resultado final passa.
  if (!m.ok) return out.filter((x) => x.id === 'fim');
  return out.sort((x, y) => y.p - x.p);
}
const nomeCidade = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (m) => m.toLowerCase());

function renderInsights(lista) {
  // 25/10/2026 17h: os destaques sobem para logo abaixo dos cards de Lula e Flávio, na Apuração (ver sem rolar);
  // a lista do simulador fica escondida para o mesmo texto não aparecer duas vezes.
  const topo = S.modo === 'vivo' || S.modo === 'teste' ?document.querySelector('#painel-apuracao [data-rx-dest]') : null;
  const baixo = $('[data-sim-ins]');
  if (topo && baixo) {
    baixo.style.display = 'none';
    const vb = $('[data-sim-ins-vazio]');
    if (vb) vb.hidden = true;
  } else if (baixo) baixo.style.display = '';
  const ol = topo || baixo;
  if (!ol) return;
  // Dois destaques por vez (v6, 24/10/2026: a aba sem parede de texto): o mais forte fica, o segundo gira.
  const fixos = lista.slice(0, 1);
  const resto = lista.slice(1);
  const mostrar = resto.length ? [...fixos, resto[S.rot % resto.length]] : fixos;
  const vistos = new Set();
  const final = mostrar.filter((x) => x && !vistos.has(x.id) && vistos.add(x.id));
  const ids = new Set(final.map((x) => x.id));
  // depois de mostrar dois destaques, a caixa guarda a altura: um destaque a menos não puxa a página para cima
  if (final.length > 1) ol.classList.add('dois');
  for (const li of Array.from(ol.children)) {
    if (!ids.has(li.dataset.id) && !li.classList.contains('saindo')) {
      li.classList.add('saindo');
      setTimeout(() => li.remove(), reduz() ? 0 : 450);
    }
  }
  let ref = null;
  for (const x of final) {
    let li = Array.from(ol.children).find((e) => e.dataset.id === x.id && !e.classList.contains('saindo'));
    const s = C.emHtml(x.html);
    if (!li) {
      li = document.createElement('li');
      li.dataset.id = x.id;
      li.className = `ap-in entrando${x.tom === 'forte' ? ' forte' : ''}`;
      li.innerHTML = s;
      li._h = s;
      requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove('entrando')));
      setTimeout(() => li.classList.remove('entrando'), 600); // aba em segundo plano não roda requestAnimationFrame
    } else if (li._h !== s) {
      li.innerHTML = s;
      li._h = s;
      // pisca no máximo a cada 20 s (na simulação os números mudam a cada segundo)
      if (!li._t || Date.now() - li._t > 20000) {
        li._t = Date.now();
        li.classList.remove('mudou');
        void li.offsetWidth;
        li.classList.add('mudou');
      }
    }
    const alvo = ref ? ref.nextSibling : ol.firstChild;
    if (li !== alvo) ol.insertBefore(li, alvo);
    ref = li;
  }
  const vazio = topo ? document.querySelector('#painel-apuracao [data-rx-dest-vazio]') : $('[data-sim-ins-vazio]');
  if (vazio) vazio.hidden = final.length > 0;
}

/* ============================================================ esqueletos */

function faixaSim() {
  const h = C.h;
  if (S.modo === 'sim') {
    const d = S.demo;
    return h`<div class="ap-sim sim-faixa" role="note"><p><b>SIMULAÇÃO</b> ${d?.replay ? h`É a apuração real do 2º turno de 2022 (Lula × Jair Bolsonaro) repetida pelo mesmo modelo, ${d.replay.replace(/^2º turno de 2022, /, '')}. Serve para conhecer a tela; não é dado de 2026.` : 'Apuração de 2022 repetida pelo modelo.'}</p><div class="ap-sim-acoes"><button type="button" data-sim="reiniciar">Recomeçar</button><button type="button" data-sim="sair">Sair da simulação</button></div></div>`;
  }
  if (S.modo === 'teste') {
    return h`<div class="ap-sim sim-faixa" role="note"><p><b>TESTE</b> Arquivo de teste do simulador (números fictícios, gerados contra um TSE simulado). Não é dado real.</p><div class="ap-sim-acoes"><button type="button" data-sim="sair">Sair do teste</button></div></div>`;
  }
  return '';
}

function htmlLado(id) {
  const h = C.h;
  const c = candSim(id);
  return h`<div class="sim-lado" data-sim-lado="${id}" style="--c:${c.cor};--ct:${id === 'lula' ? 'var(--lula-texto)' : 'var(--flavio-texto)'}">
    <div class="ap-quem">${C.foto(c)}<div><p class="ap-nome">${c.nome}</p><p class="ap-part">${S.modo === 'sim' && id === 'flavio' ? 'PL · 22 (2022)' : `${C.txt(c.partido) || ''}${fin(C.num(c.numero)) ? ` · ${c.numero}` : ''}`}</p></div></div>
    <p class="sim-rot">projeção final</p>
    <p class="sim-num"><span data-sim-pct="${id}">—</span><small>%</small></p>
    <p class="sim-faixa-txt" data-sim-faixa="${id}">—</p>
    <p class="sim-chance"><span>chance de vitória</span> <b data-sim-ch="${id}">—</b></p>
  </div>`;
}

function esqueleto() {
  const h = C.h;
  const r = rot();
  return h`<section class="bloco sim" aria-label="Simulador do resultado final">
    <div class="sim-cab">
      <p class="sobre">Simulador do resultado final ${iSim('simulador', 'o simulador')}</p>
      <p class="sim-selo" data-sim-selo></p>
    </div>
    ${faixaSim()}
    <p class="sim-aviso" data-sim-aviso hidden></p>
    <div class="sim-hero">${htmlLado('lula')}${htmlLado('flavio')}</div>
    <div class="sim-barra" aria-hidden="true"><span data-sim-bl></span><span data-sim-bf></span><i></i><b data-sim-bfx></b></div>
    <p class="sim-modelado" data-sim-modelado></p>
    <ol class="ap-ins sim-ins" data-sim-ins aria-live="polite"></ol>
    <p class="estado" data-sim-ins-vazio hidden>Os destaques entram aqui assim que a projeção começar.</p>

    <h3 class="sub">Para onde foram os votos do 1º turno ${iSim('transferencia', 'a transferência')}</h3>
    <div class="sim-transf" data-sim-transf></div>
    <button type="button" class="sim-mais" data-sim="leais">Ver também quem votou em ${r.lula} e em ${r.flavio}</button>

    <h3 class="sub">A projeção ao longo da noite ${iSim('faixa', 'a faixa')}</h3>
    <div class="graf sim-graf" data-sim-graf role="img" aria-label="Projeção do resultado final ao longo da apuração, com a faixa de 80%"></div>
    <p class="sim-leg" data-sim-leg></p>

    <h3 class="sub">O que falta para virar</h3>
    <div class="sim-virar" data-sim-virar></div>

    <h3 class="sub">Virada por estado, contra ${r.anterior} ${iSim('virada', 'a virada por estado')}</h3>
    <div class="ap-mapa-wrap">
      <div><div class="ap-mapa" data-sim-mapa>${htmlMapa()}</div><p class="ap-leg" data-sim-mapa-leg></p></div>
      <div class="ap-uf" data-sim-uf><p class="ap-uf-dica">Toque num estado para ver a projeção, a prévia, o 1º turno e ${r.anterior}.</p></div>
    </div>

    <h3 class="sub">As cidades que mais pesam no que falta</h3>
    <div data-sim-cidades></div>

    <p class="fonte" data-sim-fonte></p>
  </section>`;
}

function htmlMapa() {
  const h = C.h;
  return Object.entries(GRADE).map(
    ([uf, [c, l]]) =>
      h`<button type="button" class="lad" data-sim-ufb="${uf}" style="grid-column:${c};grid-row:${l}" aria-label="${uf}"><span class="lad-uf">${uf}</span><span class="lad-v" data-v></span><span class="lad-barra"><i data-b></i></span></button>`,
  );
}

function esqueletoPre() {
  const h = C.h;
  const fe = C.msDe(C.dados()?.eleicao?.fechamento) ?? C.msDe(CFG.fechamento);
  const antes = Date.now() < fe;
  return h`<section class="bloco sim" aria-label="Simulador do resultado final">
    <p class="sobre">Simulador do resultado final ${iSim('simulador', 'o simulador')}</p>
    <p class="sim-pre-g">${antes ? h`Começa às 17h, com a apuração` : 'Aguardando a primeira projeção'}</p>
    <p class="sim-pre-r">${antes
      ? h`Assim que o TSE (Tribunal Superior Eleitoral) soltar os primeiros números, este bloco passa a projetar o resultado final <b>cidade a cidade</b>, muito antes dos 100%:`
      : h`O simulador roda num computador à parte e manda uma projeção nova a cada minuto. ${S.erro && S.erro !== 'teste' ? h`Última tentativa de leitura: ${S.erro}.` : ''} Enquanto isso, a apuração por estado, acima, segue sozinha.`}</p>
    <ul class="sim-pre-l">
      <li>o número projetado de cada um, com a faixa e a chance de vitória;</li>
      <li>para onde foram os eleitores de Cury, Renan e Caiado e os que não votaram no 1º turno, comparado com 2022;</li>
      <li>a projeção ao longo da noite e o que precisaria acontecer no que falta para o outro virar;</li>
      <li>a virada de cada estado contra 2022 e as cidades que mais pesam no que falta.</li>
    </ul>
    <div class="ap-pre-acoes"><button type="button" class="botao-link" data-sim="ver">Ver simulação</button><span class="nota">a apuração real de 2022 repetida pelo modelo, cidade a cidade</span></div>
    <p class="fonte">Prova: repetindo a apuração de 2022 município a município, na ordem em que os boletins chegaram ao TSE, o erro médio da projeção foi de 0,1 ponto a partir de 5% apurado (0,3 ponto no pior momento, com 10%).</p>
  </section>`;
}

/* ================================================================ render */

function montar() {
  if (!S.raiz) return;
  const modo = S.modo;
  if (modo === 'pre' || modo === 'espera') {
    S.raiz.innerHTML = C.emHtml(esqueletoPre());
    S.esqueleto = modo;
    return;
  }
  S.raiz.innerHTML = C.emHtml(esqueleto());
  S.esqueleto = modo;
}

function docAtual() {
  if (S.modo === 'sim') return S.demo?.quadros?.[S.quadro] || null;
  return S.doc;
}

function atualizar() {
  const d = docAtual();
  if (!d || !S.raiz) return;
  if (S.esqueleto !== S.modo) montar();
  const r = rot();
  const p = obj(d.projecao) || {};
  const a = obj(d.apuracao) || {};
  // Antes de maduro, a chance do simulador fica "em ajuste" (sem número nem cor): ver maduro().
  const m = maduro(d, serieAtual());
  for (const id of ['lula', 'flavio']) {
    const v = p[`${id}_pct`];
    animar($(`[data-sim-pct="${id}"]`), v, (x) => (fin(x) ? C.fNum(x, 1) : '—'));
    const fx = p.faixa80?.[id];
    texto(`[data-sim-faixa="${id}"]`, Array.isArray(fx) && fin(fx[0]) ? (fx[0] === fx[1] ? 'resultado final' : `entre ${C.fNum(fx[0], 1)}% e ${C.fNum(fx[1], 1)}%`) : '—');
    const ch = m.ok ? p.chance?.[id] : null;
    texto(`[data-sim-ch="${id}"]`, m.ok ? chanceTxt(ch) : 'em ajuste');
    const el = $(`[data-sim-ch="${id}"]`);
    if (el) {
      const cor = corChance(ch);
      el.style.background = cor.fundo;
      el.style.color = cor.tinta;
    }
  }
  const bl = $('[data-sim-bl]');
  const bf = $('[data-sim-bf]');
  if (bl && bf && fin(p.lula_pct)) {
    bl.style.flexGrow = String(p.lula_pct);
    bf.style.flexGrow = String(100 - p.lula_pct);
    bl.style.background = candSim('lula').cor;
    bf.style.background = candSim('flavio').cor;
    const fx = p.faixa80?.lula;
    const b = $('[data-sim-bfx]');
    if (b && Array.isArray(fx) && fin(fx[0])) {
      b.style.left = `${clamp(fx[0], 0, 100)}%`;
      b.style.width = `${clamp(fx[1] - fx[0], 0, 100)}%`;
    }
  }
  const selo = $('[data-sim-selo]');
  if (selo) {
    const quando = S.modo === 'sim' ? `${C.fHora(d.gerado_ms)} de 30/10/2022` : C.fHora(d.gerado_ms);
    selo.textContent = `${S.modo === 'sim' ? 'simulação' : S.modo === 'teste' ? 'teste' : 'ao vivo'} · ${quando || '—'}`;
    selo.classList.toggle('vivo', S.modo === 'vivo');
  }
  // aviso de arquivo velho
  const av = $('[data-sim-aviso]');
  if (av) {
    const velho = S.modo === 'vivo' && fin(d.gerado_ms) && Date.now() - d.gerado_ms > CFG.velhoMs && (a.secoes_pct ?? 0) < 100;
    av.hidden = !velho;
    if (velho) av.textContent = `O simulador não atualiza desde ${C.fHora(d.gerado_ms)}. Os números abaixo são dessa hora; a apuração por estado, acima, segue ao vivo.`;
    S.raiz.querySelector('.sim')?.classList.toggle('sim-velho', velho);
  }
  texto(
    '[data-sim-modelado]',
    fin(a.eleitorado_modelado_pct)
      ? `${C.fNum(a.eleitorado_modelado_pct, 1)}% do eleitorado já entrou no modelo (${C.fInt(a.municipios_lidos)} de ${C.fInt(a.municipios_total)} municípios lidos, ${C.fInt(a.municipios_completos)} completos) · ${C.fNum(a.secoes_pct, 2)}% das seções apuradas`
      : '',
  );
  renderInsights(insights(d));
  renderTransf(d);
  renderVirar(d);
  renderMapa(d);
  renderCidades(d);
  desenharGraf();
  const fonte = $('[data-sim-fonte]');
  if (fonte) {
    htmlEm(
      fonte,
      C.h`Método: 1º turno de ${r.ano === '2022' ? '2022' : '2026'} de cada cidade + transferência medida na apuração (regressão ecológica com encolhimento, prévia: padrão de ${r.anterior} e a média das pesquisas), virada em escala log-razão por Brasil, região e estado, e desconto do viés de ordem das seções. Faixa calibrada repetindo as apurações de 2018, 2022 e do 1º turno de 2026. Fonte dos votos: TSE. Resultado oficial é só o do TSE.${S.modo === 'sim' && S.demo?.verdade ? C.h` <b>Resultado real de 2022: Lula ${C.fNum(S.demo.verdade.lula_pct, 2)}% × Bolsonaro ${C.fNum(S.demo.verdade.flavio_pct, 2)}%.</b>` : ''}`,
    );
  }
}

function barraTransf(g) {
  const h = C.h;
  const L = candSim('lula');
  const F = candSim('flavio');
  const parte = (v, cor, cls, rotulo) => (fin(v) && v > 0 ? h`<span class="${cls}" style="flex-grow:${v.toFixed(2)};--c:${cor}" title="${rotulo} ${C.fNum(v, 1)}%"></span>` : '');
  return h`<div class="sim-tb">${parte(g.lula, L.cor, 'tb-l', rot().lula)}${parte(g.flavio, F.cor, 'tb-f', rot().flavio)}${parte(g.bn, 'var(--tinta-3)', 'tb-n', 'branco/nulo')}${parte(g.abst, 'var(--linha-2)', 'tb-a', 'não votou')}</div>`;
}

function renderTransf(d) {
  const el = $('[data-sim-transf]');
  if (!el) return;
  const h = C.h;
  const r = rot();
  const grupos = arr(d.transferencia?.grupos);
  const ordem = S.mostrarLeais ? ['outros', 'abstencao', 'brancos_nulos', 'lula', 'flavio'] : ['outros', 'abstencao', 'brancos_nulos'];
  const linhas = ordem
    .map((id) => grupos.find((g) => g?.id === id))
    .filter(Boolean)
    .map((g) => {
      const fotos =
        g.id === 'outros' && !r.sim
          ? h`<span class="sim-mini">${OUTROS_FOTOS.map((o) => h`<img src="/candidates/2026/2026-tse-${o.sq}.webp" alt="${o.nome}" width="22" height="22" loading="lazy" />`)}</span>`
          : '';
      const rotulo = g.id === 'outros' ? h`quem votou em ${r.outros}` : g.rotulo;
      const ant =
        fin(g.lula_2022) && fin(g.flavio_2022)
          ? h`<span class="sim-ant">em ${r.anterior}: ${C.fNum(g.lula_2022, 0)}% × ${C.fNum(g.flavio_2022, 0)}%</span>`
          : '';
      return h`<div class="sim-tl">
        <p class="sim-tl-cab">${fotos}<span class="sim-tl-rot">${rotulo}</span><span class="sim-tl-n">${votosCurto(g.eleitores_1t)} no 1º turno</span></p>
        ${barraTransf(g)}
        <p class="sim-tl-num"><span><i class="mc" style="--c:${candSim('lula').cor}"></i>${r.lula} <b>${pct1(g.lula)}</b></span><span><i class="mc" style="--c:${candSim('flavio').cor}"></i>${r.flavio} <b>${pct1(g.flavio)}</b></span><span class="sim-tl-out">branco/nulo ${pct1(g.bn)} · não votou ${pct1(g.abst)}</span></p>
        <p class="sim-tl-ant">${ant}${fin(g.apurado_pct) && g.apurado_pct >= 0.5 ? h`<span>medido em ${C.fNum(g.apurado_pct, 0)}% desse eleitorado</span>` : h`<span>prévia</span>`}</p>
      </div>`;
    });
  htmlEm(el, linhas.length ? linhas : C.lacunaBloco('A transferência aparece com os primeiros municípios apurados.'));
  const b = $('[data-sim="leais"]');
  if (b) b.textContent = S.mostrarLeais ? 'Esconder quem votou nos dois finalistas' : `Ver também quem votou em ${r.lula} e em ${r.flavio}`;
}

function renderVirar(d) {
  const el = $('[data-sim-virar]');
  if (!el) return;
  const h = C.h;
  const r = rot();
  const v = obj(d.virar);
  const a = obj(d.apuracao) || {};
  if (!v || !fin(v.precisa_pct) || (a.secoes_pct ?? 0) >= 100) {
    htmlEm(el, C.lacunaBloco((a.secoes_pct ?? 0) >= 100 ? 'Apuração concluída: não falta nada.' : 'Aparece com a primeira projeção.'));
    return;
  }
  const atras = v.atras === 'lula' ? r.lula : r.flavio;
  const lider = v.lider === 'lula' ? r.lula : r.flavio;
  const cor = candSim(v.atras).cor;
  const marca = clamp(v.precisa_pct, 0, 100);
  const esp = clamp(v.esperado_pct, 0, 100);
  const folga = v.precisa_pct - v.esperado_pct;
  htmlEm(
    el,
    h`<p class="sim-virar-t">${v.impossivel
      ? h`<b>${atras}</b> não alcança mais <b>${lider}</b>: precisaria de mais votos do que os que faltam.`
      : h`Para <b>${atras}</b> passar <b>${lider}</b>, precisa de <b>${C.fNum(v.precisa_pct, 1)}%</b> dos <b>${votosCurto(v.faltam_validos)}</b> de votos válidos que faltam contar. O modelo espera <b>${C.fNum(v.esperado_pct, 1)}%</b>: ${folga > 0 ? h`faltam <b>${C.fNum(folga, 1)} ${folga < 2 ? 'ponto' : 'pontos'}</b> em cada cidade que ainda não terminou.` : h`já é suficiente.`}`}</p>
    <div class="sim-regua" aria-hidden="true"><i class="r-esp" style="left:${esp.toFixed(2)}%;--c:${cor}"></i><i class="r-pre" style="left:${marca.toFixed(2)}%"></i><span class="r-50"></span></div>
    <p class="sim-regua-leg"><span><i class="r-esp-l" style="--c:${cor}"></i>esperado</span><span><i class="r-pre-l"></i>necessário</span><span>escala: % dos válidos que faltam</span></p>`,
  );
}

function renderMapa(d) {
  const r = rot();
  const ufs = new Map(arr(d.ufs).map((u) => [u.uf, u]));
  const L = candSim('lula').cor;
  const F = candSim('flavio').cor;
  for (const el of $$('[data-sim-ufb]')) {
    const u = ufs.get(el.dataset.simUfb);
    if (!u) continue;
    const prev = !(u.apurado_pct > 0);
    const proj = fin(u.lula_proj) ? u.lula_proj : u.lula_previa;
    const ref = u.lula_2022;
    const vir = fin(proj) && fin(ref) ? proj - ref : null;
    const t = fin(vir) ? clamp(Math.abs(vir) / 8, 0, 1) : 0;
    // fundo escuro com a cor de quem andou (mais forte = virada maior); a letra é a de maior contraste
    const c = misturar(tema().cartao, fin(vir) && vir >= 0 ? L : F, (prev ? 0.1 : 0.14) + t * (prev ? 0.2 : 0.26));
    el.style.background = rgb(c);
    el.style.color = tintaSobre(c);
    el.classList.toggle('prev', prev);
    el.classList.toggle('sel', S.ufSel === u.uf);
    const v = el.querySelector('[data-v]');
    const s = fin(vir) ? `${vir >= 0 ? 'L' : 'F'} +${C.fNum(Math.abs(vir), 1)}` : '—';
    if (v && v.textContent !== s) v.textContent = s;
    const b = el.querySelector('[data-b]');
    if (b) b.style.width = `${clamp(u.apurado_pct || 0, 0, 100).toFixed(1)}%`;
    el.setAttribute('aria-label', `${u.nome}: ${fin(vir) ? `andou ${C.fNum(Math.abs(vir), 1)} pontos para ${vir >= 0 ? r.lula : r.flavio} desde ${r.anterior}` : 'sem dado'}; ${C.fNum(u.apurado_pct || 0, 0)}% apurado`);
  }
  texto('[data-sim-mapa-leg]', `Número: para quem o estado andou desde ${r.anterior}, em pontos do par (L = ${r.lula}, F = ${r.flavio}). Cor mais forte, virada maior. Tracejado: ainda sem contagem (prévia). Barrinha: quanto já foi apurado.`);
  renderUF(d);
}

function renderUF(d) {
  const caixa = $('[data-sim-uf]');
  if (!caixa) return;
  const h = C.h;
  const r = rot();
  const u = arr(d.ufs).find((x) => x.uf === S.ufSel);
  if (!u) {
    htmlEm(caixa, h`<p class="ap-uf-dica">Toque num estado para ver a projeção, a prévia, o 1º turno e ${r.anterior}.</p>`);
    return;
  }
  const lin = (rotulo, v) => h`<tr><td>${rotulo}</td><td class="n">${pct1(v)}</td><td class="n">${pct1(fin(v) ? 100 - v : null)}</td></tr>`;
  htmlEm(
    caixa,
    h`<div class="ap-uf-cab"><p class="ap-uf-nome">${u.nome} <small>${u.uf}</small></p><button type="button" class="ap-uf-x" data-sim="fechar-uf" aria-label="Fechar">×</button></div>
    <p class="ap-uf-l"><b>${C.fNum(u.apurado_pct || 0, 1)}%</b> do eleitorado apurado</p>
    <table class="tab"><thead><tr><th style="width:44%">% do par</th><th class="n">${r.lula}</th><th class="n">${r.flavio}</th></tr></thead><tbody>
      ${lin(h`<b>Projeção final</b>`, u.lula_proj)}${lin('Apurado até agora', u.lula_apurado)}${lin('Prévia (antes da contagem)', u.lula_previa)}${lin(`1º turno de ${r.ano}`, u.lula_1t_par)}${lin(`2º turno de ${r.anterior}`, u.lula_2022)}
    </tbody></table>
    <p class="ap-uf-l">Faltam cerca de <b>${votosCurto(u.faltam_validos)}</b> de votos válidos${fin(u.saldo_resto) && u.faltam_validos > 0 ? h`; devem render <b>+${votosCurto(Math.abs(u.saldo_resto))}</b> a ${u.saldo_resto >= 0 ? r.lula : r.flavio}` : ''}.</p>`,
  );
}

function renderCidades(d) {
  const el = $('[data-sim-cidades]');
  if (!el) return;
  const h = C.h;
  const r = rot();
  const lista = arr(d.pesam).slice(0, 8);
  if (!lista.length) {
    htmlEm(el, C.lacunaBloco((d.apuracao?.secoes_pct ?? 0) >= 100 ? 'Nada falta: apuração concluída.' : 'A lista aparece com a primeira projeção.'));
    return;
  }
  htmlEm(
    el,
    h`<table class="tab sim-cid"><thead><tr><th>Cidade</th><th class="n">Apurado</th><th class="n">Faltam</th><th class="n">Deve render</th></tr></thead><tbody>
    ${lista.map(
      (c) => h`<tr><td><b>${nomeCidade(c.nome)}</b> <small>${c.uf}${fin(c.lula_2022) ? ` · ${r.lula} ${C.fNum(c.lula_2022, 0)}% do par em ${r.anterior}` : ''}</small></td><td class="n">${C.fNum(c.apurado_pct || 0, 0)}%</td><td class="n">${votosCurto(c.faltam_validos)}</td><td class="n"><i class="mc" style="--c:${candSim(c.saldo >= 0 ? 'lula' : 'flavio').cor}"></i> +${votosCurto(Math.abs(c.saldo))}<small>${c.saldo >= 0 ? r.lula : r.flavio} · ${C.fNum(c.saldo >= 0 ? c.lula_resto_pct : 100 - c.lula_resto_pct, 0)}% do resto</small></td></tr>`,
    )}</tbody></table>`,
  );
}

/* ============================================================== gráfico */

function serieAtual() {
  if (S.modo === 'sim') {
    const d = docAtual();
    const t = d?.gerado_ms ?? 0;
    return arr(S.demo?.serie).filter((p) => p.t <= t);
  }
  return arr(S.doc?.serie);
}

function desenharGraf() {
  const el = $('[data-sim-graf]');
  if (!el || el.offsetParent === null) return;
  const pts = serieAtual().filter((p) => fin(p.t) && fin(p.lula));
  const W = Math.round(el.clientWidth);
  if (W < 60) return;
  if (pts.length < 1) {
    htmlEm(el, C.lacunaBloco('O gráfico começa com a primeira projeção.'));
    return;
  }
  const L = candSim('lula').cor;
  const F = candSim('flavio').cor;
  const H = W < 500 ? 250 : 290;
  const m = { t: 26, r: 46, b: 28, l: 36 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  let x0 = pts[0].t;
  let x1 = pts[pts.length - 1].t;
  if (x1 - x0 < 20 * 60000) x1 = x0 + 20 * 60000;
  const vals = pts.flatMap((p) => [p.lo, p.hi, p.cont].filter(fin)).concat(pts.map((p) => p.lula));
  const longe = Math.max(2, ...vals.map((v) => Math.abs(v - 50))) + 0.6;
  const meia = longe <= 3 ? 3 : longe <= 5 ? 5 : longe <= 8 ? 8 : Math.ceil(longe / 5) * 5;
  const yLo = 50 - meia;
  const yHi = 50 + meia;
  const sx = (v) => m.l + ((v - x0) / (x1 - x0)) * iw;
  const sy = (v) => m.t + ih - ((clamp(v, yLo, yHi) - yLo) / (yHi - yLo)) * ih;
  const n2 = (v) => Math.round(v * 10) / 10;
  const out = [];
  const passo = meia <= 3 ? 1 : meia <= 5 ? 1 : meia <= 8 ? 2 : 5;
  for (let v = Math.ceil(yLo / passo) * passo; v <= yHi + 1e-9; v += passo) {
    const y = n2(sy(v));
    out.push(`<line class="g" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text class="tk" x="${m.l - 6}" y="${n2(y + 3.5)}" text-anchor="end">${v}%</text>`);
  }
  out.push(`<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${n2(sy(50))}" y2="${n2(sy(50))}"/>`);
  out.push(`<line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`);
  // marcas de hora (de meia em meia hora, ou de hora em hora em telas estreitas)
  const intervalo = (x1 - x0) / 60000 > 150 || W < 420 ? 60 : 30;
  const primeiro = Math.ceil(x0 / (intervalo * 60000)) * intervalo * 60000;
  for (let t = primeiro; t <= x1; t += intervalo * 60000) {
    const x = n2(sx(t));
    out.push(`<line class="ax" x1="${x}" x2="${x}" y1="${H - m.b}" y2="${H - m.b + 4}"/><text class="tk" x="${x}" y="${H - m.b + 17}" text-anchor="middle">${C.fHora(t)}</text>`);
  }
  // faixa de 80% de Lula e, espelhada, a de Flávio
  const faixa = (lado) => {
    const sup = pts.filter((p) => fin(p.lo) && fin(p.hi));
    if (sup.length < 2) return '';
    const f = (v) => (lado === 'lula' ? v : 100 - v);
    const cima = sup.map((p) => `${n2(sx(p.t))},${n2(sy(f(lado === 'lula' ? p.hi : p.lo)))}`);
    const baixo = sup.map((p) => `${n2(sx(p.t))},${n2(sy(f(lado === 'lula' ? p.lo : p.hi)))}`).reverse();
    return `<polygon class="sim-band" points="${cima.concat(baixo).join(' ')}" style="--c:${lado === 'lula' ? L : F}"/>`;
  };
  out.push(faixa('lula'), faixa('flavio'));
  const caminho = (fn) => {
    const ok = pts.filter((p) => fin(fn(p)));
    return ok.map((p, i) => `${i ? 'L' : 'M'}${n2(sx(p.t))},${n2(sy(fn(p)))}`).join('');
  };
  out.push(`<path class="ln trac" d="${caminho((p) => p.cont)}" style="--c:${L}" opacity="0.55"/>`);
  out.push(`<path class="ln trac" d="${caminho((p) => (fin(p.cont) ? 100 - p.cont : null))}" style="--c:${F}" opacity="0.55"/>`);
  out.push(`<path class="ln" d="${caminho((p) => p.lula)}" style="--c:${L}"/>`);
  out.push(`<path class="ln" d="${caminho((p) => 100 - p.lula)}" style="--c:${F}"/>`);
  const ult = pts[pts.length - 1];
  const xu = n2(sx(ult.t));
  const yl = sy(ult.lula);
  const yf = sy(100 - ult.lula);
  const sep = Math.abs(yl - yf) < 16 ? (16 - Math.abs(yl - yf)) / 2 : 0;
  const [ylT, yfT] = yl < yf ? [yl - sep, yf + sep] : [yl + sep, yf - sep];
  out.push(`<circle class="mk" cx="${xu}" cy="${n2(yl)}" r="4" style="--c:${L}"/><circle class="mk" cx="${xu}" cy="${n2(yf)}" r="4" style="--c:${F}"/>`);
  out.push(`<text class="rot fim" x="${xu + 7}" y="${n2(ylT + 4)}" style="fill:${tema().lulaTexto}">${C.fNum(ult.lula, 1)}</text><text class="rot fim" x="${xu + 7}" y="${n2(yfT + 4)}" style="fill:${tema().flavioTexto}">${C.fNum(100 - ult.lula, 1)}</text>`);
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${out.join('')}</svg>`;
  if (el._svg !== svg) {
    el._svg = svg;
    el.innerHTML = svg;
  }
  const r = rot();
  htmlEm(
    '[data-sim-leg]',
    C.h`<span><i class="lk" style="--c:${L}"></i>${r.lula}, projeção</span><span><i class="lk" style="--c:${F}"></i>${r.flavio}, projeção</span><span><i class="lk trac" style="--c:${C.cand('lula').cor}"></i>contagem até a hora</span><span><i class="sim-band-l"></i>faixa de 80%</span>`,
  );
}

/* ================================================================ modos */

function pararTimers() {
  for (const t of S.timers) clearInterval(t);
  S.timers = [];
}

function modoInicial() {
  const q = C.params;
  if (q.get('sim') !== null || q.get('simdemo') !== null) return 'sim';
  if (q.get('simteste') !== null || q.get('simulador')) return 'teste';
  return null;
}

async function ciclo() {
  if (S.modo === 'sim') return;
  const fe = C.msDe(C.dados()?.eleicao?.fechamento) ?? C.msDe(CFG.fechamento);
  // Fora da noite não há o que ler: nada de pedido ao ramo (salvo o teste pedido na URL).
  if (!aceitaTeste() && Date.now() < C.msDe(CFG.inicio)) {
    if (S.esqueleto !== 'pre') {
      S.modo = 'pre';
      montar();
    }
    return;
  }
  const d = await lerArquivo();
  if (d) {
    S.doc = d;
    S.docEm = Date.now();
    if (S.modo !== 'teste') S.modo = 'vivo';
    atualizar();
    publicar(d);
    return;
  }
  if (S.modo === 'teste') {
    if (!S.doc) montarEspera();
    return;
  }
  if (S.doc && S.modo === 'vivo') {
    atualizar(); // falhou esta leitura: fica a anterior, com o aviso de velho quando passar de 3 min
    return;
  }
  const novo = Date.now() < fe ? 'pre' : 'espera';
  if (S.modo !== novo || S.esqueleto !== novo) {
    S.modo = novo;
    montar();
  }
}
// Repassa o simulador.json lido à apuração por estado (apuracao.js), que o usa em dois lugares: no destaque
// "transferência dos votos do 1º turno" e no detalhe de cada estado. Chega com a hora em que foi gerado
// (gerado_ms) e só da leitura real ou de teste: a demonstração de 2022 (modo 'sim') nunca é repassada.
function publicar(d) {
  if (S.modo === 'sim' || !d) return;
  const det = { doc: d, em: Date.now(), modo: S.modo, maduro: maduro(d) };
  window.__radar2tSimulador = det;
  try {
    window.dispatchEvent(new CustomEvent('radar2t:simulador', { detail: det }));
  } catch {
    /* sem CustomEvent: a apuração lê window.__radar2tSimulador ao carregar */
  }
}
function montarEspera() {
  S.raiz.innerHTML = C.emHtml(esqueletoPre());
  S.esqueleto = 'espera';
}

function ligarVivo() {
  pararTimers();
  ciclo();
  S.timers.push(setInterval(ciclo, CFG.cadaMs));
  S.timers.push(
    setInterval(() => {
      S.rot += 1;
      if (S.modo === 'vivo' || S.modo === 'teste') atualizar();
    }, CFG.rotacaoMs),
  );
}

async function ligarSim() {
  pararTimers();
  S.modo = 'sim';
  S.raiz.innerHTML = C.emHtml(C.h`<section class="bloco sim"><p class="sobre">Simulador do resultado final</p><p class="estado">Carregando a simulação…</p></section>`);
  S.esqueleto = null;
  const demo = await lerDemo();
  if (!demo) {
    S.raiz.innerHTML = C.emHtml(C.h`<section class="bloco sim"><p class="sobre">Simulador do resultado final</p>${C.lacunaBloco(`A simulação não carregou: ${S.demoErro || 'falha ao ler a demonstração'}. Tente de novo em instantes.`)}<div class="ap-pre-acoes"><button type="button" class="botao-link" data-sim="sair">Voltar</button></div></section>`);
    return;
  }
  S.quadro = 0;
  S.simInicio = Date.now();
  S.simFim = false;
  montar();
  atualizar();
  S.timers.push(setInterval(passoSim, CFG.simPassoMs));
  S.timers.push(setInterval(() => (S.rot += 1), CFG.rotacaoMs));
}

function passoSim() {
  const q = arr(S.demo?.quadros);
  if (!q.length) return;
  const f = clamp((Date.now() - S.simInicio) / CFG.simMs, 0, 1);
  // anda pelo tempo da noite de 2022, não pelo número do quadro
  const t0 = q[0].gerado_ms;
  const t1 = q[q.length - 1].gerado_ms;
  const alvo = t0 + (t1 - t0) * f;
  let i = 0;
  while (i + 1 < q.length && q[i + 1].gerado_ms <= alvo) i++;
  if (i !== S.quadro) {
    S.quadro = i;
    atualizar();
  }
  if (f >= 1 && !S.simFim) {
    S.simFim = true;
    S.quadro = q.length - 1;
    atualizar();
    pararTimers();
  }
}

function sairSim() {
  pararTimers();
  const fe = C.msDe(C.dados()?.eleicao?.fechamento) ?? C.msDe(CFG.fechamento);
  S.modo = aceitaTeste() ? 'teste' : S.doc && !S.doc.teste ? 'vivo' : Date.now() < fe ? 'pre' : 'espera';
  if (S.modo === 'vivo' || (S.modo === 'teste' && S.doc)) atualizar();
  else montar();
  ligarVivo();
}

/* ================================================================ eventos */

function abrirExplica(termo) {
  const dlg = document.getElementById('folha');
  const tit = document.getElementById('folha-tit');
  const txt = document.getElementById('folha-txt');
  if (!dlg || !tit || !txt) return;
  const nomes = { simulador: 'Simulador do resultado final', faixa: 'Faixa e chance', transferencia: 'Transferência de votos', virada: 'Virada por estado', ordem: 'Viés de ordem das seções' };
  tit.textContent = nomes[termo] || termo;
  txt.textContent = EXPLICA[termo] || '';
  if (typeof dlg.showModal === 'function') {
    if (!dlg.open) dlg.showModal();
  } else dlg.setAttribute('open', '');
}

function aoClicar(e) {
  const alvo = e.target instanceof Element ? e.target : null;
  if (!alvo || !S.raiz?.contains(alvo)) return;
  const bi = alvo.closest('[data-sim-termo]');
  if (bi) {
    e.preventDefault();
    abrirExplica(bi.dataset.simTermo);
    return;
  }
  const b = alvo.closest('[data-sim]');
  if (b) {
    const a = b.dataset.sim;
    if (a === 'ver' || a === 'reiniciar') {
      ligarSim();
      S.raiz.scrollIntoView({ block: 'start', behavior: reduz() ? 'auto' : 'smooth' });
    } else if (a === 'sair') {
      if (S.modo === 'teste') {
        const u = new URL(location.href);
        u.searchParams.delete('simteste');
        u.searchParams.delete('simulador');
        history.replaceState(null, '', u);
      }
      sairSim();
    } else if (a === 'leais') {
      S.mostrarLeais = !S.mostrarLeais;
      const d = docAtual();
      if (d) renderTransf(d);
    } else if (a === 'fechar-uf') {
      S.ufSel = null;
      const d = docAtual();
      if (d) renderMapa(d);
    }
    return;
  }
  const uf = alvo.closest('[data-sim-ufb]');
  if (uf) {
    S.ufSel = S.ufSel === uf.dataset.simUfb ? null : uf.dataset.simUfb;
    const d = docAtual();
    if (d) renderMapa(d);
  }
}

// A simulação da apuração (botão dela ou ?sim=1) liga a deste bloco também.
function observarApuracao() {
  const ver = () => {
    const ativa = document.body.classList.contains('com-faixa-sim');
    if (ativa && !S.apurSim && S.modo !== 'sim' && S.visivel) ligarSim();
    S.apurSim = ativa;
  };
  try {
    new MutationObserver(ver).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  } catch {
    /* sem observador: o botão deste bloco continua funcionando */
  }
}

function observarVisibilidade(painel) {
  const ver = () => {
    const vis = !painel || !painel.hidden;
    if (vis === S.visivel) return;
    S.visivel = vis;
    if (vis) {
      if (S.modo === 'sim') {
        if (!S.timers.length && !S.simFim) {
          S.timers.push(setInterval(passoSim, CFG.simPassoMs));
          S.timers.push(setInterval(() => (S.rot += 1), CFG.rotacaoMs));
        }
        atualizar();
      } else ligarVivo();
    } else if (S.modo !== 'sim') pararTimers();
  };
  ver();
  if (painel) {
    try {
      new MutationObserver(ver).observe(painel, { attributes: true, attributeFilter: ['hidden'] });
    } catch {
      /* ignora */
    }
  }
  window.addEventListener('resize', () => {
    clearTimeout(S.tRes);
    S.tRes = setTimeout(desenharGraf, 150);
  });
}

/* ================================================================== CSS */

function estilos() {
  if (document.getElementById('sim-css')) return;
  const s = document.createElement('style');
  s.id = 'sim-css';
  s.textContent = `
.sim-cab { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.sim-cab .sobre { margin: 0; }
.sim-selo { margin: 0; font-size: 11.5px; font-weight: 650; color: var(--tinta-3); letter-spacing: 0.02em; }
.sim-selo.vivo::before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: var(--vivo); vertical-align: 1px; animation: simPulso 2s ease-in-out infinite; }
@keyframes simPulso { 50% { opacity: 0.25; } }
.sim-faixa { margin: 12px 0 4px; }
.sim-aviso { margin: 12px 0 0; padding: 9px 12px; border: 1px solid var(--alerta-borda); border-radius: 10px; background: var(--alerta-fundo); color: var(--alerta); font-size: 13px; line-height: 1.45; }
.sim-aviso[hidden] { display: block; visibility: hidden; }
.sim-aviso { min-height: calc(2 * 1.45 * 13px + 20px); }
@media (max-width: 359px) { .sim-aviso { min-height: calc(3 * 1.45 * 13px + 20px); } }
.sim.sim-velho .sim-hero, .sim.sim-velho .sim-barra { opacity: 0.6; }
.sim-hero { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
.sim-lado { min-width: 0; padding: 12px 12px 12px; border: 1px solid var(--linha); border-radius: 14px; background: var(--cartao); }
.sim-lado .ap-quem .foto-wrap { width: 44px; height: 44px; flex: none; box-shadow: 0 0 0 2px var(--cartao), 0 0 0 4px var(--c, var(--linha-2)); }
.sim-lado .ap-quem .foto { width: 44px; height: 44px; }
.sim-lado .ap-quem .foto-ini { font-size: 14px; }
.sim-rot { margin: 12px 0 0; font-size: 11px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--tinta-2); }
.sim-num { margin: 0; font-size: 40px; line-height: 1.05; font-weight: 790; letter-spacing: -0.03em; color: var(--ct, var(--tinta)); font-variant-numeric: tabular-nums; }
.sim-num small { font-size: 20px; font-weight: 700; margin-left: 1px; }
.sim-faixa-txt { margin: 2px 0 0; font-size: 12.5px; color: var(--tinta-2); font-variant-numeric: tabular-nums; }
.sim-chance { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin: 10px 0 0; font-size: 12px; color: var(--tinta-2); }
.sim-chance b { padding: 3px 9px; border-radius: 999px; font-size: 14px; font-weight: 760; background: var(--suave-2); transition: background-color 1.2s ease, color 1.2s ease; font-variant-numeric: tabular-nums; }
@media (max-width: 520px) { body:not(.tv) .sim-chance { min-height: 36px; } } /* no celular a pílula às vezes empurra o rótulo para duas linhas: a altura já fica reservada */
.sim-barra { position: relative; display: flex; gap: 2px; height: 12px; margin: 14px 0 0; }
.sim-barra span { flex: 50 1 0px; min-width: 2px; background: var(--linha-2); transition: flex-grow 1s ease, background-color 1s ease; }
.sim-barra span:first-of-type { border-radius: 6px 0 0 6px; }
.sim-barra span:last-of-type { border-radius: 0 6px 6px 0; }
.sim-barra i { position: absolute; left: 50%; top: -5px; bottom: -5px; border-left: 2px solid var(--tinta); transform: translateX(-1px); }
.sim-barra b { position: absolute; top: -3px; bottom: -3px; border: 1.5px solid var(--tinta-2); border-radius: 4px; background: color-mix(in srgb, var(--tinta) 12%, transparent); transition: left 1s ease, width 1s ease; pointer-events: none; }
.sim-modelado { margin: 10px 0 14px; font-size: 12px; line-height: 1.45; color: var(--tinta-3); }
.sim-ins { position: relative; margin-top: 2px; }
.sim-ins > li.saindo { position: absolute; left: 0; right: 0; }
body:not(.tv) .sim-ins.dois { min-height: 190px; }
.sim-transf { display: grid; gap: 12px; }
.sim-tl { min-width: 0; }
.sim-tl-cab { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font-size: 13.5px; }
.sim-tl-rot { font-weight: 650; min-width: 0; }
.sim-tl-n { margin-left: auto; font-size: 12px; color: var(--tinta-3); white-space: nowrap; }
.sim-mini { display: inline-flex; flex: none; }
.sim-mini img { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 1.5px var(--cartao); background: var(--suave-2); }
.sim-mini img + img { margin-left: -6px; }
.sim-tb { display: flex; gap: 2px; height: 14px; overflow: hidden; border-radius: 7px; background: var(--suave-2); }
.sim-tb span { min-width: 2px; background: var(--c); transition: flex-grow 1s ease; }
.sim-tl-num { display: flex; flex-wrap: wrap; gap: 2px 14px; margin: 6px 0 0; font-size: 13px; }
.sim-tl-num span { display: inline-flex; align-items: center; gap: 5px; }
.sim-tl-num b { font-variant-numeric: tabular-nums; }
.sim-tl-out { color: var(--tinta-3); font-size: 12px; }
.sim-tl-ant { display: flex; flex-wrap: wrap; gap: 2px 12px; margin: 2px 0 0; font-size: 12px; color: var(--tinta-3); }
.sim-mais { appearance: none; margin: 10px 0 0; padding: 0; border: 0; background: none; font: inherit; font-size: 13px; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; color: var(--tinta-2); }
.sim-graf { min-height: 120px; }
.graf .sim-band { fill: var(--c); fill-opacity: 0.13; stroke: none; }
.sim-leg { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 0 0; font-size: 12px; color: var(--tinta-3); }
.sim-leg span { display: inline-flex; align-items: center; gap: 6px; }
.sim-band-l { display: inline-block; width: 18px; height: 10px; border-radius: 2px; background: color-mix(in srgb, var(--tinta) 18%, transparent); }
.sim-virar-t { margin: 0; font-size: 14px; line-height: 1.5; }
.sim-regua { position: relative; height: 12px; margin: 14px 0 0; border-radius: 6px; background: linear-gradient(90deg, var(--suave-2), var(--suave-2)); }
.sim-regua .r-50 { position: absolute; left: 50%; top: -4px; bottom: -4px; border-left: 1.5px dashed var(--tinta-3); }
.sim-regua i { position: absolute; top: -4px; width: 4px; height: 20px; border-radius: 2px; transform: translateX(-2px); transition: left 1s ease; }
.sim-regua .r-esp { background: var(--c); }
.sim-regua .r-pre { background: var(--tinta); }
.sim-regua-leg { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 8px 0 0; font-size: 12px; color: var(--tinta-3); }
.sim-regua-leg span { display: inline-flex; align-items: center; gap: 6px; }
.sim-regua-leg i { display: inline-block; width: 4px; height: 12px; border-radius: 2px; }
.sim-regua-leg .r-esp-l { background: var(--c); }
.sim-regua-leg .r-pre-l { background: var(--tinta); }
.sim-cid td small { display: block; }
.sim-cid td .mc { margin-right: 2px; vertical-align: 0; }
.sim-pre-g { margin: 0; font-size: 26px; line-height: 1.15; font-weight: 770; letter-spacing: -0.02em; }
.sim-pre-r { margin: 8px 0 6px; font-size: 14px; line-height: 1.5; color: var(--tinta-2); }
.sim-pre-l { margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.55; color: var(--tinta-2); }
@media (max-width: 380px) { .sim-num { font-size: 34px; } .sim-tl-n { display: none; } }
body.tv #ap-simulador { display: none; }
`;
  document.head.appendChild(s);
}

/* ============================================================== início */

export function iniciar(ctx) {
  C = ctx;
  S.raiz = ctx.raiz;
  estilos();
  document.addEventListener('click', aoClicar);
  observarApuracao();
  const inicial = modoInicial();
  if (inicial === 'sim') {
    S.visivel = !ctx.painel || !ctx.painel.hidden;
    ligarSim();
    observarVisibilidade(ctx.painel);
  } else {
    S.modo = inicial; // 'teste' ou null (decide na primeira leitura)
    if (!S.modo) {
      const fe = C.msDe(C.dados()?.eleicao?.fechamento) ?? C.msDe(CFG.fechamento);
      S.modo = Date.now() < fe ? 'pre' : 'espera';
      montar();
    }
    observarVisibilidade(ctx.painel);
  }
  return {
    redesenhar: desenharGraf,
  };
}
