/* Radar Eleitoral · 2º turno · APURAÇÃO AO VIVO (o "processador" da noite de 25/10)
 *
 * Módulo ES sem dependências, carregado pelo app.js com import dinâmico.
 * - Lê o TSE direto do navegador (CORS liberado): Brasil a cada 5 s; a abrangência
 *   (progresso de cada UF, um arquivo só) a cada 5 s diz quais UFs mudaram, e só essas
 *   são relidas, até 4 por vez. As 27 capitais (arquivo de cada município) são lidas a
 *   cada ~30 s, escalonadas, sem nunca atrasar o Brasil nem os estados. Detalhes em
 *   "leitura do TSE".
 * - Projeta o resultado final UF por UF: o que já foi apurado + o que falta,
 *   misturando o observado na UF com a prévia (modelo_uf do JSON; se faltar,
 *   o cálculo de reserva descrito em montarBase).
 * - Chance de vitória por Monte Carlo (2.000 sorteios, sementes fixas para o
 *   número não "tremer" entre leituras). Os MESMOS sorteios dão a chance de cada
 *   estado (fatia de sorteios em que cada candidato vence naquele estado), então a
 *   chance nacional e as dos estados são coerentes entre si.
 * - Painel "Estados, número a número" (todos os 27 + Exterior), situação de cada estado
 *   (aguardando, indefinido, provável, definido) e destaques ("O que está
 *   acontecendo") com 1º turno, histórico 2002-2022, capitais e pesquisas.
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
  // Ritmo de leitura do TSE. Por que 5 s é tão rápido quanto o próprio site do TSE:
  // o site resultados.tse.jus.br e esta página leem OS MESMOS arquivos, servidos pela mesma
  // rede de distribuição (Akamai), que guarda cada arquivo por 45 a 57 s (max-age medido em
  // 23/10/2026) e só então busca a versão nova na origem. Ninguém, nem o site do TSE, vê um
  // número antes de o arquivo trocar na borda. Pedindo a cada 5 s, com pedido condicional
  // (If-None-Match / If-Modified-Since), a página descobre a troca em até 5 s depois dela e,
  // enquanto nada muda, o TSE responde 304 (uns 200 bytes). Nada de parâmetro na URL para
  // "furar" o cache: isso iria até a origem do TSE, aumentaria a carga na noite da apuração
  // e arriscaria bloqueio (429), sem trazer número mais novo.
  CADA_BR_MS: 5000,
  CADA_AB_MS: 5000,
  // Capitais (arquivo de cada município, mesmo formato do arquivo do estado): no máximo 4
  // pedidos no ar, uma leitura nova por segundo no máximo (escalonadas), cada capital a
  // cada ~30 s (90 s enquanto ainda sem voto) e só quando não há Brasil, abrangência nem
  // estado esperando. Capital 100% apurada deixa de ser lida.
  CAP_PARALELO: 4,
  CAP_CADA_MS: 30000,
  CAP_PARADO_MS: 90000,
  // Estado "provável": chance de 99% (ou 1%) E ao menos 25% das seções do estado apuradas.
  // Nunca por prévia: sem voto contado, o estado fica "aguardando".
  UF_PROVAVEL_CHANCE: 0.99,
  UF_PROVAVEL_SEC: 25,
  // Mínimo de apuração (% das seções) para cada tipo de destaque nascer: com pouco contado,
  // a ordem em que as urnas chegam enviesa os números e o texto afirmaria demais.
  INS_MIN: { vs1t: 20, virou: 30, placar: 10, regiao: 15, termometro: 30, capital: 20, capitais: 30, momento: 5, pesquisas: 15, transf: 1 },
  // Atrasos (hora da totalização do TSE → hora da leitura aqui) guardados para a mediana.
  ATRASOS_N: 30,
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
  ufOrigem: 'mapa', // de onde veio o toque que abriu o detalhe: 'mapa' ou 'tabela'
  ufOrd: 'eleitorado', // ordem do painel Estados: eleitorado | apurado | disputa
  ufOrdEm: 0, // última reordenação das linhas (ms)
  histAberto: false, // histórico 2002-2022 aberto no detalhe do estado
  insTodos: false, // lista "Ver todos" aberta
  insVisto: new Map(), // id do destaque → { d: desde quando aparece (ms), u: última vez visto (ms) }
  cap: new Map(), // capitais: cod → arquivo do TSE lido
  atrasos: [], // hora da totalização do TSE × hora em que esta página viu a versão
  simDoc: null, // simulador.json do Mac, repassado pelo simulador.js ({ doc, em, modo })
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
// Para dentro de frase: "chance de mais de 99%", "chance de menos de 1%", "chance de 72%".
const chanceDe = (p) => {
  const t = chanceTxt(p);
  return t.startsWith('>') ? `mais de ${t.slice(1)}` : t.startsWith('<') ? `menos de ${t.slice(1)}` : t;
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
    const b = {
      ...padrao,
      t1Lula: t1ParUF,
      // 1º turno da UF: % dos válidos entre TODOS os candidatos (os outros somam 100 − L − F),
      // abstenção e brancos+nulos. Servem para "vs 1º turno" e para o comparecimento por região.
      t1L: pl,
      t1F: pf,
      abst1T: C.num(p?.abstencao_pct),
      bn1T: C.num(p?.brancos_nulos_pct),
      eleitorado: C.num(m?.eleitorado) ?? C.num(p?.eleitorado),
      fonte: 'média nacional',
    };
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
  // Histórico dos estados nos segundos turnos de 2002 a 2022 (TSE) e lista das capitais.
  const hist = lerHistorico(d?.estados_historico);
  if (!hist) lac.push('Sem o histórico dos estados (2002 a 2022) no JSON: os destaques históricos não aparecem.');
  const capitais = lerCapitais(d?.capitais);
  if (!capitais.length) lac.push('Sem a lista de capitais no JSON: a comparação por capital não aparece.');
  const mediaAcerto = C.num(d?.medias?.acerto_1t?.validos?.lula) ?? C.num(d?.media_acerto_1t?.validos?.lula);
  return {
    ufs,
    hist,
    capitais,
    mediaAcerto,
    t1ParNac: t1Par,
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

// estados_historico (inputs/pocket/historico_uf.json via build_pocket): para cada UF, em quantos
// segundos turnos de 2002 a 2022 ela votou no mesmo lado do vencedor nacional ("acompanhou"),
// a participação do PT no par em cada ano e a distância média, em pontos, entre a UF e o
// resultado nacional. "termometros" = as UFs que mais acompanham (hoje AM e MG).
function lerHistorico(eh) {
  const e = obj(eh);
  if (!e || !obj(e.ufs)) return null;
  const ufs = new Map();
  for (const [k, v] of Object.entries(e.ufs)) {
    const uf = String(k).toUpperCase();
    const x = obj(v);
    const a = C.num(x?.acompanhou);
    const n = C.num(x?.eleicoes);
    if (!UFS.includes(uf) || a === null || n === null || n <= 0) continue;
    const anos = arr(x.anos)
      .map((y) => ({ ano: C.num(y?.ano), par: C.num(y?.pt_par), venceu: C.txt(y?.venceu), acompanhou: y?.acompanhou === true }))
      .filter((y) => y.ano !== null && y.par !== null);
    ufs.set(uf, { acompanhou: a, eleicoes: n, dist: C.num(x.distancia_media_pp), anos });
  }
  if (!ufs.size) return null;
  const anos = arr(e.anos).map((y) => ({ ano: C.num(y?.ano), vencedor: C.txt(y?.vencedor), par: C.num(y?.pt_par) })).filter((y) => y.ano !== null);
  const termometros = arr(e.termometros).map((x) => String(x).toUpperCase()).filter((x) => ufs.has(x));
  return { ufs, anos, termometros, ano0: anos.length ? Math.min(...anos.map((y) => y.ano)) : 2002 };
}
// capitais: o cod é a chave do arquivo do TSE (ex.: sp71072 → .../dados/sp/sp71072-c0001-e006258-u.json).
function lerCapitais(lista) {
  const out = [];
  const vistos = new Set();
  for (const c of arr(lista)) {
    const uf = String(c?.uf || '').toUpperCase();
    const cod = String(c?.cod || '').toLowerCase();
    if (!UFS.includes(uf) || uf === 'ZZ' || !/^[a-z]{2}\d{5}$/.test(cod) || !cod.startsWith(uf.toLowerCase()) || vistos.has(cod)) continue;
    vistos.add(cod);
    out.push({ uf, cod, nome: C.txt(c.nome) || NOME_UF[uf], eleitorado: C.num(c.eleitorado), par1t: C.num(c.lula_par_1t), par22: C.num(c.lula_par_2022), secoes: C.num(c.secoes) });
  }
  return out.sort((a, b) => (b.eleitorado ?? 0) - (a.eleitorado ?? 0));
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
    // Seções apuradas (%): seções totalizadas ÷ seções, como o TSE; sem isso, o percentual do arquivo.
    const fim = !!(o && o.ts > 0 && o.st !== null && o.st >= o.ts);
    const sec = !o ? 0 : o.ts > 0 && o.st !== null ? (o.st / o.ts) * 100 : Number.isFinite(o.pst) ? o.pst : f * 100;
    return { uf, b, o, te, est, f, L, F, vv: o ? o.vv : 0, shareObs, compObs, bnObs, fim, sec };
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
    // Comparações com o 1º turno e quem está à frente (em % do par; nada disso usa prévia).
    u.parObs = u.shareObs !== null ? u.shareObs * 100 : null;
    u.t1Par = u.b.t1Lula !== null ? u.b.t1Lula * 100 : null;
    u.lider = lider(u.L, u.F);
    u.lider1T = u.t1Par === null ? null : u.t1Par > 50 ? 'lula' : u.t1Par < 50 ? 'flavio' : null;
    u.dT1 = u.parObs !== null && u.t1Par !== null ? u.parObs - u.t1Par : null;
    // Matematicamente definido no estado: a vantagem é maior que todo o eleitorado que falta lá.
    u.faltaMax = u.fim ? 0 : u.remMax;
    u.defUF = u.lider && Math.abs(u.L - u.F) > u.faltaMax ? u.lider : null;
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
  // Os mesmos sorteios dão a chance nacional e a de cada estado (ver montecarlo).
  const mc = montecarlo(linhas, projL, projF, rem);
  let pL;
  if (tudo || definido) {
    pL = dif > 0 ? 1 : dif < 0 ? 0 : 0.5;
  } else if (eleitoTSE) {
    pL = eleitoTSE === 'lula' ? 1 : 0;
  } else {
    // 100% e 0% ficam para quando está decidido; antes disso, no máximo ">99%".
    pL = clamp(mc.nac, 0.001, 0.999);
  }
  // Situação de cada estado. "Definido": vantagem maior que o eleitorado que falta no estado
  // (ou estado 100% apurado). "Provável": chance ≥ 99% (ou ≤ 1%) E ao menos 25% das seções
  // do estado apuradas E o líder da contagem é o mesmo da projeção. Estado sem voto contado
  // fica "aguardando" e nunca é declarado pela prévia.
  linhas.forEach((u, i) => {
    const temVoto = !!u.o && u.L + u.F > 0;
    u.prevChance = mc.uf[i];
    let ch = clamp(mc.uf[i], 0.001, 0.999);
    if (u.defUF) ch = u.defUF === 'lula' ? 1 : 0;
    u.chance = ch;
    const ladoProj = u.projL > u.projF ? 'lula' : u.projF > u.projL ? 'flavio' : null;
    const prov =
      temVoto && !u.defUF && u.sec >= MODELO.UF_PROVAVEL_SEC && u.lider && u.lider === ladoProj &&
      (ch >= MODELO.UF_PROVAVEL_CHANCE || ch <= 1 - MODELO.UF_PROVAVEL_CHANCE);
    u.status = !u.o ? 'sem-leitura' : !temVoto ? 'aguardando' : u.defUF ? 'definido' : prov ? 'provavel' : 'indefinido';
    u.quem = u.status === 'definido' ? u.defUF : u.status === 'provavel' ? (ch >= 0.5 ? 'lula' : 'flavio') : null;
    // Faixa de 80% da participação final de Lula no par do estado (mesmas incertezas dos sorteios).
    const tot = u.projL + u.projF;
    if (tot > 0) {
      const sh = u.projL / tot;
      const sd = (u.rem / tot) * Math.sqrt(u.sig ** 2 + (A.base.sigmaNac / 100) ** 2);
      u.faixa = u.rem > 0 && !u.defUF ? [Math.max(0, sh - 1.2816 * sd) * 100, Math.min(1, sh + 1.2816 * sd) * 100] : null;
      u.projPar = sh * 100;
    } else {
      u.faixa = null;
      u.projPar = null;
    }
  });
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

// Devolve a chance nacional de Lula (nac) e a de Lula em cada estado (uf, na ordem de linhas).
// Cada sorteio tem um erro nacional comum e um erro próprio de cada estado; o nacional soma os
// estados, então os dois números saem dos mesmos sorteios e não se contradizem.
function montecarlo(linhas, projL, projF, rem) {
  const z = normais();
  const S = UFS.length + 1;
  const V = projL + projF;
  const uf = new Float64Array(linhas.length);
  if (V <= 0) {
    uf.fill(0.5);
    return { nac: 0.5, uf };
  }
  const phi = clamp(rem / V, 0, 1);
  const sNac = (A.base.sigmaNac / 100) * phi;
  const d0 = A.base.sigmaNac / 100; // deslocamento nacional comum, em fração dos válidos que faltam
  const base = projL - projF;
  let vit = 0;
  for (let k = 0; k < MODELO.SORTEIOS; k++) {
    const o = k * S;
    let d = V * sNac * z[o];
    for (let i = 0; i < linhas.length; i++) {
      const u = linhas[i];
      let di = 0;
      if (u.rem > 0) {
        d += u.rem * u.sig * z[o + 1 + i];
        di = u.rem * (d0 * z[o] + u.sig * z[o + 1 + i]);
      }
      const mu = u.projL - u.projF + 2 * di;
      uf[i] += mu > 0 ? 1 : mu === 0 ? 0.5 : 0;
    }
    const m = base + 2 * d;
    vit += m > 0 ? 1 : m === 0 ? 0.5 : 0;
  }
  for (let i = 0; i < uf.length; i++) uf[i] /= MODELO.SORTEIOS;
  return { nac: vit / MODELO.SORTEIOS, uf };
}

/* ============================================================== insights */

