/* Radar Eleitoral · 2º turno · APURAÇÃO AO VIVO (o "processador" da noite de 25/10)
 *
 * Módulo ES sem dependências, carregado pelo app.js com import dinâmico.
 * - Lê o TSE direto do navegador (CORS liberado): Brasil a cada 20 s e cada UF
 *   a cada ~60 s, uma por vez (uma a cada 2 s), nunca as 28 em paralelo.
 * - Projeta o resultado final UF por UF: o que já foi apurado + o que falta,
 *   misturando o observado na UF com a prévia (modelo_uf do JSON; se faltar,
 *   o cálculo de reserva descrito em montarBase).
 * - Chance de vitória por Monte Carlo (2.000 sorteios, sementes fixas para o
 *   número não "tremer" entre leituras).
 * - Antes das 17h de 25/10: contagem até o fechamento, prévia por estado e o
 *   botão da SIMULAÇÃO (números fictícios, faixa fixa na tela).
 * - Teste com o 1º turno, que tem o mesmo formato: ?eleicao=6257.
 *   Simulação direta: ?sim=1 (ou ?sim=<semente> para repetir a mesma noite).
 */

/* ============================================================ constantes */

export const MODELO = {
  // Eleição do 2º turno no TSE (o 1º turno é a 6257, útil para testar o leitor).
  ELEICAO: '6258',
  TSE: 'https://resultados.tse.jus.br/oficial/ele2026',
  // sqcand de cada candidato nos arquivos do TSE.
  SQ: { lula: '280002542548', flavio: '280002551544' },
  // Abstenção nacional do 1º turno de 2026 (TSE: 21,08%). Só entra no cálculo de
  // reserva do comparecimento, se o JSON não trouxer primeiro_turno.abstencao_pct.
  ABST_T1_NACIONAL: 21.08,
  // Peso da observação da própria UF: w = f / (f + K_MISTURA), com f = fração do
  // eleitorado da UF já totalizada. Com 15% apurado, observação e prévia pesam igual.
  K_MISTURA: 0.15,
  // Swing observado entra na prévia com peso g = F / (F + K_SWING), F = fração
  // do eleitorado do país já totalizada (10% apurado: metade do swing).
  K_SWING: 0.1,
  // Incerteza nacional em pontos de participação no par, se o JSON não trouxer
  // modelo_nacional.sigma_pp nem media.sigma_pp. Multiplicada pela fração que falta.
  SIGMA_NACIONAL: 1.5,
  // Incerteza própria de cada UF (pp), se modelo_uf não trouxer sigma_uf_pp.
  // Multiplicada por √(1 − f): some à medida que a UF é apurada.
  SIGMA_UF: 2.5,
  // Brancos e nulos (fração do comparecimento) quando nada for informado.
  BRANCOS_NULOS: 0.05,
  // Monte Carlo: sorteios e semente fixa (mesmos sorteios a cada leitura).
  SORTEIOS: 2000,
  SEMENTE: 20261025,
  // Educação com o TSE.
  CADA_BR_MS: 20000,
  PASSO_UF_MS: 2000,
  // Simulação: 3h30 de apuração em 2 minutos, um passo por segundo.
  SIM_MS: 120000,
  SIM_PASSO_MS: 1000,
  SIM_HORAS: 3.5,
  // Por quanto tempo o insight "a liderança trocou de mãos" fica no ar.
  TROCA_VALE_MS: 30 * 60 * 1000,
};

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO', 'ZZ'];
const NOME_UF = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul',
  MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins', ZZ: 'Exterior',
};
const REGIAO = {
  AC: 'N', AM: 'N', AP: 'N', PA: 'N', RO: 'N', RR: 'N', TO: 'N',
  AL: 'NE', BA: 'NE', CE: 'NE', MA: 'NE', PB: 'NE', PE: 'NE', PI: 'NE', RN: 'NE', SE: 'NE',
  DF: 'CO', GO: 'CO', MS: 'CO', MT: 'CO',
  ES: 'SE', MG: 'SE', RJ: 'SE', SP: 'SE',
  PR: 'S', RS: 'S', SC: 'S',
  ZZ: 'EX',
};
// Mapa de ladrilhos: [coluna, linha] numa grade de 6 × 8, na posição geográfica aproximada.
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
// Reserva de eleitorado por UF, só se o JSON não trouxer: participação de cada UF
// no eleitorado de 2022 (TSE) × eleitorado de 2026 do arquivo do 2º turno (158.745.502).
const ELEITORADO_2026 = 158745502;
const PARTE_2022 = {
  SP: 0.2216, MG: 0.1041, RJ: 0.082, BA: 0.0722, RS: 0.0549, PR: 0.0542, PE: 0.0449, CE: 0.0436,
  PA: 0.0389, SC: 0.0351, MA: 0.0323, GO: 0.0315, PB: 0.0202, ES: 0.0187, AM: 0.0169, PI: 0.0164,
  RN: 0.0163, MT: 0.0158, AL: 0.0151, DF: 0.0141, MS: 0.0126, SE: 0.011, RO: 0.0078, TO: 0.0068,
  ZZ: 0.0045, AC: 0.0038, AP: 0.0035, RR: 0.0023,
};
// Simulação: quando cada região começa e quanto tempo leva (fração da noite simulada).
const RITMO_SIM = { S: [0.0, 0.45], SE: [0.02, 0.55], CO: [0.05, 0.62], NE: [0.12, 0.7], N: [0.15, 0.75], EX: [0.4, 0.55] };

// Cores só para a chance de vitória (não são cores de partido).
const VERDE = '#0b7a3b';
const VERMELHO = '#b42318';
const NEUTRO = '#f3f3ef';

/* ================================================================ estado */

let C = null; // contexto vindo do app.js (helpers e dados)
const A = {
  raiz: null,
  ativo: false,
  modo: null, // 'pre' | 'vivo' | 'sim'
  eleicao: MODELO.ELEICAO,
  teste: false,
  base: null,
  br: null,
  brErro: null,
  brEm: 0,
  proxBR: 0,
  ufs: new Map(),
  ufErros: new Map(),
  ufIdx: 0,
  res: null,
  serie: [],
  trocas: [],
  ufSel: null,
  rot: 0,
  timers: [],
  sim: null,
  semente: null,
  z: null,
};

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const reduzMovimento = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/* ============================================================ utilidades */

