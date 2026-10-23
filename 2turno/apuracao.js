/* Radar Eleitoral · 2º turno · APURAÇÃO AO VIVO (o "processador" da noite de 25/10)
 *
 * Módulo ES sem dependências, carregado pelo app.js com import dinâmico.
 * - Lê o TSE direto do navegador (CORS liberado): Brasil a cada 10 s; a abrangência
 *   (progresso de cada UF, um arquivo só) a cada 10 s diz quais UFs mudaram, e só essas
 *   são relidas, até 4 por vez. Detalhes em "leitura do TSE".
 * - Projeta o resultado final UF por UF: o que já foi apurado + o que falta,
 *   misturando o observado na UF com a prévia (modelo_uf do JSON; se faltar,
 *   o cálculo de reserva descrito em montarBase).
 * - Chance de vitória por Monte Carlo (2.000 sorteios, sementes fixas para o
 *   número não "tremer" entre leituras).
 * - Antes das 17h de 25/10: contagem até o fechamento, prévia por estado e o
 *   botão da SIMULAÇÃO (números fictícios, faixa fixa na tela).
 * - Teste com o 1º turno, que tem o mesmo formato: ?eleicao=6257.
 *   Simulação direta: ?sim=1 (ou ?sim=<semente> para repetir a mesma noite).
 *   Simulador do TSE (work/pocket/qa_apuracao/sim_tse.py): ?tse=http://127.0.0.1:PORTA,
 *   aceito só com a página aberta em host local e apontando para host local.
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
  // Ritmo de leitura do TSE. O Akamai do TSE guarda cada arquivo de 30 a 60 s na borda
  // (max-age medido em 23/10/2026: 45 a 57 s) e responde 304 a pedido condicional, então
  // ler mais rápido que 10 s não traz número mais novo, só gasta requisição.
  CADA_BR_MS: 10000,
  CADA_AB_MS: 10000,
  // Estados: no máximo 4 pedidos no ar; cada um relido quando a abrangência avisa que
  // mudou e, como rede de segurança, ao menos a cada 60 s enquanto conta (15 s se a
  // abrangência falhar; 5 min depois de 100% totalizado).
  UF_PARALELO: 4,
  UF_IDADE_MS: 60000,
  UF_IDADE_SEM_AB_MS: 15000,
  UF_IDADE_FIM_MS: 300000,
  UF_IDADE_PARADO_MS: 120000,
  // Pedido que passa de 15 s é abortado (o TSE lento chega a 8 s e ainda vale esperar).
  LIMITE_MS: 15000,
  // Depois de erro: 5 s, 10 s, 20 s, 40 s, até 1 min (429: pausa de 30 s em tudo).
  ESPERA_MIN_MS: 5000,
  ESPERA_MAX_MS: 60000,
  ESPERA_429_MS: 30000,
  // Aba em segundo plano (ou outra aba da página aberta): metade do ritmo.
  OCULTA_FATOR: 2,
  // Sem nenhuma resposta do TSE por mais que isso, o aviso diz desde quando.
  SEM_RESPOSTA_MS: 90000,
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
  // Base dos arquivos do TSE; ?tse= troca pelo simulador local (ver fonteTeste).
  fonte: MODELO.TSE,
  fonteTeste: null,
  base: null,
  baseAssin: null,
  br: null,
  ufs: new Map(),
  // O "apurado" que está na tela (Brasil ou soma dos estados), para nunca andar para trás.
  vista: null,
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
// Ladrilho com números: fundo sempre claro (tinta do partido de quem lidera na projeção,
// mais forte = margem maior) para que os números nas cores dos candidatos fiquem legíveis.
function corLadrilhoNum(corPartido, margem, prev) {
  const t = prev ? 0.06 + Math.min(0.12, margem * 0.6) : 0.1 + Math.min(0.26, (margem / 0.3) * 0.26);
  const c = misturar('#ffffff', corPartido, t);
  return { fundo: rgb(c), tinta: claro(c) ? '#0b0b0b' : '#ffffff' };
}
function animarNumero(el, para, fmt, dur = 900) {
  if (!el) return;
  const de = el._v;
  el._v = para;
  if (de === undefined || de === para || reduzMovimento() || !Number.isFinite(de) || !Number.isFinite(para)) {
    el.textContent = fmt(para);
    return;
  }
  const t0 = performance.now();
  cancelAnimationFrame(el._raf);
  const passo = (agora) => {
    const k = Math.min(1, (agora - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    const t = fmt(de + (para - de) * e);
    if (el.textContent !== t) el.textContent = t;
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
// Percentual apurado sem arredondar para cima: 99,996% vira "99,99%", nunca "100,00%"
// enquanto falta seção (o TSE só dá 100% com todas totalizadas).
function pctPiso(v, casas) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v >= 100) return `${C.fNum(100, 0)}%`;
  const k = 10 ** casas;
  return `${C.fNum(Math.floor(v * k) / k, casas)}%`;
}
// Votos por extenso curto, com a preposição certa: "940 mil votos", "1,2 milhão de votos",
// "312 votos". Antes saía "57 mil de votos".
function votosDif(d, adj = '') {
  const a = Math.abs(d);
  const v = a === 1 ? 'voto' : 'votos';
  const x = adj ? `${v} ${adj}${a === 1 ? '' : 's'}` : v;
  if (a >= 1e6) return `${votosCurto(a)} de ${x}`;
  return `${votosCurto(a)} ${x}`;
}
const chanceTxt = (p) => {
  if (p === null || p === undefined || !Number.isFinite(p)) return '—';
  const v = p * 100;
  if (v > 0 && v < 1) return '<1%';
  if (v > 99 && v < 100) return '>99%';
  return `${C.fNum(arredPar(v), 0)}%`;
};
// Arredonda a chance de modo que os dois lados somem 100: com 33,5% × 66,5% saía "34% × 67%".
function arredPar(v) {
  return v > 50 ? 100 - Math.round(100 - v) : Math.round(v);
}
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
  // UFs fora do modelo_uf que ficaram com a reserva (1º turno + deslocamento): hoje, o
  // Exterior. Antes o aviso dizia que elas "partem da média nacional", o que não era verdade.
  const reservaUF = [];
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
      if (origem === 'modelo_uf') reservaUF.push(uf === 'ZZ' ? 'Exterior' : uf);
    } else if (origem !== 'nacional') {
      faltaUF += 1;
    }
    ufs.set(uf, b);
  }
  if (reservaUF.length) lac.push(`Fora do modelo por estado: ${reservaUF.join(', ')}. ${reservaUF.length === 1 ? 'Usa' : 'Usam'} o 1º turno mais o deslocamento nacional das pesquisas.`);
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

/* Arquivos (conferidos em 23/10/2026 contra o TSE e o ele-c.json):
 * - <uf>-c0001-e006258-u.json: votos do cargo 1 (Presidente) na UF, em br e em zz;
 *   ~3 KB, 880 bytes comprimido. dt/ht = última totalização (vazios antes da primeira).
 * - br-e006258-ab.json: a "abrangência", com seções e eleitorado totalizados de cada UF
 *   e do Brasil num arquivo só (26 KB, 1,2 KB comprimido), sem votos. Serve para saber
 *   quais UFs mudaram sem pedir as 28. Não existe arquivo simplificado ("-r.json") em 2026.
 * O TSE libera CORS para qualquer origem e aceita If-None-Match/If-Modified-Since. */
const HOST_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;
// ?tse=http://127.0.0.1:PORTA aponta a leitura para o simulador. Só vale com a página
// aberta em host local E apontando para host local: em produção (douglora.github.io) o
// parâmetro é ignorado, então um link com ?tse= nunca muda a fonte de quem abre.
function fonteTeste(q) {
  const v = q?.get?.('tse');
  if (!v) return null;
  try {
    if (!HOST_LOCAL.test(location.hostname)) return null;
    const u = new URL(v);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !HOST_LOCAL.test(u.hostname)) return null;
    return `${u.origin}/oficial/ele2026`;
  } catch {
    return null;
  }
}
const codEleicao = () => String(A.eleicao).padStart(6, '0');
function urlTSE(uf) {
  const u = uf.toLowerCase();
  return `${A.fonte}/${A.eleicao}/dados/${u}/${u}-c0001-e${codEleicao()}-u.json`;
}
const urlAB = () => `${A.fonte}/${A.eleicao}/dados/br/br-e${codEleicao()}-ab.json`;