function lider(L, F) {
  return L > F ? 'lula' : F > L ? 'flavio' : null;
}

// "em Minas Gerais", "na Bahia", "no Ceará": a preposição certa de cada estado.
const EM_UF = {
  AC: 'no', AL: 'em', AM: 'no', AP: 'no', BA: 'na', CE: 'no', DF: 'no', ES: 'no', GO: 'em', MA: 'no', MG: 'em', MS: 'em',
  MT: 'em', PA: 'no', PB: 'na', PE: 'em', PI: 'no', PR: 'no', RJ: 'no', RN: 'no', RO: 'em', RR: 'em', RS: 'no', SC: 'em',
  SE: 'em', SP: 'em', TO: 'no', ZZ: 'no',
};
const REGIAO_NOME = { N: 'Norte', NE: 'Nordeste', CO: 'Centro-Oeste', SE: 'Sudeste', S: 'Sul' };
const nomeUF = (uf) => (uf === 'ZZ' ? 'Exterior' : NOME_UF[uf]);
const emUF = (uf) => `${EM_UF[uf] || 'em'} ${nomeUF(uf)}`;
// "em Goiás, no Paraná e em Santa Catarina" (até 3 nomes, depois "e mais N").
function listaEm(ufs, max = 3) {
  const nomes = ufs.slice(0, max).map(emUF);
  const mais = ufs.length - nomes.length;
  if (mais > 0) nomes.push(`mais ${mais}`);
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : nomes[0] || '';
}
// Com sinal e vírgula: "+1,2" / "−0,6".
const sinalPP = (v, casas = 1) => {
  const t = C.fNum(Math.abs(v), casas);
  return Number(t.replace(',', '.')) === 0 ? t : `${v > 0 ? '+' : '−'}${t}`;
};
// "ponto" até 1,9 (como está escrito na tela); passou de 2, "pontos".
const pontosTxt = (v, casas = 1) => (Math.round(Math.abs(v) * 10 ** casas) / 10 ** casas < 2 ? 'ponto' : 'pontos');
const nEstados = (n) => `${n} ${n === 1 ? 'estado' : 'estados'}`;

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
  const MIN = MODELO.INS_MIN;
  const BR = 'Brasil';

  if (A.modo !== 'pre' && c.pst <= 0 && c.L + c.F === 0) {
    out.push({ id: 'aguardando', tag: BR, p: 30, html: h`Aguardando a primeira totalização do TSE. Enquanto isso, vale a prévia de cada estado.` });
  }
  if (r.tudo && c.L + c.F > 0) {
    out.push({
      id: 'concluida',
      tag: BR,
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
      tag: BR,
      p: 100,
      tom: 'forte',
      html: h`Matematicamente definido: a diferença de <b>${votosDif(c.L - c.F)}</b> é maior que todo o eleitorado que falta apurar. ${n(r.definido)} não pode mais ser alcançado.`,
    });
  } else if (r.eleitoTSE) {
    out.push({
      id: 'eleito-tse',
      tag: BR,
      p: 100,
      tom: 'forte',
      html: h`O TSE já declarou <b>${n(r.eleitoTSE)}</b> eleito, com ${pctPiso(c.pst, 2)} das seções apuradas.`,
    });
  }
  if (aberta && lp && lc && lp !== lc) {
    out.push({
      id: 'virada',
      tag: BR,
      p: 95,
      tom: 'forte',
      html: h`A projeção já aponta <b>${n(lp)}</b>, embora <b>${n(lc)}</b> lidere a contagem.`,
    });
  }
  const troca = A.trocas[A.trocas.length - 1];
  if (troca && agora - troca.t < MODELO.TROCA_VALE_MS) {
    out.push({
      id: `troca-${troca.t}`,
      tag: BR,
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
      tag: BR,
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
      tag: 'Pesquisas',
      p: 70,
      html: h`Swing observado: a apuração está <b>${C.fNum(Math.abs(r.swing) * 100, 1)} ${pontosTxt(r.swing * 100)}</b> mais favorável a ${n(quem)} do que a prévia indicava, estado por estado.`,
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
        tag: BR,
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
        tag: BR,
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
        tag: 'Estado',
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
      tag: 'Pesquisas',
      p: 50,
      html: h`Triangulação para <b>${n(lp)}</b>: apuração projetada <b>${pct1(proj)}</b> dos válidos · média das pesquisas <b>${pct1(med)}</b> · Polymarket <b>${pPoly !== null ? chanceTxt(pPoly) : 'sem leitura'}</b> de chance.`,
    });
  }
  if (c.pst > 0 && c.est > 0) {
    out.push({
      id: 'comparecimento',
      tag: BR,
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
        tag: 'Estado',
        p: 35,
        html: h`Maior vantagem${r.tudo ? '' : ' até agora'}: <b>${maiorV.uf === 'ZZ' ? 'Exterior' : maiorV.uf}</b>, +${votosDif(maiorV.L - maiorV.F)} para ${n(quem)}.`,
      });
    }
  }
  if (c.pst > 0) insightsNovos(r, out, { n, h, agora, MIN });
  return out.sort((a, b) => b.p - a.p);
}

