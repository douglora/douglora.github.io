/**
 * Cartões ao vivo da Hyperliquid na aba Mercados (24/10/2026).
 *
 * Por que existe: no domingo 25/10, depois das 17h de Brasília, a bolsa americana está fechada.
 * Os contratos perpétuos da Hyperliquid (24 h por dia, 7 dias por semana) são o primeiro preço
 * do Brasil depois da apuração. Cada cartão traz o preço, duas variações (desde o fechamento de
 * sexta 23/10 em Nova York e em 24 h) e o gráfico de 15 em 15 min.
 *
 * Módulo ES, sem dependências e sem import de outros arquivos do site:
 *
 *   montar(el) → controle { retomar(), pausar(), destruir() }
 *     Renderiza os cartões dentro de `el` e os mantém vivos sozinho. Idempotente: chamar de novo
 *     no mesmo elemento devolve o mesmo controle e não duplica nada.
 *
 * Como lê, em camadas (cada uma cai para a próxima, nada lança erro para fora):
 *   1. WebSocket público (wss://api.hyperliquid.xyz/ws): activeAssetCtx (preço do meio do livro,
 *      a cada ~1 s) e candle de 15 min. Estado "ao vivo".
 *   2. REST (POST /info, metaAndAssetCtxs do dex xyz) a cada 20 s enquanto o WebSocket não der sinal.
 *   3. Snapshot local (SNAPSHOT_URL, gravado por scripts/pocket_hyperliquid.py), com a hora dele.
 *   4. "sem conexão", discreto.
 * Pausa quando a aba fica escondida (fecha o WebSocket e para os relógios) e retoma ao voltar.
 */

const SNAPSHOT_URL = '/data/pocket/hyperliquid.json';

const API_URL = 'https://api.hyperliquid.xyz/info';
const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const DEX = 'xyz';
const INTERVALO = '15m';
const INTERVALO_MS = 15 * 60 * 1000;

// Fechamento de sexta 23/10/2026 em Nova York: 16h EDT (o horário de verão dos EUA vai até 01/11) = 20h00 UTC.
const FECHAMENTO_MS = Date.UTC(2026, 9, 23, 20, 0, 0);
// O gráfico começa na abertura de sexta (09h30 EDT = 13h30 UTC) e anda até agora, no máximo 96 h para trás.
const ABERTURA_MS = Date.UTC(2026, 9, 23, 13, 30, 0);
const JANELA_MAX_MS = 96 * 3600 * 1000;
// Urnas fecham às 17h de Brasília (UTC-3, sem horário de verão) de domingo 25/10.
const URNAS_MS = Date.UTC(2026, 9, 25, 20, 0, 0);
const BRT_MS = 3 * 3600 * 1000;

const POLL_MS = 20000; // REST enquanto o WebSocket não dá sinal
const WS_SEM_DADO_MS = 15000; // sem mensagem por 15 s: o WebSocket não conta como vivo
const CANDLES_REFRESCO_MS = 120000; // no modo REST, refaz as velas de 2 em 2 min
const SNAPSHOT_REFRESCO_MS = 60000;

// Todos conferidos na API em 24/10/2026 (dex xyz: perpétuos de ações/ETFs, índices e commodities).
// EWZ: volume ~US$ 2,4 mi/24 h; BRENTOIL: ~US$ 28 mi; SP500: ~US$ 47 mi.
const ATIVOS = [
  { coin: 'xyz:EWZ', cod: 'EWZ', nome: 'ETF de ações brasileiras', sub: 'iShares MSCI Brazil', un: 'US$', dec: 2, destaque: true },
  { coin: 'xyz:BRENTOIL', cod: 'BRENTOIL', nome: 'Petróleo Brent', sub: 'Contrato de petróleo, por barril', un: 'US$', dec: 2 },
  { coin: 'xyz:SP500', cod: 'SP500', nome: 'Bolsa dos EUA · S&P 500', sub: 'Índice das 500 maiores empresas', un: 'pts', dec: 1 },
];

/* ------------------------------------------------------------------ utilidades */

const SVG = 'http://www.w3.org/2000/svg';
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const ehNum = (v) => typeof v === 'number' && Number.isFinite(v);
const aNum = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return ehNum(n) ? n : null;
};
const pad2 = (n) => String(n).padStart(2, '0');
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

