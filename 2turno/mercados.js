/**
 * Mercados de previsão do 2º turno presidencial de 25/10/2026:
 * Lula (PT) × Flávio Bolsonaro (PL), na Polymarket e na Kalshi.
 *
 * Módulo ES sem dependências. Interface:
 *
 *   lerMercados() → {
 *     atualizado_em: ISO,
 *     fontes: [{
 *       id: 'polymarket' | 'kalshi', nome, url, titulo,
 *       candidatos: { lula: {prob, compra, venda, ultimo}, flavio: {prob, compra, venda, ultimo} },
 *       volume_usd, liquidez_usd, encerra_em,
 *       status: 'ok' | 'erro', erro, origem: 'ao_vivo' | 'snapshot',
 *       atualizado_em,   // extra: hora do dado DESTA fonte (no snapshot, a hora da coleta)
 *     }]
 *   }
 *   lerHistorico(id, dias = 30) → [{ t: ISO, lula: 0..1 | null, flavio: 0..1 | null }]
 *     (o array traz também, não enumeráveis, .origem e .atualizado_em)
 *
 * Como lê: primeiro ao vivo, direto da API pública (fetch com timeout de 8 s,
 * sem chave e sem cabeçalho extra, então sem preflight). Se falhar (CORS, rede
 * ou formato), lê /data/pocket/mercados.json, gravado por
 * scripts/pocket_mercados.py, e marca origem: 'snapshot'. Uma fonte falhar não
 * derruba a outra.
 *
 * CORS medido em 22/10/2026 com Origin https://douglora.github.io:
 *   - Polymarket (gamma-api e clob): libera (Access-Control-Allow-Origin: *) → ao vivo.
 *   - Kalshi: recusa (403 do CloudFront para qualquer Origin que não seja
 *     kalshi.com, inclusive localhost) → no navegador sai sempre do snapshot;
 *     no Node, que não aplica CORS, sai ao vivo.
 *
 * Preços (de 0 a 1 = US$ por contrato que paga US$ 1 se o candidato vencer):
 *   compra = melhor oferta de compra do "Sim" (bid); venda = melhor oferta de
 *   venda (ask); ultimo = último negócio; prob = (compra + venda) / 2, ou ultimo
 *   quando falta um lado do livro. O que não existe vira null.
 * volume_usd: total do evento como a própria plataforma mostra (na Kalshi é
 *   contagem de contratos de US$ 1; na Polymarket, dólares negociados).
 * liquidez_usd: Polymarket = número da própria Polymarket para o evento;
 *   Kalshi (que não publica mais esse número) = soma do dinheiro parado nas
 *   ofertas dos dois livros (preço × quantidade), a mesma conta.
 * encerra_em: Polymarket = data final do evento; Kalshi = close_time do
 *   contrato (25/10/2027, prazo máximo: o contrato fecha antes, quando sai o vencedor).
 * atualizado_em do topo: hora do dado mais novo entre as fontes com status 'ok';
 *   a idade de cada fonte está no atualizado_em dela.
 * Histórico: prob pelo meio do livro, de hora em hora até 30 dias e de 12 em 12 h
 *   até 120 dias; buraco de um candidato herda o valor anterior.
 */

const TEMPO_LIMITE_MS = 8000;
const SNAPSHOT = '/data/pocket/mercados.json';
const CACHE_SNAPSHOT_MS = 30 * 1000;
// Depois de uma falha de rede/CORS, espera 2 min antes de tentar o ao vivo de
// novo (no navegador a Kalshi falha sempre; assim não suja o console a cada leitura).
const PAUSA_APOS_BLOQUEIO_MS = 2 * 60 * 1000;
const HORA = 3600;
const DIA = 86400;

const POLYMARKET = {
  id: 'polymarket',
  nome: 'Polymarket',
  url: 'https://polymarket.com/event/brazil-presidential-election',
  titulo: 'Eleição presidencial do Brasil: quem vence (inclui o 2º turno)',
  gamma: 'https://gamma-api.polymarket.com',
  clob: 'https://clob.polymarket.com',
  slug: 'brazil-presidential-election',
  // Token do "Sim" de cada candidato (ids fixos do mercado, conferidos em 22/10/2026).
  token: {
    lula: '30630994248667897740988010928640156931882346081873066002335460180076741328029',
    flavio: '109876868437950584369987384406356259939519193117253465815665152916226511121427',
  },
};