// Destaques que cruzam estado, 1º turno, histórico, capitais, simulador e pesquisas. Cada um nasce
// só com apuração mínima (MODELO.INS_MIN) e usa apenas números que estão na tela ou nos arquivos lidos.
function insightsNovos(r, out, { n, h, agora, MIN }) {
  const ufs = r.linhas.filter((u) => u.uf !== 'ZZ');
  const totEleit = r.linhas.reduce((s, u) => s + u.te, 0) || 1;
  const comVoto = (u) => !!u.o && u.L + u.F > 0;
  const BR = 'Brasil';

  // a) estado definido ou provável (os 10 maiores; o resto entra no placar)
  const firmes = r.linhas.filter((u) => u.status === 'definido' || u.status === 'provavel').sort((a, b) => b.te - a.te);
  for (const u of firmes.slice(0, 10)) {
    const q = u.quem;
    const part = u.te / totEleit;
    const p = (u.status === 'definido' ? 66 : 60) + 14 * Math.min(1, part / 0.1);
    if (u.status === 'definido') {
      out.push({
        id: `uf-def-${u.uf}`,
        tag: 'Estado',
        p,
        html: u.fim
          ? h`${n(q)} venceu ${emUF(u.uf)}: <b>${pct1(q === 'lula' ? u.parObs : 100 - u.parObs)}</b> dos votos válidos, diferença de <b>${votosDif(u.L - u.F)}</b> (apuração do estado concluída).`
          : h`${n(q)} já venceu ${emUF(u.uf)}: a vantagem de <b>${votosDif(u.L - u.F)}</b> é maior que todo o eleitorado que falta apurar lá.`,
      });
    } else {
      out.push({
        id: `uf-prov-${u.uf}`,
        tag: 'Estado',
        p,
        html: h`${n(q)} deve vencer ${emUF(u.uf)}: <b>${pct1(q === 'lula' ? u.parObs : 100 - u.parObs)}</b> com ${pctPiso(u.sec, 0)} das seções apuradas, e o modelo dá chance de <b>${chanceDe(q === 'lula' ? u.chance : 1 - u.chance)}</b> de vencer lá. Ainda não é matemática: pode mudar.`,
      });
    }
  }

  // b) termômetros históricos (AM e MG no JSON): estados que votaram no vencedor nacional em todos os segundos turnos
  const hist = A.base.hist;
  for (const uf of hist?.termometros ?? []) {
    const u = r.linhas.find((x) => x.uf === uf);
    const e = hist.ufs.get(uf);
    if (!u || !e || !comVoto(u) || !u.lider) continue;
    const firme = u.status === 'definido' || u.status === 'provavel';
    if (!firme && u.sec < MIN.termometro) continue;
    const part = u.lider === 'lula' ? u.parObs : 100 - u.parObs;
    const verbo = u.status === 'definido' ? 'já venceu' : u.status === 'provavel' ? 'deve vencer' : 'lidera';
    const seg = e.acompanhou === e.eleicoes ? h`nos <b>${e.eleicoes}</b> segundos turnos` : h`em <b>${e.acompanhou} dos ${e.eleicoes}</b> segundos turnos`;
    out.push({
      id: `termometro-${uf}`,
      tag: 'Histórico',
      p: firme ? 84 : 62,
      html: h`<b>${nomeUF(uf)}</b> votou no vencedor nacional ${seg} desde ${hist.ano0}${e.dist !== null ? h` e, em média, ficou a <b>${C.fNum(e.dist, 1)} ${pontosTxt(e.dist)}</b> do resultado nacional do PT` : ''}. Hoje, com ${pctPiso(u.sec, 0)} apurado, ${n(u.lider)} ${verbo} lá com <b>${pct1(part)}</b>. <span class="ap-nota-in">É contexto histórico, não garantia: o resultado nacional só vem da contagem.</span>`,
    });
  }

  // c) contra o 1º turno: variação média da fatia de Lula no par
  const v1 = ufs.filter((u) => comVoto(u) && u.dT1 !== null && u.sec >= MIN.vs1t);
  if (v1.length >= 3) {
    const w = v1.reduce((s, u) => s + u.L + u.F, 0);
    const media = v1.reduce((s, u) => s + (u.L + u.F) * u.dT1, 0) / w;
    const melhorL = [...v1].sort((a, b) => b.dT1 - a.dT1)[0];
    const melhorF = [...v1].sort((a, b) => a.dT1 - b.dT1)[0];
    const frases = [];
    if (melhorL.dT1 > 0.05) frases.push(h`de ${n('lula')}: <b>${nomeUF(melhorL.uf)}</b> (${sinalPP(melhorL.dT1)})`);
    if (melhorF.dT1 < -0.05) frases.push(h`de ${n('flavio')}: <b>${nomeUF(melhorF.uf)}</b> (${sinalPP(-melhorF.dT1)})`);
    out.push({
      id: 'vs1t',
      tag: 'Estado',
      p: 69,
      html: h`Contra o 1º turno, ${n('lula')} tem em média <b>${C.fNum(Math.abs(media), 1)} ${pontosTxt(media)} ${media >= 0 ? 'a mais' : 'a menos'}</b> na disputa entre os dois (${nEstados(v1.length)} com ${MIN.vs1t}% ou mais apurado, ponderados pelos votos já contados).${frases.length ? h` Maior avanço ${frases.map((f, i) => h`${i ? '; ' : ''}${f}`)}.` : ''}`,
    });
  }

  // d) estados que trocaram de lado em relação ao 1º turno
  const viraram = ufs.filter((u) => comVoto(u) && u.sec >= MIN.virou && u.lider && u.lider1T && u.lider !== u.lider1T).sort((a, b) => b.te - a.te);
  if (viraram.length) {
    const grupo = (q) => viraram.filter((u) => u.lider === q).map((u) => u.uf);
    const gl = grupo('lula');
    const gf = grupo('flavio');
    const partes = [];
    if (gl.length) partes.push(h`${n('lula')} passou à frente ${listaEm(gl)}`);
    if (gf.length) partes.push(h`${n('flavio')} passou à frente ${listaEm(gf)}`);
    const aberto = viraram.some((u) => u.sec < 70 && u.status !== 'definido');
    out.push({
      id: 'virou',
      tag: 'Estado',
      p: 76,
      html: h`Trocaram de lado desde o 1º turno (${MIN.virou}% ou mais apurado): ${partes.map((x, i) => h`${i ? '; ' : ''}${x}`)}.${aberto ? ' Ainda falta apurar parte dos estados citados.' : ''}`,
    });
  }

  // e) placar por estado
  const lidera = ufs.filter((u) => comVoto(u) && u.sec >= MIN.placar && u.lider);
  if (lidera.length >= 3) {
    const nL = lidera.filter((u) => u.lider === 'lula');
    const nF = lidera.filter((u) => u.lider === 'flavio');
    const eleit27 = ufs.reduce((s, u) => s + u.te, 0) || 1;
    const sh = (l) => (l.reduce((s, u) => s + u.te, 0) / eleit27) * 100;
    const def = ufs.filter((u) => u.status === 'definido');
    const prov = ufs.filter((u) => u.status === 'provavel');
    const cont = (l, q) => l.filter((u) => u.quem === q).length;
    out.push({
      id: 'placar-uf',
      tag: 'Estado',
      p: 58,
      html: h`Placar por estado (27 UFs, as com ${MIN.placar}% ou mais apurado): ${n('lula')} lidera em <b>${nL.length}</b> (${C.fNum(sh(nL), 0)}% do eleitorado) e ${n('flavio')} em <b>${nF.length}</b> (${C.fNum(sh(nF), 0)}%). Definidos: <b>${def.length}</b>${def.length ? h` (${n('lula')} ${cont(def, 'lula')}, ${n('flavio')} ${cont(def, 'flavio')})` : ''}; prováveis: <b>${prov.length}</b>.`,
    });
  }

  // f) comparecimento contra o 1º turno, por região
  const regs = [];
  for (const rg of Object.keys(REGIAO_NOME)) {
    const l = r.linhas.filter((u) => REGIAO[u.uf] === rg);
    const te = l.reduce((s, u) => s + u.te, 0);
    const est = l.reduce((s, u) => s + u.est, 0);
    if (!te || (est / te) * 100 < MIN.regiao) continue;
    let c = 0;
    let es = 0;
    let esp = 0;
    for (const u of l) {
      if (!u.o || u.est <= 0 || u.b.abst1T === null) continue;
      c += u.o.c;
      es += u.est;
      esp += u.est * (1 - u.b.abst1T / 100);
    }
    if (es <= 0) continue;
    regs.push({ rg, obs: (c / es) * 100, ant: (esp / es) * 100, dif: (c / es - esp / es) * 100, apur: (est / te) * 100 });
  }
  const relev = regs.filter((x) => Math.abs(x.dif) >= 0.5).sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif)).slice(0, 3);
  if (relev.length) {
    out.push({
      id: 'comp-regiao',
      tag: BR,
      p: 52,
      html: h`Comparecimento contra o 1º turno nas regiões com ${MIN.regiao}% ou mais apurado: ${relev.map((x, i) => h`${i ? '; ' : ''}<b>${REGIAO_NOME[x.rg]}</b> ${pct1(x.obs)} (${sinalPP(x.dif)} ${pontosTxt(x.dif)})`)}. Cada região é comparada com a abstenção que os mesmos estados tiveram no 1º turno.`,
    });
  }

  // g) capitais
  const caps = (A.base.capitais || [])
    .map((c) => {
      const o = A.cap.get(c.cod);
      if (!o || !(o.L + o.F > 0)) return null;
      const sec = o.ts > 0 && o.st !== null ? (o.st / o.ts) * 100 : o.pst;
      return { c, o, sec, par: (100 * o.L) / (o.L + o.F) };
    })
    .filter(Boolean);
  const capsOk = caps.filter((x) => x.sec >= MIN.capital);
  if (capsOk.length) {
    const escolhidas = capsOk.slice(0, 3);
    const mov = [...capsOk].filter((x) => x.c.par1t !== null).sort((a, b) => Math.abs(b.par - b.c.par1t) - Math.abs(a.par - a.c.par1t))[0];
    if (mov && !escolhidas.includes(mov) && Math.abs(mov.par - mov.c.par1t) >= 1.5) escolhidas.push(mov);
    escolhidas.forEach((x, i) => {
      const refs = [];
      if (x.c.par1t !== null) refs.push(`1º turno: ${pct1(x.c.par1t)}`);
      if (x.c.par22 !== null) refs.push(`2022: ${pct1(x.c.par22)}`);
      out.push({
        id: `capital-${x.c.uf}`,
        tag: 'Cidade',
        p: 66 - i * 0.5,
        html: h`Na capital ${x.c.nome} (${x.c.uf}), com <b>${pctPiso(x.sec, 0)}</b> apurado, ${n('lula')} tem <b>${pct1(x.par)}</b> do par${refs.length ? ` (${refs.join('; ')})` : ''}.`,
      });
    });
  }
  const agr = caps.filter((x) => x.sec >= MIN.capitais && x.c.par1t !== null && x.c.eleitorado);
  if (agr.length >= 3) {
    const w = agr.reduce((s, x) => s + x.c.eleitorado, 0);
    const m1 = agr.reduce((s, x) => s + x.c.eleitorado * (x.par - x.c.par1t), 0) / w;
    const a22 = agr.filter((x) => x.c.par22 !== null);
    const w22 = a22.reduce((s, x) => s + x.c.eleitorado, 0);
    const m22 = w22 ? a22.reduce((s, x) => s + x.c.eleitorado * (x.par - x.c.par22), 0) / w22 : null;
    const acima = agr.filter((x) => x.par > x.c.par1t).length;
    out.push({
      id: 'capitais-agregado',
      tag: 'Cidade',
      p: 64,
      html: h`Nas <b>${agr.length}</b> capitais com ${MIN.capitais}% ou mais apurado, ${n('lula')} está <b>${sinalPP(m1)} ${pontosTxt(m1)}</b> em relação ao 1º turno (média pelo tamanho do eleitorado; acima do 1º turno em ${acima}${m22 !== null ? h`; contra 2022: ${sinalPP(m22)}` : ''}).`,
    });
  }

  // h) transferência de votos do 1º turno, medida pelo simulador municipal (arquivo do Mac, com atraso de minutos)
  const sim = simVivo();
  if (sim) {
    const g = arr(sim.doc.transferencia?.grupos).find((x) => x?.id === 'outros');
    const ab = arr(sim.doc.transferencia?.grupos).find((x) => x?.id === 'abstencao');
    const ger = C.num(sim.doc.gerado_ms);
    if (g && C.num(g.lula) !== null && C.num(g.flavio) !== null && (C.num(g.apurado_pct) ?? 0) >= MIN.transf && ger !== null) {
      const idade = Math.max(0, Math.round((agora - ger) / 60000));
      const nome = String(g.rotulo || 'Cury, Renan, Caiado e outros').replace(/^quem votou em\s+/i, '');
      out.push({
        id: 'transf-1t',
        tag: 'Cidade',
        p: 63,
        html: h`Simulador municipal (dado das <b>${hms(ger)}</b>${idade >= 3 ? `, de ${idade} min atrás` : ''}): dos eleitores de ${nome} no 1º turno, <b>${C.fNum(g.flavio, 0)}%</b> foram para ${n('flavio')} e <b>${C.fNum(g.lula, 0)}%</b> para ${n('lula')}${C.num(g.flavio_2022) !== null ? h` (em 2022, o mesmo grupo: ${C.fNum(g.flavio_2022, 0)}% × ${C.fNum(g.lula_2022, 0)}%)` : ''}.${ab && C.num(ab.abst) !== null && (C.num(ab.apurado_pct) ?? 0) >= MIN.transf ? h` Dos que não votaram no 1º turno, <b>${C.fNum(100 - ab.abst, 0)}%</b> apareceram agora.` : ''}`,
      });
    }
  }

  // i) embalo da contagem nos últimos ~15 min (série da própria tela)
  const s = A.serie;
  if (s.length >= 2) {
    const ult = s[s.length - 1];
    let ref = null;
    for (let i = s.length - 2; i >= 0; i--) {
      if (s[i].t <= ult.t - 15 * 60000) {
        ref = s[i];
        break;
      }
    }
    if (!ref && ult.t - s[0].t >= 8 * 60000) ref = s[0];
    if (ref && ult.aL !== null && ref.aL !== null && ult.pst >= MIN.momento && ult.t > ref.t) {
      const d = ult.aL - ref.aL;
      if (Math.abs(d) >= 0.15) {
        const min = Math.round((ult.t - ref.t) / 60000);
        out.push({
          id: 'momento',
          tag: BR,
          p: 47,
          html: h`Nos últimos <b>${min} min</b>, a fatia de ${n('lula')} na contagem ${d > 0 ? 'subiu' : 'caiu'} de <b>${pct2(ref.aL)}</b> para <b>${pct2(ult.aL)}</b> (${sinalPP(d, 2)} ${pontosTxt(d, 2)}). Isso vem de quais urnas entraram na conta, não de eleitores mudando de voto.`,
        });
      }
    }
  }

  // j) projeção contra as pesquisas (média e "só as que mais acertaram")
  if (r.completo && r.cont.pst >= MIN.pesquisas && r.proj.parL !== null) {
    const par = (a, b) => (a !== null && b !== null && a + b > 0 ? (a / (a + b)) * 100 : null);
    const mp = par(A.base.mediaL, A.base.mediaF);
    const ma = A.base.mediaAcerto !== null && A.base.mediaAcerto !== undefined ? A.base.mediaAcerto : null;
    const acima = (m) => {
      const d = r.proj.parL - m;
      return h`${C.fNum(Math.abs(d), 1)} ${pontosTxt(d)} ${d >= 0 ? 'acima' : 'abaixo'}`;
    };
    if (mp !== null) {
      out.push({
        id: 'pesquisas-acerto',
        tag: 'Pesquisas',
        p: 48,
        html: h`A projeção da apuração dá ${n('lula')} <b>${pct1(r.proj.parL)}</b> do par: <b>${acima(mp)}</b> da média das pesquisas (${pct1(mp)})${ma !== null ? h` e <b>${acima(ma)}</b> das que mais acertaram no 1º turno (${pct1(ma)})` : ''}.`,
      });
    }
  }
}

