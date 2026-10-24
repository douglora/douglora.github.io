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
 *       status: 'ok' | 'erro', erro,
 *       origem: 'ao_vivo' | 'vivo-15s' | 'snapshot',   // por qual caminho o preço chegou
 *       via: 'websocket' | 'rest' | 'vivo-15s' | 'snapshot',   // extra: o detalhe do caminho
 *       atualizado_em,   // extra: hora do dado DESTA fonte (ver abaixo, é a hora do preço, não da leitura)
 *     }]
 *   }
 *   lerHistorico(id, dias = 30) → [{ t: ISO, lula: 0..1 | null, flavio: 0..1 | null }]
 *     (o array traz também, não enumeráveis, .origem e .atualizado_em)
 *   aoMudar(fn) → desfaz()   // extra: chama fn() quando chega preço novo (WebSocket ou balde novo do
 *     canal vivo); quem usa chama lerMercados() de novo. Sem ouvinte o módulo não tem relógio próprio.
 *   diagnostico() → objeto com o estado interno (WebSocket, canal vivo), para o console.
 *
 * Como lê, em camadas (cada fonte cai para a próxima; uma fonte falhar não derruba a outra):
 *   1. ao_vivo, Polymarket: WebSocket público do livro (wss://ws-subscriptions-clob.polymarket.com),
 *      tempo real de verdade, onde a rede do visitante alcança; senão a leitura REST direta
 *      (clob /book, fetch com timeout de 8 s, sem chave e sem cabeçalho extra, então sem
 *      preflight). atualizado_em = último sinal de vida da conexão (preço, ou PONG a cada 10 s).
 *   2. vivo-15s: o Mac do Radar lê as duas casas a cada 15 s (scripts/pocket_mercados_vivo.py) e
 *      grava um arquivo por balde no ramo `vivo` de douglora.github.io (vivo/AAAAMMDD/HH/MMSS.json,
 *      horário de Brasília). raw.githubusercontent.com serve na hora um caminho NOVO (medido em
 *      24/10/2026); só um caminho pedido antes de existir fica em cache como 404 por 1 a 2 min. Por
 *      isso a página só pede baldes que começaram há pelo menos 12 s, no máximo 2 pedidos por leitura:
 *      o do instante (agora − 12 s) e, se não existir, o alinhado ao minuto (que o Mac grava
 *      sempre, mudando o preço ou não; parado há mais de 3 min, só esses saem). Nunca pede balde futuro.
 *      atualizado_em = hora em que o Mac leu a casa. É o caminho de quem está no Brasil, onde o
 *      provedor bloqueia a Polymarket e a Kalshi (Resolução CMN 5.298/2026), e o da Kalshi sempre.
 *   3. snapshot: /data/pocket/mercados.json do site e o do ramo `mercados` (5 em 5 min, mais cache
 *      de ~5 min do raw), gravado por scripts/pocket_mercados.py. Vale o mais novo dos dois.
 *      Também é a reserva quando o vivo está mais velho que 2,5 min.
 *
 * CORS medido em 22/10/2026 com Origin https://douglora.github.io:
 *   - Polymarket (gamma-api e clob): libera (Access-Control-Allow-Origin: *) → ao vivo.
 *   - Kalshi: recusa (403 do CloudFront para qualquer Origin que não seja
 *     kalshi.com, inclusive localhost) → no navegador sai do vivo-15s ou do snapshot;
 *     no Node, que não aplica CORS, sai ao vivo.
 *   - raw.githubusercontent.com libera (*), inclusive no 404.
 *
 * Preços (de 0 a 1 = US$ por contrato que paga US$ 1 se o candidato vencer):
 *   compra = melhor oferta de compra do "Sim" (bid); venda = melhor oferta de
 *   venda (ask); ultimo = último negócio; prob = (compra + venda) / 2, ou ultimo
 *   quando falta um lado do livro. O que não existe vira null.
 *   Polymarket: igual ao que o polymarket.com mostra, que é o meio do livro, ou o último
 *   negócio quando a faixa compra–venda passa de US$ 0,10.
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

// Canal vivo (arquivos de 15 s do Mac no ramo `vivo`; ver o cabeçalho).
const VIVO_BASE = 'https://raw.githubusercontent.com/douglora/douglora.github.io/vivo/vivo/';
const VIVO_BALDE_MS = 15 * 1000;
// O Mac grava o balde logo na virada e o push leva de 1,5 s (Mac livre) a 6,5 s (medido com o Mac
// carregado, load médio 45); com 12 s de folga o arquivo já existe. Pedir antes de existir deixa um 404
// em cache no raw por 1 a 2 min, para todo mundo.
const VIVO_MARGEM_MS = 12 * 1000;
const VIVO_BATIMENTO = 2; // balde par (segundo :00 ou :30): o Mac sempre grava, mesmo com o preço parado
const VIVO_VALE_MS = 150 * 1000; // preço do Mac mais velho que isso perde para o snapshot mais novo
const VIVO_TEMPO_LIMITE_MS = 6000;

// WebSocket público do livro da Polymarket (sem chave; a Polymarket libera de qualquer origem).
const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const WS_PING_MS = 10 * 1000; // a Polymarket pede um PING a cada 10 s e responde PONG
const WS_ABRIR_MS = 6 * 1000;
const WS_VALE_MS = 25 * 1000; // sem sinal de vida por 25 s: conexão morta
const WS_ESPERA_PRIMEIRA_MS = 2500; // a primeira leitura da página espera o livro chegar por até 2,5 s
const WS_OCULTA_FECHA_MS = 60 * 1000; // aba escondida por 1 min: fecha a conexão
const NOTIFICAR_MIN_MS = 1000;

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

/* No mercado negRisk da Polymarket o livro às vezes informa o último negócio
 * pelo lado oposto do contrato (Lula "último 76%" com compra 22% e venda 24%,
 * 23/10/2026). Último fora da faixa compra–venda vira o complementar se este
 * couber; se nenhum couber, fica sem último. */
const FOLGA_ULTIMO = 0.03;
function ultimoCoerente(c, v, u) {
  if (u === null || c === null || v === null) return u;
  const cabe = (x) => x >= c - FOLGA_ULTIMO && x <= v + FOLGA_ULTIMO;
  if (cabe(u)) return u;
  return cabe(1 - u) ? 1 - u : null;
}

function cotacao(compra, venda, ultimo) {
  const c = compra !== null && compra > 0 && compra < 1 ? compra : null;
  const v = venda !== null && venda > 0 && venda < 1 ? venda : null;
  const u = ultimoCoerente(c, v, ultimo !== null && ultimo > 0 && ultimo <= 1 ? ultimo : null);
  const prob = c !== null && v !== null ? (c + v) / 2 : u;
  return { prob: arred(prob), compra: arred(c), venda: arred(v), ultimo: arred(u) };
}

const cotacaoVazia = () => ({ prob: null, compra: null, venda: null, ultimo: null });

/* O que o polymarket.com mostra: o meio do livro, ou o último negócio quando a faixa
 * compra–venda passa de US$ 0,10 (regra da própria Polymarket; sem último, fica o meio). */
const LIMITE_SPREAD_POLY = 0.1;
function cotacaoPoly(compra, venda, ultimo) {
  const cot = cotacao(compra, venda, ultimo);
  if (cot.compra !== null && cot.venda !== null && cot.ultimo !== null && cot.venda - cot.compra > LIMITE_SPREAD_POLY + 1e-9) {
    cot.prob = cot.ultimo;
  }
  return cot;
}

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
      ? cotacaoPoly(melhorPreco(livro.bids, true), melhorPreco(livro.asks, false), num(livro.last_trade_price))
      : cotacaoPoly(num(mercado.bestBid), num(mercado.bestAsk), num(mercado.lastTradePrice));
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
    via: 'rest',
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
    via: 'rest',
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
    // o Mac não alcança mais o site (bloqueio do provedor): a página avisa
    bloqueio: f.bloqueio && typeof f.bloqueio.desde === 'string' ? { desde: f.bloqueio.desde } : null,
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

/* ------------------------------------------------------------ ouvintes */

/* `aoMudar(fn)`: a página registra um ouvinte e é chamada quando chega preço novo (WebSocket ou
 * balde novo do canal vivo). O módulo só tem relógio próprio enquanto houver ouvinte. */
const ouvintes = new Set();
let ultimaNotificacao = 0;
let notificacaoPendente = null;

function notificar() {
  if (!ouvintes.size) return;
  const espera = ultimaNotificacao + NOTIFICAR_MIN_MS - Date.now();
  if (espera > 0) {
    if (!notificacaoPendente) {
      notificacaoPendente = setTimeout(() => {
        notificacaoPendente = null;
        notificar();
      }, espera);
    }
    return;
  }
  ultimaNotificacao = Date.now();
  for (const fn of [...ouvintes]) {
    try {
      fn();
    } catch (e) {
      console.warn('[mercados] ouvinte falhou:', e?.message || e);
    }
  }
}

export function aoMudar(fn) {
  if (typeof fn !== 'function') throw new TypeError('aoMudar espera uma função');
  ouvintes.add(fn);
  agendarVivo();
  return () => ouvintes.delete(fn);
}

/* ----------------------------------------------------- canal vivo (15 s) */

const vivo = { ultimo: null, faltam: new Set(), emCurso: null, erro: null, pedidos: 0, naoEncontrados: 0 };

// Nome do arquivo do balde k (k·15 s desde 1970): AAAAMMDD/HH/MMSS.json em Brasília (UTC−3 fixo desde 2019).
function caminhoBalde(k) {
  const x = new Date(k * VIVO_BALDE_MS - 3 * 3600e3).toISOString();
  return `${x.slice(0, 4)}${x.slice(5, 7)}${x.slice(8, 10)}/${x.slice(11, 13)}/${x.slice(14, 16)}${x.slice(17, 19)}.json`;
}

async function pegarBalde(k) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), VIVO_TEMPO_LIMITE_MS);
  vivo.pedidos += 1;
  try {
    const r = await fetch(VIVO_BASE + caminhoBalde(k), { cache: 'no-store', signal: ctrl.signal });
    if (r.status === 404) {
      const e = new Error('balde não existe (parado, ou o Mac ainda não enviou)');
      e.ausente = true;
      throw e;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} em raw.githubusercontent.com`);
    const doc = await r.json();
    if (!doc || doc.v !== 1 || typeof doc.fontes !== 'object' || doc.fontes === null) throw new Error('balde em formato inesperado');
    return doc;
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`sem resposta em ${VIVO_TEMPO_LIMITE_MS / 1000} s (raw.githubusercontent.com)`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* Acha o balde mais novo que já existe, com no máximo 2 pedidos por leitura:
 *   1. o do instante: o balde que começou há pelo menos VIVO_MARGEM_MS (nunca um balde futuro);
 *   2. se esse não existir (o Mac só grava todo balde enquanto o preço mexe, ou o envio atrasou), o
 *      alinhado ao minuto, que o Mac grava sempre; com o preço parado ele vale igual ao do balde que faltou.
 * Balde que já deu 404 não é pedido de novo e nada mais velho que o último bom é pedido: sem balde novo,
 * fica o último bom, com a hora dele (a idade aparece na tela). */
async function lerVivoAgora() {
  const k0 = Math.floor((Date.now() - VIVO_MARGEM_MS) / VIVO_BALDE_MS);
  const kBat = k0 - (((k0 % VIVO_BATIMENTO) + VIVO_BATIMENTO) % VIVO_BATIMENTO);
  const candidatos = kBat === k0 ? [k0] : [k0, kBat];
  let pedidos = 0;
  let erro = null;
  for (const k of candidatos) {
    if (vivo.ultimo && k <= vivo.ultimo.k) break;
    if (vivo.faltam.has(k)) continue;
    if (pedidos >= 2) break;
    pedidos += 1;
    try {
      const doc = await pegarBalde(k);
      vivo.ultimo = { k, doc, lidoEm: Date.now() };
      erro = null;
      break;
    } catch (e) {
      if (e.ausente) {
        vivo.faltam.add(k);
        vivo.naoEncontrados += 1;
      } else {
        erro = e;
      }
    }
  }
  if (vivo.faltam.size > 64) {
    for (const k of [...vivo.faltam].sort((a, b) => a - b).slice(0, 32)) vivo.faltam.delete(k);
  }
  vivo.erro = erro ? erro.message : null;
  return vivo.ultimo;
}

function lerVivo() {
  if (!NO_NAVEGADOR) return Promise.resolve(null);
  if (!vivo.emCurso) {
    vivo.emCurso = lerVivoAgora()
      .catch((e) => {
        vivo.erro = e?.message || String(e);
        return vivo.ultimo;
      })
      .finally(() => {
        vivo.emCurso = null;
      });
  }
  return vivo.emCurso;
}

function cotacaoDoVivo(c) {
  const lado = limparCotacao(c);
  return lado.prob === null ? null : lado;
}

// Uma casa no arquivo do balde → fonte no formato de lerMercados(). Devolve null sem preço dos dois lados.
function fonteDoVivo(F, doc) {
  const c = doc?.fontes?.[F.id];
  const em = num(c?.em);
  const lula = cotacaoDoVivo(c?.lula);
  const flavio = cotacaoDoVivo(c?.flavio);
  if (em === null || !lula || !flavio) return null;
  return {
    ...cabecalho(F),
    candidatos: { lula, flavio },
    volume_usd: num(c.vol),
    liquidez_usd: num(c.liq),
    encerra_em: typeof c.fim === 'string' ? c.fim : null,
    status: 'ok',
    erro: null,
    origem: 'vivo-15s',
    via: 'vivo-15s',
    atualizado_em: iso(em),
    balde: doc.b || null,
    aviso: typeof c.erro === 'string' && c.erro ? `o Mac não conseguiu reler agora (${c.erro}); vale o último preço lido` : null,
    bloqueio: null,
  };
}

const idadeMs = (f) => (f?.atualizado_em ? Date.now() - Date.parse(f.atualizado_em) : Infinity);

/* Com ouvinte, o módulo relê o canal vivo logo depois de cada balde novo ficar pronto
 * (virada de 15 s + margem + folga de 0,4 a 1 s, para os visitantes não baterem juntos). */
let agendaVivo = null;
function agendarVivo() {
  if (!NO_NAVEGADOR || !ouvintes.size || agendaVivo) return;
  const agora = Date.now();
  const proximo = (Math.floor((agora - VIVO_MARGEM_MS) / VIVO_BALDE_MS) + 1) * VIVO_BALDE_MS + VIVO_MARGEM_MS;
  agendaVivo = setTimeout(async () => {
    agendaVivo = null;
    if (!document.hidden && ouvintes.size) {
      const antes = vivo.ultimo?.k;
      await lerVivo();
      if (vivo.ultimo?.k !== antes) notificar();
    }
    agendarVivo();
  }, Math.max(250, proximo - agora + 400 + Math.random() * 600));
}

/* ------------------------------------------------- Polymarket WebSocket */

const novoLivro = () => ({ bids: new Map(), asks: new Map(), compra: null, venda: null, ultimo: null, pronto: false });
const LADO_DO_TOKEN = { [POLYMARKET.token.lula]: 'lula', [POLYMARKET.token.flavio]: 'flavio' };
const ws = {
  soc: null,
  estado: 'parado', // parado | abrindo | aberto | falhou
  proxima: 0,
  falhas: 0,
  abriuEm: 0,
  vida: 0,
  erro: null,
  livros: { lula: novoLivro(), flavio: novoLivro() },
  pronto: null,
  resolverPronto: null,
  timerPing: null,
  timerOculta: null,
  fechandoDeProposito: false,
  mensagens: 0,
  assinatura: '',
};

const topoDoLivro = (mapa, maior) => {
  let melhor = null;
  for (const [p, q] of mapa) if (q > 0 && (melhor === null || (maior ? p > melhor : p < melhor))) melhor = p;
  return melhor;
};

function wsAtualizarTopo(livro) {
  livro.compra = topoDoLivro(livro.bids, true);
  livro.venda = topoDoLivro(livro.asks, false);
}

function wsLivro(ev) {
  const lado = LADO_DO_TOKEN[ev.asset_id];
  if (!lado) return;
  const livro = ws.livros[lado];
  const montar = (lista) => {
    const mapa = new Map();
    for (const o of Array.isArray(lista) ? lista : []) {
      const p = num(o?.price);
      const q = num(o?.size);
      if (p !== null && q > 0) mapa.set(p, q);
    }
    return mapa;
  };
  livro.bids = montar(ev.bids);
  livro.asks = montar(ev.asks);
  const u = num(ev.last_trade_price);
  if (u !== null) livro.ultimo = u;
  wsAtualizarTopo(livro);
  livro.pronto = true;
}

function wsMudanca(ch) {
  const lado = LADO_DO_TOKEN[ch?.asset_id];
  if (!lado) return;
  const livro = ws.livros[lado];
  if (!livro.pronto) return; // sem o livro inteiro de partida, a diferença não serve
  const p = num(ch.price);
  const q = num(ch.size);
  const mapa = String(ch.side).toUpperCase() === 'BUY' ? livro.bids : String(ch.side).toUpperCase() === 'SELL' ? livro.asks : null;
  if (mapa && p !== null && q !== null) {
    if (q > 0) mapa.set(p, q);
    else mapa.delete(p);
  }
  wsAtualizarTopo(livro);
}

function wsNegocio(ev) {
  const lado = LADO_DO_TOKEN[ev?.asset_id];
  const p = num(ev?.price);
  if (lado && p !== null) ws.livros[lado].ultimo = p;
}

function wsMensagem(texto) {
  ws.vida = Date.now();
  ws.mensagens += 1;
  if (texto === 'PONG') return;
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    return;
  }
  for (const ev of Array.isArray(dados) ? dados : [dados]) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.event_type === 'book') wsLivro(ev);
    else if (ev.event_type === 'price_change') for (const ch of Array.isArray(ev.price_changes) ? ev.price_changes : []) wsMudanca(ch);
    else if (ev.event_type === 'last_trade_price') wsNegocio(ev);
  }
  if (LADOS.every((l) => ws.livros[l].pronto)) {
    ws.resolverPronto?.();
    const f = polymarketDoWs();
    const assinatura = f ? LADOS.map((l) => ['prob', 'compra', 'venda', 'ultimo'].map((c) => f.candidatos[l][c]).join('/')).join('|') : '';
    if (assinatura !== ws.assinatura) {
      ws.assinatura = assinatura;
      notificar();
    }
  }
}

function wsLimpar() {
  clearInterval(ws.timerPing);
  ws.timerPing = null;
  ws.livros = { lula: novoLivro(), flavio: novoLivro() };
  ws.assinatura = '';
}

function wsFalhou(abriu, motivo) {
  const durou = abriu ? Date.now() - ws.abriuEm : 0;
  wsLimpar();
  ws.soc = null;
  ws.estado = ws.fechandoDeProposito ? 'parado' : 'falhou';
  ws.erro = motivo || (abriu ? 'conexão encerrada' : 'não abriu (bloqueio de rede, DNS ou proxy)');
  if (ws.fechandoDeProposito) {
    ws.proxima = 0;
  } else if (abriu) {
    if (durou > 30000) ws.falhas = 0;
    ws.falhas += 1;
    ws.proxima = Date.now() + Math.min(60000, 2000 * 2 ** Math.min(ws.falhas, 5));
  } else {
    // não abriu: quase sempre é bloqueio (o provedor do Brasil barra o DNS): tenta de novo só a cada 3, 6, 10 min
    ws.proxima = Date.now() + Math.min(10 * 60000, 3 * 60000 * 2 ** Math.min(ws.falhas, 2));
    ws.falhas += 1;
  }
  ws.fechandoDeProposito = false;
  ws.resolverPronto?.();
}

function abrirWs() {
  if (!NO_NAVEGADOR || typeof WebSocket === 'undefined') return;
  if (ws.estado === 'abrindo' || ws.estado === 'aberto' || Date.now() < ws.proxima) return;
  let soc;
  ws.estado = 'abrindo';
  ws.erro = null;
  ws.pronto = new Promise((resolve) => {
    ws.resolverPronto = resolve;
  });
  try {
    soc = new WebSocket(WS_URL);
  } catch (e) {
    wsFalhou(false, e?.message);
    return;
  }
  ws.soc = soc;
  const limite = setTimeout(() => {
    if (ws.soc === soc && ws.estado === 'abrindo') {
      try {
        soc.close();
      } catch {}
      wsFalhou(false, `sem resposta em ${WS_ABRIR_MS / 1000} s`);
    }
  }, WS_ABRIR_MS);
  soc.onopen = () => {
    clearTimeout(limite);
    if (ws.soc !== soc) return;
    ws.estado = 'aberto';
    ws.abriuEm = Date.now();
    ws.vida = ws.abriuEm;
    soc.send(JSON.stringify({ assets_ids: LADOS.map((l) => POLYMARKET.token[l]), type: 'market' }));
    ws.timerPing = setInterval(() => {
      if (ws.soc !== soc) return;
      if (Date.now() - ws.vida > WS_VALE_MS) {
        try {
          soc.close();
        } catch {}
        return;
      }
      try {
        soc.send('PING');
      } catch {}
    }, WS_PING_MS);
  };
  soc.onmessage = (e) => {
    if (ws.soc === soc && typeof e.data === 'string') wsMensagem(e.data);
  };
  soc.onerror = () => {}; // o onclose vem em seguida e trata
  soc.onclose = () => {
    clearTimeout(limite);
    if (ws.soc === soc) wsFalhou(ws.estado === 'aberto');
  };
}

function fecharWs() {
  const soc = ws.soc;
  if (!soc) return;
  ws.fechandoDeProposito = true;
  try {
    soc.close();
  } catch {}
  if (ws.soc === soc && ws.estado !== 'aberto') wsFalhou(false);
}

if (NO_NAVEGADOR) {
  // Aba escondida por 1 min: fecha o WebSocket (o navegador segura os timers do PING); volta a abrir na próxima leitura.
  document.addEventListener?.('visibilitychange', () => {
    clearTimeout(ws.timerOculta);
    if (document.hidden) ws.timerOculta = setTimeout(fecharWs, WS_OCULTA_FECHA_MS);
    else agendarVivo();
  });
}

// Preço da Polymarket pelo livro que o WebSocket mantém; null se a conexão não está viva.
function polymarketDoWs() {
  if (ws.estado !== 'aberto' || Date.now() - ws.vida > WS_VALE_MS) return null;
  if (!LADOS.every((l) => ws.livros[l].pronto)) return null;
  const candidatos = {};
  for (const lado of LADOS) {
    const L = ws.livros[lado];
    candidatos[lado] = cotacaoPoly(L.compra, L.venda, L.ultimo);
  }
  try {
    validarCandidatos(candidatos, 'Polymarket (WebSocket)');
  } catch {
    return null;
  }
  return {
    ...cabecalho(POLYMARKET),
    candidatos,
    volume_usd: null,
    liquidez_usd: null,
    encerra_em: null,
    status: 'ok',
    erro: null,
    origem: 'ao_vivo',
    via: 'websocket',
    atualizado_em: iso(ws.vida),
  };
}

// O WebSocket só traz preço; volume, liquidez e prazo vêm do canal vivo (ou do snapshot, se já lido).
function comMeta(fonte, docVivo) {
  if (fonte.volume_usd !== null && fonte.encerra_em !== null) return fonte;
  const m = fonteDoVivo(fonte.id === 'polymarket' ? POLYMARKET : KALSHI, docVivo);
  if (!m) return fonte;
  return {
    ...fonte,
    volume_usd: fonte.volume_usd ?? m.volume_usd,
    liquidez_usd: fonte.liquidez_usd ?? m.liquidez_usd,
    encerra_em: fonte.encerra_em ?? m.encerra_em,
  };
}

/* ---------------------------------------------------------- lerMercados */

async function doSnapshot(F, erroVivo) {
  const snap = await lerSnapshot();
  const f = snap.fontes.find((x) => x && x.id === F.id);
  if (!f) throw new Error(`snapshot sem ${F.id}`);
  return { ...fonteDoSnapshot(F, f, snap, erroVivo), via: 'snapshot' };
}

function comLimite(promessa, ms, F) {
  let timer;
  const limite = new Promise((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new ErroBloqueio(`sem resposta em ${ms / 1000} s (${F.nome})`)), ms);
  });
  promessa.catch(() => {}); // se perder a corrida, o erro dela não vira "rejeição sem tratamento"
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer));
}

/* Camadas de uma fonte, da mais nova para a mais velha: ao vivo (WebSocket, depois REST) → vivo-15s →
 * snapshot. O vivo só vale enquanto o preço do Mac tiver menos de 2,5 min; mais velho que isso, vale
 * o que for mais novo entre ele e o snapshot. */
async function lerFonte(F, aoVivoDireto, docVivo) {
  const chave = `${F.id}:mercados`;
  let erroVivo = new Error(motivoSemVivo(chave));
  if (F.id === 'polymarket') {
    const w = polymarketDoWs();
    if (w) return comMeta(w, docVivo);
  }
  const doVivo = fonteDoVivo(F, docVivo);
  if (aoVivoDireto && podeTentar(chave)) {
    try {
      // Com o vivo em dia como reserva, não espera mais que 3 s por uma leitura direta que não responde.
      return await (doVivo && idadeMs(doVivo) <= VIVO_VALE_MS ? comLimite(aoVivoDireto(), 3000, F) : aoVivoDireto());
    } catch (e) {
      erroVivo = e;
      registrarFalha(chave, e);
    }
  }
  if (doVivo && idadeMs(doVivo) <= VIVO_VALE_MS) return doVivo;
  try {
    const snap = await doSnapshot(F, erroVivo);
    if (doVivo && snap.status === 'ok' && idadeMs(doVivo) < idadeMs(snap)) return doVivo;
    return snap;
  } catch (e) {
    if (doVivo) return doVivo;
    const vivoMsg = vivo.erro ? `; vivo: ${vivo.erro}` : NO_NAVEGADOR ? '; vivo: sem balde recente' : '';
    return fonteComErro(F, `ao vivo: ${erroVivo.message}${vivoMsg}; snapshot: ${e.message}`);
  }
}

let leituraEmCurso = null;

async function lerMercadosAgora() {
  abrirWs();
  // Na primeira leitura da página o WebSocket ainda está abrindo: espera o livro chegar (até 2,5 s).
  const espera = ws.estado === 'abrindo' && ws.pronto ? Promise.race([ws.pronto, new Promise((r) => setTimeout(r, WS_ESPERA_PRIMEIRA_MS))]) : null;
  const [ultimoVivo] = await Promise.all([lerVivo(), espera]);
  const docVivo = ultimoVivo?.doc || null;
  const fontes = await Promise.all([
    lerFonte(POLYMARKET, polymarketAoVivo, docVivo),
    lerFonte(KALSHI, NO_NAVEGADOR ? null : kalshiAoVivo, docVivo),
  ]);
  // Hora do dado mais novo entre as fontes que responderam; cada fonte traz a sua.
  const horas = fontes
    .filter((f) => f.status === 'ok' && f.atualizado_em)
    .map((f) => Date.parse(f.atualizado_em))
    .filter(Number.isFinite);
  return { atualizado_em: iso(horas.length ? Math.max(...horas) : Date.now()), fontes };
}

export function lerMercados() {
  if (!leituraEmCurso) {
    leituraEmCurso = lerMercadosAgora().finally(() => {
      leituraEmCurso = null;
    });
  }
  return leituraEmCurso;
}

export function diagnostico() {
  return {
    navegador: NO_NAVEGADOR,
    websocket: { estado: ws.estado, falhas: ws.falhas, erro: ws.erro, mensagens: ws.mensagens, vida_ha_s: ws.vida ? Math.round((Date.now() - ws.vida) / 1000) : null, proxima_tentativa_em_s: Math.max(0, Math.round((ws.proxima - Date.now()) / 1000)) },
    vivo: {
      balde: vivo.ultimo ? vivo.ultimo.doc.b : null,
      lido_ha_s: vivo.ultimo ? Math.round((Date.now() - vivo.ultimo.lidoEm) / 1000) : null,
      pedidos: vivo.pedidos,
      baldes_ausentes: vivo.naoEncontrados,
      erro: vivo.erro,
    },
    ouvintes: ouvintes.size,
  };
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