function reduzMovimento() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/** Número no formato brasileiro (vírgula decimal, ponto de milhar). Menos tipográfico: U+2212. */
function fmt(v, dec = 2) {
  if (!ehNum(v)) return '—';
  const neg = v < 0 && Number(Math.abs(v).toFixed(dec)) !== 0;
  const [i, f] = Math.abs(v).toFixed(dec).split('.');
  return (neg ? '−' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (f ? ',' + f : '');
}

function fmtPct(v) {
  if (!ehNum(v)) return '—';
  const z = Number(Math.abs(v).toFixed(2)) === 0;
  return (z ? '' : v > 0 ? '+' : '−') + fmt(Math.abs(v), 2) + '%';
}

function abreviar(v) {
  if (!ehNum(v) || v <= 0) return '';
  if (v >= 1e9) return fmt(v / 1e9, 1) + ' bi';
  if (v >= 1e6) return fmt(v / 1e6, 1) + ' mi';
  if (v >= 1e3) return fmt(v / 1e3, 0) + ' mil';
  return fmt(v, 0);
}

/** Hora de Brasília (UTC-3 fixo) a partir de milissegundos. */
function brt(ms) {
  return new Date(ms - BRT_MS);
}
const horaSeg = (ms) => {
  const d = brt(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
};
const horaMin = (ms) => {
  const d = brt(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
};
const diaMes = (ms) => {
  const d = brt(ms);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}`;
};
const diaSemana = (ms) => DIAS[brt(ms).getUTCDay()];

function prefixo(v) {
  return v > 0 ? 'alta' : v < 0 ? 'queda' : 'zero';
}

async function pedir(corpo, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: ctl.signal,
      cache: 'no-store',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVG, tag);
  for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
  return e;
}

/* ------------------------------------------------------------------ montagem */

export function montar(raiz) {
  if (!raiz || typeof document === 'undefined') return null;
  const antigo = raiz.__hlControle;
  if (antigo && !antigo.destruido) {
    antigo.retomar();
    return antigo;
  }
  let c = null;
  try {
    c = criar(raiz);
  } catch (e) {
    // Nunca derruba a página: sem cartões, mas sem erro.
    try {
      raiz.replaceChildren();
    } catch {
      /* nada */
    }
    return null;
  }
  raiz.__hlControle = c;
  return c;
}

function criar(raiz) {
  const S = {
    raiz,
    bloco: null,
    topo: { ponto: null, rotulo: null },
    ativos: ATIVOS.map((cfg) => ({
      cfg,
      velas: [], // {t,o,h,l,c}
      mid: null,
      prev: null,
      ref: null,
      vol: null,
      oi: null,
      ts: 0, // quando o preço foi lido
      origem: null, // 'vivo' | 'foto'
      exib: null, // número mostrado agora
      txt: '',
      anim: 0,
      lay: null,
      grafEm: 0,
      sujo: true,
      refs: null,
    })),
    ws: null,
    wsTimer: null,
    wsPing: null,
    wsTent: 0,
    ultimoWs: 0,
    restOkEm: 0,
    proxPoll: 0,
    candlesEm: 0,
    temVivo: false,
    fotoOk: false,
    fotoEm: 0,
    fotoMs: 0,
    tentativas: 0,
    ocupado: false,
    restTimer: null,
    tickTimer: null,
    raf: 0,
    pausado: false,
    destruido: false,
    modo: 'conectando',
  };

  /* ---------- DOM ---------- */

  function montarDom() {
    const bloco = el('section', 'hl-bloco');
    bloco.setAttribute('aria-label', 'Hyperliquid, preços ao vivo');

    const topo = el('div', 'hl-topo');
    const rot = el('span', 'hl-rotulo');
    const ponto = el('i', 'hl-ponto');
    ponto.setAttribute('aria-hidden', 'true');
    const txt = el('span', 'hl-rotulo-txt', 'Hyperliquid · conectando');
    rot.append(ponto, txt);
    topo.append(rot);
    bloco.append(topo);
    S.topo.ponto = ponto;
    S.topo.rotulo = txt;

    const grade = el('div', 'hl-grade');
    for (const a of S.ativos) grade.append(montarCartao(a));
    bloco.append(grade);

    S.bloco = bloco;
    S.raiz.replaceChildren(bloco);
  }

  function montarCartao(a) {
    const cfg = a.cfg;
    const card = el('article', 'hl-card' + (cfg.destaque ? ' hl-card-destaque' : ''));
    card.dataset.coin = cfg.coin;
    card.setAttribute('aria-label', `${cfg.nome} (${cfg.cod})`);

    const info = el('div', 'hl-info');

    const cab = el('header', 'hl-cab');
    const h = el('h3', 'hl-nome', cfg.nome);
    const cod = el('span', 'hl-cod', cfg.cod);
    const tag = el('span', 'hl-tag');
    tag.hidden = true;
    cab.append(h, cod, tag);
    const sub = el('p', 'hl-sub', cfg.sub);

    const preco = el('p', 'hl-preco');
    const unPre = el('span', 'hl-un', cfg.un === 'US$' ? 'US$' : '');
    const valor = el('span', 'hl-valor', '—');
    const unPos = el('span', 'hl-un hl-un-pos', cfg.un === 'US$' ? '' : cfg.un);
    preco.append(unPre, valor, unPos);

    const vars = el('div', 'hl-vars');
    const vRef = variacao('Desde fech. de sex. 23/10');
    const v24 = variacao('Em 24 h');
    vars.append(vRef.caixa, v24.caixa);

    const pe = el('p', 'hl-pe');
    const hora = el('span', 'hl-hora', 'Conectando…');
    const vol = el('span', 'hl-vol');
    pe.append(hora, vol);

    info.append(cab, sub, preco, vars, pe);

    // gráfico
    const graf = el('div', 'hl-graf');
    graf.setAttribute('role', 'img');
    graf.setAttribute('aria-label', `Gráfico de ${cfg.cod}, de sexta 23/10 até agora, de 15 em 15 minutos`);
    const plot = el('div', 'hl-plot');
    const svg = svgEl('svg', { class: 'hl-svg', viewBox: '0 0 1000 400', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
    const gid = 'hl-g-' + cfg.cod;
    const defs = svgEl('defs');
    const lg = svgEl('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' });
    lg.append(svgEl('stop', { offset: '0', class: 'hl-gs0' }), svgEl('stop', { offset: '1', class: 'hl-gs1' }));
    defs.append(lg);
    const dias = svgEl('g', { class: 'hl-dias' });
    const urnasL = svgEl('line', { class: 'hl-urnas-l', x1: '0', x2: '0', y1: '0', y2: '400' });
    const refL = svgEl('line', { class: 'hl-ref-l', x1: '0', x2: '1000', y1: '200', y2: '200' });
    const area = svgEl('path', { class: 'hl-area', d: '', fill: `url(#${gid})` });
    const linha = svgEl('path', { class: 'hl-linha', d: '' });
    svg.append(defs, dias, urnasL, refL, area, linha);

    const pt = el('i', 'hl-pt');
    pt.setAttribute('aria-hidden', 'true');
    const cruz = el('i', 'hl-cruz');
    cruz.hidden = true;
    const cruzPt = el('i', 'hl-cruz-pt');
    cruzPt.hidden = true;
    const dica = el('div', 'hl-dica');
    dica.hidden = true;
    const urnasT = el('span', 'hl-urnas-t', 'urnas fecham');
    urnasT.hidden = true;
    plot.append(svg, urnasT, pt, cruz, cruzPt, dica);

    const tagRef = el('span', 'hl-ref-tag');
    tagRef.hidden = true;
    const eixo = el('div', 'hl-eixo');
    graf.append(plot, tagRef, eixo);

    card.append(info, graf);

    a.refs = {
      card, tag, valor, unPre, unPos, vRef, v24, hora, vol, graf, plot, linha, area, refL, urnasL, urnasT, dias, pt, cruz, cruzPt, dica, tagRef, eixo,
      stops: lg, eixoSig: '', diasSig: '',
    };

    plot.addEventListener('pointermove', (e) => mostrarDica(a, e));
    plot.addEventListener('pointerdown', (e) => mostrarDica(a, e));
    plot.addEventListener('pointerleave', () => esconderDica(a));
    plot.addEventListener('pointercancel', () => esconderDica(a));
    plot.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') setTimeout(() => esconderDica(a), 900);
    });
    return card;
  }

  function variacao(rotulo) {
    const caixa = el('div', 'hl-var');
    const r = el('span', 'hl-var-rot', rotulo);
    const n = el('b', 'hl-var-n', '—');
    caixa.append(r, n);
    return { caixa, n };
  }

  /* ---------- dados ---------- */

  function porCoin(coin) {
    return S.ativos.find((a) => a.cfg.coin === coin);
  }

  function velaDe(v) {
    const t = aNum(v.t), o = aNum(v.o), h = aNum(v.h), l = aNum(v.l), c = aNum(v.c);
    if (t == null || o == null || h == null || l == null || c == null) return null;
    return { t, o, h, l, c };
  }

  /** Fechamento da vela que termina às 20h00 UTC de sexta (ou a última que termina antes, até 6 h de folga). */
  function refDasVelas(velas) {
    let melhor = null;
    for (const v of velas) {
      if (v.t + INTERVALO_MS <= FECHAMENTO_MS && (!melhor || v.t > melhor.t)) melhor = v;
    }
    if (!melhor) return null;
    return FECHAMENTO_MS - (melhor.t + INTERVALO_MS) <= 6 * 3600 * 1000 ? melhor.c : null;
  }

  function aplicarPreco(a, preco, ts) {
    if (!ehNum(preco) || preco <= 0) return;
    a.mid = preco;
    a.ts = ts;
    const v = a.velas;
    if (v.length) {
      const u = v[v.length - 1];
      const atual = Math.floor(ts / INTERVALO_MS) * INTERVALO_MS;
      if (atual > u.t) {
        v.push({ t: atual, o: u.c, h: Math.max(u.c, preco), l: Math.min(u.c, preco), c: preco });
      } else if (atual === u.t) {
        u.c = preco;
        u.h = Math.max(u.h, preco);
        u.l = Math.min(u.l, preco);
      }
    }
    a.sujo = true;
  }

  function aplicarCtx(a, ctx, ts) {
    if (!ctx) return;
    const mid = aNum(ctx.midPx) || aNum(ctx.markPx);
    const prev = aNum(ctx.prevDayPx);
    if (prev && prev > 0) a.prev = prev;
    const vol = aNum(ctx.dayNtlVlm);
    if (vol != null) a.vol = vol;
    const oi = aNum(ctx.openInterest), mk = aNum(ctx.markPx);
    if (oi != null && mk) a.oi = oi * mk;
    a.origem = 'vivo';
    aplicarPreco(a, mid, ts);
  }

  function aplicarVelaViva(a, d) {
    const v = velaDe(d);
    if (!v) return;
    const arr = a.velas;
    if (!arr.length) {
      arr.push(v);
    } else {
      const u = arr[arr.length - 1];
      if (v.t > u.t) arr.push(v);
      else if (v.t === u.t) arr[arr.length - 1] = v;
      else {
        const i = arr.findIndex((x) => x.t === v.t);
        if (i >= 0) arr[i] = v;
      }
    }
    a.sujo = true;
  }

  async function carregarRest() {
    const agora = Date.now();
    const ini = Math.max(agora - JANELA_MAX_MS, ABERTURA_MS);
    const [meta, ...cand] = await Promise.all([
      pedir({ type: 'metaAndAssetCtxs', dex: DEX }),
      ...S.ativos.map((a) => pedir({ type: 'candleSnapshot', req: { coin: a.cfg.coin, interval: INTERVALO, startTime: ini, endTime: agora } }).catch(() => null)),
    ]);
    const universo = (meta && meta[0] && meta[0].universe) || [];
    const ctxs = (meta && meta[1]) || [];
    const mapa = new Map();
    universo.forEach((u, i) => mapa.set(u.name, ctxs[i]));
    let algum = false;
    S.ativos.forEach((a, i) => {
      const lista = Array.isArray(cand[i]) ? cand[i].map(velaDe).filter(Boolean).sort((x, y) => x.t - y.t) : null;
      if (lista && lista.length) {
        a.velas = lista;
        const r = refDasVelas(lista);
        if (r) a.ref = r;
      }
      const ctx = mapa.get(a.cfg.coin);
      if (ctx) {
        aplicarCtx(a, ctx, agora);
        algum = true;
      }
    });
    if (!algum) throw new Error('sem mercados na resposta');
    S.restOkEm = agora;
    S.proxPoll = agora + POLL_MS;
    S.candlesEm = agora;
    S.temVivo = true;
    S.tentativas = 0;
  }

  async function carregarCtx() {
    const agora = Date.now();
    const meta = await pedir({ type: 'metaAndAssetCtxs', dex: DEX });
    const universo = (meta && meta[0] && meta[0].universe) || [];
    const ctxs = (meta && meta[1]) || [];
    const mapa = new Map();
    universo.forEach((u, i) => mapa.set(u.name, ctxs[i]));
    let algum = false;
    for (const a of S.ativos) {
      const ctx = mapa.get(a.cfg.coin);
      if (ctx) {
        aplicarCtx(a, ctx, agora);
        algum = true;
      }
    }
    if (!algum) throw new Error('sem mercados na resposta');
    S.restOkEm = agora;
    S.proxPoll = agora + POLL_MS;
    S.temVivo = true;
    S.tentativas = 0;
  }

  async function carregarFoto() {
    const r = await fetch(SNAPSHOT_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const lista = Array.isArray(j && j.ativos) ? j.ativos : [];
    const quando = Date.parse(j && j.gerado_em);
    let algum = false;
    for (const a of S.ativos) {
      if (a.origem === 'vivo') continue; // dado vivo vale mais que foto
      const s = lista.find((x) => x && x.coin === a.cfg.coin);
      if (!s) continue;
      const preco = aNum(s.preco);
      if (!preco || preco <= 0) continue;
      const velas = Array.isArray(s.velas)
        ? s.velas.map((v) => (Array.isArray(v) ? velaDe({ t: v[0], o: v[1], h: v[2], l: v[3], c: v[4] }) : null)).filter(Boolean)
        : [];
      a.velas = velas;
      a.prev = aNum(s.prev_dia) || a.prev;
      a.ref = aNum(s.ref_fechamento) || refDasVelas(velas) || a.ref;
      a.vol = aNum(s.volume_24h_usd);
      a.oi = aNum(s.open_interest_usd);
      a.mid = preco;
      a.ts = ehNum(quando) ? quando : Date.parse(s.atualizado_em) || Date.now();
      a.origem = 'foto';
      a.sujo = true;
      algum = true;
    }
    if (!algum) throw new Error('snapshot sem os ativos');
    S.fotoOk = true;
    S.fotoMs = ehNum(quando) ? quando : Date.now();
    S.fotoEm = Date.now();
  }

  async function carregarTudo() {
    if (S.ocupado || S.pausado || S.destruido) return;
    S.ocupado = true;
    try {
      await carregarRest();
      conectarWs();
    } catch {
      S.tentativas++;
      if (!S.temVivo && (!S.fotoOk || Date.now() - S.fotoEm > SNAPSHOT_REFRESCO_MS)) {
        try {
          await carregarFoto();
        } catch {
          /* sem snapshot: fica "sem conexão" */
        }
      }
      agendarRest();
    } finally {
      S.ocupado = false;
      atualizarTudo();
    }
  }

  function agendarRest() {
    clearTimeout(S.restTimer);
    if (S.pausado || S.destruido) return;
    const espera = Math.min(60000, 5000 * 2 ** Math.max(0, Math.min(S.tentativas, 4) - 1));
    S.restTimer = setTimeout(carregarTudo, espera);
  }

  /* ---------- WebSocket ---------- */

  const wsVivo = () => !!(S.ws && S.ws.readyState === 1 && Date.now() - S.ultimoWs < WS_SEM_DADO_MS);

  function conectarWs() {
    if (S.pausado || S.destruido || S.ws) return;
    let ws;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      S.ws = null;
      agendarWs();
      return;
    }
    S.ws = ws;
    ws.onopen = () => {
      if (S.ws !== ws) return;
      try {
        for (const a of S.ativos) {
          ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'activeAssetCtx', coin: a.cfg.coin } }));
          ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'candle', coin: a.cfg.coin, interval: INTERVALO } }));
        }
        clearInterval(S.wsPing);
        S.wsPing = setInterval(() => {
          try {
            if (ws.readyState === 1) ws.send(JSON.stringify({ method: 'ping' }));
          } catch {
            /* a reconexão cuida */
          }
        }, 25000);
      } catch {
        /* onclose cuida */
      }
    };
    ws.onmessage = (ev) => {
      if (S.ws !== ws) return;
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!m || !m.channel) return;
      const agora = Date.now();
      if (m.channel === 'activeAssetCtx' && m.data) {
        const a = porCoin(m.data.coin);
        if (a) {
          S.ultimoWs = agora;
          S.wsTent = 0;
          aplicarCtx(a, m.data.ctx, agora);
          agendarDesenho();
        }
      } else if (m.channel === 'candle' && m.data) {
        const lista = Array.isArray(m.data) ? m.data : [m.data];
        for (const d of lista) {
          if (d && d.i === INTERVALO) {
            const a = porCoin(d.s);
            if (a) {
              S.ultimoWs = agora;
              aplicarVelaViva(a, d);
            }
          }
        }
        agendarDesenho();
      }
    };
    const cair = () => {
      if (S.ws !== ws) return;
      fecharWs();
      agendarWs();
      atualizarTudo();
    };
    ws.onerror = cair;
    ws.onclose = cair;
  }

  function fecharWs() {
    clearInterval(S.wsPing);
    S.wsPing = null;
    const ws = S.ws;
    S.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* nada */
      }
    }
  }

  function agendarWs() {
    clearTimeout(S.wsTimer);
    if (S.pausado || S.destruido) return;
    S.wsTent++;
    const espera = Math.min(60000, 2000 * 2 ** Math.min(S.wsTent - 1, 5));
    S.wsTimer = setTimeout(conectarWs, espera);
  }

  /* ---------- relógio de 1 s ---------- */

  function tick() {
    if (S.destruido) return;
    if (!S.raiz.isConnected) return;
    if (!S.raiz.contains(S.bloco)) montarDom(); // alguém limpou o contêiner: refaz
    const agora = Date.now();
    // Sem sinal do WebSocket: REST a cada 20 s (ou o reconectar cuida do resto).
    if (!wsVivo() && !S.ocupado && S.restOkEm && agora >= S.proxPoll) {
      S.ocupado = true;
      const refazVelas = agora - S.candlesEm >= CANDLES_REFRESCO_MS;
      (refazVelas ? carregarRest() : carregarCtx())
        .then(() => {
          S.proxPoll = Date.now() + POLL_MS;
        })
        .catch(() => {
          S.tentativas++;
          S.proxPoll = Date.now() + Math.min(60000, POLL_MS * 2 ** Math.min(S.tentativas, 2)); // 40 s, 60 s: sem martelar a rede
        })
        .finally(() => {
          S.ocupado = false;
          atualizarTudo();
        });
    }
    atualizarTudo();
  }

  function calcularModo() {
    const agora = Date.now();
    if (wsVivo()) return 'vivo';
    if (S.restOkEm && agora - S.restOkEm < POLL_MS * 2.6) return 'rest';
    if (S.temVivo) return 'off';
    if (S.fotoOk) return 'foto';
    return S.tentativas > 0 ? 'off' : 'conectando';
  }

  /* ---------- desenho ---------- */

  function agendarDesenho() {
    if (S.raf || S.pausado) return;
    S.raf = requestAnimationFrame(() => {
      S.raf = 0;
      desenharTodos(false);
    });
  }

  function atualizarTudo() {
    if (S.destruido) return;
    S.modo = calcularModo();
    atualizarTopo();
    desenharTodos(true);
  }

  function atualizarTopo() {
    const m = S.modo;
    const txt =
      m === 'vivo' ? 'Hyperliquid · ao vivo'
      : m === 'rest' ? 'Hyperliquid · a cada 20 s'
      : m === 'foto' ? `Hyperliquid · foto de ${diaMes(S.fotoMs)} às ${horaMin(S.fotoMs)}`
      : m === 'off' ? 'Hyperliquid · sem conexão'
      : 'Hyperliquid · conectando';
    if (S.topo.rotulo.textContent !== txt) S.topo.rotulo.textContent = txt;
    const cls = 'hl-ponto hl-p-' + m;
    if (S.topo.ponto.className !== cls) S.topo.ponto.className = cls;
    S.bloco.dataset.modo = m;
  }

  function desenharTodos(forcar) {
    for (const a of S.ativos) desenharCartao(a, forcar);
  }

  function mostrarPreco(a, novo) {
    const r = a.refs;
    const txt = fmt(novo, a.cfg.dec);
    if (txt === r.valor.textContent && a.exib != null) {
      a.exib = novo;
      return;
    }
    const antes = a.exib;
    cancelAnimationFrame(a.anim);
    a.anim = 0;
    if (antes == null || reduzMovimento() || Math.abs(novo - antes) / (Math.abs(antes) || 1) > 0.05) {
      r.valor.textContent = txt;
      a.exib = novo;
    } else {
      const t0 = performance.now();
      const dur = 420;
      const passo = (agora) => {
        const k = Math.min(1, (agora - t0) / dur);
        const e = 1 - (1 - k) ** 3;
        const v = antes + (novo - antes) * e;
        r.valor.textContent = k >= 1 ? txt : fmt(v, a.cfg.dec);
        a.exib = k >= 1 ? novo : v;
        if (k < 1) a.anim = requestAnimationFrame(passo);
        else a.anim = 0;
      };
      a.anim = requestAnimationFrame(passo);
    }
    if (antes != null && novo !== antes && !reduzMovimento()) {
      const cls = novo > antes ? 'hl-f-alta' : 'hl-f-queda';
      r.valor.classList.remove('hl-f-alta', 'hl-f-queda');
      void r.valor.offsetWidth;
      r.valor.classList.add(cls);
    }
  }

  function variacao24(a) {
    if (ehNum(a.prev) && ehNum(a.mid)) return (a.mid / a.prev - 1) * 100;
    // sem prevDayPx: a vela que fechou há 24 h
    const alvo = (a.ts || Date.now()) - 24 * 3600 * 1000;
    let v = null;
    for (const x of a.velas) if (x.t + INTERVALO_MS <= alvo) v = x;
    return v && ehNum(a.mid) ? (a.mid / v.c - 1) * 100 : null;
  }

  function pintarVar(caixa, v) {
    const cls = 'hl-var-n ' + (v == null ? 'zero' : prefixo(Number(v.toFixed(2)) === 0 ? 0 : v));
    const txt = v == null ? '—' : fmtPct(v);
    if (caixa.n.textContent !== txt) caixa.n.textContent = txt;
    if (caixa.n.className !== cls) caixa.n.className = cls;
  }

  function desenharCartao(a, forcarGrafico) {
    const r = a.refs;
    if (!r) return;
    const tem = ehNum(a.mid);
    const modo = S.modo;

    if (tem) mostrarPreco(a, a.mid);
    else if (r.valor.textContent !== '—') {
      r.valor.textContent = '—';
      a.exib = null;
    }

    const vRef = tem && ehNum(a.ref) ? (a.mid / a.ref - 1) * 100 : null;
    const v24 = tem ? variacao24(a) : null;
    pintarVar(r.vRef, vRef);
    pintarVar(r.v24, v24);

    const dir = vRef != null ? vRef : v24;
    const cor = dir == null || Number(dir.toFixed(2)) === 0 ? 'zero' : dir > 0 ? 'alta' : 'queda';
    const classeCartao = 'hl-card' + (a.cfg.destaque ? ' hl-card-destaque' : '') + ' hl-c-' + cor + (tem ? '' : ' hl-vazio');
    if (r.card.className !== classeCartao) r.card.className = classeCartao;

    // rótulo discreto só quando o cartão não está ao vivo
    const degradado = modo === 'foto' || modo === 'off' || modo === 'conectando';
    const tagTxt = !degradado ? '' : modo === 'foto' ? 'foto' : modo === 'off' ? 'sem conexão' : '';
    r.tag.hidden = !tagTxt;
    if (tagTxt && r.tag.textContent !== tagTxt) r.tag.textContent = tagTxt;

    let hora;
    if (!tem) hora = modo === 'conectando' ? 'Conectando…' : 'Sem conexão com a Hyperliquid';
    else if (a.origem === 'foto') hora = `Foto de ${diaMes(a.ts)} às ${horaMin(a.ts)}`;
    else if (modo === 'off') hora = `Última leitura às ${horaSeg(a.ts)}`;
    else hora = `Atualizado às ${horaSeg(a.ts)}`;
    if (r.hora.textContent !== hora) r.hora.textContent = hora;
    const vol = ehNum(a.vol) && a.vol > 0 ? `Volume 24 h US$ ${abreviar(a.vol)}` : '';
    if (r.vol.textContent !== vol) r.vol.textContent = vol;

    const agora = performance.now();
    if (a.sujo || forcarGrafico) {
      if (forcarGrafico || agora - a.grafEm > 450 || !a.lay) {
        desenharGrafico(a, cor);
        a.grafEm = agora;
        a.sujo = false;
      } else {
        a.sujo = true;
      }
    }
  }

  /* ---------- gráfico ---------- */

  function serie(a) {
    const v = a.velas;
    if (!v.length || !ehNum(a.mid)) return [];
    const fim = Math.max(a.ts || Date.now(), v[v.length - 1].t + 1);
    const pts = [[v[0].t, v[0].o]];
    v.forEach((x, i) => {
      if (i === v.length - 1) pts.push([fim, a.mid]);
      else pts.push([x.t + INTERVALO_MS, x.c]);
    });
    return pts;
  }

  function desenharGrafico(a, cor) {
    const r = a.refs;
    const pts = serie(a);
    if (pts.length < 2) {
      r.linha.setAttribute('d', '');
      r.area.setAttribute('d', '');
      r.pt.hidden = true;
      r.refL.style.display = 'none';
      r.tagRef.hidden = true;
      r.urnasL.style.display = 'none';
      r.urnasT.hidden = true;
      r.dias.replaceChildren();
      r.eixo.replaceChildren();
      r.eixoSig = r.diasSig = '';
      a.lay = null;
      return;
    }
    const W = 1000, H = 400;
    const tmin = pts[0][0];
    const tmax = pts[pts.length - 1][0];
    let ymin = Infinity, ymax = -Infinity;
    for (const p of pts) {
      if (p[1] < ymin) ymin = p[1];
      if (p[1] > ymax) ymax = p[1];
    }
    if (ehNum(a.ref)) {
      ymin = Math.min(ymin, a.ref);
      ymax = Math.max(ymax, a.ref);
    }
    if (ymax - ymin < ymax * 0.0005) {
      const m = ymax * 0.0015;
      ymin -= m;
      ymax += m;
    }
    const span = tmax - tmin || 1;
    const fy = (p) => 0.08 + 0.84 * (1 - (p - ymin) / (ymax - ymin));
    const lay = { pts: [], tmin, tmax, fy };
    let d = '';
    pts.forEach((p, i) => {
      const fx = (p[0] - tmin) / span;
      const y = fy(p[1]);
      lay.pts.push({ t: p[0], p: p[1], fx, fy: y });
      d += (i ? 'L' : 'M') + (fx * W).toFixed(1) + ' ' + (y * H).toFixed(1);
    });
    a.lay = lay;
    r.linha.setAttribute('d', d);
    r.area.setAttribute('d', d + `L${W} ${H}L0 ${H}Z`);

    // linha de referência: fechamento de sexta
    if (ehNum(a.ref)) {
      const y = fy(a.ref);
      r.refL.style.display = '';
      r.refL.setAttribute('y1', (y * H).toFixed(1));
      r.refL.setAttribute('y2', (y * H).toFixed(1));
      r.tagRef.hidden = false;
      r.tagRef.textContent = fmt(a.ref, a.cfg.dec);
      r.tagRef.style.top = `calc(6px + (100% - 26px) * ${y.toFixed(4)})`;
      r.tagRef.title = 'Fechamento de sexta 23/10 em Nova York';
    } else {
      r.refL.style.display = 'none';
      r.tagRef.hidden = true;
    }

    // último ponto (pulsa)
    const u = lay.pts[lay.pts.length - 1];
    r.pt.hidden = false;
    r.pt.style.left = (u.fx * 100).toFixed(3) + '%';
    r.pt.style.top = (u.fy * 100).toFixed(3) + '%';

    // fechamento das urnas
    if (URNAS_MS > tmin && URNAS_MS < tmax) {
      const fx = (URNAS_MS - tmin) / span;
      r.urnasL.style.display = '';
      r.urnasL.setAttribute('x1', (fx * W).toFixed(1));
      r.urnasL.setAttribute('x2', (fx * W).toFixed(1));
      r.urnasT.hidden = false;
      r.urnasT.style.left = (fx * 100).toFixed(2) + '%';
      r.urnasT.classList.toggle('hl-esq', fx > 0.82);
    } else {
      r.urnasL.style.display = 'none';
      r.urnasT.hidden = true;
    }

    // viradas de dia (meia-noite de Brasília) e rótulos do eixo
    const dia = 86400000;
    const ticks = [];
    for (let t = Math.ceil((tmin - BRT_MS) / dia) * dia + BRT_MS; t < tmax; t += dia) ticks.push(t); // meia-noite de Brasília = 03h00 UTC
    const sigDias = ticks.map((t) => ((t - tmin) / span).toFixed(3)).join(',');
    if (sigDias !== r.diasSig) {
      r.diasSig = sigDias;
      r.dias.replaceChildren(
        ...ticks.map((t) => {
          const x = (((t - tmin) / span) * W).toFixed(1);
          return svgEl('line', { class: 'hl-dia-l', x1: x, x2: x, y1: '0', y2: String(H) });
        }),
      );
    }
    const marcas = [{ t: tmin, fx: 0 }, ...ticks.map((t) => ({ t, fx: (t - tmin) / span }))].filter((m, i, arr) => i === 0 || m.fx > 0.06 || arr.length === 1);
    const sigEixo = marcas.map((m) => m.t + ':' + m.fx.toFixed(3)).join(',');
    if (sigEixo !== r.eixoSig) {
      r.eixoSig = sigEixo;
      r.eixo.replaceChildren(
        ...marcas.map((m) => {
          const s = el('span', 'hl-eixo-t', `${diaSemana(m.t)} ${diaMes(m.t)}`);
          s.style.left = (m.fx * 100).toFixed(2) + '%';
          if (m.fx > 0.86) s.classList.add('hl-esq');
          return s;
        }),
      );
    }
  }

  /* ---------- dica ao passar o dedo/mouse ---------- */

  function mostrarDica(a, e) {
    const r = a.refs;
    const lay = a.lay;
    if (!lay || !lay.pts.length) return;
    const box = r.plot.getBoundingClientRect();
    if (!box.width) return;
    const f = limitar((e.clientX - box.left) / box.width, 0, 1);
    const t = lay.tmin + f * (lay.tmax - lay.tmin);
    // ponto mais próximo no tempo (busca binária)
    let lo = 0, hi = lay.pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lay.pts[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const p = Math.abs(lay.pts[lo].t - t) <= Math.abs(lay.pts[hi].t - t) ? lay.pts[lo] : lay.pts[hi];
    r.cruz.hidden = false;
    r.cruzPt.hidden = false;
    r.dica.hidden = false;
    r.cruz.style.left = (p.fx * 100).toFixed(3) + '%';
    r.cruzPt.style.left = (p.fx * 100).toFixed(3) + '%';
    r.cruzPt.style.top = (p.fy * 100).toFixed(3) + '%';
    const un = a.cfg.un === 'US$' ? 'US$ ' : '';
    const pos = a.cfg.un === 'US$' ? '' : ' ' + a.cfg.un;
    const vs = ehNum(a.ref) ? ` · ${fmtPct((p.p / a.ref - 1) * 100)} vs. sex.` : '';
    r.dica.textContent = `${un}${fmt(p.p, a.cfg.dec)}${pos}${vs} · ${diaSemana(p.t)} ${horaMin(p.t)}`;
    r.dica.classList.toggle('hl-dir', p.fx < 0.5); // a dica fica no canto oposto ao dedo
  }

  function esconderDica(a) {
    const r = a.refs;
    if (!r) return;
    r.cruz.hidden = true;
    r.cruzPt.hidden = true;
    r.dica.hidden = true;
  }

  /* ---------- ciclo de vida ---------- */

  function aoMudarVisibilidade() {
    if (document.hidden) pausar();
    else retomar();
  }

  function aoVoltarRede() {
    if (!S.pausado) carregarTudo();
  }

  function pausar() {
    if (S.pausado || S.destruido) return;
    S.pausado = true;
    clearInterval(S.tickTimer);
    clearTimeout(S.restTimer);
    clearTimeout(S.wsTimer);
    cancelAnimationFrame(S.raf);
    S.raf = 0;
    fecharWs();
  }

  function retomar() {
    if (S.destruido) return;
    if (document.hidden) return;
    if (!S.pausado && S.tickTimer) return;
    S.pausado = false;
    clearInterval(S.tickTimer);
    S.tickTimer = setInterval(tick, 1000);
    S.wsTent = 0;
    S.ocupado = false;
    carregarTudo();
    atualizarTudo();
  }

  function destruir() {
    if (S.destruido) return;
    pausar();
    S.destruido = true;
    document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    window.removeEventListener('online', aoVoltarRede);
    for (const a of S.ativos) cancelAnimationFrame(a.anim);
    try {
      S.raiz.replaceChildren();
    } catch {
      /* nada */
    }
    controle.destruido = true;
    if (S.raiz.__hlControle === controle) delete S.raiz.__hlControle;
  }

  const controle = {
    destruido: false,
    retomar,
    pausar,
    destruir,
    get modo() {
      return S.modo;
    },
  };

  montarDom();
  document.addEventListener('visibilitychange', aoMudarVisibilidade);
  window.addEventListener('online', aoVoltarRede);
  if (!document.hidden) {
    S.tickTimer = setInterval(tick, 1000);
    carregarTudo();
  } else {
    S.pausado = true;
  }
  return controle;
}