// O simulador.json do Mac, repassado pelo simulador.js, só vale na apuração real (ou no teste que usa
// ?tse=/?eleicao= com ?simteste=/?simulador=) e nunca na simulação da tela.
function simVivo() {
  const s = A.simDoc;
  if (!s || !obj(s.doc) || A.modo !== 'vivo') return null;
  const teste = A.teste || !!A.fonteTeste;
  if (s.modo === 'teste' && teste) return s;
  // Arquivo real: o Mac manda a cada ~60 s e o raw.githubusercontent guarda ~5 min. Mais de 30 min sem
  // arquivo novo = processador parado: o dado deixa de entrar nos destaques (não vira número velho).
  const ger = C.num(s.doc.gerado_ms);
  if (s.modo === 'vivo' && !teste && !s.doc.teste && !s.doc.simulacao && ger !== null && Date.now() - ger <= 30 * 60000) return s;
  return null;
}

// Sincroniza uma lista de destaques sem recriar o que já está na tela: o que continua só troca
// o texto (se mudou); o que entra anima de cima; o que sai desliza para a direita.
function sincronizarLista(ol, itens, { animar, completa }) {
  const ids = new Set(itens.map((x) => x.id));
  for (const li of Array.from(ol.children)) {
    if (!ids.has(li.dataset.id) && !li.classList.contains('saindo')) {
      if (animar && !reduzMovimento()) {
        li.classList.add('saindo');
        setTimeout(() => li.remove(), 450);
      } else li.remove();
    }
  }
  let ref = null;
  for (const x of itens) {
    let li = Array.from(ol.children).find((e) => e.dataset.id === x.id && !e.classList.contains('saindo'));
    const corpo = C.emHtml(x.html);
    if (!li) {
      li = document.createElement('li');
      li.dataset.id = x.id;
      li.className = `ap-in${animar ? ' entrando' : ''}${x.tom === 'forte' ? ' forte' : ''}`;
      li.innerHTML = `<span class="ap-tag t-${slugTag(x.tag)}">${x.tag}</span><span class="ap-txt"></span>${completa ? '<small class="ap-desde"></small>' : ''}`;
      li.querySelector('.ap-txt').innerHTML = corpo;
      li._h = corpo;
      if (animar) {
        requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove('entrando')));
        setTimeout(() => li.classList.remove('entrando'), 600); // aba em segundo plano não roda requestAnimationFrame
      }
    } else if (li._h !== corpo) {
      li.querySelector('.ap-txt').innerHTML = corpo;
      li._h = corpo;
      // Acende no máximo a cada 20 s: com a leitura a cada 5 s os números mudam toda hora.
      if (animar && (!li._acesoEm || Date.now() - li._acesoEm > 20000)) {
        li._acesoEm = Date.now();
        li.classList.remove('mudou');
        void li.offsetWidth;
        li.classList.add('mudou');
      }
    }
    li.classList.toggle('forte', x.tom === 'forte');
    if (completa) {
      const d = li.querySelector('.ap-desde');
      const t = A.insVisto.get(x.id)?.d;
      const txt = t ? `desde ${C.fHora(t).replace('h', ':')}` : '';
      if (d && d.textContent !== txt) d.textContent = txt;
    }
    const alvo = ref ? ref.nextSibling : ol.firstChild;
    if (li !== alvo) ol.insertBefore(li, alvo);
    ref = li;
  }
}
const slugTag = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// Na tela do celular e do computador: 4 destaques fixos e 2 que giram. No Modo TV (sem rolagem), 3 e 1.
const emTV = () => document.body.classList.contains('tv');
function renderInsights(lista) {
  const ol = $('[data-ap-ins]');
  if (!ol) return;
  const agora = A.modo === 'sim' ? A.sim?.relogio ?? Date.now() : Date.now();
  // "desde": quando este aparelho viu o destaque pela primeira vez (some do registro se ficar 2 min fora)
  for (const x of lista) {
    const v = A.insVisto.get(x.id);
    if (v) v.u = agora;
    else A.insVisto.set(x.id, { d: agora, u: agora });
  }
  for (const [id, v] of A.insVisto) if (agora - v.u > 120000) A.insVisto.delete(id);
  const nFixos = emTV() ? 3 : 4;
  const nGiro = emTV() ? 1 : 2;
  const fixos = lista.slice(0, nFixos);
  const resto = lista.slice(nFixos);
  let mostrar = fixos;
  if (resto.length) {
    // Os destaques que giram trocam a cada 8 s por entre os demais (de dois em dois, ou um a um na TV).
    const giro = [];
    for (let k = 0; k < Math.min(nGiro, resto.length); k++) giro.push(resto[(A.rot * nGiro + k) % resto.length]);
    mostrar = [...fixos, ...giro.filter((x, i) => giro.indexOf(x) === i)];
  }
  sincronizarLista(ol, mostrar, { animar: true, completa: false });
  const vazio = $('[data-ap-ins-vazio]');
  if (vazio) vazio.hidden = mostrar.length > 0;
  // Lista completa (Ver todos): todos os destaques vivos, com a etiqueta e o "desde".
  const todos = $('[data-ap-ins-todos]');
  const bt = $('[data-ap="ins-todos"]');
  if (bt) {
    const rot = A.insTodos ? 'Esconder a lista' : `Ver todos (${lista.length})`;
    if (bt.textContent !== rot) bt.textContent = rot;
    bt.setAttribute('aria-expanded', A.insTodos ? 'true' : 'false');
    bt.hidden = lista.length === 0;
  }
  if (todos) {
    todos.hidden = !A.insTodos || lista.length === 0;
    if (A.insTodos) sincronizarLista(todos, lista, { animar: false, completa: true });
  }
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
  atualizarEstados(r);
  atualizarDetalheUF(r);
}