const KALSHI = {
  id: 'kalshi',
  nome: 'Kalshi',
  url: 'https://kalshi.com/markets/kxbrpres/brazil-presidential-election-winner/kxbrpres-26',
  titulo: 'Quem vence a eleição presidencial do Brasil?',
  api: 'https://api.elections.kalshi.com/trade-api/v2',
  serie: 'KXBRPRES',
  evento: 'KXBRPRES-26',
  ticker: { lula: 'KXBRPRES-26-LULA', flavio: 'KXBRPRES-26-FBOL' },
};

const FONTES = { polymarket: POLYMARKET, kalshi: KALSHI };
const LADOS = ['lula', 'flavio'];

/* ----------------------------------------------------------------- util */

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function arred(v, casas = 4) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** casas;
  return Math.round(v * f) / f;
}

const iso = (ms) => new Date(ms).toISOString();

function isoDe(texto) {
  const ms = Date.parse(texto);
  return Number.isFinite(ms) ? iso(ms) : null;
}

function host(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
}

function semAcento(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

class ErroBloqueio extends Error {}

async function pegarJson(url, opcoes = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TEMPO_LIMITE_MS);
  try {
    let resposta;
    try {
      resposta = await fetch(url, { ...opcoes, signal: ctrl.signal });
    } catch (e) {
      if (ctrl.signal.aborted) throw new Error(`sem resposta em ${TEMPO_LIMITE_MS / 1000} s (${host(url)})`);
      // No navegador, CORS recusado e rede fora aparecem igual: TypeError "Failed to fetch".
      throw new ErroBloqueio(`bloqueado (CORS) ou sem rede em ${host(url)}: ${e?.message || e}`);
    }
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status} em ${host(url)}`);
    try {
      return await resposta.json();
    } catch {
      if (ctrl.signal.aborted) throw new Error(`sem resposta em ${TEMPO_LIMITE_MS / 1000} s (${host(url)})`);
      throw new Error(`resposta não é JSON (${host(url)})`);
    }
  } finally {
    clearTimeout(timer);
  }
}

const pausaAte = new Map();
// No navegador a Kalshi recusa sempre (CORS): vai direto ao snapshot, sem tentar o
// ao vivo e sem sujar o console. No Node, que não aplica CORS, continua ao vivo.
const NO_NAVEGADOR = typeof window !== 'undefined' && typeof document !== 'undefined';
const SO_SNAPSHOT_NO_NAVEGADOR = new Set(['kalshi']);
const soSnapshot = (chave) => NO_NAVEGADOR && SO_SNAPSHOT_NO_NAVEGADOR.has(String(chave).split(':')[0]);
const podeTentar = (chave) => !soSnapshot(chave) && Date.now() >= (pausaAte.get(chave) || 0);
const motivoSemVivo = (chave) =>
  soSnapshot(chave)
    ? 'ao vivo não é lido no navegador (a plataforma bloqueia por CORS)'
    : 'ao vivo em pausa depois de bloqueio recente';
function registrarFalha(chave, erro) {
  if (erro instanceof ErroBloqueio) pausaAte.set(chave, Date.now() + PAUSA_APOS_BLOQUEIO_MS);
}

/* --------------------------------------------------------------- preços */

function cotacao(compra, venda, ultimo) {
  const c = compra !== null && compra > 0 && compra < 1 ? compra : null;
  const v = venda !== null && venda > 0 && venda < 1 ? venda : null;
  const u = ultimo !== null && ultimo > 0 && ultimo <= 1 ? ultimo : null;
  const prob = c !== null && v !== null ? (c + v) / 2 : u;
  return { prob: arred(prob), compra: arred(c), venda: arred(v), ultimo: arred(u) };
}

const cotacaoVazia = () => ({ prob: null, compra: null, venda: null, ultimo: null });

function validarCandidatos(candidatos, onde) {
  for (const lado of LADOS) {
    const p = candidatos[lado]?.prob;
    if (p === null || p === undefined || !(p >= 0 && p <= 1)) {
      throw new Error(`formato: sem preço de ${lado} (${onde})`);
    }
  }
}

const cabecalho = (F) => ({ id: F.id, nome: F.nome, url: F.url, titulo: F.titulo });

/* ------------------------------------------------------ Polymarket vivo */

function melhorPreco(ofertas, maior) {
  let melhor = null;
  for (const o of Array.isArray(ofertas) ? ofertas : []) {
    const p = num(o?.price);
    const q = num(o?.size);
    if (p === null || !(q > 0)) continue;
    if (melhor === null || (maior ? p > melhor : p < melhor)) melhor = p;
  }
  return melhor;
}

function tokenSim(mercado) {
  try {
    const ids = typeof mercado.clobTokenIds === 'string' ? JSON.parse(mercado.clobTokenIds) : mercado.clobTokenIds;
    return Array.isArray(ids) ? String(ids[0]) : null;
  } catch {
    return null;
  }
}

function acharMercadoPoly(mercados, token, lado) {
  const nome = lado === 'lula' ? 'lula' : 'flavio bolsonaro';
  return (
    mercados.find((m) => tokenSim(m) === token) ||
    mercados.find((m) => m.closed !== true && semAcento(m.groupItemTitle || m.question).includes(nome))
  );
}

async function polymarketAoVivo() {
  const P = POLYMARKET;
  const [resposta, ...livros] = await Promise.all([
    pegarJson(`${P.gamma}/events/slug/${P.slug}`),
    ...LADOS.map((lado) => pegarJson(`${P.clob}/book?token_id=${P.token[lado]}`).catch(() => null)),
  ]);
  const evento = Array.isArray(resposta) ? resposta[0] : resposta;
  if (!evento || !Array.isArray(evento.markets)) throw new Error('formato inesperado do evento (Polymarket)');

  const candidatos = {};
  LADOS.forEach((lado, i) => {
    const mercado = acharMercadoPoly(evento.markets, P.token[lado], lado);
    if (!mercado) throw new Error(`formato: mercado de ${lado} não está no evento (Polymarket)`);
    const livro = livros[i];
    const livroServe =
      livro && Array.isArray(livro.bids) && Array.isArray(livro.asks) && tokenSim(mercado) === P.token[lado];
    candidatos[lado] = livroServe
      ? cotacao(melhorPreco(livro.bids, true), melhorPreco(livro.asks, false), num(livro.last_trade_price))
      : cotacao(num(mercado.bestBid), num(mercado.bestAsk), num(mercado.lastTradePrice));
  });
  validarCandidatos(candidatos, 'Polymarket');

  return {
    ...cabecalho(P),
    candidatos,
    volume_usd: arred(num(evento.volume), 2),
    liquidez_usd: arred(num(evento.liquidity), 2),
    encerra_em: isoDe(evento.endDate),
    status: 'ok',
    erro: null,
    origem: 'ao_vivo',
    atualizado_em: iso(Date.now()),
  };
}

/* ---------------------------------------------------------- Kalshi vivo */

// API nova: campo_dollars ("0.2500"); API antiga: campo em centavos (25).
function dolar(obj, campo) {
  const d = num(obj?.[`${campo}_dollars`]);
  if (d !== null) return d;
  const c = num(obj?.[campo]);
  return c === null ? null : c / 100;
}

function contratos(obj, campo) {
  const fp = num(obj?.[`${campo}_fp`]);
  return fp !== null ? fp : num(obj?.[campo]);
}

// O livro da Kalshi só tem ofertas de compra: do "Sim" e do "Não".
// Comprar "Não" a p é o mesmo que vender "Sim" a 1 - p.
function lerLivroKalshi(resposta) {
  const livro = resposta?.orderbook_fp ?? resposta?.orderbook;
  if (!livro || typeof livro !== 'object') return null;
  const novo = 'yes_dollars' in livro || 'no_dollars' in livro;
  const div = novo ? 1 : 100;
  const pares = (lista) =>
    (Array.isArray(lista) ? lista : [])
      .map((par) => [num(par?.[0]), num(par?.[1])])
      .filter(([p, q]) => p !== null && q !== null && q > 0)
      .map(([p, q]) => [p / div, q]);
  const sim = pares(novo ? livro.yes_dollars : livro.yes);
  const nao = pares(novo ? livro.no_dollars : livro.no);
  const topo = (lista) => (lista.length ? Math.max(...lista.map(([p]) => p)) : null);
  const melhorNao = topo(nao);
  return {
    compra: topo(sim),
    venda: melhorNao === null ? null : 1 - melhorNao,
    dinheiro: [...sim, ...nao].reduce((s, [p, q]) => s + p * q, 0),
  };
}

async function kalshiAoVivo() {
  const K = KALSHI;
  const [resposta, ...livros] = await Promise.all([
    pegarJson(`${K.api}/events/${K.evento}?with_nested_markets=true`),
    ...LADOS.map((lado) => pegarJson(`${K.api}/markets/${K.ticker[lado]}/orderbook`).catch(() => null)),
  ]);
  // Com with_nested_markets=true a lista vem em event.markets e a de cima volta vazia; sem ele, o contrário.
  const mercados = [resposta?.event?.markets, resposta?.markets].find((x) => Array.isArray(x) && x.length);
  if (!mercados) throw new Error('formato inesperado do evento (Kalshi)');

  const candidatos = {};
  const lidos = LADOS.map((lado, i) => {
    const mercado = mercados.find((m) => m.ticker === K.ticker[lado]);
    if (!mercado) throw new Error(`formato: ${K.ticker[lado]} não está no evento (Kalshi)`);
    const livro = lerLivroKalshi(livros[i]);
    candidatos[lado] = livro
      ? cotacao(livro.compra, livro.venda, dolar(mercado, 'last_price'))
      : cotacao(dolar(mercado, 'yes_bid'), dolar(mercado, 'yes_ask'), dolar(mercado, 'last_price'));
    return { mercado, livro };
  });
  validarCandidatos(candidatos, 'Kalshi');

  const volume = mercados.reduce((s, m) => s + (contratos(m, 'volume') || 0), 0);
  const liquidez = lidos.every((x) => x.livro) ? lidos.reduce((s, x) => s + x.livro.dinheiro, 0) : null;

  return {
    ...cabecalho(K),
    candidatos,
    volume_usd: arred(volume, 2),
    liquidez_usd: arred(liquidez, 2),
    encerra_em: isoDe(lidos[0].mercado.close_time),
    status: 'ok',
    erro: null,
    origem: 'ao_vivo',
    atualizado_em: iso(Date.now()),
  };
}

/* ------------------------------------------------------------- snapshot */

let snapshotEmCache = null;

function urlSnapshot() {
  const base = globalThis.location?.href;
  return base ? new URL(SNAPSHOT, base).href : SNAPSHOT;
}

/* O Mac grava o snapshot a cada 5 min no ramo `mercados` do repositório do
 * site, sem reconstruir o Pages (raw.githubusercontent.com libera CORS e guarda
 * cache de ~5 min). Se ele falhar ou estiver mais velho, vale o do site. */
const SNAPSHOT_RAMO = 'https://raw.githubusercontent.com/douglora/douglora.github.io/mercados/mercados.json';

function validarSnapshot(snap) {
  if (!snap || !Array.isArray(snap.fontes)) throw new Error('snapshot em formato inesperado');
  return snap;
}

function lerSnapshot() {
  const agora = Date.now();
  if (snapshotEmCache && agora - snapshotEmCache.em < CACHE_SNAPSHOT_MS) return snapshotEmCache.promessa;
  const doSite = pegarJson(urlSnapshot(), { cache: 'no-cache' }).then(validarSnapshot);
  const doRamo = NO_NAVEGADOR
    ? pegarJson(SNAPSHOT_RAMO, { cache: 'no-cache' }).then(validarSnapshot)
    : Promise.reject(new Error('fora do navegador'));
  const promessa = Promise.allSettled([doRamo, doSite]).then(([ramo, site]) => {
    const bons = [ramo, site].filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!bons.length) throw site.reason || ramo.reason;
    return bons.sort((a, b) => String(b.atualizado_em || '').localeCompare(String(a.atualizado_em || '')))[0];
  });
  const entrada = { em: agora, promessa };
  snapshotEmCache = entrada;
  promessa.catch(() => {
    if (snapshotEmCache === entrada) snapshotEmCache = null;
  });
  return promessa;
}

function limparCotacao(c) {
  const v = (x) => {
    const n = num(x);
    return n !== null && n >= 0 && n <= 1 ? n : null;
  };
  return { prob: v(c?.prob), compra: v(c?.compra), venda: v(c?.venda), ultimo: v(c?.ultimo) };
}

function fonteDoSnapshot(F, f, snap, erroVivo) {
  const comErro = f.status === 'erro';
  return {
    ...cabecalho(F),
    candidatos: { lula: limparCotacao(f.candidatos?.lula), flavio: limparCotacao(f.candidatos?.flavio) },
    volume_usd: num(f.volume_usd),
    liquidez_usd: num(f.liquidez_usd),
    encerra_em: typeof f.encerra_em === 'string' ? f.encerra_em : null,
    status: comErro ? 'erro' : 'ok',
    erro: comErro ? `ao vivo: ${erroVivo?.message}; snapshot: ${f.erro || 'sem dado'}` : null,
    origem: 'snapshot',
    atualizado_em: f.atualizado_em || snap.atualizado_em || null,
  };
}

function fonteComErro(F, mensagem) {
  return {
    ...cabecalho(F),
    candidatos: { lula: cotacaoVazia(), flavio: cotacaoVazia() },
    volume_usd: null,
    liquidez_usd: null,
    encerra_em: null,
    status: 'erro',
    erro: mensagem,
    origem: 'snapshot',
    atualizado_em: null,
  };
}

/* ---------------------------------------------------------- lerMercados */

async function lerFonte(F, aoVivo) {
  const chave = `${F.id}:mercados`;
  let erroVivo = new Error(motivoSemVivo(chave));
  if (podeTentar(chave)) {
    try {
      return await aoVivo();
    } catch (e) {
      erroVivo = e;
      registrarFalha(chave, e);
    }
  }
  try {
    const snap = await lerSnapshot();
    const f = snap.fontes.find((x) => x && x.id === F.id);
    if (!f) throw new Error(`snapshot sem ${F.id}`);
    return fonteDoSnapshot(F, f, snap, erroVivo);
  } catch (e) {
    return fonteComErro(F, `ao vivo: ${erroVivo.message}; snapshot: ${e.message}`);
  }
}

export async function lerMercados() {
  const fontes = await Promise.all([lerFonte(POLYMARKET, polymarketAoVivo), lerFonte(KALSHI, kalshiAoVivo)]);
  // Hora do dado mais novo entre as fontes que responderam; cada fonte traz a sua.
  const horas = fontes
    .filter((f) => f.status === 'ok' && f.atualizado_em)
    .map((f) => Date.parse(f.atualizado_em))
    .filter(Number.isFinite);
  return { atualizado_em: iso(horas.length ? Math.max(...horas) : Date.now()), fontes };
}

/* --------------------------------------------------------- lerHistorico */

// Resolução: de hora em hora até 30 dias; de 12 em 12 h até 120; diária acima disso.
const baldeHoras = (dias) => (dias <= 30 ? 1 : dias <= 120 ? 12 : 24);

/**
 * Junta as duas séries ([[t_seg, valor], ...]) num ponto por balde de tempo
 * (o balde é o horário redondo mais próximo). Em cada balde fica a observação
 * mais recente de cada candidato; t é a hora real dessa observação. Lado sem
 * dado num balde herda o valor anterior; antes da primeira observação, null.
 */
function juntar(lula, flavio, baldeSeg) {
  const baldes = new Map();
  const colocar = (serie, lado) => {
    for (const [t, v] of serie) {
      if (t === null || v === null || !(v >= 0 && v <= 1)) continue;
      const k = Math.floor(t / baldeSeg + 0.5);
      let b = baldes.get(k);
      if (!b) baldes.set(k, (b = { t, lula: null, flavio: null, tLula: -Infinity, tFlavio: -Infinity }));
      const campoT = lado === 'lula' ? 'tLula' : 'tFlavio';
      if (t >= b[campoT]) {
        b[lado] = v;
        b[campoT] = t;
      }
      if (t > b.t) b.t = t;
    }
  };
  colocar(lula, 'lula');
  colocar(flavio, 'flavio');
  const lista = [...baldes.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => b);
  let ultLula = null;
  let ultFlavio = null;
  for (const b of lista) {
    if (b.lula === null) b.lula = ultLula;
    else ultLula = b.lula;
    if (b.flavio === null) b.flavio = ultFlavio;
    else ultFlavio = b.flavio;
  }
  return lista;
}

function recortar(lista, dias, refSeg) {
  const desde = refSeg - dias * DIA;
  return lista
    .filter((b) => b.t >= desde)
    .map((b) => ({ t: iso(b.t * 1000), lula: arred(b.lula), flavio: arred(b.flavio) }));
}

async function historicoPolymarketAoVivo(dias) {
  const P = POLYMARKET;
  const balde = baldeHoras(dias);
  // interval=max só traz de hora em hora os últimos 30 dias; acima disso, 12 h ou 24 h.
  const params = balde === 1 ? 'interval=1m&fidelity=60' : `interval=max&fidelity=${balde * 60}`;
  const respostas = await Promise.all(
    LADOS.map((lado) => pegarJson(`${P.clob}/prices-history?market=${P.token[lado]}&${params}`)),
  );
  const [lula, flavio] = respostas.map((r) => {
    if (!r || !Array.isArray(r.history)) throw new Error('formato inesperado do histórico (Polymarket)');
    return r.history.map((p) => [num(p.t), num(p.p)]);
  });
  return recortar(juntar(lula, flavio, balde * HORA), dias, Math.floor(Date.now() / 1000));
}

function precoVela(vela) {
  const lado = (obj, campo = 'close') => {
    if (!obj) return null;
    const d = num(obj[`${campo}_dollars`]);
    if (d !== null) return d;
    const c = num(obj[campo]);
    return c === null ? null : c / 100;
  };
  const compra = lado(vela.yes_bid);
  const venda = lado(vela.yes_ask);
  if (compra !== null && venda !== null && compra > 0 && venda < 1) return (compra + venda) / 2;
  return lado(vela.price) ?? lado(vela.price, 'previous');
}

async function historicoKalshiAoVivo(dias) {
  const K = KALSHI;
  const balde = baldeHoras(dias);
  const agora = Math.floor(Date.now() / 1000);
  const periodo = balde === 24 ? 1440 : 60; // minutos por vela
  const inicio = agora - dias * DIA - balde * HORA;
  const fim = agora + periodo * 60; // inclui a vela em andamento
  const respostas = await Promise.all(
    LADOS.map((lado) =>
      pegarJson(
        `${K.api}/series/${K.serie}/markets/${K.ticker[lado]}/candlesticks` +
          `?start_ts=${inicio}&end_ts=${fim}&period_interval=${periodo}`,
      ),
    ),
  );
  const [lula, flavio] = respostas.map((r) => {
    if (!r || !Array.isArray(r.candlesticks)) throw new Error('formato inesperado das velas (Kalshi)');
    return r.candlesticks.map((v) => {
      const t = num(v.end_period_ts);
      return [t === null ? null : Math.min(t, agora), precoVela(v)];
    });
  });
  return recortar(juntar(lula, flavio, balde * HORA), dias, agora);
}

function historicoDoSnapshot(lista, dias) {
  const pontos = lista
    .map((p) => ({ t: Date.parse(p?.t) / 1000, lula: num(p?.lula), flavio: num(p?.flavio) }))
    .filter((p) => Number.isFinite(p.t));
  if (!pontos.length) return [];
  const lula = pontos.map((p) => [p.t, p.lula]);
  const flavio = pontos.map((p) => [p.t, p.flavio]);
  const ref = Math.max(...pontos.map((p) => p.t));
  return recortar(juntar(lula, flavio, baldeHoras(dias) * HORA), dias, ref);
}

function comOrigem(pontos, origem, atualizadoEm) {
  Object.defineProperty(pontos, 'origem', { value: origem, enumerable: false });
  Object.defineProperty(pontos, 'atualizado_em', { value: atualizadoEm, enumerable: false });
  return pontos;
}

/**
 * Série de probabilidades dos últimos `dias` dias (padrão 30): de hora em hora
 * até 30 dias, de 12 em 12 h até 120. Devolve [] se nem o ao vivo nem o
 * snapshot responderem (o motivo vai para o console.warn).
 */
export async function lerHistorico(id, dias = 30) {
  const F = FONTES[id];
  if (!F) throw new TypeError(`fonte desconhecida: ${id} (use 'polymarket' ou 'kalshi')`);
  let n = Number(dias);
  if (!(n > 0)) n = 30;
  n = Math.min(n, 400);

  const chave = `${id}:historico`;
  let erroVivo = new Error(motivoSemVivo(chave));
  if (podeTentar(chave)) {
    try {
      const pontos = await (id === 'polymarket' ? historicoPolymarketAoVivo(n) : historicoKalshiAoVivo(n));
      if (!pontos.length) throw new Error('histórico vazio');
      return comOrigem(pontos, 'ao_vivo', iso(Date.now()));
    } catch (e) {
      erroVivo = e;
      registrarFalha(chave, e);
    }
  }
  try {
    const snap = await lerSnapshot();
    const lista = snap.historico?.[id];
    if (!Array.isArray(lista)) throw new Error(`snapshot sem histórico de ${id}`);
    const f = snap.fontes.find((x) => x && x.id === id);
    return comOrigem(historicoDoSnapshot(lista, n), 'snapshot', f?.atualizado_em || snap.atualizado_em || null);
  } catch (e) {
    console.warn(`[mercados] histórico de ${id} indisponível. Ao vivo: ${erroVivo.message}. Snapshot: ${e.message}`);
    return comOrigem([], null, null);
  }
}