function lerTSE(j) {
  if (!obj(j)) throw falha('arquivo do TSE em formato inesperado');
  const s = obj(j.s) || {};
  const e = obj(j.e) || {};
  const v = obj(j.v) || {};
  const cand = new Map();
  for (const ag of arr(j.carg?.[0]?.agr)) for (const p of arr(ag?.par)) for (const c of arr(p?.cand)) cand.set(String(c?.sqcand), c);
  const cl = cand.get(MODELO.SQ.lula);
  const cf = cand.get(MODELO.SQ.flavio);
  if (!cl || !cf) throw falha('arquivo do TSE sem Lula ou sem Flávio');
  // O TSE marca e = "s" e st = "Eleito" quando declara o eleito (no 1º turno, e = "s"
  // vinha com st = "2º turno": isso não conta).
  const eleito = (c) => c?.e === 's' && /eleit/i.test(String(c?.st || '')) && !/n[ãa]o/i.test(String(c?.st || ''));
  return {
    st: pBR(s.st),
    ts: pBR(s.ts),
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
    eleito: eleito(cl) ? 'lula' : eleito(cf) ? 'flavio' : null,
    tTot: msTSE(j.dt, j.ht),
    tGer: msTSE(j.dg, j.hg),
    idg: pBR(j.idg),
    em: Date.now(),
  };
}
// Abrangência: seções totalizadas por UF (só para saber quem mudou) e as do Brasil.
function lerAbrangencia(j) {
  if (!obj(j) || !Array.isArray(j.abr)) throw falha('abrangência do TSE em formato inesperado');
  const ufs = new Map();
  let br = null;
  for (const x of j.abr) {
    const cd = String(x?.cdabr || '').toUpperCase();
    const st = pBR(x?.s?.st);
    if (st === null) continue;
    const it = { st, ts: pBR(x?.s?.ts), tTot: msTSE(x?.dt, x?.ht) };
    if (cd === 'BR') br = it;
    else if (UFS.includes(cd)) ufs.set(cd, it);
  }
  return { ufs, br, tTot: br?.tTot ?? null, st: br?.st ?? 0, tGer: msTSE(j.dg, j.hg), idg: pBR(j.idg) };
}
// > 0 quando b é uma versão mais nova que a do mesmo arquivo. Ordem: hora da totalização
// (dt/ht), seções totalizadas, hora de geração do arquivo. As bordas do Akamai não ficam
// em sincronia: uma pode entregar uma versão de minutos atrás depois de outra já ter
// entregado a nova. Sem esta régua, a tela voltava para números velhos (e podia anunciar
// uma "troca de liderança" que não houve).
function compVersao(a, b) {
  if (!a) return 1;
  const ta = a.tTot ?? -1;
  const tb = b.tTot ?? -1;
  if (ta !== tb) return tb - ta;
  const sa = a.st ?? -1;
  const sb = b.st ?? -1;
  if (sa !== sb) return sb - sa;
  return (b.tGer ?? 0) - (a.tGer ?? 0) || (b.idg ?? 0) - (a.idg ?? 0);
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
  const cont = vistaNacional(linhas, { estTot, teTot, fNac, vvCont });
  const lidos = linhas.filter((u) => u.o).length;
  const semLeitura = linhas.filter((u) => !u.o).map((u) => u.uf);
  // Projeção completa = todas as UFs lidas. Uma UF que não responde (TSE fora do ar só
  // para ela, JSON quebrado) não pode segurar a projeção a noite inteira: depois de duas
  // tentativas com erro, ou 45 s de leitura, ela entra pela prévia e a tela avisa.
  // O relógio conta da primeira resposta boa do TSE, não da abertura da página: com o TSE
  // fora do ar na abertura, a projeção saía assim que ele voltava, sem SP, MG e RJ, e a
  // chance pulava de 40% para 34% e depois 48% em meio minuto.
  const desistiu = (uf) => (R.tentou.get(uf) ?? 0) >= 2 && R.erros.has(uf);
  const desde = R.primeiroOk ? Date.now() - R.primeiroOk : 0;
  const completo =
    A.modo === 'sim' || semLeitura.length === 0 || (desde > 20000 && semLeitura.every(desistiu)) || desde > 120000;
  const totalVal = vvCont + rem;
  const proj = {
    L: projL,
    F: projF,
    pL: totalVal > 0 ? (projL / totalVal) * 100 : null,
    pF: totalVal > 0 ? (projF / totalVal) * 100 : null,
    parL: projL + projF > 0 ? (projL / (projL + projF)) * 100 : null,
  };
  // Matematicamente definido: quem está atrás não alcança nem com todo o eleitorado que
  // falta (eleitores das seções não totalizadas, pela mesma fonte do apurado na tela).
  const remMaxCont = Math.max(0, cont.te - cont.est);
  const dif = cont.L - cont.F;
  const definido = cont.L + cont.F > 0 && Math.abs(dif) > remMaxCont ? (dif > 0 ? 'lula' : 'flavio') : null;
  // Concluída pelas seções (st = ts), não pelo percentual: "pst" arredondado chega a
  // "100,00" com dezenas de seções faltando.
  const tudo =
    cont.L + cont.F > 0 && (cont.ts > 0 && cont.st !== null ? cont.st >= cont.ts : cont.pst >= 100 || remMaxCont === 0);
  const eleitoTSE = A.br?.eleito ?? null;
  const decidido = tudo || !!definido || !!eleitoTSE;
  // Votos válidos que faltam, na mesma régua do apurado da tela: a projeção por UF dá a
  // taxa (válidos por eleitor ainda não totalizado) e o apurado dá quantos eleitores
  // faltam. Antes, "precisa de X%" misturava a diferença do arquivo Brasil com o estoque
  // das UFs, que podia estar alguns minutos atrás (ou à frente).
  const taxa = remMax > 0 ? rem / remMax : 0.75;
  const remCont = remMaxCont * taxa;
  let pL;
  if (tudo || definido) {
    pL = dif > 0 ? 1 : dif < 0 ? 0 : 0.5;
  } else if (eleitoTSE) {
    pL = eleitoTSE === 'lula' ? 1 : 0;
  } else {
    // 100% e 0% ficam para quando está decidido; antes disso, no máximo ">99%".
    pL = clamp(montecarlo(linhas, projL, projF, rem), 0.001, 0.999);
  }
  return {
    linhas, swing, g, fNac, rem, remCont, remMax: remMaxCont, cont, proj, pL, definido, tudo, eleitoTSE, decidido,
    lidos, semLeitura, completo, totalVal,
  };
}