/* ================================================== Estados, número a número */

// Painel sob o mapa: os 27 estados e o Exterior, cada um em uma linha de 4 colunas que se
// atualiza no lugar (mesmos números que contam e acendem como os do mapa; nada pisca o tempo todo).
// [estado + % das seções apuradas] [apurado agora] [vs 1º turno] [situação]. Tocar abre o detalhe.
const ORDENS = [
  ['eleitorado', 'Eleitorado'],
  ['apurado', '% apurado'],
  ['disputa', 'Mais disputados'],
];

function htmlEstados() {
  const h = C.h;
  const lin = UFS.map(
    (uf) => h`<li class="uf-it" data-uf="${uf}"><button type="button" class="uf-lin" data-uf="${uf}" data-ap-lin aria-expanded="false" aria-label="${nomeUF(uf)}">
      <span class="uf-c1" aria-hidden="true"><span class="uf-nome">${nomeUF(uf)}</span><span class="uf-sec"><b data-sp>0%</b> apurado</span><span class="uf-barra"><i data-b></i></span></span>
      <span class="uf-c2" aria-hidden="true"><span class="uf-n uf-nl"><span class="uf-k">${C.curto('lula')}</span> <b data-al>—</b></span><span class="uf-n uf-nf"><span class="uf-k">${C.curto('flavio')}</span> <b data-af>—</b></span></span>
      <span class="uf-c3" aria-hidden="true"><span class="uf-d" data-dw><span class="uf-dq" data-dq></span> <b data-d>—</b></span><span class="uf-d2" data-d2></span></span>
      <span class="uf-c4" aria-hidden="true"><b class="uf-sit" data-sit>lendo…</b><span class="uf-sit2" data-sit2></span></span>
    </button></li>`,
  );
  return h`<div class="uf-ord" role="group" aria-label="Ordenar os estados">
      <span class="uf-ord-r">Ordenar por</span>
      ${ORDENS.map(([k, rot]) => h`<button type="button" class="uf-ord-b" data-ap="ord-uf" data-ord="${k}" aria-pressed="${A.ufOrd === k ? 'true' : 'false'}">${rot}</button>`)}
    </div>
    <div class="uf-tab" style="--uf-l:${rgb(misturar(C.cand('lula').cor, '#000000', 0.12))};--uf-f:${rgb(misturar(C.cand('flavio').cor, '#000000', 0.12))}">
      <div class="uf-cab" aria-hidden="true"><span>Estado e apuração</span><span>Apurado agora</span><span>vs 1º turno</span><span>Situação</span></div>
      <ol class="uf-lista" data-ap-ufs>${lin}</ol>
    </div>
    <p class="ap-leg uf-leg">Apurado agora: % dos votos dos dois já contados. vs 1º turno: quanto a fatia de ${C.curto('lula')} entre os dois mudou desde o 1º turno (aparece o nome de quem ganhou terreno; “virou” = hoje lidera quem não liderava lá); o número pequeno é a fatia de ${C.curto('lula')} no 1º turno. Situação: “definido” quando a vantagem é maior que todo o eleitorado que falta apurar no estado; “provável” só com chance de 99% ou mais e ao menos 25% das seções contadas; sem voto contado, “aguardando”. Mais disputados: projeção mais perto de 50%. Toque numa linha para o detalhe.</p>`;
}

const f1p = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : C.fNum(um(v), 1));
// Seções em % com uma casa, sem arredondar para cima (99,96% fica 99,9%; 100 só com tudo apurado).
const fSec1 = (v) => (v > 0 && v < 0.1 ? '<0,1%' : v >= 100 ? '100%' : `${C.fNum(Math.floor(v * 10) / 10, 1)}%`);

function situacaoUF(u) {
  const n = (id) => C.curto(id);
  if (u.status === 'sem-leitura') return { txt: 'lendo…', sub: '', cls: '' };
  if (u.status === 'aguardando') return { txt: 'aguardando', sub: 'sem voto contado', cls: 'ag' };
  if (u.status === 'definido') return { txt: `${n(u.quem)} venceu`, sub: 'definido', cls: `def q-${u.quem}` };
  if (u.status === 'provavel') return { txt: `${n(u.quem)} provável`, sub: `chance ${chanceTxt(u.quem === 'lula' ? u.chance : 1 - u.chance)}`, cls: `prov q-${u.quem}` };
  const q = u.lider;
  const sub = u.sec >= 10 && q ? `chance ${n(q)} ${chanceTxt(q === 'lula' ? u.chance : 1 - u.chance)}` : '';
  return { txt: 'indefinido', sub, cls: 'ind' };
}

function atualizarEstados(r) {
  const ol = $('[data-ap-ufs]');
  if (!ol) return;
  const L = C.curto('lula');
  const F = C.curto('flavio');
  // vs 1º turno: o nome de quem ganhou terreno (uf-dq) fica ao lado do número; em telas estreitas vira só a inicial
  const fD = (v) => (v === 0 ? C.fNum(0, 1) : `+${C.fNum(Math.abs(v), 1)}`);
  for (const u of r.linhas) {
    const li = ol.querySelector(`:scope > .uf-it[data-uf="${u.uf}"]`);
    if (!li) continue;
    const bt = li.querySelector('.uf-lin');
    const comVoto = !!u.o && u.L + u.F > 0;
    let mudou = false;
    mudou = numLad(bt.querySelector('[data-sp]'), u.o ? Math.max(0, u.sec) : 0, fSec1) || mudou;
    const bar = bt.querySelector('[data-b]');
    if (bar) bar.style.width = `${clamp(u.sec, 0, 100).toFixed(1)}%`;
    const al = bt.querySelector('[data-al]');
    const af = bt.querySelector('[data-af]');
    if (comVoto) {
      const pl = um(u.parObs);
      mudou = numLad(al, pl, f1) || mudou;
      mudou = numLad(af, um(100 - pl), f1) || mudou;
    } else {
      for (const x of [al, af]) if (x.textContent !== '—') { x._v = undefined; x.textContent = '—'; }
    }
    const d = bt.querySelector('[data-d]');
    const dw = bt.querySelector('[data-dw]');
    const dq = bt.querySelector('[data-dq]');
    const d2 = bt.querySelector('[data-d2]');
    let t2 = '';
    if (comVoto && u.dT1 !== null) {
      mudou = numLad(d, um(u.dT1), fD) || mudou;
      dw.dataset.s = u.dT1 >= 0 ? 'l' : 'f';
      const nomeQ = um(u.dT1) === 0 ? '' : u.dT1 >= 0 ? L : F;
      if (dq.textContent !== nomeQ) dq.textContent = nomeQ;
      const virou = u.lider && u.lider1T && u.lider !== u.lider1T;
      t2 = virou ? `⇄ virou p/ ${C.curto(u.lider)}` : `1º t.: ${f1p(u.t1Par)}`;
      d2.classList.toggle('virou', !!virou);
    } else {
      if (d.textContent !== '—') { d._v = undefined; d.textContent = '—'; }
      if (dq.textContent) dq.textContent = '';
      delete dw.dataset.s;
      d2.classList.remove('virou');
      t2 = u.t1Par !== null ? `1º t.: ${f1p(u.t1Par)}` : '';
    }
    if (d2.textContent !== t2) d2.textContent = t2;
    const sit = situacaoUF(u);
    const s1 = bt.querySelector('[data-sit]');
    const s2 = bt.querySelector('[data-sit2]');
    if (s1.textContent !== sit.txt) s1.textContent = sit.txt;
    if (s2.textContent !== sit.sub) s2.textContent = sit.sub;
    const [k, qcls] = sit.cls.split(' ');
    const cls = `uf-it ${u.lider && comVoto ? (u.lider === 'lula' ? 'lid-l' : 'lid-f') : ''} ${k ? `s-${k}` : ''} ${qcls || ''} ${u.sec < 10 && comVoto ? 'pouco' : ''} ${A.ufSel === u.uf ? 'sel' : ''}`.replace(/\s+/g, ' ').trim();
    if (li.className !== cls) li.className = cls;
    const exp = A.ufSel === u.uf ? 'true' : 'false';
    if (bt.getAttribute('aria-expanded') !== exp) bt.setAttribute('aria-expanded', exp);
    if (comVoto) {
      const [br, bg, bb] = hexRgb(C.cand(u.lider === 'flavio' ? 'flavio' : 'lula').cor);
      bt.style.setProperty('--brilho', `rgba(${br},${bg},${bb},0.4)`);
    }
    if (mudou) brilhar(bt);
    const rotulo =
      `${nomeUF(u.uf)}: ${fSec1(u.sec)} das seções apuradas; ` +
      (comVoto ? `apurado ${L} ${f1p(u.parObs)}%, ${F} ${f1p(100 - u.parObs)}%` : 'sem voto contado') +
      (comVoto && u.dT1 !== null ? `; ${C.fNum(Math.abs(u.dT1), 1)} ${pontosTxt(u.dT1)} ${u.dT1 >= 0 ? 'a mais' : 'a menos'} para ${L} que no 1º turno${u.lider && u.lider1T && u.lider !== u.lider1T ? `; virou para ${C.curto(u.lider)}` : ''}` : '') +
      `; ${sit.txt}${sit.sub ? `, ${sit.sub}` : ''}`;
    if (bt.getAttribute('aria-label') !== rotulo) bt.setAttribute('aria-label', rotulo);
  }
  reordenarEstados(r, false);
}