// Número do TSE: texto, com vírgula decimal ("47,03"); inteiros sem separador.
function pBR(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}
// "25/10/2026" + "19:42:10" no horário de Brasília (UTC−3) → ms.
function msTSE(dt, ht) {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(dt || '').trim());
  const h = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(ht || '').trim());
  if (!d || !h) return null;
  return Date.UTC(+d[3], +d[2] - 1, +d[1], +h[1] + 3, +h[2], +(h[3] || 0));
}
function rngMulberry(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
function hexRgb(hx) {
  let x = String(hx).replace('#', '');
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  const n = parseInt(x.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function misturar(a, b, t) {
  const p = hexRgb(a);
  const q = hexRgb(b);
  return p.map((v, i) => Math.round(v + (q[i] - v) * t));
}
const rgb = (c) => `rgb(${c.join(',')})`;
const claro = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.55;
// Do neutro ao verde forte (quem ganha chance) ou ao vermelho (quem perde).
function corChance(p) {
  if (p === null || p === undefined || !Number.isFinite(p)) return { fundo: rgb(hexRgb(NEUTRO)), tinta: '#0b0b0b', forca: 0 };
  const forca = Math.pow(Math.min(1, Math.abs(p - 0.5) * 2), 0.8);
  const c = misturar(NEUTRO, p >= 0.5 ? VERDE : VERMELHO, forca);
  return { fundo: rgb(c), tinta: claro(c) ? '#0b0b0b' : '#ffffff', forca };
}
// Ladrilho: cor do partido de quem lidera, intensidade pela margem.
function corLadrilho(corPartido, margem, prev) {
  const t = prev ? 0.16 + Math.min(0.24, margem * 1.2) : 0.22 + Math.min(0.78, (margem / 0.3) * 0.78);
  const c = misturar('#ffffff', corPartido, t);
  return { fundo: rgb(c), tinta: claro(c) ? '#0b0b0b' : '#ffffff' };
}
function animarNumero(el, para, fmt) {
  if (!el) return;
  const de = el._v;
  el._v = para;
  if (de === undefined || de === para || reduzMovimento() || !Number.isFinite(de) || !Number.isFinite(para)) {
    el.textContent = fmt(para);
    return;
  }
  const t0 = performance.now();
  const dur = 900;
  cancelAnimationFrame(el._raf);
  const passo = (agora) => {
    const k = Math.min(1, (agora - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(de + (para - de) * e);
    if (k < 1) el._raf = requestAnimationFrame(passo);
  };
  el._raf = requestAnimationFrame(passo);
}
const $ = (sel) => A.raiz?.querySelector(sel);
const $$ = (sel) => Array.from(A.raiz?.querySelectorAll(sel) || []);
function texto(sel, valor) {
  const el = $(sel);
  if (el && el.textContent !== valor) el.textContent = valor;
}
function htmlEm(sel, conteudo) {
  const el = $(sel);
  if (!el) return;
  const s = C.emHtml(conteudo);
  if (el._h !== s) {
    el._h = s;
    el.innerHTML = s;
  }
}
const pct1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${C.fNum(v, 1)}%`);
// Apurado com duas casas, como o TSE publica.
const pct2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${C.fNum(v, 2)}%`);
const chanceTxt = (p) => {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  const v = p * 100;
  if (v > 0 && v < 1) return '<1%';
  if (v > 99 && v < 100) return '>99%';
  return `${C.fNum(v, 0)}%`;
};
function votosCurto(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) {
    const r = Math.round((a / 1e6) * 10) / 10;
    return `${C.fNum(r, 1)} ${r < 2 ? 'milhão' : 'milhões'}`;
  }
  if (a >= 1e3) return `${C.fNum(a / 1e3, 0)} mil`;
  return C.fNum(a, 0);
}

/* ================================================= base: a prévia por UF */

/* Prévia de cada UF, antes de contar.
 * 1) modelo_uf do JSON (calculado em Python com o 1º turno, o padrão de cada UF
 *    entre os turnos de 2002 a 2022, a tendência e o tamanho das amostras).
 * 2) Reserva, se modelo_uf faltar: participação de Lula no par = 1º turno da UF
 *    + deslocamento nacional (média das pesquisas no par − 1º turno nacional no
 *    par); comparecimento = (1 − abstenção da UF no 1º turno) − (abstenção
 *    estimada nacional − abstenção nacional do 1º turno); brancos e nulos = os
 *    do 1º turno na UF.
 * 3) Sem nada por UF: a média nacional em todas, com lacuna declarada. */
function montarBase(d) {
  const lac = [];
  const ufs = new Map();
  const mn = obj(d?.modelo_nacional);
  const media = obj(d?.media);
  const t1 = obj(d?.primeiro_turno);
  const vL = C.num(media?.validos?.lula);
  const vF = C.num(media?.validos?.flavio);
  const mediaPar = vL !== null && vF !== null && vL + vF > 0 ? vL / (vL + vF) : null;
  const nacPar = C.num(mn?.lula_par) !== null ? C.num(mn.lula_par) / 100 : mediaPar;
  if (nacPar === null) lac.push('Sem média das pesquisas: a prévia nacional usa 50% para cada um.');
  const sigmaNac = C.num(mn?.sigma_pp) ?? C.num(media?.sigma_pp) ?? null;
  if (sigmaNac === null) lac.push(`Sem incerteza da média (sigma): usando ${C.fNum(MODELO.SIGMA_NACIONAL, 1)} ponto.`);
  const abstEst = C.num(d?.projecao?.abstencao_estimada_pct);
  const abstT1 = C.num(t1?.abstencao_pct) ?? MODELO.ABST_T1_NACIONAL;
  const desloc = abstEst !== null ? (abstEst - abstT1) / 100 : 0;
  if (abstEst === null) lac.push('Sem abstenção estimada: o comparecimento de cada estado repete o do 1º turno.');
  const padrao = {
    prior: nacPar ?? 0.5,
    comp: clamp(1 - (abstEst ?? abstT1) / 100, 0.3, 1),
    bn: MODELO.BRANCOS_NULOS,
    sigma: MODELO.SIGMA_UF,
    elasticidade: null,
    eleitorado: null,
    t1Lula: null,
  };
  // 1º turno por UF (serve para "onde cada um venceu" e para a reserva)
  const porUF = new Map();
  for (const u of arr(t1?.por_uf)) {
    const uf = String(u?.uf || '').toUpperCase();
    if (UFS.includes(uf)) porUF.set(uf, u);
  }
  const t1L = C.num(arr(t1?.candidatos).find((c) => c?.id === 'lula')?.validos_pct);
  const t1F = C.num(arr(t1?.candidatos).find((c) => c?.id === 'flavio')?.validos_pct);
  const t1Par = t1L !== null && t1F !== null && t1L + t1F > 0 ? t1L / (t1L + t1F) : null;
  const deltaNac = mediaPar !== null && t1Par !== null ? mediaPar - t1Par : 0;

  const modelo = new Map();
  for (const m of arr(d?.modelo_uf)) {
    const uf = String(m?.uf || '').toUpperCase();
    if (UFS.includes(uf)) modelo.set(uf, m);
  }
  let origem = modelo.size ? 'modelo_uf' : porUF.size ? 'reserva' : 'nacional';
  if (origem === 'reserva') lac.push('Prévia por estado calculada pela página (reserva): o JSON não trouxe modelo_uf.');
  if (origem === 'nacional') lac.push('Sem prévia por estado: todos os estados partem da média nacional.');
  let faltaUF = 0;
  for (const uf of UFS) {
    const m = modelo.get(uf);
    const p = porUF.get(uf);
    const pl = C.num(p?.lula);
    const pf = C.num(p?.flavio);
    const t1ParUF = pl !== null && pf !== null && pl + pf > 0 ? pl / (pl + pf) : null;
    const b = { ...padrao, t1Lula: t1ParUF, eleitorado: C.num(m?.eleitorado) ?? C.num(p?.eleitorado), fonte: 'média nacional' };
    if (m) {
      const pr = C.num(m.prior_lula_par);
      const cp = C.num(m.prior_comparecimento);
      const bn = C.num(m.prior_brancos_nulos);
      if (pr !== null) b.prior = clamp(pr / 100, 0.01, 0.99);
      if (cp !== null) b.comp = clamp(cp / 100, 0.2, 1);
      if (bn !== null) b.bn = clamp(bn / 100, 0, 0.5);
      b.sigma = C.num(m.sigma_uf_pp) ?? MODELO.SIGMA_UF;
      b.elasticidade = C.num(m.elasticidade);
      b.fonte = C.txt(m.fonte) || 'modelo_uf';
    } else if (t1ParUF !== null) {
      b.prior = clamp(t1ParUF + deltaNac, 0.01, 0.99);
      const ab = C.num(p?.abstencao_pct);
      if (ab !== null) b.comp = clamp(1 - ab / 100 - desloc, 0.2, 1);
      const bn = C.num(p?.brancos_nulos_pct);
      if (bn !== null) b.bn = clamp(bn / 100, 0, 0.5);
      b.fonte = 'reserva: 1º turno + deslocamento nacional';
      if (origem === 'modelo_uf') faltaUF += 1;
    } else if (origem !== 'nacional') {
      faltaUF += 1;
    }
    ufs.set(uf, b);
  }
  if (faltaUF) lac.push(`${faltaUF} ${faltaUF === 1 ? 'estado sem prévia própria' : 'estados sem prévia própria'}: partem da média nacional.`);
  let semEleitorado = 0;
  for (const [uf, b] of ufs) {
    if (b.eleitorado === null || b.eleitorado === undefined) {
      b.eleitorado = Math.round(ELEITORADO_2026 * PARTE_2022[uf]);
      semEleitorado += 1;
    }
  }
  if (semEleitorado) lac.push(`Eleitorado de ${semEleitorado} ${semEleitorado === 1 ? 'estado' : 'estados'} aproximado pela divisão de 2022, até o TSE informar.`);
  return {
    ufs,
    origem,
    lacunas: lac,
    nacPar: nacPar ?? 0.5,
    sigmaNac: sigmaNac ?? MODELO.SIGMA_NACIONAL,
    tendencia: C.num(mn?.tendencia_pp_por_dia),
    componentes: mn?.componentes ?? null,
    abstT1,
    abstEst,
    mediaL: vL,
    mediaF: vF,
  };
}

/* ======================================================== leitura do TSE */

function urlTSE(uf) {
  const e = String(A.eleicao).padStart(6, '0');
  const u = uf.toLowerCase();
  return `${MODELO.TSE}/${A.eleicao}/dados/${u}/${u}-c0001-e${e}-u.json`;
}
async function buscarTSE(uf) {
  const r = await fetch(urlTSE(uf), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return lerTSE(await r.json());
}
function lerTSE(j) {
  if (!obj(j)) throw new Error('arquivo do TSE em formato inesperado');
  const s = obj(j.s) || {};
  const e = obj(j.e) || {};
  const v = obj(j.v) || {};
  const cand = new Map();
  for (const ag of arr(j.carg?.[0]?.agr)) for (const p of arr(ag?.par)) for (const c of arr(p?.cand)) cand.set(String(c?.sqcand), c);
  const cl = cand.get(MODELO.SQ.lula);
  const cf = cand.get(MODELO.SQ.flavio);
  if (!cl || !cf) throw new Error('arquivo sem Lula ou sem Flávio');
  return {
    pst: pBR(s.pstn ?? s.pst) ?? 0,
    te: pBR(e.te) ?? 0,
    est: pBR(e.est) ?? 0,
    c: pBR(e.c) ?? 0,
    vb: pBR(v.vb) ?? 0,
    tvn: pBR(v.tvn) ?? 0,
    vv: pBR(v.vv) ?? 0,
    L: pBR(cl.vap) ?? 0,
    F: pBR(cf.vap) ?? 0,
    pL: pBR(cl.pvapn ?? cl.pvap),
    pF: pBR(cf.pvapn ?? cf.pvap),
    tTot: msTSE(j.dt, j.ht),
    tGer: msTSE(j.dg, j.hg),
    em: Date.now(),
  };
}

/* ============================================================ processador */

function normais() {
  if (A.z) return A.z;
  const S = UFS.length + 1;
  const z = new Float64Array(MODELO.SORTEIOS * S);
  const rng = rngMulberry(MODELO.SEMENTE);
  for (let i = 0; i < z.length; i++) z[i] = normal(rng);
  A.z = z;
  return z;
}

function processar() {
  const base = A.base;
  if (!base) return null;
  const linhas = UFS.map((uf) => {
    const b = base.ufs.get(uf);
    const o = A.ufs.get(uf) || null;
    const te = o ? o.te : b.eleitorado ?? 0;
    const est = o ? clamp(o.est, 0, te) : 0;
    const f = te > 0 ? est / te : 0;
    const L = o ? o.L : 0;
    const F = o ? o.F : 0;
    const shareObs = L + F > 0 ? L / (L + F) : null;
    const compObs = o && est > 0 ? o.c / est : null;
    const bnObs = o && o.c > 0 ? (o.vb + o.tvn) / o.c : null;
    return { uf, b, o, te, est, f, L, F, vv: o ? o.vv : 0, shareObs, compObs, bnObs };
  });
  // Swing observado: média, ponderada pelos votos apurados, de (observado − prévia).
  let sn = 0;
  let sd = 0;
  for (const u of linhas) {
    if (u.shareObs === null) continue;
    const peso = u.L + u.F;
    sn += peso * (u.shareObs - u.b.prior);
    sd += peso;
  }
  const swing = sd > 0 ? sn / sd : 0;
  const teTot = linhas.reduce((s, u) => s + u.te, 0);
  const estTot = linhas.reduce((s, u) => s + u.est, 0);
  const fNac = teTot > 0 ? estTot / teTot : 0;
  const g = fNac / (fNac + MODELO.K_SWING);
  let projL = 0;
  let projF = 0;
  let rem = 0;
  let remMax = 0;
  let vvCont = 0;
  for (const u of linhas) {
    const w = u.f / (u.f + MODELO.K_MISTURA);
    u.w = w;
    u.prior = clamp(u.b.prior + g * swing, 0.01, 0.99);
    u.comp = u.compObs !== null ? w * u.compObs + (1 - w) * u.b.comp : u.b.comp;
    u.bn = u.bnObs !== null ? w * u.bnObs + (1 - w) * u.b.bn : u.b.bn;
    u.share = u.shareObs !== null ? w * u.shareObs + (1 - w) * u.prior : u.prior;
    u.rem = Math.max(0, u.te - u.est) * clamp(u.comp, 0, 1) * (1 - clamp(u.bn, 0, 1));
    u.remMax = Math.max(0, u.te - u.est);
    u.projL = u.L + u.rem * u.share;
    u.projF = u.F + u.rem * (1 - u.share);
    u.sig = (u.b.sigma / 100) * Math.sqrt(Math.max(0, 1 - u.f));
    projL += u.projL;
    projF += u.projF;
    rem += u.rem;
    remMax += u.remMax;
    vvCont += u.vv;
  }
  // Apurado oficial: o arquivo Brasil quando houver (é o mais novo); senão a soma das UFs.
  const br = A.br;
  const cont = br
    ? { L: br.L, F: br.F, pst: br.pst, est: br.est, te: br.te, c: br.c, vv: br.vv, pL: br.pL, pF: br.pF, tTot: br.tTot }
    : {
        L: linhas.reduce((s, u) => s + u.L, 0),
        F: linhas.reduce((s, u) => s + u.F, 0),
        pst: fNac * 100,
        est: estTot,
        te: teTot,
        c: linhas.reduce((s, u) => s + (u.o ? u.o.c : 0), 0),
        vv: vvCont,
        pL: null,
        pF: null,
        tTot: null,
      };
  if (cont.pL === null && cont.vv > 0) {
    cont.pL = (cont.L / cont.vv) * 100;
    cont.pF = (cont.F / cont.vv) * 100;
  }
  const lidos = linhas.filter((u) => u.o).length;
  const completo = lidos === UFS.length || A.modo === 'sim';
  const totalVal = vvCont + rem;
  const proj = {
    L: projL,
    F: projF,
    pL: totalVal > 0 ? (projL / totalVal) * 100 : null,
    pF: totalVal > 0 ? (projF / totalVal) * 100 : null,
    parL: projL + projF > 0 ? (projL / (projL + projF)) * 100 : null,
  };
  // Matematicamente definido: quem está atrás não alcança nem com todo o eleitorado que falta.
  const remMaxBR = br ? Math.max(0, br.te - br.est) : remMax;
  const dif = cont.L - cont.F;
  const definido = cont.L + cont.F > 0 && Math.abs(dif) > remMaxBR ? (dif > 0 ? 'lula' : 'flavio') : null;
  const tudo = cont.pst >= 100 || (cont.L + cont.F > 0 && remMaxBR === 0);
  let pL;
  if (tudo || definido) {
    pL = dif > 0 ? 1 : dif < 0 ? 0 : 0.5;
  } else {
    pL = montecarlo(linhas, projL, projF, rem);
  }
  return { linhas, swing, g, fNac, rem, remMax: remMaxBR, cont, proj, pL, definido, tudo, lidos, completo, totalVal };
}

function montecarlo(linhas, projL, projF, rem) {
  const z = normais();
  const S = UFS.length + 1;
  const V = projL + projF;
  if (V <= 0) return 0.5;
  const phi = clamp(rem / V, 0, 1);
  const sNac = (A.base.sigmaNac / 100) * phi;
  const base = projL - projF;
  let vit = 0;
  for (let k = 0; k < MODELO.SORTEIOS; k++) {
    const o = k * S;
    let d = V * sNac * z[o];
    for (let i = 0; i < linhas.length; i++) {
      const u = linhas[i];
      if (u.rem > 0) d += u.rem * u.sig * z[o + 1 + i];
    }
    const m = base + 2 * d;
    vit += m > 0 ? 1 : m === 0 ? 0.5 : 0;
  }
  return vit / MODELO.SORTEIOS;
}

/* ============================================================== insights */

function lider(L, F) {
  return L > F ? 'lula' : F > L ? 'flavio' : null;
}

function calcularInsights(r) {
  const out = [];
  const h = C.h;
  const n = (id) => C.curto(id);
  const c = r.cont;
  const contando = c.pst > 0 && c.pst < 100 && !r.tudo;
  const lc = lider(c.L, c.F);
  const lp = lider(r.proj.L, r.proj.F);
  const agora = A.modo === 'sim' ? A.sim?.relogio ?? Date.now() : Date.now();

  if (A.modo !== 'pre' && c.pst <= 0 && c.L + c.F === 0) {
    out.push({ id: 'aguardando', p: 30, html: h`Aguardando a primeira totalização do TSE. Enquanto isso, vale a prévia de cada estado.` });
  }
  if (r.tudo && c.L + c.F > 0) {
    out.push({
      id: 'concluida',
      p: 100,
      tom: 'forte',
      html:
        c.L >= c.F
          ? h`Apuração concluída: ${n('lula')} <b>${pct2(c.pL)}</b> × ${n('flavio')} <b>${pct2(c.pF)}</b> dos votos válidos. Resultado oficial: TSE.`
          : h`Apuração concluída: ${n('flavio')} <b>${pct2(c.pF)}</b> × ${n('lula')} <b>${pct2(c.pL)}</b> dos votos válidos. Resultado oficial: TSE.`,
    });
  } else if (r.definido) {
    out.push({
      id: 'definido',
      p: 100,
      tom: 'forte',
      html: h`Matematicamente definido: a diferença de <b>${votosCurto(Math.abs(c.L - c.F))}</b> de votos é maior que todo o eleitorado que falta apurar. ${n(r.definido)} não pode mais ser alcançado.`,
    });
  }
  if (contando && lp && lc && lp !== lc) {
    out.push({
      id: 'virada',
      p: 95,
      tom: 'forte',
      html: h`A projeção já aponta <b>${n(lp)}</b>, embora <b>${n(lc)}</b> lidere a contagem.`,
    });
  }
  const troca = A.trocas[A.trocas.length - 1];
  if (troca && agora - troca.t < MODELO.TROCA_VALE_MS) {
    out.push({
      id: `troca-${troca.t}`,
      p: 90,
      html: h`A liderança da contagem trocou de mãos às <b>${C.fHora(troca.t)}</b>, com ${C.fNum(troca.pst, 1)}% apurado: <b>${n(troca.lider)}</b> passou à frente.`,
    });
  }
  if (contando && lc && r.rem > 0) {
    const atras = lc === 'lula' ? 'flavio' : 'lula';
    const def = Math.abs(c.L - c.F);
    const precisa = ((r.rem + def) / (2 * r.rem)) * 100;
    out.push({
      id: 'precisa',
      p: 80,
      html:
        precisa > 100
          ? h`Para virar, ${n(atras)} precisaria de mais votos do que a estimativa dos que ainda faltam contar (<b>${votosCurto(r.rem)}</b>).`
          : h`Para virar, <b>${n(atras)}</b> precisa de <b>${C.fNum(precisa, 1)}%</b> dos votos válidos que faltam.`,
    });
  }
  if (contando && Math.abs(r.swing) >= 0.003 && r.fNac >= 0.03) {
    const quem = r.swing > 0 ? 'lula' : 'flavio';
    out.push({
      id: 'swing',
      p: 70,
      html: h`Swing observado: a apuração está <b>${C.fNum(Math.abs(r.swing) * 100, 1)} ${Math.abs(r.swing) * 100 < 2 ? 'ponto' : 'pontos'}</b> mais favorável a ${n(quem)} do que a prévia indicava, estado por estado.`,
    });
  }
  if (contando) {
    const reg = (lista) => {
      let te = 0;
      let est = 0;
      for (const u of r.linhas) if (lista.includes(REGIAO[u.uf])) {
        te += u.te;
        est += u.est;
      }
      return te > 0 ? (est / te) * 100 : null;
    };
    const ss = reg(['S', 'SE']);
    const nn = reg(['N', 'NE']);
    if (ss !== null && nn !== null && Math.abs(ss - nn) >= 15) {
      const rapido = ss > nn ? 'Sul e Sudeste' : 'Norte e Nordeste';
      const lento = ss > nn ? 'Norte e Nordeste' : 'Sul e Sudeste';
      out.push({
        id: 'ritmo',
        p: 65,
        html: h`${rapido} já totalizaram <b>${C.fNum(Math.max(ss, nn), 0)}%</b> do eleitorado; ${lento}, <b>${C.fNum(Math.min(ss, nn), 0)}%</b>. A contagem ainda não mostra o peso de ${lento}.`,
      });
    }
  }
  if (contando && r.rem > 0) {
    let emLula = 0;
    let comBase = 0;
    for (const u of r.linhas) {
      if (u.b.t1Lula === null) continue;
      comBase += u.rem;
      if (u.b.t1Lula > 0.5) emLula += u.rem;
    }
    if (comBase > 0) {
      out.push({
        id: 'faltam',
        p: 60,
        html: h`Faltam cerca de <b>${votosCurto(r.rem)}</b> de votos válidos; <b>${C.fNum((emLula / comBase) * 100, 0)}%</b> deles em estados onde ${n('lula')} teve mais votos que ${n('flavio')} no 1º turno.`,
      });
    }
    const maior = [...r.linhas].sort((a, b) => b.rem - a.rem)[0];
    if (maior && maior.rem > 0) {
      const liq = maior.rem * (2 * maior.share - 1);
      const quem = liq >= 0 ? 'lula' : 'flavio';
      out.push({
        id: `estoque-${maior.uf}`,
        p: 55,
        html: h`Maior estoque de votos ainda por contar: <b>${maior.uf === 'ZZ' ? 'Exterior' : maior.uf}</b> (${C.fNum(maior.f * 100, 0)}% apurado), deve render <b>+${votosCurto(Math.abs(liq))}</b> a ${n(quem)}.`,
      });
    }
  }
  if (c.pst > 0 && lp) {
    const merc = C.mercados();
    const poly = arr(merc?.fontes).find((f) => f?.id === 'polymarket' && f.status !== 'erro');
    const pPoly = C.num(poly?.candidatos?.[lp]?.prob);
    const med = lp === 'lula' ? A.base.mediaL : A.base.mediaF;
    const proj = lp === 'lula' ? r.proj.parL : r.proj.parL === null ? null : 100 - r.proj.parL;
    out.push({
      id: 'triangulacao',
      p: 50,
      html: h`Triangulação para <b>${n(lp)}</b>: apuração projetada <b>${pct1(proj)}</b> dos válidos · média das pesquisas <b>${pct1(med)}</b> · Polymarket <b>${pPoly !== null ? chanceTxt(pPoly) : 'sem leitura'}</b> de chance.`,
    });
  }
  if (c.pst > 0 && c.est > 0) {
    out.push({
      id: 'comparecimento',
      p: 40,
      html: h`Comparecimento até agora: <b>${C.fNum((c.c / c.est) * 100, 1)}%</b> (1º turno: ${C.fNum(100 - A.base.abstT1, 1)}%).`,
    });
  }
  if (c.pst > 0) {
    const maiorV = [...r.linhas].filter((u) => u.L + u.F > 0).sort((a, b) => Math.abs(b.L - b.F) - Math.abs(a.L - a.F))[0];
    if (maiorV) {
      const quem = maiorV.L >= maiorV.F ? 'lula' : 'flavio';
      out.push({
        id: `vantagem-${maiorV.uf}-${quem}`,
        p: 35,
        html: h`Maior vantagem${r.tudo ? '' : ' até agora'}: <b>${maiorV.uf === 'ZZ' ? 'Exterior' : maiorV.uf}</b>, +${votosCurto(Math.abs(maiorV.L - maiorV.F))} de votos para ${n(quem)}.`,
      });
    }
  }
  return out.sort((a, b) => b.p - a.p);
}

function renderInsights(lista) {
  const ol = $('[data-ap-ins]');
  if (!ol) return;
  const fixos = lista.slice(0, 3);
  const resto = lista.slice(3);
  const mostrar = resto.length ? [...fixos, resto[A.rot % resto.length]] : fixos;
  const ids = new Set(mostrar.map((x) => x.id));
  for (const li of Array.from(ol.children)) {
    if (!ids.has(li.dataset.id) && !li.classList.contains('saindo')) {
      li.classList.add('saindo');
      setTimeout(() => li.remove(), reduzMovimento() ? 0 : 450);
    }
  }
  let ref = null;
  mostrar.forEach((x) => {
    let li = Array.from(ol.children).find((e) => e.dataset.id === x.id && !e.classList.contains('saindo'));
    const s = C.emHtml(x.html);
    if (!li) {
      li = document.createElement('li');
      li.dataset.id = x.id;
      li.className = `ap-in entrando${x.tom === 'forte' ? ' forte' : ''}`;
      li.innerHTML = s;
      li._h = s;
      requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove('entrando')));
    } else if (li._h !== s) {
      li.innerHTML = s;
      li._h = s;
      li.classList.remove('mudou');
      void li.offsetWidth;
      li.classList.add('mudou');
    }
    const alvo = ref ? ref.nextSibling : ol.firstChild;
    if (li !== alvo) ol.insertBefore(li, alvo);
    ref = li;
  });
  const vazio = $('[data-ap-ins-vazio]');
  if (vazio) vazio.hidden = mostrar.length > 0;
}

/* ================================================================ mapa */

function htmlMapa() {
  const h = C.h;
  const lad = UFS.filter((u) => u !== 'ZZ').map((uf) => {
    const [c, l] = GRADE[uf];
    return h`<button type="button" class="lad" data-uf="${uf}" style="grid-column:${c};grid-row:${l}" aria-label="${NOME_UF[uf]}"><span class="lad-uf">${uf}</span><span class="lad-v" data-v></span><span class="lad-barra"><i data-b></i></span></button>`;
  });
  return h`<div class="ap-mapa" role="group" aria-label="Mapa de ladrilhos dos estados">
    ${lad}
    <button type="button" class="lad lad-ext" data-uf="ZZ" style="grid-column:4 / span 3;grid-row:8" aria-label="Exterior"><span class="lad-uf">Exterior</span><span class="lad-v" data-v></span><span class="lad-barra"><i data-b></i></span></button>
  </div>`;
}

function atualizarMapa(r) {
  for (const u of r.linhas) {
    const el = $(`.lad[data-uf="${u.uf}"]`);
    if (!el) continue;
    const prev = u.shareObs === null;
    const share = prev ? u.prior : u.shareObs;
    const quem = share >= 0.5 ? 'lula' : 'flavio';
    const margem = Math.abs(share - 0.5) * 2;
    const cor = corLadrilho(C.cand(quem).cor, margem, prev);
    el.style.background = cor.fundo;
    el.style.color = cor.tinta;
    el.classList.toggle('prev', prev);
    el.classList.toggle('sel', A.ufSel === u.uf);
    const v = el.querySelector('[data-v]');
    const txt = `${quem === 'lula' ? 'L' : 'F'} ${C.fNum(Math.max(share, 1 - share) * 100, 0)}`;
    if (v && v.textContent !== txt) v.textContent = txt;
    const bar = el.querySelector('[data-b]');
    if (bar) bar.style.width = `${clamp(u.f * 100, 0, 100).toFixed(1)}%`;
    el.setAttribute(
      'aria-label',
      `${NOME_UF[u.uf]}: ${prev ? 'prévia' : 'lidera'} ${C.curto(quem)} com ${C.fNum(Math.max(share, 1 - share) * 100, 0)}% do par; ${C.fNum(u.f * 100, 0)}% apurado`,
    );
  }
  atualizarDetalheUF(r);
}

function atualizarDetalheUF(r) {
  const caixa = $('[data-ap-uf]');
  if (!caixa) return;
  const u = r.linhas.find((x) => x.uf === A.ufSel);
  if (!u) {
    htmlEm('[data-ap-uf]', C.h`<p class="ap-uf-dica">Toque num estado para ver o apurado, a prévia, a projeção e os votos que faltam.</p>`);
    return;
  }
  const h = C.h;
  const linha = (id) => {
    const ap = u.L + u.F > 0 ? ((id === 'lula' ? u.L : u.F) / (u.L + u.F)) * 100 : null;
    const pr = (id === 'lula' ? u.prior : 1 - u.prior) * 100;
    const pj = u.projL + u.projF > 0 ? ((id === 'lula' ? u.projL : u.projF) / (u.projL + u.projF)) * 100 : null;
    return h`<tr><td><i class="mc" style="--c:${C.cand(id).cor}"></i> ${C.curto(id)}</td><td class="n">${pct1(ap)}</td><td class="n">${pct1(pr)}</td><td class="n"><b>${pct1(pj)}</b></td></tr>`;
  };
  const liq = u.rem * (2 * u.share - 1);
  const el = u.b.elasticidade;
  const elTxt =
    el !== null && el !== undefined && Number.isFinite(el)
      ? h`<p class="ap-uf-l">Aqui o voto costuma se mover <b>${C.fNum(el, 1)} ${el < 2 ? 'vez' : 'vezes'}</b> o que o país se move entre os turnos${el > 1.05 ? ' (mais que a média)' : el < 0.95 ? ' (menos que a média)' : ''}.</p>`
      : '';
  htmlEm(
    '[data-ap-uf]',
    h`<div class="ap-uf-cab"><p class="ap-uf-nome">${NOME_UF[u.uf]} <small>${u.uf === 'ZZ' ? '' : u.uf}</small></p><button type="button" class="ap-uf-x" data-ap="fechar-uf" aria-label="Fechar">×</button></div>
      <p class="ap-uf-l">${u.o ? h`<b>${C.fNum(u.f * 100, 1)}%</b> do eleitorado apurado` : 'Ainda sem leitura deste estado'}${u.o ? h` · ${C.fInt(u.L + u.F)} votos nos dois` : ''}</p>
      <table class="tab"><thead><tr><th style="width:30%">% do par</th><th class="n">Apurado</th><th class="n">Prévia</th><th class="n">Projeção</th></tr></thead><tbody>${linha('lula')}${linha('flavio')}</tbody></table>
      <p class="ap-uf-l">Faltam cerca de <b>${votosCurto(u.rem)}</b> de votos válidos${u.rem > 0 ? h`; devem render <b>+${votosCurto(Math.abs(liq))}</b> a ${C.curto(liq >= 0 ? 'lula' : 'flavio')}` : ''}.</p>
      <p class="ap-uf-l">Comparecimento: ${u.compObs !== null ? h`<b>${C.fNum(u.compObs * 100, 1)}%</b> até agora` : 'sem leitura ainda'} (prévia ${C.fNum(u.b.comp * 100, 1)}%).</p>
      ${elTxt}
      <p class="fonte">Prévia: ${u.b.fonte}. Peso da observação neste estado: ${C.fNum(u.w * 100, 0)}%.</p>`,
  );
}

/* ============================================================= gráficos */

function pontoSerie(r) {
  const t = A.modo === 'sim' ? A.sim.relogio : r.cont.tTot ?? Date.now();
  const p = {
    t,
    pst: r.cont.pst,
    pL: r.pL,
    aL: r.cont.L + r.cont.F > 0 ? (r.cont.L / (r.cont.L + r.cont.F)) * 100 : null,
    jL: r.proj.parL,
  };
  const ult = A.serie[A.serie.length - 1];
  if (ult && ult.pst === p.pst && Math.abs((ult.jL ?? 0) - (p.jL ?? 0)) < 1e-9 && ult.t === p.t) return false;
  if (ult && t < ult.t) return false;
  // Troca de liderança da contagem.
  if (ult && ult.aL !== null && p.aL !== null && (ult.aL - 50) * (p.aL - 50) < 0) {
    A.trocas.push({ t, pst: p.pst, lider: p.aL > 50 ? 'lula' : 'flavio' });
  }
  A.serie.push(p);
  if (A.serie.length > 1500) A.serie.splice(0, A.serie.length - 1500);
  guardarSerie();
  return true;
}
const chaveSerie = () => `radar2t.apuracao.${A.eleicao}`;
function guardarSerie() {
  if (A.modo !== 'vivo') return; // a simulação fica só na memória
  try {
    localStorage.setItem(chaveSerie(), JSON.stringify({ serie: A.serie, trocas: A.trocas }));
  } catch {
    /* sem armazenamento: fica na memória */
  }
}
function carregarSerie() {
  A.serie = [];
  A.trocas = [];
  if (A.modo !== 'vivo') return;
  try {
    const s = JSON.parse(localStorage.getItem(chaveSerie()) || 'null');
    if (Array.isArray(s?.serie)) A.serie = s.serie.filter((p) => Number.isFinite(p?.t));
    if (Array.isArray(s?.trocas)) A.trocas = s.trocas.filter((p) => Number.isFinite(p?.t));
  } catch {
    /* ignora */
  }
}

function desenharChance(el) {
  const pts = A.serie.filter((p) => Number.isFinite(p.pL));
  if (!pts.length) {
    el.innerHTML = C.emHtml(C.lacunaBloco('O gráfico começa com a primeira leitura.'));
    return;
  }
  const L = C.cand('lula');
  const F = C.cand('flavio');
  const xs = pts.map((p) => p.t);
  const mL = new Map(pts.map((p) => [p.t, p.pL * 100]));
  const mF = new Map(pts.map((p) => [p.t, 100 - p.pL * 100]));
  const pst = new Map(pts.map((p) => [p.t, p.pst]));
  let x0 = xs[0];
  let x1 = xs[xs.length - 1];
  if (x1 - x0 < 10 * 60000) x1 = x0 + 10 * 60000;
  C.desenharLinhasTempo(el, {
    x0,
    x1,
    xs,
    rotX: xs,
    yLo: 0,
    yHi: 100,
    yPasso: 25,
    yFmt: (v) => `${v}%`,
    ref: 50,
    series: [
      { cor: L.cor, pts: pts.map((p) => ({ t: p.t, y: mL.get(p.t) })), mapa: mL },
      { cor: F.cor, pts: pts.map((p) => ({ t: p.t, y: mF.get(p.t) })), mapa: mF },
    ],
    vFmt: (v) => C.fNum(v, 0),
    minDist: 56,
    dica: (t) =>
      C.h`<p class="dica-tit">${C.fHora(t)} · ${C.fNum(pst.get(t), 1)}% apurado</p><p class="dica-l"><i class="lk" style="--c:${L.cor}"></i><b>${C.fNum(mL.get(t), 0)}%</b><span>${C.curto('lula')}</span></p><p class="dica-l"><i class="lk" style="--c:${F.cor}"></i><b>${C.fNum(mF.get(t), 0)}%</b><span>${C.curto('flavio')}</span></p>`,
  });
}

function desenharVotos(el) {
  const pts = A.serie.filter((p) => Number.isFinite(p.jL));
  if (!pts.length) {
    el.innerHTML = C.emHtml(C.lacunaBloco('O gráfico começa com a primeira leitura.'));
    return;
  }
  const L = C.cand('lula');
  const F = C.cand('flavio');
  const xs = pts.map((p) => p.t);
  const jL = new Map(pts.map((p) => [p.t, p.jL]));
  const jF = new Map(pts.map((p) => [p.t, 100 - p.jL]));
  const aL = new Map(pts.filter((p) => p.aL !== null).map((p) => [p.t, p.aL]));
  const aF = new Map(pts.filter((p) => p.aL !== null).map((p) => [p.t, 100 - p.aL]));
  const pst = new Map(pts.map((p) => [p.t, p.pst]));
  const vals = [...jL.values(), ...jF.values(), ...aL.values(), ...aF.values()];
  const longe = Math.max(...vals.map((v) => Math.abs(v - 50))) + 1.5;
  const meia = Math.max(10, Math.ceil(longe / 5) * 5);
  let x0 = xs[0];
  let x1 = xs[xs.length - 1];
  if (x1 - x0 < 10 * 60000) x1 = x0 + 10 * 60000;
  C.desenharLinhasTempo(el, {
    x0,
    x1,
    xs,
    rotX: xs,
    yLo: 50 - meia,
    yHi: 50 + meia,
    yPasso: meia <= 15 ? 5 : 10,
    yFmt: (v) => `${v}%`,
    ref: 50,
    series: [
      { cor: L.cor, pts: pts.map((p) => ({ t: p.t, y: aL.get(p.t) ?? null })), mapa: aL, trac: true, rotular: false },
      { cor: F.cor, pts: pts.map((p) => ({ t: p.t, y: aF.get(p.t) ?? null })), mapa: aF, trac: true, rotular: false },
      { cor: L.cor, pts: pts.map((p) => ({ t: p.t, y: jL.get(p.t) })), mapa: jL },
      { cor: F.cor, pts: pts.map((p) => ({ t: p.t, y: jF.get(p.t) })), mapa: jF },
    ],
    vFmt: (v) => C.fNum(v, 1),
    minDist: 60,
    dica: (t) =>
      C.h`<p class="dica-tit">${C.fHora(t)} · ${C.fNum(pst.get(t), 1)}% apurado</p>
        <p class="dica-l"><i class="lk" style="--c:${L.cor}"></i><b>${pct1(jL.get(t))}</b><span>${C.curto('lula')}, projeção</span></p>
        <p class="dica-l"><i class="lk" style="--c:${F.cor}"></i><b>${pct1(jF.get(t))}</b><span>${C.curto('flavio')}, projeção</span></p>
        <p class="dica-sep">Apurado: ${C.curto('lula')} ${pct1(aL.get(t))} · ${C.curto('flavio')} ${pct1(aF.get(t))}</p>`,
  });
}

/* ============================================================ esqueletos */

function htmlLados(prevOnly) {
  const h = C.h;
  return ['lula', 'flavio'].map((id) => {
    const c = C.cand(id);
    return h`<div class="ap-lado" data-lado="${id}">
      <div class="ap-quem">${C.foto(c)}<div><p class="ap-nome">${c.nome}</p><p class="ap-part">${C.txt(c.partido) || ''}${C.num(c.numero) !== null ? ` · ${c.numero}` : ''}</p></div></div>
      <p class="ap-ch-rot">${prevOnly ? 'chance antes da contagem' : 'chance de vitória'}</p>
      <p class="ap-ch" data-ch="${id}">—</p>
      ${prevOnly
        ? h`<p class="ap-sub">prévia: <b data-pv="${id}">—</b> dos válidos</p>`
        : h`<p class="ap-votos"><span data-votos="${id}">0</span> votos</p><p class="ap-sub"><b data-pct="${id}">—</b> dos válidos apurados</p>`}
    </div>`;
  });
}

function htmlOrigemPrevia() {
  const h = C.h;
  const b = A.base;
  if (!b) return '';
  const comp = b.componentes;
  const itens = [];
  const rot = (k) => String(k).replace(/_/g, ' ').replace(/\bpp\b/g, 'pp');
  const val = (v) => {
    const x = C.num(v);
    if (x !== null) return C.fNum(x, Math.abs(x) >= 10 ? 1 : 2).replace('-', '−');
    return C.txt(v);
  };
  // Valor em pontos: com sinal e unidade ("+0,30 ponto", "−0,24 ponto").
  const pp = (v) => {
    const x = C.num(v);
    if (x === null) return null;
    const t = C.fNum(Math.abs(x), 2);
    return `${x > 0 ? '+' : x < 0 ? '−' : ''}${t} ${Math.abs(x) < 2 ? 'ponto' : 'pontos'}`;
  };
  const valItem = (it) => (C.num(it.valor_pp) !== null ? pp(it.valor_pp) : val(it.valor ?? it.peso));
  if (Array.isArray(comp)) {
    for (const it of comp) {
      if (!obj(it)) continue;
      const nome = C.txt(it.rotulo) || C.txt(it.nome);
      const v = valItem(it);
      if (nome) itens.push(h`${nome}${v ? h`: <b>${v}</b>` : ''}${C.txt(it.texto) ? ` (${it.texto})` : ''}`);
    }
  } else if (obj(comp)) {
    for (const [k, v] of Object.entries(comp)) {
      if (obj(v)) {
        const nome = C.txt(v.rotulo) || rot(k);
        const x = valItem(v);
        itens.push(h`${nome}${x ? h`: <b>${x}</b>` : ''}${C.txt(v.texto) ? ` (${v.texto})` : ''}`);
      } else {
        const x = val(v);
        if (x) itens.push(h`${rot(k)}: <b>${x}</b>`);
      }
    }
  }
  const nac = h`Prévia nacional: ${C.curto('lula')} <b>${pct1(b.nacPar * 100)}</b> do par, incerteza de <b>${C.fNum(b.sigmaNac, 1)} ${b.sigmaNac < 2 ? 'ponto' : 'pontos'}</b>${b.tendencia !== null ? h`, tendência de ${pp(b.tendencia)} por dia` : ''}.`;
  const origem =
    b.origem === 'modelo_uf'
      ? 'Por estado: modelo da mesa (1º turno de 2026, padrão de cada estado entre os turnos de 2002 a 2022, tendência e tamanho das amostras).'
      : b.origem === 'reserva'
        ? 'Por estado: cálculo de reserva da página (1º turno de cada estado + deslocamento nacional das pesquisas).'
        : 'Por estado: sem dado próprio; todos partem da média nacional.';
  return h`<p class="ap-origem"><b>De onde vem a prévia</b> ${C.info('Prévia por estado')}: ${nac} ${origem}${itens.length ? h` Componentes: ${itens.map((x, i) => h`${i ? ' · ' : ''}${x}`)}.` : ''}</p>
    ${b.lacunas.length ? h`<ul class="ap-lac">${b.lacunas.map((x) => h`<li>${x}</li>`)}</ul>` : ''}`;
}

function htmlComoFunciona() {
  const h = C.h;
  return h`<details class="mais" data-k="ap-como"><summary>Como a projeção funciona</summary>
    <div class="mais-corpo">
      <ol class="passos">
        <li><b>Prévia de cada estado</b> antes de contar: participação de ${C.curto('lula')} no par, comparecimento e brancos e nulos (veja “De onde vem a prévia”).</li>
        <li><b>Durante a contagem</b>, cada estado mistura o que já foi apurado com a prévia. O peso do apurado é f ÷ (f + ${C.fNum(MODELO.K_MISTURA, 2)}), com f = parte do eleitorado já totalizada: com 15% apurado, metade e metade.</li>
        <li><b>Votos que faltam</b> = eleitorado ainda não totalizado × comparecimento × (1 − brancos e nulos), estado por estado. Projeção final = apurado + o que falta.</li>
        <li><b>Swing observado</b> ${C.info('Swing observado')}: quanto a apuração está, em média, acima ou abaixo da prévia nos estados já contados. Ele corrige a prévia dos estados que ainda não começaram, com peso crescente pela parte do país já apurada.</li>
        <li><b>Chance de vitória</b>: ${C.fInt(MODELO.SORTEIOS)} sorteios. Um erro nacional comum (incerteza de ${C.fNum(A.base?.sigmaNac ?? MODELO.SIGMA_NACIONAL, 1)} ponto × parte que falta apurar) mais um erro próprio de cada estado (incerteza do estado × √(1 − f)). Com tudo apurado, 100% e 0%.</li>
        <li><b>Matematicamente definido</b> ${C.info('Matematicamente definido')}: quando a diferença na contagem é maior que todo o eleitorado que ainda falta apurar.</li>
      </ol>
      <p class="nota">Leitura do TSE: Brasil a cada 20 segundos; cada estado a cada minuto, um por vez. Fonte: resultados.tse.jus.br.</p>
    </div>
  </details>`;
}

function esqueletoPainel() {
  const h = C.h;
  const sim = A.modo === 'sim';
  return h`
    ${sim
      ? h`<div class="ap-sim" role="note"><p><b>SIMULAÇÃO — números fictícios</b> Apuração inventada a partir da prévia, só para conhecer a tela. Nada aqui é dado real.</p><div class="ap-sim-acoes"><button type="button" data-ap="sim-reiniciar">Recomeçar</button><button type="button" data-ap="sim-sair">Sair da simulação</button></div></div>`
      : ''}
    ${A.teste ? h`<div class="alerta"><p><b>Teste com a eleição ${A.eleicao}</b> (o 1º turno, de 04/10). Os números são reais daquele dia, não do 2º turno.</p></div>` : ''}
    <section class="ap-topo" aria-label="Chance de vitória e votos apurados">
      <p class="sobre">Apuração ao vivo · ${sim ? 'simulação' : 'TSE'} ${C.info('Apuração')}</p>
      <div class="ap-hero">${htmlLados(false)}</div>
      <div class="ap-chbar" aria-hidden="true"><span data-seg="lula"></span><span data-seg="flavio"></span><i></i></div>
      <p class="ap-chleg">Chance de vitória pelo modelo da mesa ${C.info('Chance de vitória')}<span class="ap-def" data-ap-def hidden></span></p>
    </section>
    <section class="bloco ap-prog-b ap-sec-prog">
      <div class="ap-prog-cab"><p class="ap-prog-num"><b data-ap-pst>0,0%</b> das seções apuradas</p><p class="ap-prog-lido" data-ap-lidos></p></div>
      <div class="ap-prog" aria-hidden="true"><i data-ap-barra></i></div>
      <p class="fonte" data-ap-hora>Aguardando a primeira leitura…</p>
    </section>
    <section class="bloco ap-sec-duo">
      <h2 class="sobre">Apurado agora × projeção final ${C.info('Projeção final')}</h2>
      <p class="ap-virada" data-ap-virada hidden></p>
      <div class="ap-duo">
        <div class="ap-card"><p class="ap-card-tit">Apurado agora</p><div data-ap-apurado></div></div>
        <div class="ap-card ap-card-proj"><p class="ap-card-tit">Projeção final</p><div data-ap-proj></div></div>
      </div>
    </section>
    <section class="bloco ap-sec-ins">
      <h2 class="sobre">O que está acontecendo</h2>
      <ol class="ap-ins" data-ap-ins aria-live="polite"></ol>
      <p class="estado" data-ap-ins-vazio hidden>Os destaques aparecem aqui assim que a contagem começar.</p>
    </section>
    <section class="bloco ap-sec-mapa">
      <h2 class="sobre">Estados ${C.info('UF')}</h2>
      <div class="ap-mapa-wrap">
        <div>${htmlMapa()}
          <p class="ap-leg">Cor: quem lidera no estado (cor do partido) · mais forte = margem maior · barra de baixo = parte apurada · tracejado = ainda sem votos (mostra a prévia). L = ${C.curto('lula')}, F = ${C.curto('flavio')}.</p>
        </div>
        <div class="ap-uf" data-ap-uf></div>
      </div>
    </section>
    <section class="bloco ap-sec-graf">
      <h2 class="sobre">Ao longo da noite</h2>
      <h3 class="sub">Chance de vitória</h3>
      <div class="leg"><span><i class="lk" style="--c:${C.cand('lula').cor}"></i>${C.curto('lula')}</span><span><i class="lk" style="--c:${C.cand('flavio').cor}"></i>${C.curto('flavio')}</span></div>
      <div class="graf" data-grafico="apur-chance" tabindex="0" role="img" aria-label="Chance de vitória ao longo da apuração"></div>
      <h3 class="sub">Apurado × projeção, em % dos votos dados aos dois</h3>
      <div class="leg"><span><i class="lk" style="--c:${C.cand('lula').cor}"></i>${C.curto('lula')}, projeção</span><span><i class="lk" style="--c:${C.cand('flavio').cor}"></i>${C.curto('flavio')}, projeção</span><span><i class="lk trac" style="--c:#45443f"></i>apurado</span></div>
      <div class="graf" data-grafico="apur-votos" tabindex="0" role="img" aria-label="Apurado e projeção ao longo da apuração"></div>
      <p class="fonte">${sim ? 'Simulação: guardada só na memória.' : 'Pontos guardados neste aparelho a cada leitura que muda.'}</p>
    </section>
    <section class="bloco ap-sec-previa">
      ${htmlOrigemPrevia()}
      ${htmlComoFunciona()}
    </section>
    <p class="ap-rodape">Projeção estatística da mesa, não é resultado oficial. Resultado oficial: TSE (Tribunal Superior Eleitoral).</p>`;
}

function esqueletoPre() {
  const h = C.h;
  return h`
    <section class="bloco ap-pre">
      <h2 class="sobre">Apuração ao vivo</h2>
      <p class="ap-pre-g" data-ap-pre-g>—</p>
      <p class="ap-pre-r" data-ap-pre-r></p>
      <p class="texto">A partir das 17h, esta aba lê o TSE (Tribunal Superior Eleitoral) a cada 20 segundos e mostra, sem você precisar recarregar:</p>
      <ul class="lista-texto">
        <li>votos apurados de cada um, contando na tela, e a chance de vitória: quem ganha chance fica verde, quem perde fica vermelho;</li>
        <li>o apurado agora ao lado da projeção final, onde aparece a virada que a contagem ainda não mostrou;</li>
        <li>o mapa dos estados, com quem lidera em cada um e quanto já foi apurado;</li>
        <li>destaques que entram e saem conforme a apuração anda (quanto falta, quem precisa de quanto, o swing contra as pesquisas).</li>
      </ul>
      <div class="ap-pre-acoes"><button type="button" class="botao-link" data-ap="sim">Ver simulação</button><span class="nota">números fictícios, só para conhecer a tela</span></div>
    </section>
    <section class="bloco">
      <h2 class="sobre">Prévia antes da contagem</h2>
      <div class="ap-hero">${htmlLados(true)}</div>
      <div class="ap-chbar" aria-hidden="true"><span data-seg="lula"></span><span data-seg="flavio"></span><i></i></div>
      <p class="ap-chleg">Chance pelo modelo da apuração, antes do primeiro voto contado ${C.info('Chance de vitória')}</p>
      <div class="ap-mapa-wrap">
        <div>${htmlMapa()}<p class="ap-leg">Prévia de cada estado: cor de quem deve liderar, mais forte = margem maior. L = ${C.curto('lula')}, F = ${C.curto('flavio')}.</p></div>
        <div class="ap-uf" data-ap-uf></div>
      </div>
    </section>
    <section class="bloco ap-sec-previa">
      ${htmlOrigemPrevia()}
      ${htmlComoFunciona()}
    </section>
    <p class="ap-rodape">Projeção estatística da mesa, não é resultado oficial. Resultado oficial: TSE (Tribunal Superior Eleitoral).</p>`;
}

/* ============================================================ atualização */

function pintarChance(pL) {
  for (const id of ['lula', 'flavio']) {
    const p = pL === null ? null : id === 'lula' ? pL : 1 - pL;
    const cor = corChance(p);
    for (const lado of $$(`.ap-lado[data-lado="${id}"]`)) {
      lado.style.background = cor.fundo;
      lado.style.color = cor.tinta;
      lado.classList.toggle('escuro', cor.tinta === '#ffffff');
    }
    for (const seg of $$(`.ap-chbar [data-seg="${id}"]`)) {
      seg.style.background = cor.fundo === rgb(hexRgb(NEUTRO)) ? '#d9d8d2' : cor.fundo;
      seg.style.flexGrow = String(p === null ? 1 : Math.max(0.0001, p));
    }
    for (const el of $$(`[data-ch="${id}"]`)) {
      const t = chanceTxt(p);
      if (el.textContent !== t) el.textContent = t;
    }
  }
}

function blocoPar(L, F, pL, pF, rotDif, casas = 1) {
  const h = C.h;
  const fmt = casas === 2 ? pct2 : pct1;
  const linha = (id, v, p) =>
    h`<p class="ap-par"><span><i class="mc" style="--c:${C.cand(id).cor}"></i>${C.curto(id)}</span><b>${fmt(p)}</b></p>`;
  const dif = L - F;
  const quem = dif > 0 ? 'lula' : dif < 0 ? 'flavio' : null;
  const soma = L + F;
  return h`${linha('lula', L, pL)}${linha('flavio', F, pF)}
    <div class="barra fina"><span class="seg" style="--c:${C.cand('lula').cor};flex:${soma > 0 ? (L / soma) * 100 : 50} 1 0px"></span><span class="seg" style="--c:${C.cand('flavio').cor};flex:${soma > 0 ? (F / soma) * 100 : 50} 1 0px"></span></div>
    <p class="ap-dif">${quem ? h`${rotDif}: <b>${C.curto(quem)} +${votosCurto(Math.abs(dif))}</b>` : h`${rotDif}: <b>empate</b>`}</p>`;
}

function atualizarTela() {
  const r = processar();
  A.res = r;
  if (!r || !A.raiz) return;
  if (A.modo === 'pre') {
    pintarChance(r.pL);
    for (const id of ['lula', 'flavio']) {
      const el = $(`[data-pv="${id}"]`);
      if (el) el.textContent = pct1(id === 'lula' ? r.proj.parL : 100 - r.proj.parL);
    }
    atualizarMapa(r);
    return;
  }
  const c = r.cont;
  const temVoto = c.L + c.F > 0;
  // Com votos já apurados mas estados ainda carregando, a chance espera a projeção completa
  // (salvo se o arquivo Brasil já decide: 100% apurado ou matematicamente definido).
  const decidido = r.tudo || r.definido;
  pintarChance(!r.completo && temVoto && !decidido ? null : r.pL);
  for (const id of ['lula', 'flavio']) {
    animarNumero($(`[data-votos="${id}"]`), id === 'lula' ? c.L : c.F, (v) => C.fInt(v));
    const el = $(`[data-pct="${id}"]`);
    if (el) el.textContent = temVoto ? pct2(id === 'lula' ? c.pL : c.pF) : '—';
  }
  const def = $('[data-ap-def]');
  if (def) {
    const msg = r.tudo && temVoto ? ' · apuração concluída' : r.definido ? ' · matematicamente definido' : '';
    def.hidden = !msg;
    def.textContent = msg;
  }
  texto('[data-ap-pst]', `${C.fNum(c.pst, c.pst >= 100 || c.pst === 0 ? 0 : 2)}%`);
  const barra = $('[data-ap-barra]');
  if (barra) barra.style.width = `${clamp(c.pst, 0, 100)}%`;
  texto('[data-ap-lidos]', A.modo === 'sim' ? 'simulação acelerada' : `${r.lidos} de ${UFS.length} estados lidos`);
  atualizarHora();
  // Apurado × projeção
  htmlEm('[data-ap-apurado]', temVoto ? blocoPar(c.L, c.F, c.pL, c.pF, 'Diferença', 2) : C.h`<p class="ap-vazio">Ainda sem votos apurados.</p>`);
  htmlEm(
    '[data-ap-proj]',
    r.tudo && temVoto
      ? blocoPar(c.L, c.F, c.pL, c.pF, 'Resultado final da contagem', 2)
      : r.completo
      ? blocoPar(r.proj.L, r.proj.F, r.proj.pL, r.proj.pF, 'Diferença projetada')
      : C.h`<p class="ap-vazio">Lendo os estados (${r.lidos} de ${UFS.length})… a projeção aparece quando todos tiverem sido lidos.</p>`,
  );
  const vir = $('[data-ap-virada]');
  const lc = lider(c.L, c.F);
  const lp = lider(r.proj.L, r.proj.F);
  const temVirada = r.completo && temVoto && !r.tudo && lc && lp && lc !== lp;
  if (vir) {
    vir.hidden = !temVirada;
    if (temVirada) vir.textContent = `A projeção aponta virada: ${C.curto(lp)} termina à frente, embora ${C.curto(lc)} lidere a contagem agora.`;
  }
  if (r.completo) {
    renderInsights(calcularInsights(r));
    if (pontoSerie(r)) for (const g of $$('[data-grafico^="apur-"]')) C.desenharGrafico(g);
  } else {
    renderInsights(calcularInsights(r).filter((x) => ['aguardando', 'comparecimento', 'concluida', 'definido'].includes(x.id)));
  }
  atualizarMapa(r);
}

function atualizarHora() {
  const el = $('[data-ap-hora]');
  if (!el || !A.res) return;
  if (A.modo === 'sim') {
    el.textContent = `Hora simulada: ${C.fHora(A.sim.relogio)} · 3h30 de apuração em 2 minutos · um passo por segundo`;
    return;
  }
  const t = A.res.cont.tTot;
  const falta = Math.max(0, Math.ceil((A.proxBR - Date.now()) / 1000));
  const partes = [];
  partes.push(t ? `Última totalização do TSE: ${C.fDataHora(t)}` : 'O TSE ainda não totalizou nenhuma seção');
  if (A.ativo) partes.push(A.brErro ? `TSE não respondeu agora (${A.brErro}); nova tentativa em ${falta} s` : `próxima leitura em ${falta} s`);
  else partes.push('leitura pausada enquanto a aba está fechada');
  const s = partes.join(' · ');
  if (el.textContent !== s) el.textContent = s;
}

function atualizarPre() {
  const e = obj(C.dados()?.eleicao) || {};
  const fe = C.msDe(e.fechamento) ?? C.msDe('2026-10-25T17:00:00-03:00');
  const falta = fe - Date.now();
  if (falta <= 0) {
    trocarModo('vivo');
    return;
  }
  const tot = Math.ceil(falta / 60000);
  const d = Math.floor(tot / 1440);
  const hh = Math.floor((tot % 1440) / 60);
  const m = tot % 60;
  let g;
  const resto = [];
  if (d >= 1) {
    g = d === 1 ? 'falta 1 dia' : `faltam ${d} dias`;
    if (hh) resto.push(`${hh} h`);
    if (m) resto.push(`${m} min`);
  } else if (hh >= 1) {
    g = hh === 1 ? 'falta 1 hora' : `faltam ${hh} horas`;
    if (m) resto.push(`${m} min`);
  } else {
    g = m <= 1 ? 'falta 1 minuto' : `faltam ${m} minutos`;
  }
  texto('[data-ap-pre-g]', g);
  texto('[data-ap-pre-r]', `${resto.length ? `e ${resto.join(' ')} ` : ''}para o fechamento das urnas · domingo, 25/10, às ${C.fHora(fe).replace('h00', 'h')} (horário de Brasília)`);
}

/* =============================================================== leitura */

function pararTimers() {
  for (const t of A.timers) clearInterval(t);
  A.timers = [];
}

async function lerBR() {
  try {
    A.br = await buscarTSE('br');
    A.brErro = null;
  } catch (e) {
    A.brErro = String(e?.message || e).slice(0, 80);
  }
  A.brEm = Date.now();
  A.proxBR = A.brEm + MODELO.CADA_BR_MS;
  atualizarTela();
}

async function lerProximaUF() {
  const uf = UFS[A.ufIdx % UFS.length];
  A.ufIdx += 1;
  try {
    A.ufs.set(uf, await buscarTSE(uf));
    A.ufErros.delete(uf);
  } catch (e) {
    A.ufErros.set(uf, String(e?.message || e).slice(0, 80));
  }
  atualizarTela();
}

function ligarVivo() {
  pararTimers();
  if (!A.ativo || document.hidden) return;
  if (Date.now() - A.brEm >= MODELO.CADA_BR_MS) lerBR();
  else A.proxBR = A.brEm + MODELO.CADA_BR_MS;
  A.timers.push(
    setInterval(() => {
      if (Date.now() >= A.proxBR) lerBR();
      atualizarHora();
    }, 1000),
  );
  lerProximaUF();
  A.timers.push(setInterval(lerProximaUF, MODELO.PASSO_UF_MS));
  A.timers.push(setInterval(() => (A.rot += 1), 8000));
}

/* ============================================================= simulação */

function iniciarSimulacao() {
  const sem = A.semente ?? Math.floor(Math.random() * 1e9);
  const rng = rngMulberry(sem);
  for (let i = 0; i < 12; i++) rng(); // os primeiros sorteios de sementes pequenas saem extremos
  // Erro nacional da noite simulada: a incerteza do próprio modelo, limitado a 2 desvios.
  const sigma = A.base.sigmaNac / 100;
  const nac = clamp(normal(rng) * sigma, -2 * sigma, 2 * sigma);
  const ufs = new Map();
  for (const uf of UFS) {
    const b = A.base.ufs.get(uf);
    const te = b.eleitorado ?? 0;
    const [ini, dur] = RITMO_SIM[REGIAO[uf]];
    ufs.set(uf, {
      te,
      share: clamp(b.prior + nac + normal(rng) * (b.sigma / 100), 0.05, 0.95),
      comp: clamp(b.comp + normal(rng) * 0.012, 0.3, 0.98),
      bn: clamp(b.bn + normal(rng) * 0.006, 0.005, 0.2),
      vies: normal(rng) * 0.035,
      ini: clamp(ini + (rng() - 0.5) * 0.08, 0, 0.6),
      dur: clamp(dur + (rng() - 0.5) * 0.1, 0.3, 0.8),
    });
  }
  const t0 = C.msDe('2026-10-25T17:00:00-03:00');
  A.sim = { semente: sem, ufs, inicio: Date.now(), t0, relogio: t0, fim: false };
  A.br = null;
  A.ufs = new Map();
  A.serie = [];
  A.trocas = [];
}

function passoSimulacao() {
  const s = A.sim;
  if (!s) return;
  const tau = clamp((Date.now() - s.inicio) / MODELO.SIM_MS, 0, 1);
  s.relogio = s.t0 + tau * MODELO.SIM_HORAS * 3600e3;
  let te = 0;
  let est = 0;
  let c = 0;
  let vb = 0;
  let vv = 0;
  let L = 0;
  let F = 0;
  for (const uf of UFS) {
    const u = s.ufs.get(uf);
    const p = clamp((tau - u.ini) / u.dur, 0, 1);
    const f = p * p * (3 - 2 * p);
    const e = Math.round(u.te * f);
    const cc = Math.round(e * u.comp);
    const bn = Math.round(cc * u.bn);
    const v = cc - bn;
    const sh = clamp(u.share + u.vies * (1 - f), 0.02, 0.98);
    const l = Math.round(v * sh);
    A.ufs.set(uf, { pst: f * 100, te: u.te, est: e, c: cc, vb: Math.round(bn * 0.4), tvn: bn - Math.round(bn * 0.4), vv: v, L: l, F: v - l, pL: null, pF: null, tTot: s.relogio, em: Date.now() });
    te += u.te;
    est += e;
    c += cc;
    vb += bn;
    vv += v;
    L += l;
    F += v - l;
  }
  A.br = { pst: te > 0 ? (est / te) * 100 : 0, te, est, c, vb, tvn: 0, vv, L, F, pL: vv > 0 ? (L / vv) * 100 : null, pF: vv > 0 ? (F / vv) * 100 : null, tTot: s.relogio };
  if (tau >= 1) {
    s.fim = true;
    pararTimers();
  }
  atualizarTela();
}

function ligarSimulacao() {
  pararTimers();
  passoSimulacao();
  if (A.sim?.fim) return;
  A.timers.push(setInterval(passoSimulacao, MODELO.SIM_PASSO_MS));
  A.timers.push(setInterval(() => (A.rot += 1), 8000));
}

/* ================================================================= modos */

function modoInicial() {
  const q = C.params;
  const sim = q.get('sim');
  if (sim !== null) {
    const n = Number(sim);
    A.semente = Number.isFinite(n) && n > 1 ? Math.floor(n) : null;
    return 'sim';
  }
  const el = q.get('eleicao');
  if (el && /^\d{4,6}$/.test(el)) {
    A.eleicao = el;
    A.teste = el !== MODELO.ELEICAO;
    return 'vivo';
  }
  const fe = C.msDe(C.dados()?.eleicao?.fechamento) ?? C.msDe('2026-10-25T17:00:00-03:00');
  return Date.now() >= fe ? 'vivo' : 'pre';
}

function trocarModo(modo) {
  pararTimers();
  A.modo = modo;
  A.ufSel = null;
  A.rot = 0;
  A.sim = null;
  if (modo !== 'sim') {
    A.br = null;
    A.ufs = new Map();
    A.brEm = 0;
    carregarSerie();
  }
  montarTela();
  faixaSim();
}

function montarTela() {
  if (!A.raiz) return;
  if (!C.dados()) {
    A.raiz.innerHTML = C.emHtml(C.lacunaBloco('Carregando os dados da prévia…'));
    return;
  }
  A.base = montarBase(C.dados());
  if (A.modo === 'sim' && !A.sim) iniciarSimulacao();
  A.raiz.innerHTML = C.emHtml(A.modo === 'pre' ? esqueletoPre() : esqueletoPainel());
  for (const el of $$('.ap-ins')) el.innerHTML = '';
  if (A.modo === 'pre') {
    atualizarPre();
    atualizarTela();
    if (A.ativo) A.timers.push(setInterval(atualizarPre, 1000));
  } else if (A.modo === 'sim') {
    atualizarTela();
    if (A.ativo) ligarSimulacao();
  } else {
    atualizarTela();
    if (A.ativo) ligarVivo();
  }
  for (const g of $$('[data-grafico^="apur-"]')) C.desenharGrafico(g);
}

function faixaSim() {
  let el = document.getElementById('ap-sim-fixa');
  const mostrar = A.modo === 'sim' && A.ativo;
  if (!el && mostrar) {
    el = document.createElement('div');
    el.id = 'ap-sim-fixa';
    el.className = 'ap-sim-fixa';
    el.setAttribute('role', 'status');
    el.innerHTML = '<b>SIMULAÇÃO — números fictícios</b> <button type="button" data-ap="sim-sair">Sair</button>';
    document.body.appendChild(el);
  }
  if (el) el.hidden = !mostrar;
  document.body.classList.toggle('com-faixa-sim', mostrar);
}

/* ================================================================== API */

export function iniciar(ctx) {
  C = ctx;
  A.raiz = ctx.raiz;
  A.modo = modoInicial();
  carregarSerie();
  C.registrarDesenho('apur-chance', desenharChance);
  C.registrarDesenho('apur-votos', desenharVotos);
  document.addEventListener('click', (e) => {
    const alvo = e.target instanceof Element ? e.target.closest('[data-ap], .lad[data-uf]') : null;
    if (!alvo) return;
    if (alvo.matches('.lad[data-uf]')) {
      A.ufSel = A.ufSel === alvo.dataset.uf ? null : alvo.dataset.uf;
      if (A.res) atualizarMapa(A.res);
      return;
    }
    const a = alvo.dataset.ap;
    if (a === 'sim') {
      trocarModo('sim');
      A.raiz?.scrollIntoView({ block: 'start' });
    } else if (a === 'sim-reiniciar') {
      A.semente = null;
      trocarModo('sim');
    } else if (a === 'sim-sair') {
      A.semente = null;
      const fe = C.msDe(C.dados()?.eleicao?.fechamento) ?? C.msDe('2026-10-25T17:00:00-03:00');
      trocarModo(Date.now() >= fe ? 'vivo' : 'pre');
    } else if (a === 'fechar-uf') {
      A.ufSel = null;
      if (A.res) atualizarMapa(A.res);
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (A.modo === 'vivo' && A.ativo) ligarVivo();
  });
  montarTela();
  return {
    mostrar() {
      A.ativo = true;
      if (!A.base && C.dados()) montarTela();
      else if (A.modo === 'vivo') ligarVivo();
      else if (A.modo === 'sim' && !A.sim?.fim) ligarSimulacao();
      else if (A.modo === 'pre') {
        pararTimers();
        A.timers.push(setInterval(atualizarPre, 1000));
        atualizarPre();
      }
      faixaSim();
    },
    esconder() {
      A.ativo = false;
      if (A.modo !== 'sim') pararTimers();
      faixaSim();
      atualizarHora();
    },
    dadosMudaram() {
      const ativo = A.ativo;
      pararTimers();
      A.base = null;
      montarTela();
      if (ativo && A.modo === 'sim' && A.sim?.fim) passoSimulacao();
      faixaSim();
    },
    mercadosMudaram() {
      if (A.res && A.modo !== 'pre' && A.res.completo) renderInsights(calcularInsights(A.res));
    },
    abaPadrao() {
      return A.modo === 'vivo' && !A.teste ? 'apuracao' : null;
    },
  };
}