// O "apurado agora" da tela. Fonte principal: o arquivo Brasil. A soma das 28 UFs só
// substitui o Brasil quando é comprovadamente mais nova (todas as UFs lidas numa
// totalização igual ou posterior à do Brasil, com mais seções): acontece quando a borda
// do cache segura o arquivo Brasil e solta os estados. E o número na tela nunca diminui:
// se a candidata tem menos votos que a já mostrada, fica a já mostrada (a não ser um
// arquivo Brasil de totalização posterior, que é a palavra oficial, inclusive em correção).
function vistaNacional(linhas, t) {
  const lidas = linhas.filter((u) => u.o);
  const soma = (k) => lidas.reduce((s, u) => s + (u.o[k] ?? 0), 0);
  let somaUF = null;
  if (lidas.length) {
    const todas = lidas.length === UFS.length;
    const ts = todas && lidas.every((u) => u.o.ts !== null) ? soma('ts') : null;
    const st = lidas.every((u) => u.o.st !== null) ? soma('st') : null;
    const tTot = lidas.every((u) => u.o.tTot !== null) ? Math.max(...lidas.map((u) => u.o.tTot)) : null;
    somaUF = {
      fonte: 'estados', todas, L: soma('L'), F: soma('F'), st, ts, est: t.estTot, te: t.teTot, c: soma('c'), vv: t.vvCont,
      pst: ts && st !== null ? (st / ts) * 100 : t.fNac * 100, tTot, pL: null, pF: null,
    };
  }
  const br = A.br ? { fonte: 'br', ...A.br } : null;
  let cand = br || somaUF;
  // Brasil sem resposta há mais de 1 min e a soma das UFs comprovadamente mais nova: a soma
  // entra (com aviso na linha da hora). Com o Brasil respondendo, fica o Brasil, mesmo um
  // pouco atrás das UFs: é o número que o site do TSE mostra, e a soma de UFs lidas em
  // momentos diferentes não bate com nenhuma totalização do TSE.
  const brParado = br && R.erros.has('br') && Date.now() - (br.em ?? 0) > 60000;
  if (
    brParado && somaUF && somaUF.todas && br.tTot !== null && somaUF.st !== null && br.st !== null &&
    lidas.every((u) => u.o.tTot !== null && u.o.tTot >= br.tTot) && somaUF.st > br.st
  ) cand = somaUF;
  const v = A.vista;
  if (v && cand && cand !== v) {
    const domina = cand.L >= v.L && cand.F >= v.F && (cand.st ?? 0) >= (v.st ?? 0) && cand.est >= v.est;
    const brNovo = cand.fonte === 'br' && cand.tTot !== null && (v.tTot === null || cand.tTot > v.tTot);
    if (!domina && !brNovo) cand = v;
  }
  if (!cand) cand = { fonte: 'nada', L: 0, F: 0, st: 0, ts: null, est: 0, te: t.teTot, c: 0, vv: 0, pst: 0, tTot: null, pL: null, pF: null };
  A.vista = cand;
  const c = { ...cand };
  if ((c.pL === null || c.pL === undefined) && c.vv > 0) {
    c.pL = (c.L / c.vv) * 100;
    c.pF = (c.F / c.vv) * 100;
  }
  return c;
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
  // Com a eleição decidida (conta ou TSE), "virada" e "quanto precisa" deixam de fazer sentido.
  const aberta = contando && !r.decidido;
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
          ? h`Apuração concluída: ${n('lula')} <b>${pct2(c.pL)}</b> × ${n('flavio')} <b>${pct2(c.pF)}</b> dos votos válidos, diferença de <b>${votosDif(c.L - c.F)}</b>. Resultado oficial: TSE.`
          : h`Apuração concluída: ${n('flavio')} <b>${pct2(c.pF)}</b> × ${n('lula')} <b>${pct2(c.pL)}</b> dos votos válidos, diferença de <b>${votosDif(c.L - c.F)}</b>. Resultado oficial: TSE.`,
    });
  } else if (r.definido) {
    out.push({
      id: 'definido',
      p: 100,
      tom: 'forte',
      html: h`Matematicamente definido: a diferença de <b>${votosDif(c.L - c.F)}</b> é maior que todo o eleitorado que falta apurar. ${n(r.definido)} não pode mais ser alcançado.`,
    });
  } else if (r.eleitoTSE) {
    out.push({
      id: 'eleito-tse',
      p: 100,
      tom: 'forte',
      html: h`O TSE já declarou <b>${n(r.eleitoTSE)}</b> eleito, com ${pctPiso(c.pst, 2)} das seções apuradas.`,
    });
  }
  if (aberta && lp && lc && lp !== lc) {
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
      html: h`A liderança da contagem trocou de mãos às <b>${C.fHora(troca.t)}</b>, com ${pctPiso(troca.pst, 1)} apurado: <b>${n(troca.lider)}</b> passou à frente.`,
    });
  }
  if (aberta && lc && r.remCont > 0) {
    const atras = lc === 'lula' ? 'flavio' : 'lula';
    const def = Math.abs(c.L - c.F);
    const precisa = ((r.remCont + def) / (2 * r.remCont)) * 100;
    out.push({
      id: 'precisa',
      p: 80,
      html:
        precisa > 100
          ? h`Para virar, ${n(atras)} precisaria de mais votos do que a estimativa dos que ainda faltam contar (<b>${votosCurto(r.remCont)}</b>).`
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
        html: h`${rapido} já totalizaram <b>${pctPiso(Math.max(ss, nn), 0)}</b> do eleitorado; ${lento}, <b>${pctPiso(Math.min(ss, nn), 0)}</b>. A contagem ainda não mostra o peso de ${lento}.`,
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
        html: h`Faltam cerca de <b>${votosDif(r.remCont, 'válido')}</b>; <b>${C.fNum((emLula / comBase) * 100, 0)}%</b> deles em estados onde ${n('lula')} teve mais votos que ${n('flavio')} no 1º turno.`,
      });
    }
    const maior = [...r.linhas].sort((a, b) => b.rem - a.rem)[0];
    if (maior && maior.rem > 0) {
      const liq = maior.rem * (2 * maior.share - 1);
      const quem = liq >= 0 ? 'lula' : 'flavio';
      out.push({
        id: `estoque-${maior.uf}`,
        p: 55,
        html: h`Maior estoque de votos ainda por contar: <b>${maior.uf === 'ZZ' ? 'Exterior' : maior.uf}</b> (${pctPiso(maior.f * 100, 0)} apurado), deve render <b>+${votosCurto(Math.abs(liq))}</b> a ${n(quem)}.`,
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
        html: h`Maior vantagem${r.tudo ? '' : ' até agora'}: <b>${maiorV.uf === 'ZZ' ? 'Exterior' : maiorV.uf}</b>, +${votosDif(maiorV.L - maiorV.F)} para ${n(quem)}.`,
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

// Cada ladrilho mostra os números de uma vez, sem precisar tocar: a projeção do estado
// (antes do primeiro voto, a prévia) em "L 52,1" e "F 47,9", e, durante a contagem, o
// apurado e a barra de seções. Tocar abre o detalhe, como extra.
function htmlMapa(contagem) {
  const h = C.h;
  const miolo = (rot) => h`<span class="lad-uf">${rot}</span>
    <span class="lad-n lad-nl" aria-hidden="true"><span class="lad-k">L</span> <span data-pl>—</span></span>
    <span class="lad-n lad-nf" aria-hidden="true"><span class="lad-k">F</span> <span data-pf>—</span></span>
    ${contagem
      ? h`<span class="lad-a" aria-hidden="true"><span class="lad-sv">sem votos</span><span class="lad-av"><span class="lad-ar">apur. </span><span data-al>—</span><span class="lad-ax"><span class="lad-ar"> </span>·<span class="lad-ar"> </span></span><span data-af>—</span></span></span>
    <span class="lad-s" aria-hidden="true"><span class="lad-barra"><i data-b></i></span><span class="lad-sp" data-sp>0%</span></span>`
      : ''}`;
  const lad = UFS.filter((u) => u !== 'ZZ').map((uf) => {
    const [c, l] = GRADE[uf];
    return h`<button type="button" class="lad" data-uf="${uf}" style="grid-column:${c};grid-row:${l}" aria-label="${NOME_UF[uf]}">${miolo(uf)}</button>`;
  });
  return h`<div class="ap-mapa v2${contagem ? ' com-contagem' : ''}" role="group" aria-label="Mapa de ladrilhos dos estados" style="--lad-l:${rgb(misturar(C.cand('lula').cor, '#000000', 0.3))};--lad-f:${rgb(misturar(C.cand('flavio').cor, '#000000', 0.3))}">
    ${lad}
    <button type="button" class="lad lad-ext" data-uf="ZZ" style="grid-column:4 / span 3;grid-row:8" aria-label="Exterior">${miolo('Exterior')}</button>
  </div>`;
}

// Troca o número contando do valor antigo ao novo; devolve true quando o valor mudou
// (a primeira pintura não conta como mudança).
function numLad(el, para, fmt) {
  if (!el) return false;
  if (el._v === para) return false;
  const mudou = el._v !== undefined;
  animarNumero(el, para, fmt, 600);
  return mudou;
}
const um = (v) => Math.round(v * 10) / 10;
const f1 = (v) => C.fNum(v, 1);
// Seções: piso (99,6% fica 99%) e "<1%" quando já há seção contada mas não chega a 1%.
const fSec = (v) => (v > 0 && v < 1 ? '<1%' : `${C.fNum(Math.floor(v), 0)}%`);

// Acende uma vez (0,6 s). Na noite real a leitura é a cada 10 s; na simulação acelerada
// os números mudam a cada segundo, e o intervalo mínimo de 4 s por estado evita que o
// mapa fique piscando sem parar.
function brilhar(el) {
  if (reduzMovimento()) return;
  const agora = Date.now();
  if (el._brilhoEm && agora - el._brilhoEm < 4000) return;
  el._brilhoEm = agora;
  el.classList.remove('brilha');
  void el.offsetWidth;
  el.classList.add('brilha');
  clearTimeout(el._brilho);
  el._brilho = setTimeout(() => el.classList.remove('brilha'), 650);
}

function atualizarMapa(r) {
  const contagem = A.modo !== 'pre';
  for (const u of r.linhas) {
    const el = $(`.lad[data-uf="${u.uf}"]`);
    if (!el) continue;
    const prev = u.shareObs === null;
    // Projeção do estado em % dos votos dados aos dois; antes do primeiro voto é a prévia.
    const pj = u.projL + u.projF > 0 ? u.projL / (u.projL + u.projF) : u.share;
    const quem = pj >= 0.5 ? 'lula' : 'flavio';
    const margem = Math.abs(pj - 0.5) * 2;
    const cor = corLadrilhoNum(C.cand(quem).cor, margem, prev);
    el.style.background = cor.fundo;
    el.style.color = cor.tinta;
    const [br, bg, bb] = hexRgb(C.cand(quem).cor);
    el.style.setProperty('--brilho', `rgba(${br},${bg},${bb},0.55)`);
    el.classList.toggle('prev', prev);
    el.classList.toggle('lid-l', quem === 'lula');
    el.classList.toggle('lid-f', quem === 'flavio');
    el.classList.toggle('sel', A.ufSel === u.uf);
    const pL = um(pj * 100);
    const pF = um(100 - pL);
    let mudou = numLad(el.querySelector('[data-pl]'), pL, f1);
    mudou = numLad(el.querySelector('[data-pf]'), pF, f1) || mudou;
    const sec = Number.isFinite(u.o?.pst) ? u.o.pst : u.f * 100;
    const secP = sec >= 100 ? 100 : sec >= 1 ? Math.floor(sec) : sec > 0 ? 0.5 : 0;
    let aL = null;
    if (contagem) {
      const al = el.querySelector('[data-al]');
      const af = el.querySelector('[data-af]');
      if (prev) {
        for (const x of [al, af]) if (x && x.textContent !== '—') { x._v = undefined; x.textContent = '—'; }
      } else {
        aL = um(u.shareObs * 100);
        mudou = numLad(al, aL, f1) || mudou;
        mudou = numLad(af, um(100 - aL), f1) || mudou;
      }
      mudou = numLad(el.querySelector('[data-sp]'), secP, fSec) || mudou;
      const bar = el.querySelector('[data-b]');
      if (bar) bar.style.width = `${clamp(sec, 0, 100).toFixed(1)}%`;
    }
    if (mudou) brilhar(el);
    const nome = u.uf === 'ZZ' ? 'Exterior' : NOME_UF[u.uf];
    el.setAttribute(
      'aria-label',
      `${nome}: ${prev ? 'prévia' : 'projeção'} ${C.curto('lula')} ${f1(pL)}%, ${C.curto('flavio')} ${f1(pF)}%` +
        (contagem ? (aL !== null ? `; apurado ${f1(aL)}% a ${f1(um(100 - aL))}%` : '; ainda sem votos') + `; ${fSec(secP)} das seções` : ''),
    );
  }
  atualizarDetalheUF(r);
}

function atualizarDetalheUF(r) {
  const caixa = $('[data-ap-uf]');
  if (!caixa) return;
  const u = r.linhas.find((x) => x.uf === A.ufSel);
  // Sem estado escolhido o painel some: os números já estão nos ladrilhos.
  caixa.hidden = !u;
  if (!u) {
    htmlEm('[data-ap-uf]', '');
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
      <p class="ap-uf-l">${u.o ? h`<b>${pctPiso(u.f * 100, 1)}</b> do eleitorado apurado` : 'Ainda sem leitura deste estado'}${u.o ? h` · ${C.fInt(u.L + u.F)} votos nos dois` : ''}</p>
      <table class="tab"><thead><tr><th style="width:30%">% do par</th><th class="n">Apurado</th><th class="n">Prévia</th><th class="n">Projeção</th></tr></thead><tbody>${linha('lula')}${linha('flavio')}</tbody></table>
      <p class="ap-uf-l">Faltam cerca de <b>${votosDif(u.rem, 'válido')}</b>${u.rem > 0 ? h`; devem render <b>+${votosCurto(Math.abs(liq))}</b> a ${C.curto(liq >= 0 ? 'lula' : 'flavio')}` : ''}.</p>
      <p class="ap-uf-l">Comparecimento: ${u.compObs !== null ? h`<b>${C.fNum(u.compObs * 100, 1)}%</b> até agora` : 'sem leitura ainda'} (prévia ${C.fNum(u.b.comp * 100, 1)}%).</p>
      ${elTxt}
      <p class="fonte">Prévia: ${u.b.fonte}. Peso da observação neste estado: ${C.fNum(u.w * 100, 0)}%.</p>`,
  );
}

/* ============================================================= gráficos */

// Teto da série guardada; acima dele os pontos mais antigos são afinados (ver afinarSerie).
const SERIE_MAX = 1200;
function pontoSerie(r) {
  // Hora da totalização; se o arquivo vier sem dt/ht com votos já contados (não aconteceu no
  // 1º turno, mas o gráfico não pode depender disso), vale a hora de geração do arquivo.
  const t = A.modo === 'sim' ? A.sim.relogio : r.cont.tTot ?? (r.cont.pst > 0 ? r.cont.tGer ?? null : null);
  // Sem hora de totalização (antes da primeira) não há ponto. Antes entrava Date.now(), que
  // misturava o relógio do aparelho com o do TSE (e um relógio adiantado travava a série).
  if (!Number.isFinite(t)) return false;
  const p = {
    t,
    pst: r.cont.pst,
    pL: r.pL,
    aL: r.cont.L + r.cont.F > 0 ? (r.cont.L / (r.cont.L + r.cont.F)) * 100 : null,
    jL: r.proj.parL,
  };
  const n = A.serie.length;
  const ult = A.serie[n - 1];
  if (ult && t < ult.t) return false;
  if (ult && t === ult.t) {
    // Mesma totalização: refaz o último ponto (a projeção muda a cada UF lida). Antes cada
    // UF lida virava um ponto novo com a mesma hora: o teto de 1.500 chegava em ~50 min e o
    // gráfico perdia o começo da noite.
    if (ult.pst === p.pst && ult.pL === p.pL && ult.jL === p.jL && ult.aL === p.aL) return false;
    A.serie[n - 1] = p;
    marcarTroca(A.serie[n - 2], p);
  } else {
    marcarTroca(ult, p);
    A.serie.push(p);
  }
  if (A.serie.length > SERIE_MAX) afinarSerie();
  guardarSerie();
  return true;
}
// Troca de liderança da contagem entre dois pontos seguidos (refeita se o ponto foi refeito).
function marcarTroca(ant, p) {
  const ult = A.trocas[A.trocas.length - 1];
  if (ult && ult.t === p.t) A.trocas.pop();
  if (ant && ant.aL !== null && p.aL !== null && (ant.aL - 50) * (p.aL - 50) < 0) {
    A.trocas.push({ t: p.t, pst: p.pst, lider: p.aL > 50 ? 'lula' : 'flavio' });
    if (A.trocas.length > 50) A.trocas.splice(0, A.trocas.length - 50);
  }
}
// Noite longa: nos dois terços mais antigos fica um ponto sim, um não. O começo da noite
// continua no gráfico, com menos detalhe; o fim fica inteiro.
function afinarSerie() {
  const s = A.serie;
  const corte = Math.floor((s.length * 2) / 3);
  A.serie = [...s.slice(0, corte).filter((_, i) => i % 2 === 0), ...s.slice(corte)];
}
const chaveSerie = () => `radar2t.apuracao.${A.eleicao}${A.fonteTeste ? '.teste' : ''}`;
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
  // Só pontos da contagem desta eleição: a versão anterior gravava pontos com a hora do
  // aparelho antes da primeira totalização (por exemplo, quem abriu ?eleicao=6258 antes do
  // domingo), o que esticaria o eixo do gráfico por dias.
  const fe = A.eleicao === MODELO.ELEICAO ? C.msDe(C.dados()?.eleicao?.fechamento) ?? C.msDe('2026-10-25T17:00:00-03:00') : null;
  const vale = (p) => Number.isFinite(p?.t) && (fe === null || p.t >= fe - 600000) && p.t <= Date.now() + 864e5;
  try {
    const s = JSON.parse(localStorage.getItem(chaveSerie()) || 'null');
    if (Array.isArray(s?.serie)) A.serie = s.serie.filter((p) => vale(p) && Number.isFinite(p.pst) && p.pst > 0).slice(-SERIE_MAX);
    if (Array.isArray(s?.trocas)) A.trocas = s.trocas.filter(vale).slice(-50);
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
    // Mesmo arredondamento do placar: 99,9% é ">99", não "100" (100 fica para o decidido).
    vFmt: (v) => (v > 99 && v < 100 ? '>99' : v > 0 && v < 1 ? '<1' : C.fNum(arredPar(v), 0)),
    minDist: 56,
    dica: (t) =>
      C.h`<p class="dica-tit">${C.fHora(t)} · ${pctPiso(pst.get(t), 1)} apurado</p><p class="dica-l"><i class="lk" style="--c:${L.cor}"></i><b>${chanceTxt(mL.get(t) / 100)}</b><span>${C.curto('lula')}</span></p><p class="dica-l"><i class="lk" style="--c:${F.cor}"></i><b>${chanceTxt(mF.get(t) / 100)}</b><span>${C.curto('flavio')}</span></p>`,
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
      C.h`<p class="dica-tit">${C.fHora(t)} · ${pctPiso(pst.get(t), 1)} apurado</p>
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
      <p class="nota">Leitura do TSE: Brasil a cada 10 segundos; cada estado assim que o TSE mostra que ele mudou (e ao menos a cada minuto). O próprio TSE guarda cada arquivo de 30 a 60 segundos antes de trocar. Fonte: resultados.tse.jus.br.</p>
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
    ${A.fonteTeste ? h`<div class="alerta"><p><b>Fonte de teste: simulador local</b> (${A.fonteTeste.replace(/\/oficial\/ele2026$/, '')}). Números fictícios.</p></div>` : ''}
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
      <div class="ap-mapa-wrap v2">
        <div>${htmlMapa(true)}
          <p class="ap-leg">Projeção de cada estado (antes da contagem: prévia) · L = ${C.curto('lula')}, F = ${C.curto('flavio')} · linha menor = apurado até agora · barra = seções apuradas · tracejado = estado ainda sem votos. Toque num estado para o detalhe.</p>
        </div>
        <div class="ap-uf" data-ap-uf hidden></div>
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
      <p class="texto">A partir das 17h, esta aba lê o TSE (Tribunal Superior Eleitoral) a cada 10 segundos e mostra, sem você precisar recarregar:</p>
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
      <div class="ap-mapa-wrap v2">
        <div>${htmlMapa(false)}<p class="ap-leg">Projeção de cada estado (antes da contagem: prévia) · L = ${C.curto('lula')}, F = ${C.curto('flavio')} · cor de quem deve liderar, mais forte = margem maior. Na apuração entram o apurado e a barra de seções.</p></div>
        <div class="ap-uf" data-ap-uf hidden></div>
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
  // (salvo se já está decidido: 100% apurado, matematicamente definido ou eleito pelo TSE).
  const decidido = r.decidido;
  pintarChance(!r.completo && temVoto && !decidido ? null : r.pL);
  for (const id of ['lula', 'flavio']) {
    animarNumero($(`[data-votos="${id}"]`), id === 'lula' ? c.L : c.F, (v) => C.fInt(v));
    const el = $(`[data-pct="${id}"]`);
    if (el) el.textContent = temVoto ? pct2(id === 'lula' ? c.pL : c.pF) : '—';
  }
  const def = $('[data-ap-def]');
  if (def) {
    const msg = r.tudo && temVoto ? ' · apuração concluída' : r.definido ? ' · matematicamente definido' : r.eleitoTSE ? ' · eleito declarado pelo TSE' : '';
    def.hidden = !msg;
    def.textContent = msg;
  }
  // Sem arredondar para cima: 99,996% aparecia como "100,00%" com seções faltando.
  texto('[data-ap-pst]', r.tudo ? '100%' : c.pst <= 0 ? '0%' : pctPiso(c.pst, 2));
  const barra = $('[data-ap-barra]');
  if (barra) barra.style.width = `${clamp(c.pst, 0, 100)}%`;
  const falta = r.semLeitura.map((uf) => (uf === 'ZZ' ? 'Exterior' : uf));
  texto(
    '[data-ap-lidos]',
    A.modo === 'sim'
      ? 'simulação acelerada'
      : `${r.lidos} de ${UFS.length} estados lidos${falta.length && r.completo ? ` · sem leitura agora: ${falta.slice(0, 4).join(', ')}${falta.length > 4 ? '…' : ''} (entram pela prévia)` : ''}`,
  );
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
  const temVirada = r.completo && temVoto && !r.decidido && lc && lp && lc !== lp;
  if (vir) {
    vir.hidden = !temVirada;
    if (temVirada) vir.textContent = `A projeção aponta virada: ${C.curto(lp)} termina à frente, embora ${C.curto(lc)} lidere a contagem agora.`;
  }
  if (r.completo) {
    renderInsights(calcularInsights(r));
    if (pontoSerie(r)) for (const g of $$('[data-grafico^="apur-"]')) C.desenharGrafico(g);
  } else {
    renderInsights(calcularInsights(r).filter((x) => ['aguardando', 'comparecimento', 'concluida', 'definido', 'eleito-tse'].includes(x.id)));
  }
  atualizarMapa(r);
}

// Hora com segundos ("19:42:10"): a cada 10 s de leitura, minuto só não diz se está andando.
function hms(t) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(t);
}
function atualizarHora() {
  const el = $('[data-ap-hora]');
  if (!el || !A.res) return;
  if (A.modo === 'sim') {
    el.textContent = `Hora simulada: ${C.fHora(A.sim.relogio)} · 3h30 de apuração em 2 minutos · um passo por segundo`;
    return;
  }
  const agora = Date.now();
  const t = A.res.cont.tTot;
  const partes = [];
  partes.push(
    t
      ? `Última totalização do TSE: ${C.fDataHora(t).replace(/ às .*/, '')} às ${hms(t)}`
      : A.res.cont.pst > 0
        ? 'TSE totalizando (arquivo sem a hora da totalização)'
        : 'O TSE ainda não totalizou nenhuma seção',
  );
  // Erro vira aviso discreto, nunca tela quebrada: os números ficam os da última leitura boa.
  const e = R.erros.get('br');
  const falta = Math.max(0, Math.ceil(((R.prox.get('br') ?? agora) - agora) / 1000));
  if (R.emVoo.has('br') && !e) partes.push('lendo o TSE…');
  else if (e) partes.push(`TSE instável (${e.msg}); nova tentativa em ${falta} s`);
  else partes.push(`próxima leitura em ${falta} s`);
  if (A.res.cont.fonte === 'estados') partes.push('apurado = soma dos estados, enquanto o arquivo Brasil não responde');
  if (R.okEm && agora - R.okEm > MODELO.SEM_RESPOSTA_MS) partes.push(`sem resposta do TSE desde ${hms(R.okEm)}; os números são dessa hora`);
  else if (!R.okEm && R.inicio && agora - R.inicio > MODELO.SEM_RESPOSTA_MS) partes.push('o TSE ainda não respondeu desde que a página abriu');
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

/* Como a página lê o TSE (revisto em 23/10/2026 contra o simulador de
 * work/pocket/qa_apuracao/sim_tse.py, com 503, 429, resposta de 8 s, JSON cortado, UF
 * parada, Brasil à frente e atrás dos estados e versão velha depois da nova):
 * - Um relógio de 1 s decide o que pedir. Cada arquivo tem no máximo um pedido no ar,
 *   com tempo-limite. Antes o Brasil era pedido de novo a cada segundo enquanto a
 *   resposta não chegava (TSE lento = 8 pedidos simultâneos, e o mais velho podia chegar
 *   por último), e as UFs empilhavam um pedido a cada 2 s.
 * - Brasil a cada 10 s. Abrangência a cada 10 s: diz quais UFs mudaram; essas são
 *   relidas na hora (até 4 no ar, primeiro as com mais eleitorado por apurar) e de novo
 *   em 3, 6, 12… s se a borda do cache ainda entregar a versão anterior. Rede de
 *   segurança: toda UF em contagem é relida ao menos a cada 60 s (15 s sem abrangência).
 *   Se a abrangência mostra o Brasil à frente do arquivo Brasil lido, ele é relido já.
 * - cache: 'no-cache': o navegador revalida com If-None-Match/If-Modified-Since e, sem
 *   mudança, o TSE devolve 304 (~200 bytes). Nada de parâmetro para furar o cache. Depois
 *   de um JSON cortado, o próximo pedido daquele arquivo é cache: 'reload' (sem isso o
 *   navegador revalidava, recebia 304 e reusava o corpo cortado até a próxima versão).
 * - Versão mais velha que a já lida é descartada (compVersao).
 * - Erro: nova tentativa em 5, 10, 20, 40 s, até 1 min; 429 pausa tudo por 30 s; três
 *   erros seguidos pausam UFs e abrangência e só o Brasil sonda até o TSE voltar.
 * - Aba do navegador em segundo plano, ou outra aba da página aberta: continua lendo, em
 *   metade do ritmo (o navegador pode espaçar mais depois de 5 min oculta); ao voltar,
 *   lê na hora.
 */
const R = {
  relogio: null,
  emVoo: new Map(), // arquivo -> AbortController
  prox: new Map(), // arquivo -> não pedir antes de (ms)
  erros: new Map(), // arquivo -> { n, msg, status, cortado }
  tentou: new Map(), // UF -> pedidos feitos
  lidoEm: new Map(), // UF -> última resposta boa (ms)
  pend: new Map(), // UF -> { st, n }: a abrangência diz que há versão nova
  ab: null,
  abOk: false,
  abAtrasoDesde: 0, // desde quando o arquivo Brasil está à frente da abrangência
  pausaAte: 0,
  falhasSeguidas: 0,
  okEm: 0,
  primeiroOk: 0,
  inicio: 0,
  velhas: 0,
  pedidos: 0,
  tela: null,
};

function zerarLeitura() {
  for (const ctl of R.emVoo.values()) ctl?.abort?.();
  clearTimeout(R.relogio);
  clearTimeout(R.tela);
  R.relogio = null;
  R.tela = null;
  for (const k of ['emVoo', 'prox', 'erros', 'tentou', 'lidoEm', 'pend']) R[k] = new Map();
  R.ab = null;
  R.abOk = false;
  R.abAtrasoDesde = 0;
  R.pausaAte = 0;
  R.falhasSeguidas = 0;
  R.okEm = 0;
  R.primeiroOk = 0;
  R.inicio = 0;
  R.velhas = 0;
  R.pedidos = 0;
}

function falha(msg, status = 0) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

async function baixarJSON(chave, url) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  R.emVoo.set(chave, ctl);
  R.pedidos += 1;
  const recarregar = !!R.erros.get(chave)?.cortado;
  const limite = setTimeout(() => ctl?.abort(), MODELO.LIMITE_MS);
  try {
    let r;
    try {
      r = await fetch(url, { cache: recarregar ? 'reload' : 'no-cache', signal: ctl?.signal });
    } catch (e) {
      throw falha(e?.name === 'AbortError' ? `demorou mais de ${MODELO.LIMITE_MS / 1000} s` : 'sem conexão');
    }
    if (!r.ok) throw falha(r.status === 429 ? 'pediu uma pausa, HTTP 429' : `HTTP ${r.status}`, r.status);
    let txt;
    try {
      txt = await r.text();
    } catch (e) {
      throw falha(e?.name === 'AbortError' ? `demorou mais de ${MODELO.LIMITE_MS / 1000} s` : 'resposta interrompida');
    }
    try {
      return JSON.parse(txt);
    } catch {
      const e = falha('arquivo veio incompleto');
      e.cortado = true;
      throw e;
    }
  } finally {
    clearTimeout(limite);
    if (R.emVoo.get(chave) === ctl) R.emVoo.delete(chave);
  }
}

const ritmo = () => (document.hidden || !A.ativo ? MODELO.OCULTA_FATOR : 1);

function deuCerto(chave) {
  R.erros.delete(chave);
  R.falhasSeguidas = 0;
  R.pausaAte = 0;
  R.okEm = Date.now();
  if (!R.primeiroOk) R.primeiroOk = R.okEm;
}

function deuErro(chave, e) {
  const agora = Date.now();
  const n = (R.erros.get(chave)?.n ?? 0) + 1;
  let espera = Math.min(MODELO.ESPERA_MAX_MS, MODELO.ESPERA_MIN_MS * 2 ** (n - 1));
  if (e.status === 429) espera = Math.max(espera, MODELO.ESPERA_429_MS);
  // Espalha as novas tentativas (muitos aparelhos não voltam todos no mesmo segundo).
  espera *= 0.85 + Math.random() * 0.3;
  R.erros.set(chave, { n, msg: String(e?.message || e).slice(0, 60), status: e.status ?? 0, cortado: !!e.cortado });
  R.prox.set(chave, agora + espera);
  if (chave === 'ab') return; // abrangência é ajuda: falha dela não pausa a leitura
  R.falhasSeguidas += 1;
  if (e.status === 429) R.pausaAte = Math.max(R.pausaAte, agora + MODELO.ESPERA_429_MS);
  else if (R.falhasSeguidas >= 3) R.pausaAte = Math.max(R.pausaAte, agora + Math.min(MODELO.ESPERA_MAX_MS, MODELO.ESPERA_MIN_MS * 2 ** Math.min(4, R.falhasSeguidas - 3)));
  // Fim da pausa: o Brasil é o primeiro a sondar (antes as UFs voltavam antes dele e a tela
  // mostrava por alguns segundos a soma parcial dos estados).
  if (R.pausaAte > agora && (R.prox.get('br') ?? 0) > R.pausaAte) R.prox.set('br', R.pausaAte);
}

// Junta as respostas que chegam juntas (até 4 UFs) num redesenho só.
function pedirTela() {
  if (R.tela) return;
  R.tela = setTimeout(() => {
    R.tela = null;
    atualizarTela();
  }, 60);
}

async function lerBR() {
  try {
    const novo = lerTSE(await baixarJSON('br', urlTSE('br')));
    deuCerto('br');
    if (compVersao(A.br, novo) >= 0) {
      A.br = novo;
      // Abrangência atrás do Brasil por mais de 45 s = abrangência parada ou com cache
      // longo: as UFs voltam ao ciclo curto (ver filaUF) até ela andar de novo.
      const abSt = R.ab?.br?.st;
      if (abSt !== undefined && abSt !== null && (novo.st ?? 0) > abSt) {
        if (!R.abAtrasoDesde) R.abAtrasoDesde = Date.now();
      } else R.abAtrasoDesde = 0;
      R.prox.set('br', Date.now() + MODELO.CADA_BR_MS * ritmo());
    } else {
      // Borda do cache com versão mais velha: descarta e tenta de novo mais cedo.
      R.velhas += 1;
      R.prox.set('br', Date.now() + (MODELO.CADA_BR_MS * ritmo()) / 2);
    }
  } catch (e) {
    deuErro('br', e);
  }
  pedirTela();
}

async function lerAB() {
  try {
    const ab = lerAbrangencia(await baixarJSON('ab', urlAB()));
    deuCerto('ab');
    R.abOk = true;
    if (compVersao(R.ab, ab) >= 0) {
      R.ab = ab;
      if (!A.br || (ab.br?.st ?? 0) >= (A.br.st ?? 0)) R.abAtrasoDesde = 0;
      for (const uf of UFS) {
        const x = ab.ufs.get(uf);
        const st = A.ufs.get(uf)?.st ?? -1;
        if (x && x.st > st) {
          if (!R.pend.has(uf)) R.pend.set(uf, { st: x.st, n: 0 });
          else R.pend.get(uf).st = Math.max(R.pend.get(uf).st, x.st);
        } else if (x) R.pend.delete(uf);
      }
      // O Brasil na abrangência já está à frente do arquivo Brasil lido: relê agora.
      if (ab.br && A.br && ab.br.st > (A.br.st ?? 0) && !R.erros.has('br')) R.prox.set('br', 0);
    }
    R.prox.set('ab', Date.now() + MODELO.CADA_AB_MS * ritmo());
  } catch (e) {
    deuErro('ab', e);
    // Sem abrangência (fora do ar ou formato novo): as UFs voltam ao ciclo curto.
    if ((R.erros.get('ab')?.n ?? 0) >= 2) R.abOk = false;
  }
}

async function lerUF(uf) {
  R.tentou.set(uf, (R.tentou.get(uf) ?? 0) + 1);
  try {
    const novo = lerTSE(await baixarJSON(uf, urlTSE(uf)));
    deuCerto(uf);
    if (compVersao(A.ufs.get(uf), novo) >= 0) A.ufs.set(uf, novo);
    else R.velhas += 1;
    R.lidoEm.set(uf, Date.now());
    const p = R.pend.get(uf);
    if (p) {
      if ((A.ufs.get(uf)?.st ?? -1) >= p.st) R.pend.delete(uf);
      else {
        // A abrangência já mostra a versão nova, mas a borda ainda entrega a anterior.
        p.n += 1;
        R.prox.set(uf, Date.now() + Math.min(30000, 3000 * 2 ** Math.min(4, p.n - 1)));
        if (p.n > 8) R.pend.delete(uf);
      }
    }
  } catch (e) {
    deuErro(uf, e);
  }
  pedirTela();
  puxarUFs();
}

// Fila das UFs: nunca lidas primeiro (maior eleitorado antes), depois as que a abrangência
// diz que mudaram, depois as vencidas pela idade; dentro de cada grupo, mais eleitorado
// por apurar antes.
function filaUF(agora) {
  const fila = [];
  const parado = !A.br || (A.br.st ?? 0) === 0;
  const abConfiavel = R.abOk && !(R.abAtrasoDesde && agora - R.abAtrasoDesde > 45000);
  for (const uf of UFS) {
    if (R.emVoo.has(uf) || agora < (R.prox.get(uf) ?? 0)) continue;
    const o = A.ufs.get(uf);
    const te = o?.te || A.base?.ufs.get(uf)?.eleitorado || 0;
    const falta = o ? Math.max(0, o.te - o.est) : te;
    if (!o) {
      fila.push([3e12 + te, uf]);
      continue;
    }
    if (R.pend.has(uf)) {
      fila.push([2e12 + falta, uf]);
      continue;
    }
    const fim = o.ts > 0 && o.st !== null && o.st >= o.ts;
    const idadeMax =
      (fim ? MODELO.UF_IDADE_FIM_MS : parado ? MODELO.UF_IDADE_PARADO_MS : abConfiavel ? MODELO.UF_IDADE_MS : MODELO.UF_IDADE_SEM_AB_MS) * ritmo();
    const idade = agora - (R.lidoEm.get(uf) ?? 0);
    if (idade >= idadeMax) fila.push([1e12 + falta * Math.min(10, idade / idadeMax), uf]);
  }
  return fila.sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

function agendar() {
  const agora = Date.now();
  if (!R.emVoo.has('br') && agora >= (R.prox.get('br') ?? 0)) lerBR();
  // Pausa (429 ou erros seguidos): só o Brasil sonda; o resto espera ele voltar.
  if (agora < R.pausaAte) return;
  if (!R.emVoo.has('ab') && agora >= (R.prox.get('ab') ?? 0)) lerAB();
  puxarUFs();
}
// Ocupa as vagas de UF. Chamada a cada segundo e também ao fim de cada UF lida: a carga
// inicial das 28 (e uma rodada de UFs que mudaram) anda no ritmo da rede, não do relógio.
function puxarUFs() {
  const agora = Date.now();
  if (A.modo !== 'vivo' || agora < R.pausaAte) return;
  let livres = MODELO.UF_PARALELO;
  for (const k of R.emVoo.keys()) if (k.length === 2) livres -= 1;
  if (livres <= 0) return;
  for (const uf of filaUF(agora).slice(0, livres)) lerUF(uf);
}

function tique() {
  clearTimeout(R.relogio);
  R.relogio = null;
  if (A.modo !== 'vivo') return;
  // Agenda o próximo antes de trabalhar: um erro aqui não para o relógio.
  R.relogio = setTimeout(tique, 1000);
  try {
    agendar();
  } catch (e) {
    console.error('[apuração] leitura', e);
  }
  atualizarHora();
}

function pararTimers() {
  for (const t of A.timers) clearInterval(t);
  A.timers = [];
  clearTimeout(R.relogio);
  R.relogio = null;
}

// Liga (ou religa) a leitura ao vivo. Lê mesmo com a aba da página fechada ou o navegador
// em segundo plano (em metade do ritmo); antes a leitura parava e o gráfico da noite
// ficava com buracos.
function ligarVivo() {
  if (A.modo !== 'vivo') return;
  if (!R.inicio) R.inicio = Date.now();
  // Voltou para a frente: o que estava esperando o ritmo lento é lido já.
  if (!document.hidden && A.ativo) {
    const agora = Date.now();
    if (!R.erros.has('br') && (R.prox.get('br') ?? 0) > agora + MODELO.CADA_BR_MS) R.prox.set('br', agora);
    if (!R.erros.has('ab') && (R.prox.get('ab') ?? 0) > agora + MODELO.CADA_AB_MS) R.prox.set('ab', agora);
  }
  if (!A.timers.length) A.timers.push(setInterval(() => (A.rot += 1), 8000));
  tique();
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
  A.vista = null;
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
  A.fonteTeste = fonteTeste(q);
  if (A.fonteTeste) A.fonte = A.fonteTeste;
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
  if (A.fonteTeste) return 'vivo';
  const fe = C.msDe(C.dados()?.eleicao?.fechamento) ?? C.msDe('2026-10-25T17:00:00-03:00');
  return Date.now() >= fe ? 'vivo' : 'pre';
}

function trocarModo(modo) {
  pararTimers();
  zerarLeitura();
  A.modo = modo;
  A.ufSel = null;
  A.rot = 0;
  A.sim = null;
  A.vista = null;
  if (modo !== 'sim') {
    A.br = null;
    A.ufs = new Map();
    carregarSerie();
  }
  montarTela();
  faixaSim();
  manterTelaAcesa();
}

// O que entra na prévia. Se o JSON foi republicado sem mudar isso (pesquisas, textos,
// mercados), a apuração não é refeita: antes qualquer republicação apagava e redesenhava
// o painel inteiro (na TV, um piscar a cada atualização do JSON).
function assinaturaBase(d) {
  try {
    const t1 = obj(d?.primeiro_turno) || {};
    return JSON.stringify([
      d?.modelo_uf, d?.modelo_nacional, t1.por_uf, t1.candidatos, t1.abstencao_pct, d?.media?.validos, d?.media?.sigma_pp,
      d?.projecao?.abstencao_estimada_pct, d?.candidatos, d?.eleicao,
    ]);
  } catch {
    return String(Math.random());
  }
}

function montarTela() {
  if (!A.raiz) return;
  pararTimers();
  if (!C.dados()) {
    A.raiz.innerHTML = C.emHtml(C.lacunaBloco('Carregando os dados da prévia…'));
    return;
  }
  A.base = montarBase(C.dados());
  A.baseAssin = assinaturaBase(C.dados());
  if (A.modo === 'sim' && !A.sim) iniciarSimulacao();
  A.raiz.innerHTML = C.emHtml(A.modo === 'pre' ? esqueletoPre() : esqueletoPainel());
  for (const el of $$('.ap-ins')) el.innerHTML = '';
  if (A.modo === 'pre') {
    atualizarPre();
    atualizarTela();
    // Contagem até as 17h roda mesmo com a aba fechada, para a troca para "ao vivo" acontecer na hora.
    if (A.modo === 'pre') A.timers.push(setInterval(atualizarPre, 1000));
  } else if (A.modo === 'sim') {
    atualizarTela();
    if (A.ativo) ligarSimulacao();
  } else {
    atualizarTela();
    ligarVivo();
  }
  for (const g of $$('[data-grafico^="apur-"]')) C.desenharGrafico(g);
}

// Modo TV a noite toda: pede ao navegador para não apagar a tela enquanto a apuração está
// na TV (Wake Lock; sem suporte, nada muda). O navegador solta o pedido quando a aba sai
// da frente; ao voltar, é pedido de novo.
const TELA = { pedido: null, obs: null };
function vigiarTV() {
  if (TELA.obs || typeof MutationObserver !== 'function') return;
  TELA.obs = new MutationObserver(() => manterTelaAcesa());
  TELA.obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  manterTelaAcesa();
}
async function manterTelaAcesa() {
  const quer = document.body.classList.contains('tv') && !document.hidden && A.modo !== 'pre';
  try {
    if (quer && !TELA.pedido && navigator.wakeLock?.request) {
      TELA.pedido = 'pedindo';
      const s = await navigator.wakeLock.request('screen');
      TELA.pedido = s;
      s.addEventListener?.('release', () => {
        if (TELA.pedido === s) TELA.pedido = null;
      });
    } else if (!quer && TELA.pedido && TELA.pedido !== 'pedindo') {
      const s = TELA.pedido;
      TELA.pedido = null;
      await s.release();
    }
  } catch {
    TELA.pedido = null;
  }
}

// Só com ?tse= (simulador local): leitura do estado para os testes automáticos.
function ganchoTeste() {
  if (!A.fonteTeste) return;
  const txt = (html) => C.emHtml(html).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  window.__apuracao = {
    estado() {
      const r = A.res;
      // ufs: o que entrou na última conta (é com isso que os destaques foram escritos);
      // ufsLidas: o que já chegou do TSE (pode estar um passo à frente da conta).
      const ufs = {};
      for (const u of r?.linhas || []) {
        if (u.o) ufs[u.uf] = { st: u.o.st, ts: u.o.ts, est: u.est, te: u.te, c: u.o.c, L: u.L, F: u.F, tTot: u.o.tTot, rem: u.rem, share: u.share };
      }
      const ufsLidas = {};
      for (const [uf, o] of A.ufs) ufsLidas[uf] = { st: o.st, L: o.L, F: o.F, tTot: o.tTot };
      return {
        modo: A.modo,
        br: A.br && { st: A.br.st, L: A.br.L, F: A.br.F, tTot: A.br.tTot, eleito: A.br.eleito },
        vista: A.vista && { fonte: A.vista.fonte, st: A.vista.st, L: A.vista.L, F: A.vista.F, tTot: A.vista.tTot, pst: A.vista.pst },
        ufs,
        ufsLidas,
        emVoo: R.emVoo.size,
        pedidos: R.pedidos,
        velhas: R.velhas,
        erros: Object.fromEntries([...R.erros].map(([k, e]) => [k, e.msg])),
        pend: [...R.pend.keys()],
        abOk: R.abOk,
        pausa: Math.max(0, R.pausaAte - Date.now()),
        res: r && {
          pL: r.pL, parL: r.proj.parL, projL: r.proj.L, projF: r.proj.F, definido: r.definido, tudo: r.tudo,
          eleitoTSE: r.eleitoTSE, completo: r.completo, lidos: r.lidos, remCont: r.remCont, remMax: r.remMax, swing: r.swing,
        },
        insights: r && A.modo !== 'pre' ? calcularInsights(r).map((x) => ({ id: x.id, txt: txt(x.html) })) : [],
        serie: A.serie.length,
        trocas: A.trocas.map((x) => ({ ...x })),
      };
    },
  };
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
      // O detalhe abre embaixo do mapa: traz para a tela sem pular a página toda.
      const caixa = A.ufSel ? $('[data-ap-uf]') : null;
      if (caixa && !caixa.hidden) caixa.scrollIntoView({ block: 'nearest', behavior: reduzMovimento() ? 'auto' : 'smooth' });
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
    if (A.modo === 'vivo') ligarVivo();
    manterTelaAcesa();
  });
  vigiarTV();
  ganchoTeste();
  montarTela();
  return {
    mostrar() {
      A.ativo = true;
      if (!A.base && C.dados()) montarTela();
      else if (A.modo === 'vivo') ligarVivo();
      else if (A.modo === 'sim' && !A.sim?.fim) ligarSimulacao();
      else if (A.modo === 'pre') {
        if (!A.timers.length) A.timers.push(setInterval(atualizarPre, 1000));
        atualizarPre();
      }
      faixaSim();
    },
    esconder() {
      A.ativo = false;
      // A leitura ao vivo continua, em metade do ritmo (ver ligarVivo).
      faixaSim();
      atualizarHora();
    },
    dadosMudaram() {
      const ativo = A.ativo;
      const mesma = assinaturaBase(C.dados()) === A.baseAssin;
      // Contagem já começou: a prévia fica congelada. Uma pesquisa (ou boca de urna) que
      // entre no JSON às 18h mudaria a prévia de todos os estados no meio da apuração e
      // faria a chance pular sem nenhum voto novo.
      const congela = A.modo === 'vivo' && (A.vista?.L ?? 0) + (A.vista?.F ?? 0) > 0;
      if (A.base && A.raiz && A.modo !== 'pre' && (mesma || congela)) {
        if (!mesma && congela && !A.base.congelada) {
          A.base.congelada = true;
          A.base.lacunas.push(`Prévia congelada no início da contagem: o JSON da página mudou às ${hms(Date.now())} e a mudança não entra na projeção desta noite.`);
          const sec = $('.ap-sec-previa');
          if (sec) {
            const aberto = !!sec.querySelector('details[open]');
            sec.innerHTML = C.emHtml(C.h`${htmlOrigemPrevia()}${htmlComoFunciona()}`);
            if (aberto) sec.querySelector('details')?.setAttribute('open', '');
          }
        }
        if (A.modo !== 'sim' || A.sim) atualizarTela();
        return;
      }
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