// Reordena as linhas no lugar (sem recriar). Eleitorado é fixo; as outras mudam com a contagem,
// então só reordenam a cada 15 s (ou ao tocar no botão) para a lista não ficar pulando.
function chaveOrdem(u) {
  if (A.ufOrd === 'apurado') return [u.o ? u.sec : -1, u.te];
  if (A.ufOrd === 'disputa') return [u.o && u.L + u.F > 0 && u.projPar !== null ? -Math.abs(u.projPar - 50) : -1e9, u.te];
  return [u.te, 0];
}
function reordenarEstados(r, forcar) {
  const ol = $('[data-ap-ufs]');
  if (!ol) return;
  const agora = Date.now();
  if (!forcar && A.ufOrd !== 'eleitorado' && agora - A.ufOrdEm < 15000) return;
  const ordem = [...r.linhas].sort((a, b) => {
    const ka = chaveOrdem(a);
    const kb = chaveOrdem(b);
    return kb[0] - ka[0] || kb[1] - ka[1];
  });
  const atual = Array.from(ol.children).map((li) => li.dataset.uf);
  if (atual.length === ordem.length && ordem.every((u, i) => u.uf === atual[i])) {
    if (forcar) A.ufOrdEm = agora;
    return;
  }
  A.ufOrdEm = agora;
  let ref = null;
  for (const u of ordem) {
    const li = ol.querySelector(`:scope > .uf-it[data-uf="${u.uf}"]`);
    if (!li) continue;
    const alvo = ref ? ref.nextSibling : ol.firstChild;
    if (li !== alvo) ol.insertBefore(li, alvo);
    ref = li;
  }
}
function pintarOrdem() {
  for (const b of $$('[data-ap="ord-uf"]')) b.setAttribute('aria-pressed', b.dataset.ord === A.ufOrd ? 'true' : 'false');
}

// Detalhe do estado: o mesmo painel serve ao mapa e à tabela; ele se muda para baixo de quem foi tocado.
function abrirUF(uf, origem) {
  if (A.ufSel === uf && A.ufOrigem === origem) A.ufSel = null;
  else {
    A.ufSel = uf;
    A.ufOrigem = origem;
  }
  if (A.res) atualizarMapa(A.res);
  const caixa = A.ufSel ? $('[data-ap-uf]') : null;
  if (caixa && !caixa.hidden) caixa.scrollIntoView({ block: 'nearest', behavior: reduzMovimento() ? 'auto' : 'smooth' });
}

// A capital do estado (se lida), em uma frase.
function textoCapital(uf) {
  const c = (A.base.capitais || []).find((x) => x.uf === uf);
  if (!c) return null;
  const o = A.cap.get(c.cod);
  if (!o) return C.h`Capital ${c.nome}: ainda sem leitura.`;
  if (!(o.L + o.F > 0)) return C.h`Capital ${c.nome}: ainda sem voto contado.`;
  const sec = o.ts > 0 && o.st !== null ? (o.st / o.ts) * 100 : o.pst;
  const par = (100 * o.L) / (o.L + o.F);
  const refs = [];
  if (c.par1t !== null) refs.push(`1º turno: ${pct1(c.par1t)}`);
  if (c.par22 !== null) refs.push(`2022: ${pct1(c.par22)}`);
  return C.h`Capital ${c.nome}: <b>${fSec1(sec)}</b> apurado; ${C.curto('lula')} <b>${pct1(par)}</b> do par${refs.length ? ` (${refs.join('; ')})` : ''}.`;
}

function htmlHistorico(u) {
  const h = C.h;
  const hist = A.base.hist;
  const e = hist?.ufs.get(u.uf);
  if (!e) return '';
  const nac = new Map((hist.anos || []).map((y) => [y.ano, y]));
  const lin = e.anos.map((y) => {
    const n = nac.get(y.ano);
    return h`<tr><td>${y.ano}${n?.vencedor ? h`<small>país: ${n.vencedor}</small>` : ''}</td><td class="n">${pct1(y.par)}</td><td class="n">${n && n.par !== null ? pct1(n.par) : '—'}</td><td>${y.acompanhou ? 'sim' : 'não'}<small>estado: ${y.venceu === 'PT' ? 'PT' : 'adversário'}</small></td></tr>`;
  });
  return h`<p class="ap-uf-l">${nomeUF(u.uf)} votou no mesmo lado do vencedor nacional em <b>${e.acompanhou} dos ${e.eleicoes}</b> segundos turnos desde ${hist.ano0}${e.dist !== null ? h`; em média, ficou a <b>${C.fNum(e.dist, 1)} ${pontosTxt(e.dist)}</b> do resultado nacional do PT` : ''}.</p>
    <table class="tab"><thead><tr><th>Ano</th><th class="n">PT no estado</th><th class="n">PT no país</th><th>Acompanhou o país?</th></tr></thead><tbody>${lin}</tbody></table>
    <p class="fonte">PT = Lula, Dilma ou Haddad, em % dos votos dos dois finalistas. Histórico é contexto, não previsão. Fonte: TSE, dados abertos de 2002 a 2022.</p>`;
}

function atualizarDetalheUF(r) {
  const caixa = $('[data-ap-uf]');
  if (!caixa) return;
  const u = r.linhas.find((x) => x.uf === A.ufSel);
  // Sem estado escolhido o painel some: os números já estão nos ladrilhos e na tabela.
  caixa.hidden = !u;
  if (!u) {
    htmlEm('[data-ap-uf]', '');
    return;
  }
  // O painel mora embaixo do que foi tocado (mapa ou linha da tabela).
  const destino = A.ufOrigem === 'tabela' ? $(`.uf-it[data-uf="${u.uf}"]`) : $('.ap-mapa-wrap');
  if (destino && caixa.parentNode !== destino) destino.appendChild(caixa);
  const h = C.h;
  const L = C.curto('lula');
  const F = C.curto('flavio');
  const comVoto = !!u.o && u.L + u.F > 0;
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
  const sit = situacaoUF(u);
  const sitTxt =
    u.status === 'definido'
      ? h`${C.curto(u.quem)} venceu ${emUF(u.uf)}: ${u.fim ? 'estado 100% apurado.' : 'a vantagem é maior que todo o eleitorado que falta apurar aqui.'}`
      : u.status === 'provavel'
        ? h`${C.curto(u.quem)} provável: chance de <b>${chanceDe(u.quem === 'lula' ? u.chance : 1 - u.chance)}</b> com ${pctPiso(u.sec, 0)} das seções apuradas. Ainda não é matemática.`
        : u.status === 'indefinido'
          ? h`Indefinido: ainda dá para qualquer um dos dois.`
          : u.status === 'aguardando'
            ? h`Aguardando: sem voto contado neste estado.`
            : h`Ainda sem leitura deste estado.`;
  // 1º turno e 2022
  const e22 = A.base.hist?.ufs.get(u.uf)?.anos.find((y) => y.ano === 2022);
  const l1 = [];
  if (u.b.t1L !== null && u.b.t1F !== null) l1.push(h`No 1º turno: ${L} <b>${pct1(u.b.t1L)}</b> × ${F} <b>${pct1(u.b.t1F)}</b> dos válidos (os outros candidatos somaram ${pct1(100 - u.b.t1L - u.b.t1F)}; entre os dois, ${L} tinha <b>${pct1(u.t1Par)}</b>).`);
  if (comVoto && u.dT1 !== null) l1.push(h` Agora, apurado: ${L} <b>${pct1(u.parObs)}</b> do par, <b>${C.fNum(Math.abs(u.dT1), 1)} ${pontosTxt(u.dT1)} ${u.dT1 >= 0 ? 'a mais' : 'a menos'}</b>${u.lider && u.lider1T && u.lider !== u.lider1T ? h`; <b>virou</b>: ${C.curto(u.lider)} lidera hoje e ${C.curto(u.lider1T)} liderava no 1º turno` : ''}.`);
  if (e22) l1.push(h` Em 2022 (Lula × Bolsonaro): ${L} <b>${pct1(e22.par)}</b> do par.`);
  // comparecimento
  const comp1T = u.b.abst1T !== null ? 100 - u.b.abst1T : null;
  const dComp = u.compObs !== null && comp1T !== null ? u.compObs * 100 - comp1T : null;
  const sim = simVivo();
  const simUF = sim ? arr(sim.doc.ufs).find((x) => String(x?.uf).toUpperCase() === u.uf) : null;
  const simCid = sim ? arr(sim.doc.pesam).filter((x) => String(x?.uf).toUpperCase() === u.uf).slice(0, 3) : [];
  const gerSim = sim ? C.num(sim.doc.gerado_ms) : null;
  const capTxt = textoCapital(u.uf);
  const pjPar = u.projPar;
  htmlEm(
    '[data-ap-uf]',
    h`<div class="ap-uf-cab"><p class="ap-uf-nome">${nomeUF(u.uf)} <small>${u.uf === 'ZZ' ? '' : u.uf}</small></p><button type="button" class="ap-uf-x" data-ap="fechar-uf" aria-label="Fechar">×</button></div>
      <p class="ap-uf-sit ${sit.cls}">${sitTxt}</p>
      <p class="ap-uf-l">${u.o ? h`<b>${fSec1(u.sec)}</b> das seções apuradas · ${pctPiso(u.f * 100, 1)} do eleitorado · ${C.fInt(u.L + u.F)} votos nos dois` : 'Ainda sem leitura deste estado'}</p>
      <table class="tab"><thead><tr><th style="width:30%">% do par</th><th class="n">Apurado</th><th class="n">Prévia</th><th class="n">Projeção</th></tr></thead><tbody>${linha('lula')}${linha('flavio')}</tbody></table>
      ${pjPar !== null ? h`<p class="ap-uf-l">${u.faixa ? h`Faixa de 80% da projeção: ${L} entre <b>${pct1(u.faixa[0])}</b> e <b>${pct1(u.faixa[1])}</b> do par. ` : ''}${comVoto && u.status !== 'definido' ? h`Chance de vencer aqui: ${L} <b>${chanceTxt(u.chance)}</b> × ${F} <b>${chanceTxt(1 - u.chance)}</b> (os mesmos sorteios da chance nacional).` : u.status === 'definido' ? '' : h`Sem voto contado: a prévia daria ${L} ${chanceTxt(u.prevChance)} de chance, mas isso não conta como resultado.`}</p>` : ''}
      ${l1.length ? h`<p class="ap-uf-l">${l1}</p>` : ''}
      <p class="ap-uf-l">Comparecimento: ${u.compObs !== null ? h`<b>${C.fNum(u.compObs * 100, 1)}%</b> até agora` : 'sem leitura ainda'}${dComp !== null ? h`, ${C.fNum(Math.abs(dComp), 1)} ${pontosTxt(dComp)} ${dComp >= 0 ? 'acima' : 'abaixo'} do 1º turno (${C.fNum(comp1T, 1)}%)` : ''} (prévia ${C.fNum(u.b.comp * 100, 1)}%).</p>
      <p class="ap-uf-l">Faltam cerca de <b>${votosDif(u.rem, 'válido')}</b>${u.rem > 0 ? h`; devem render <b>+${votosCurto(Math.abs(liq))}</b> a ${C.curto(liq >= 0 ? 'lula' : 'flavio')}` : ''}.</p>
      ${capTxt ? h`<p class="ap-uf-l">${capTxt}</p>` : ''}
      ${simUF && gerSim !== null ? h`<p class="ap-uf-l">Simulador municipal (dado das ${hms(gerSim)}, pode ter alguns minutos de atraso): projeção ${L} <b>${pct1(C.num(simUF.lula_proj))}</b> do par${C.num(simUF.lula_apurado) !== null ? h`, apurado ${pct1(C.num(simUF.lula_apurado))}` : ''}.${simCid.length ? h` Cidades que mais pesam no que falta: ${simCid.map((x, i) => h`${i ? '; ' : ''}<b>${nomeCidadeSim(x.nome)}</b> (${C.fNum(C.num(x.apurado_pct) ?? 0, 0)}% apurado, +${votosCurto(Math.abs(C.num(x.saldo) ?? 0))} a ${C.num(x.saldo) >= 0 ? L : F})`)}.` : ''}</p>` : ''}
      ${A.base.hist?.ufs.has(u.uf) ? h`<p class="ap-uf-l"><button type="button" class="botao-link ap-hist-bt" data-ap="hist" aria-expanded="${A.histAberto ? 'true' : 'false'}">${A.histAberto ? 'Esconder' : 'Ver'} o histórico de 2002 a 2022 deste estado</button></p>${A.histAberto ? htmlHistorico(u) : ''}` : ''}
      ${elTxt}
      <p class="fonte">Prévia: ${u.b.fonte}. Peso da observação neste estado: ${C.fNum(u.w * 100, 0)}%.</p>`,
  );
}
const nomeCidadeSim = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (m) => m.toLowerCase());

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
    localStorage.setItem(chaveSerie(), JSON.stringify({ serie: A.serie, trocas: A.trocas, vistos: [...A.insVisto] }));
  } catch {
    /* sem armazenamento: fica na memória */
  }
}
function carregarSerie() {
  A.serie = [];
  A.trocas = [];
  A.insVisto = new Map();
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
    // "desde" dos destaques: só entradas recentes e bem formadas
    if (Array.isArray(s?.vistos)) {
      const lim = Date.now() - 6 * 3600e3;
      for (const x of s.vistos.slice(0, 200)) {
        if (Array.isArray(x) && typeof x[0] === 'string' && Number.isFinite(x[1]?.d) && Number.isFinite(x[1]?.u) && x[1].u > lim && x[1].u <= Date.now() + 864e5) A.insVisto.set(x[0], { d: x[1].d, u: x[1].u });
      }
    }
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
      <p class="nota">Leitura do TSE: Brasil e a lista de estados a cada 5 segundos; cada estado assim que o TSE mostra que ele mudou (e ao menos a cada minuto); as 27 capitais a cada cerca de 30 segundos. É o mesmo arquivo, da mesma rede de distribuição, que o site do TSE lê, e o TSE só troca cada arquivo a cada 45 a 57 segundos: não há como ver um número antes do site do TSE, e esta página o mostra assim que o arquivo troca. Fonte: resultados.tse.jus.br.</p>
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
      <p class="fonte ap-atraso" data-ap-atraso hidden></p>
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
      <div class="ap-ins-mais"><button type="button" class="ap-ins-bt" data-ap="ins-todos" aria-expanded="false" hidden>Ver todos (0)</button></div>
      <ol class="ap-ins ap-ins-lista" data-ap-ins-todos hidden></ol>
      <p class="fonte ap-ins-nota">Cada destaque tem a etiqueta do assunto (Brasil, Estado, Cidade, Histórico ou Pesquisas). “Desde” é a hora em que este aparelho viu o destaque pela primeira vez. Nenhum deles é recomendação.</p>
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
    <section class="bloco ap-sec-estados" aria-label="Estados, número a número">
      <h2 class="sobre">Estados, número a número ${C.info('UF')}</h2>
      ${htmlEstados()}
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
      <p class="texto">A partir das 17h, esta aba lê o TSE (Tribunal Superior Eleitoral) a cada 5 segundos e mostra, sem você precisar recarregar:</p>
      <ul class="lista-texto">
        <li>votos apurados de cada um, contando na tela, e a chance de vitória: quem ganha chance fica verde, quem perde fica vermelho;</li>
        <li>o apurado agora ao lado da projeção final, onde aparece a virada que a contagem ainda não mostrou;</li>
        <li>o mapa dos estados e a tabela “Estados, número a número”, com quem lidera em cada um, quanto já foi apurado e a diferença para o 1º turno;</li>
        <li>destaques que entram e saem conforme a apuração anda (estados decididos, capitais, histórico de 2002 a 2022, quanto falta, o swing contra as pesquisas).</li>
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
      : `${r.lidos} de ${UFS.length} estados lidos${falta.length && r.completo ? ` · sem leitura agora: ${falta.slice(0, 4).join(', ')}${falta.length > 4 ? '…' : ''} (entram pela prévia)` : ''}${A.base?.capitais?.length ? ` · ${A.cap.size} de ${A.base.capitais.length} capitais` : ''}`,
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
  atualizarAtraso();
}

// Quanto tempo passa entre o TSE totalizar e esta página mostrar. Mede só mudanças vistas ao vivo
// (na abertura da página não há como saber quando a versão apareceu). Vem do relógio do aparelho.
const dur = (ms) => {
  const s = Math.round(Math.abs(ms) / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
};
function hmsQ(t) {
  // hora com segundos; com a data quando não for de hoje (por exemplo, o teste com o 1º turno)
  const hoje = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
  return hoje.format(t) === hoje.format(Date.now()) ? hms(t) : `${hoje.format(t)} ${hms(t)}`;
}
function atualizarAtraso() {
  const el = $('[data-ap-atraso]');
  if (!el) return;
  const br = A.br;
  let s = '';
  if (A.modo === 'vivo' && br && Number.isFinite(br.tTot)) {
    const p = [];
    if (br.vistoVivo && Number.isFinite(br.vistoEm)) {
      const d = br.vistoEm - br.tTot;
      p.push(`TSE totalizou às ${hmsQ(br.tTot)} · lido às ${hmsQ(br.vistoEm)}, ${d < -3000 ? 'antes da hora do TSE (o relógio deste aparelho parece atrasado)' : `${dur(d)} depois`}`);
      if (Number.isFinite(br.tGer) && br.vistoEm - br.tGer >= -3000) p.push(`arquivo gerado às ${hmsQ(br.tGer)}, lido ${dur(br.vistoEm - br.tGer)} depois`);
    } else {
      p.push(`TSE totalizou às ${hmsQ(br.tTot)}; o atraso aparece na próxima totalização vista aqui`);
    }
    const ds = A.atrasos.map((x) => x.atraso).filter((x) => x >= -3000 && x < 3600e3).sort((a, b) => a - b);
    if (ds.length >= 3) p.push(`mediana das últimas ${ds.length}: ${dur(ds[Math.floor(ds.length / 2)])}`);
    s = p.join(' · ');
  }
  el.hidden = !s;
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
      // Capitais pedem com prioridade baixa: se o navegador precisar enfileirar, o Brasil e os estados passam na frente.
      const opc = { cache: recarregar ? 'reload' : 'no-cache', signal: ctl?.signal };
      if (chave.startsWith('cap:')) opc.priority = 'low';
      r = await fetch(url, opc);
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
  if (chave.startsWith('cap:')) {
    // Capital também é ajuda: erro dela só espera a sua vez (5, 10, 20… s), sem contar como falha do TSE.
    // Mas 429 é o TSE pedindo calma: pausa tudo, como nos demais arquivos.
    if (e.status === 429) {
      R.pausaAte = Math.max(R.pausaAte, agora + MODELO.ESPERA_429_MS);
      if ((R.prox.get('br') ?? 0) > R.pausaAte) R.prox.set('br', R.pausaAte);
    }
    return;
  }
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
      // "Visto em": quando esta totalização apareceu pela primeira vez aqui (um 304 que devolve a
      // mesma versão não conta). Só mede atraso quando a mudança foi vista ao vivo, não na abertura.
      const nova = !A.br || novo.tTot !== A.br.tTot || novo.st !== A.br.st || novo.L !== A.br.L || novo.F !== A.br.F;
      novo.vistoEm = nova ? novo.em : A.br.vistoEm ?? novo.em;
      novo.vistoVivo = nova ? !!A.br : !!A.br.vistoVivo;
      if (nova && A.br && novo.tTot) {
        A.atrasos.push({ t: novo.tTot, visto: novo.vistoEm, ger: novo.tGer, atraso: novo.vistoEm - novo.tTot });
        if (A.atrasos.length > MODELO.ATRASOS_N) A.atrasos.shift();
      }
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

const urlCap = (c) => `${A.fonte}/${A.eleicao}/dados/${c.uf.toLowerCase()}/${c.cod}-c0001-e${codEleicao()}-u.json`;

// Capital = arquivo do município, mesmo formato do arquivo do estado. Erro de uma capital não
// derruba nada: ela espera a sua vez (deuErro) e as demais seguem.
async function lerCap(c) {
  const chave = `cap:${c.cod}`;
  R.tentou.set(chave, (R.tentou.get(chave) ?? 0) + 1);
  try {
    const novo = lerTSE(await baixarJSON(chave, urlCap(c)));
    R.erros.delete(chave);
    if (compVersao(A.cap.get(c.cod), novo) >= 0) A.cap.set(c.cod, novo);
    else R.velhas += 1;
    R.lidoEm.set(chave, Date.now());
    const o = A.cap.get(c.cod);
    const fim = o.ts > 0 && o.st !== null && o.st >= o.ts;
    const parado = (o.st ?? 0) === 0;
    // 100% apurada: não precisa mais ler. Sem voto ainda: devagar. Contando: a cada ~30 s.
    R.prox.set(chave, fim ? Infinity : Date.now() + (parado ? MODELO.CAP_PARADO_MS : MODELO.CAP_CADA_MS) * ritmo() * (0.85 + Math.random() * 0.3));
  } catch (e) {
    deuErro(chave, e);
  }
  pedirTela();
}

// No máximo uma capital nova por tique (1 s), até 4 no ar, e só quando o Brasil, a abrangência e
// os estados não estão esperando: capital nunca atrasa o que importa mais.
function puxarCapitais() {
  const agora = Date.now();
  const caps = A.base?.capitais;
  if (A.modo !== 'vivo' || !caps?.length || agora < R.pausaAte || !A.br) return;
  let noAr = 0;
  let capsNoAr = 0;
  for (const k of R.emVoo.keys()) {
    noAr += 1;
    if (k.startsWith('cap:')) capsNoAr += 1;
  }
  if (noAr > capsNoAr) return; // Brasil, abrangência ou estado em andamento
  if (capsNoAr >= MODELO.CAP_PARALELO) return;
  if (agora >= (R.prox.get('br') ?? 0) || (R.abOk && agora >= (R.prox.get('ab') ?? 0))) return;
  if (filaUF(agora).length) return;
  for (const c of caps) {
    const chave = `cap:${c.cod}`;
    if (R.emVoo.has(chave) || agora < (R.prox.get(chave) ?? 0)) continue;
    lerCap(c);
    return;
  }
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
  puxarCapitais();
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
  if (!A.timers.length) A.timers.push(setInterval(girarDestaques, 8000));
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
  A.timers.push(setInterval(girarDestaques, 8000));
}
// Os destaques que giram trocam a cada 8 s, sem esperar a próxima leitura do TSE.
function girarDestaques() {
  A.rot += 1;
  if (A.res && A.raiz && A.modo !== 'pre' && A.res.completo) renderInsights(calcularInsights(A.res));
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
  A.cap = new Map();
  A.atrasos = [];
  A.insVisto = new Map();
  A.simDoc = modo === 'sim' ? null : A.simDoc;
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
  TELA.obs = new MutationObserver(() => {
    manterTelaAcesa();
    // entrar ou sair do Modo TV muda quantos destaques cabem na tela
    if (A.res && A.raiz && A.modo !== 'pre' && A.res.completo) renderInsights(calcularInsights(A.res));
  });
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
      atualizarHora(); // o texto do atraso acompanha a última leitura (o teste lê no meio de um segundo)
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
        insights: r && A.modo !== 'pre' ? calcularInsights(r).map((x) => ({ id: x.id, tag: x.tag, p: x.p, txt: txt(x.html) })) : [],
        // painel dos estados: o que a conta (processar) decidiu para cada linha
        estados: Object.fromEntries(
          (r?.linhas || []).map((u) => [
            u.uf,
            {
              status: u.status, quem: u.quem, chance: u.chance, prevChance: u.prevChance, sec: u.sec, fim: u.fim, defUF: u.defUF,
              L: u.L, F: u.F, te: u.te, est: u.est, rem: u.rem, sig: u.sig, projL: u.projL, projF: u.projF, parObs: u.parObs,
              t1Par: u.t1Par, dT1: u.dT1, lider: u.lider, lider1T: u.lider1T, faixa: u.faixa, projPar: u.projPar, faltaMax: u.faltaMax,
              compObs: u.compObs, tTot: u.o?.tTot ?? null, st: u.o?.st ?? null, ts: u.o?.ts ?? null, c: u.o?.c ?? null,
            },
          ]),
        ),
        capitais: Object.fromEntries([...A.cap].map(([cod, o]) => [cod, { st: o.st, ts: o.ts, L: o.L, F: o.F, tTot: o.tTot }])),
        atrasos: A.atrasos.map((x) => ({ ...x })),
        brVisto: A.br && { vistoEm: A.br.vistoEm, vistoVivo: A.br.vistoVivo, tTot: A.br.tTot, tGer: A.br.tGer },
        sigmaNac: A.base?.sigmaNac,
        rot: A.rot,
        serie: A.serie.length,
        serieFim: A.serie.slice(-80).map((x) => ({ ...x })),
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
    const alvo = e.target instanceof Element ? e.target.closest('[data-ap], .lad[data-uf], .uf-lin[data-uf]') : null;
    if (!alvo) return;
    if (alvo.matches('.lad[data-uf]')) {
      // O detalhe abre embaixo do mapa: traz para a tela sem pular a página toda.
      abrirUF(alvo.dataset.uf, 'mapa');
      return;
    }
    if (alvo.matches('.uf-lin[data-uf]')) {
      // Na tabela, o detalhe abre logo abaixo da linha tocada.
      abrirUF(alvo.dataset.uf, 'tabela');
      return;
    }
    const a = alvo.dataset.ap;
    if (a === 'ord-uf') {
      if (['eleitorado', 'apurado', 'disputa'].includes(alvo.dataset.ord)) {
        A.ufOrd = alvo.dataset.ord;
        pintarOrdem();
        if (A.res) reordenarEstados(A.res, true);
      }
      return;
    }
    if (a === 'ins-todos') {
      A.insTodos = !A.insTodos;
      if (A.res && A.modo !== 'pre' && A.res.completo) renderInsights(calcularInsights(A.res));
      return;
    }
    if (a === 'hist') {
      A.histAberto = !A.histAberto;
      if (A.res) atualizarDetalheUF(A.res);
      return;
    }
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
  // O simulador.js (bloco de baixo, outro arquivo) avisa a cada leitura boa do simulador.json do Mac.
  const receberSim = (d) => {
    if (!obj(d?.doc)) return;
    A.simDoc = { doc: d.doc, em: d.em ?? Date.now(), modo: d.modo };
    if (A.raiz && A.modo === 'vivo') pedirTela();
  };
  window.addEventListener('radar2t:simulador', (e) => receberSim(e?.detail));
  receberSim(window.__radar2tSimulador); // se ele já tinha lido antes de este módulo carregar
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
