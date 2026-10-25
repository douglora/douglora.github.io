/* Radar Eleitoral · 2º turno · versão de bolso
 *
 * Módulo ES, JavaScript puro, sem framework nem biblioteca externa.
 *
 * - Dados: /data/pocket/segundo_turno.json (para teste: ?dados=/outro.json, só
 *   caminho do mesmo site), relidos a cada 60 s. Campo ausente ou null vira
 *   lacuna visível ("sem dado ainda"), nunca tela quebrada. Pesquisa que não estava
 *   na leitura anterior aparece num aviso "Acabou de entrar" e fica destacada na
 *   aba Pesquisas por alguns minutos; as médias contam do valor antigo ao novo.
 * - Mercados: import dinâmico de /2turno/mercados.js (lerMercados e
 *   lerHistorico, aoMudar), relidos a cada 60 s e na hora em que chega preço novo
 *   (WebSocket ou balde de 15 s do Mac). Se o módulo não carregar, a página
 *   mostra "mercados indisponíveis" e tenta de novo a cada 5 min.
 *   Para teste: ?mercados=/outro-modulo.js (só caminho do mesmo site).
 * - Abas com hash para link direto: #resumo, #pesquisas, #mercados, #metodo.
 * - Gráficos em SVG feito à mão, desenhados na largura real da tela, com o
 *   número escrito nos pontos e uma tabela gêmea para cada um.
 */

const CFG = {
  dados: '/data/pocket/segundo_turno.json',
  mercados: '/2turno/mercados.js',
  cadaMercado: 60 * 1000,
  // Pesquisa nova chega ao site em ~2 min (vigia rápida + publicação); a página confere a cada
  // minuto. Depois de falha, tenta de novo em segundos (TENTATIVAS_MS), não em minutos.
  cadaDado: 60 * 1000,
  cadaModulo: 5 * 60 * 1000,
  cadaHistorico: 5 * 60 * 1000,
  tz: 'America/Sao_Paulo',
  abertura: '2026-10-25T08:00:00-03:00',
  fechamento: '2026-10-25T17:00:00-03:00',
  dataEleicao: '2026-10-25',
  horasVelho: 12,
  versaoCompleta: '/cenario-corrigido',
};

const DIA = 864e5;
const HORA = 36e5;
const ABAS = ['resumo', 'apuracao', 'pesquisas', 'mercados', 'metodo'];
const NOME_ABA = { resumo: 'Resumo', apuracao: 'Apuração', pesquisas: 'Pesquisas', mercados: 'Mercados', metodo: 'Método' };
const URL_APURACAO = '/2turno/apuracao.js';
const URL_SIMULADOR = '/2turno/simulador.js';
const URL_HYPERLIQUID = '/2turno/hyperliquid.js';
const COR_T1 = '#7d8492';
const COR_T2 = '#e3e6ec';
const COR_OUTROS = '#6b7280';

const PADRAO_CAND = {
  lula: {
    id: 'lula',
    nome: 'Lula',
    nome_completo: 'Luiz Inácio Lula da Silva',
    partido: 'PT',
    numero: 13,
    cor: '#EF4A5E',
    foto: '/candidates/2026/2026-tse-280002542548.webp',
    foto_credito: 'Ricardo Stuckert/Palácio do Planalto (CC BY 2.0)',
  },
  flavio: {
    id: 'flavio',
    nome: 'Flávio Bolsonaro',
    nome_completo: 'Flávio Nantes Bolsonaro',
    partido: 'PL',
    numero: 22,
    cor: '#5B8CF0',
    foto: '/candidates/2026/2026-tse-280002551544.webp',
    foto_credito: 'TSE (CC BY 4.0)',
  },
};

const PARTIDOS = {
  PT: 'Partido dos Trabalhadores',
  PL: 'Partido Liberal',
  PSD: 'Partido Social Democrático',
  MDB: 'Movimento Democrático Brasileiro',
  PSDB: 'Partido da Social Democracia Brasileira',
  PSOL: 'Partido Socialismo e Liberdade',
  PDT: 'Partido Democrático Trabalhista',
  PSB: 'Partido Socialista Brasileiro',
  PP: 'Progressistas',
  PCO: 'Partido da Causa Operária',
  PSTU: 'Partido Socialista dos Trabalhadores Unificado',
  PCB: 'Partido Comunista Brasileiro',
  UP: 'Unidade Popular',
  DC: 'Democracia Cristã',
  PRTB: 'Partido Renovador Trabalhista Brasileiro',
  PMB: 'Partido da Mulher Brasileira',
  PV: 'Partido Verde',
  PRD: 'Partido Renovação Democrática',
  PCDOB: 'Partido Comunista do Brasil',
  NOVO: 'Partido Novo',
  REDE: 'Rede Sustentabilidade',
  UNIAO: 'União Brasil',
  PODE: 'Podemos',
  MISSAO: 'Partido Missão',
};

const GLOSSARIO_PADRAO = [
  ['Votos válidos', 'São os votos dados a um dos candidatos; brancos e nulos ficam de fora. É a conta que o TSE (Tribunal Superior Eleitoral) usa para declarar o vencedor: no 2º turno, vence quem tiver mais da metade dos válidos.'],
  ['Votos totais', 'A pesquisa como a casa divulgou: inclui quem pretende votar em branco, anular ou ainda não decidiu. Por isso os dois candidatos somam menos de 100%. Para comparar com a urna, a conta é refeita só com os válidos.'],
  ['Média ponderada', 'Média das pesquisas em que cada uma conta com um peso diferente. Aqui o peso vem do erro histórico da casa: quem errou menos no 1º turno pesa mais.'],
  ['Faixa', 'Intervalo provável em torno da média, calculado pelo modelo do Radar. Quanto mais larga, maior a incerteza. Na barra, é o retângulo em volta do ponto de divisão: a divisão entre os dois pode estar em qualquer lugar dentro dele.'],
  ['Chance de vitória', 'Em quantas de cada 100 eleições com este mesmo quadro cada candidato venceria, segundo o modelo. Não é porcentagem de votos: 70% de chance quer dizer que o outro vence em 3 de cada 10.'],
  ['Peso', 'Quanto uma pesquisa conta na média, numa escala de 0 a 1. Depende do erro histórico da casa no 1º turno: quem errou menos pesa mais.'],
  ['Erro médio', 'Distância média, em pontos percentuais, entre a última pesquisa da casa antes do 1º turno e o resultado oficial do TSE (Tribunal Superior Eleitoral). Quanto menor, melhor.'],
  ['Erro na margem', 'Quanto a casa errou a distância entre Lula e Flávio no 1º turno, em pontos percentuais. Exemplo: a casa previa 4 pontos de diferença e a urna deu 1 ponto: erro de 3 pontos.'],
  ['Pontos percentuais (pp)', 'Diferença entre duas porcentagens. De 48% para 51% são 3 pontos percentuais (e não 3%).'],
  ['Abstenção', 'Parte do eleitorado que não foi votar, em % do total de eleitores aptos.'],
  ['Comparecimento', 'Eleitores que foram votar: o eleitorado menos a abstenção.'],
  ['Eleitorado', 'Total de pessoas aptas a votar, segundo o TSE (Tribunal Superior Eleitoral).'],
  ['Brancos e nulos', 'Votos que não vão para nenhum candidato. Não entram na conta dos válidos e não favorecem ninguém.'],
  ['Projeção com abstenção', 'Transforma a média das pesquisas em votos de verdade. Começa pelos eleitores que podem votar, tira os que devem faltar (a abstenção) e os que devem votar em branco ou anular, e divide o resto entre os dois pela média das pesquisas. Faltar muita gente não muda quem ganha se faltar igual dos dois lados; só muda se um lado faltar mais que o outro.'],
  ['Margem', 'Diferença entre o primeiro e o segundo colocado, em votos ou em pontos percentuais.'],
  ['Registro no TSE', 'Toda pesquisa eleitoral divulgada precisa ser registrada antes no TSE (Tribunal Superior Eleitoral), com amostra, método, quem pagou e questionário. O número (como BR-09709/2026) permite conferir tudo no PesqEle, o sistema de pesquisas do próprio TSE.'],
  ['Amostra', 'Quantas pessoas a casa entrevistou.'],
  ['Campo', 'Os dias em que as entrevistas foram feitas.'],
  ['Contratante', 'Quem pagou pela pesquisa.'],
  ['Modo', 'Como as entrevistas foram feitas: presencial (cara a cara), por telefone ou pela internet.'],
  ['Janela', 'Período considerado na média: só entram pesquisas com campo dentro dos últimos dias informados.'],
  ['Casa', 'O instituto que faz a pesquisa, como Datafolha, Quaest ou AtlasIntel.'],
  ['Mercado de previsão', 'Bolsa no exterior onde se negociam contratos que pagam US$ 1 (um dólar) se o candidato vencer e zero se perder. O preço do contrato, de 0 a 100 centavos, é lido como a chance que o mercado dá ao candidato. Não é pesquisa de opinião.'],
  ['Ao vivo', 'Preço lido direto na bolsa há instantes, pela internet do seu aparelho.'],
  ['Quase ao vivo', 'No Brasil o provedor de internet bloqueia a Polymarket e a Kalshi (Resolução CMN 5.298/2026), então vários aparelhos não alcançam as bolsas. O computador do Radar lê as duas a cada 15 segundos e manda o preço para cá. A hora ao lado é a da leitura, com segundos: o preço tem essa idade.'],
  ['Snapshot', 'Foto do preço guardada na última coleta que deu certo, usada quando a leitura ao vivo falha. Sempre vem com a hora da coleta.'],
  ['Compra, venda e último', 'Compra: a melhor oferta de quem quer comprar o contrato. Venda: a melhor oferta de quem quer vender. Último: o preço do último negócio fechado. A chance mostrada é o meio entre compra e venda (ou o último preço, quando falta um dos lados; na Polymarket, também quando a distância entre compra e venda passa de 10 centavos, como no site dela).'],
  ['Volume', 'Quanto já foi negociado desde que o mercado abriu. Na Polymarket, em dólares; na Kalshi, em contratos de US$ 1 (um dólar), como a própria plataforma mostra.'],
  ['Liquidez', 'Dinheiro parado em ofertas de compra e venda, pronto para negociar. Mais liquidez quer dizer preço mais difícil de mexer com pouco dinheiro.'],
  ['Seções totalizadas', 'Parte das urnas já somada pelo TSE (Tribunal Superior Eleitoral). 100% quer dizer apuração completa.'],
  ['UF', 'Unidade da Federação: os 26 estados e o Distrito Federal.'],
  ['Quatro médias', 'Ponderada: a pesquisa mais recente de cada instituto, com peso maior para a mais nova e para a de amostra maior. Simples: todas com o mesmo peso. Ajustada pelo 1º turno: cada instituto corrigido pelo quanto errou no 1º turno. Só as que mais acertaram: só os institutos de menor erro no 1º turno. A nota embaixo dos números diz a conta exata da média escolhida.'],
  ['Apuração', 'Contagem oficial dos votos pelo TSE (Tribunal Superior Eleitoral), que começa às 17h de 25/10. A aba lê os números do TSE direto, sem intermediário, e calcula a projeção por conta própria. Resultado oficial é só o do TSE.'],
  ['Projeção final', 'Estimativa de como a contagem termina: o que já foi apurado mais os votos que faltam em cada estado, divididos segundo o que já apareceu no estado e a prévia. Pode apontar quem fica à frente antes de a contagem mostrar.'],
  ['Prévia por estado', 'O que se espera de cada estado antes de contar: participação de cada candidato, comparecimento e brancos e nulos. Vem do modelo da mesa, feito com o 1º turno de 2026, o padrão de cada estado entre os turnos de 2002 a 2022, a tendência das pesquisas e o tamanho das amostras.'],
  ['Swing observado', 'Quanto a apuração está, em média, mais favorável a um dos dois do que a prévia indicava, comparando estado com estado. Serve para corrigir a prévia dos estados que ainda não começaram a contar.'],
  ['Matematicamente definido', 'Quando a diferença na contagem já é maior do que todo o eleitorado que falta apurar: nem com todos os votos restantes o segundo colocado alcança o primeiro.'],
  ['Estado provável', 'Um estado aparece como “provável” quando o modelo dá 99% ou mais de chance a um dos lados e pelo menos 25% das seções do estado já foram apuradas. Não é resultado oficial: pode mudar até o estado terminar de contar.'],
  ['Estado definido', 'Um estado fica “definido” quando a vantagem de quem lidera lá é maior que todo o eleitorado que ainda falta apurar no estado: nem com todos os votos restantes o outro alcança. Vale também para estado com 100% das seções apuradas.'],
  ['Par', 'Só os votos dados aos dois finalistas, somados como 100%. É a base dos números “do par”: brancos, nulos e votos de quem ficou fora do 2º turno não entram.'],
  ['Agregador próprio', 'A média das pesquisas feita pelo próprio Radar. Junta as casas com pesquisa recente de 2º turno, dá mais peso a quem errou menos no 1º turno, à pesquisa mais nova e à que ouviu mais gente, e corrige parte do erro que as casas tiveram no 1º turno. Atualiza sozinha a cada pesquisa nova.'],
  ['Chance normalizada', 'Nos mercados de previsão cada candidato tem o seu próprio preço, e os dois preços quase nunca somam exatamente 100. Para comparar, a página mostra a chance de cada um dividida pela soma dos dois (Lula ÷ (Lula + Flávio)), arredondada para que as duas somem 100%. Os preços originais (compra, venda e último) continuam na tabela de detalhes.'],
];

const st = {
  dados: null,
  texto: null,
  erro: null,
  falhasSeguidas: 0,
  erroDesde: 0,
  timerTentativa: null,
  carregando: true,
  lidoEm: 0,
  okEm: 0, // última leitura que deu certo (lidoEm também conta as que falharam)
  novas: new Map(), // pesquisas que acabaram de entrar: chave → { ate, id }
  timerNovas: null,
  mod: undefined, // undefined = ainda não tentou; null = falhou; objeto = módulo
  modErro: null,
  modTentativas: 0,
  modProxima: 0,
  merc: null,
  mercErro: null,
  mercEm: 0,
  lendoMerc: false,
  hist: new Map(),
  dias: 30,
  modo: 'todas',
  aba: 'resumo',
  irPara: null,
  apur: null,
  mediaSel: 'radar',
  explicaAberta: false,
  animarExplica: false,
  subaba: 'media',
  tv: false,
  tvAbaAntes: null,
};

/* ----------------------------------------------------------- utilidades */

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const txt = (v) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const plural = (n, um, varios) => (Math.abs(n) === 1 ? um : varios);
const n2 = (v) => Math.round(v * 10) / 10;

// HTML com escape automático: h`...${valor}...` escapa tudo que não vier de h`` ou cru().
const CRU = Symbol('cru');
const cru = (s) => ({ [CRU]: String(s) });
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
function emHtml(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (Array.isArray(v)) return v.map(emHtml).join('');
  if (typeof v === 'object' && CRU in v) return v[CRU];
  return esc(v);
}
function h(partes, ...valores) {
  let s = partes[0];
  for (let i = 0; i < valores.length; i++) s += emHtml(valores[i]) + partes[i + 1];
  return cru(s);
}

/* ------------------------------------------------------------- números */

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
const _nf = new Map();
function nf(casas) {
  let f = _nf.get(casas);
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
    _nf.set(casas, f);
  }
  return f;
}
const fNum = (v, c = 1) => {
  v = num(v);
  return v === null ? null : nf(c).format(v);
};
const fPct = (v, c = 1) => {
  const s = fNum(v, c);
  return s === null ? null : `${s}%`;
};
const fInt = (v) => {
  v = num(v);
  return v === null ? null : nf(0).format(Math.round(v));
};
// Como a casa publicou: inteiro sem casa decimal, fração com uma. Numa mesma
// pesquisa, se algum número tem decimal, todos saem com uma casa (47,0 ao lado de 50,1).
const fPub = (v, casas = null) => {
  v = num(v);
  if (v === null) return null;
  return `${nf(casas ?? (Number.isInteger(v) ? 0 : 1)).format(v)}%`;
};
const casasPub = (...vals) => (vals.some((v) => num(v) !== null && !Number.isInteger(num(v))) ? 1 : 0);
function fProb(p) {
  p = num(p);
  if (p === null) return null;
  const v = p * 100;
  if (v > 0 && v < 1) return '<1%';
  if (v > 99 && v < 100) return '>99%';
  return `${nf(0).format(Math.round(v))}%`;
}
const fProb1 = (p) => {
  p = num(p);
  return p === null ? null : `${nf(1).format(p * 100)}%`;
};
const fMilhoes = (v, c = 1) => {
  v = num(v);
  return v === null ? null : nf(c).format(v / 1e6);
};
function fGrande(v) {
  v = num(v);
  if (v === null) return null;
  const a = Math.abs(v);
  if (a >= 1e9) {
    const r = Math.round((v / 1e9) * 10) / 10;
    return `${nf(1).format(r)} ${Math.abs(r) < 2 ? 'bilhão' : 'bilhões'}`;
  }
  if (a >= 1e6) {
    const r = Math.round((v / 1e6) * 10) / 10;
    return `${nf(1).format(r)} ${Math.abs(r) < 2 ? 'milhão' : 'milhões'}`;
  }
  if (a >= 1e3) return `${nf(0).format(v / 1e3)} mil`;
  return nf(0).format(v);
}
const fDolar = (v) => {
  const s = fGrande(v);
  return s === null ? null : `US$ ${s}`;
};
function fSinal(v) {
  v = num(v);
  if (v === null) return null;
  const s = nf(1).format(Math.abs(v));
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}
const fPP = (v) => {
  const s = fNum(v, 1);
  return s === null ? null : `${s} pp`;
};
// Com sinal e duas casas (+0,09), para efeitos pequenos que uma casa só esconderia.
function fSinal2(v) {
  v = num(v);
  if (v === null) return null;
  const s = nf(2).format(Math.abs(v));
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

// Duas chances que somam exatamente 100%. Cada mercado dá um preço próprio a cada candidato
// (compra e venda de um lado, de outro), e os dois quase nunca somam 100. Aqui cada um é dividido
// pela soma dos dois (Lula ÷ (Lula + Flávio)) e os inteiros mostrados saem pelo método do maior
// resto: o que sobra para chegar a 100 vai a quem tem a maior parte fracionária.
// Entrada: probabilidades de 0 a 1. Saída: { l, f } exatos em % e { li, fi } inteiros, ou null.
function parChances(pL, pF) {
  pL = num(pL);
  pF = num(pF);
  if (pL === null || pF === null || pL < 0 || pF < 0 || pL + pF <= 0) return null;
  const t = pL + pF;
  const l = (pL / t) * 100;
  const f = (pF / t) * 100;
  let li = Math.floor(l + 1e-9);
  let fi = Math.floor(f + 1e-9);
  let sobra = 100 - li - fi;
  const ordem = l - li >= f - fi ? ['l', 'f'] : ['f', 'l'];
  for (let i = 0; sobra > 0; i++, sobra--) {
    if (ordem[i % 2] === 'l') li += 1;
    else fi += 1;
  }
  return { l, f, li, fi };
}
const parDe = (o) => parChances(o?.lula, o?.flavio);
const fChance = (par, id) => (par ? `${id === 'lula' ? par.li : par.fi}%` : null);
const parMercado = (f) => parChances(f?.candidatos?.lula?.prob, f?.candidatos?.flavio?.prob);
// Número que conta do valor antigo ao novo quando a leitura traz média diferente (ver animarNumeros).
const cuNum = (chave, v, casas = 1, sufixo = '') =>
  v === null
    ? cru('—')
    : h`<span data-cu="${chave}" data-v="${v}" data-casas="${casas}"${cru(sufixo ? ` data-sufixo="${sufixo}"` : '')}>${nf(casas).format(v)}${sufixo}</span>`;
function faixa(v) {
  if (!Array.isArray(v) || v.length < 2) return null;
  const a = num(v[0]);
  const b = num(v[1]);
  return a === null || b === null ? null : [Math.min(a, b), Math.max(a, b)];
}
const pctCss = (v) => String(Math.max(0, Math.min(100, Math.round(v * 1000) / 1000)));

/* ---------------------------------------------------------------- datas */

const RE_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
function msDe(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  const m = RE_DIA.exec(v.trim());
  // Data sem hora fica no meio-dia de Brasília: não muda de dia em fuso nenhum.
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], 15, 0, 0);
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
const fmtD = new Intl.DateTimeFormat('pt-BR', { timeZone: CFG.tz, day: '2-digit', month: '2-digit' });
const fmtDA = new Intl.DateTimeFormat('pt-BR', { timeZone: CFG.tz, day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtH = new Intl.DateTimeFormat('pt-BR', { timeZone: CFG.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtS = new Intl.DateTimeFormat('pt-BR', { timeZone: CFG.tz, weekday: 'long' });
const fmtAno = new Intl.DateTimeFormat('pt-BR', { timeZone: CFG.tz, year: 'numeric' });
function partesHora(t) {
  const p = fmtH.formatToParts(t);
  return { h: p.find((x) => x.type === 'hour')?.value ?? '00', m: p.find((x) => x.type === 'minute')?.value ?? '00' };
}
const fData = (v) => {
  const t = msDe(v);
  return t === null ? null : fmtD.format(t);
};
// Com o ano só quando não for o ano corrente.
const fDataAno = (v) => {
  const t = msDe(v);
  if (t === null) return null;
  return fmtAno.format(t) === fmtAno.format(Date.now()) ? fmtD.format(t) : fmtDA.format(t);
};
const fHora = (v) => {
  const t = msDe(v);
  if (t === null) return null;
  const { h: hh, m } = partesHora(t);
  return `${hh}h${m}`;
};
// "10h18m15s": a hora do preço do canal vivo, com segundos, para a idade do dado aparecer na tela.
const fmtHS = new Intl.DateTimeFormat('pt-BR', { timeZone: CFG.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const fHoraSeg = (v) => {
  const t = msDe(v);
  if (t === null) return null;
  const p = fmtHS.formatToParts(t);
  const g = (tipo) => p.find((x) => x.type === tipo)?.value ?? '00';
  return `${g('hour')}h${g('minute')}m${g('second')}s`;
};
const fHoraCurta = (v) => {
  const t = msDe(v);
  if (t === null) return null;
  const { h: hh, m } = partesHora(t);
  return m === '00' ? `${+hh}h` : `${+hh}h${m}`;
};
const fDataHora = (v) => {
  const t = msDe(v);
  return t === null ? null : `${fmtD.format(t)} às ${fHora(t)}`;
};
const mesmoDia = (a, b) => fmtDA.format(a) === fmtDA.format(b);
// "21h42" se for hoje; "21/10 às 21h42" se não for.
const fQuando = (v) => {
  const t = msDe(v);
  if (t === null) return null;
  return mesmoDia(t, Date.now()) ? fHora(t) : fDataHora(t);
};
const fSemana = (v) => {
  const t = msDe(v);
  return t === null ? null : fmtS.format(t);
};
function fIdade(v) {
  const t = msDe(v);
  if (t === null) return null;
  const s = Math.max(0, Date.now() - t) / 1000;
  if (s < 90) return 'agora há pouco';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 2 * 86400) return `há ${Math.round(s / 3600)} horas`;
  return `há ${Math.floor(s / 86400)} dias`;
}

/* ---------------------------------------------------- lacunas e links */

const LAC = cru('<span class="lac">sem dado ainda</span>');
const ou = (v) => (v === null || v === undefined || v === '' ? LAC : v);
const lacunaBloco = (t) => h`<p class="lacuna-bloco">${t}</p>`;

function urlSegura(u) {
  if (typeof u !== 'string' || !u.trim()) return null;
  try {
    const x = new URL(u.trim(), location.href);
    if (x.protocol === 'https:' || x.protocol === 'http:') return x.href;
  } catch {
    /* endereço inválido vira lacuna */
  }
  return null;
}
function caminhoLocal(v) {
  if (typeof v !== 'string') return null;
  v = v.trim();
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  try {
    const x = new URL(v, location.origin);
    return x.origin === location.origin ? x.pathname + x.search : null;
  } catch {
    return null;
  }
}
const linkExt = (u, rot) => {
  const s = urlSegura(u);
  return s ? h`<a href="${s}" target="_blank" rel="noopener noreferrer">${rot}</a>` : null;
};
function listaNomes(lista) {
  const l = arr(lista).map(txt).filter(Boolean);
  if (l.length <= 1) return l[0] || null;
  return `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}`;
}
function expandirFonte(s) {
  const t = txt(s);
  if (!t || norm(t) === 'tse') return 'TSE (Tribunal Superior Eleitoral)';
  return t;
}

const PARAMS = new URLSearchParams(location.search);
const URL_DADOS = caminhoLocal(PARAMS.get('dados')) || CFG.dados;
const URL_MERCADOS = caminhoLocal(PARAMS.get('mercados')) || CFG.mercados;

function lerPref(k, padrao) {
  try {
    return localStorage.getItem(`radar2t.${k}`) ?? padrao;
  } catch {
    return padrao;
  }
}
function gravarPref(k, v) {
  try {
    localStorage.setItem(`radar2t.${k}`, v);
  } catch {
    /* modo privado: fica só na memória */
  }
}

/* ---------------------------------------------- candidatos e partidos */

function cand(id) {
  const base = PADRAO_CAND[id] || { id, nome: id, cor: COR_OUTROS };
  const dd = arr(st.dados?.candidatos).find((c) => obj(c) && c.id === id) || {};
  const out = { ...base };
  for (const [k, v] of Object.entries(dd)) if (v !== null && v !== undefined && v !== '') out[k] = v;
  // Modo escuro: as cores do JSON (vermelho e azul escuros, pensados para fundo branco) somem no
  // fundo escuro; Lula e Flávio usam a versão clara da mesma cor, que lê bem sobre o fundo.
  out.cor = PADRAO_CAND[id] ? base.cor : /^#[0-9a-fA-F]{3,8}$/.test(String(dd.cor || '')) ? dd.cor : base.cor;
  out.nome = txt(out.nome) || base.nome;
  return out;
}
const curto = (id) => {
  const n = cand(id).nome || id;
  return id === 'lula' ? n : n.split(/\s+/)[0];
};
const chavePartido = (s) => norm(s).toUpperCase().replace(/[^A-Z]/g, '');
function nomePartido(sigla) {
  const s = txt(sigla);
  if (!s) return null;
  return PARTIDOS[chavePartido(s)] || null;
}

function foto(c) {
  const src = urlSegura(c.foto) || urlSegura(PADRAO_CAND[c.id]?.foto);
  const ini = String(c.nome || '?')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  if (!src) return h`<span class="foto-wrap" style="--c:${c.cor}"><span class="foto foto-ini" aria-hidden="true">${ini}</span></span>`;
  return h`<span class="foto-wrap" style="--c:${c.cor}"><img class="foto" src="${src}" alt="Foto de ${c.nome}" width="64" height="64" decoding="async" data-ini="${ini}" /></span>`;
}

// Foto pequena e redonda com aro fino na cor do candidato. Sem foto (ou se ela não
// carregar), mostra as iniciais. Tamanho fixo em px, ou pela classe (--av) quando tam é null.
function avatar(id, tam = 24, classe = '') {
  const c = cand(id);
  const src = urlSegura(c.foto) || urlSegura(PADRAO_CAND[id]?.foto);
  const ini = String(c.nome || '?')
    .split(/\s+/)
    .map((x) => x[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const lado = tam || 48;
  const estilo = tam ? `--c:${c.cor};--av:${tam}px` : `--c:${c.cor}`;
  return h`<span class="av${classe ? ` ${classe}` : ''}" style="${estilo}">${
    src
      ? h`<img class="foto" src="${src}" alt="" width="${lado}" height="${lado}" decoding="async" data-ini="${ini}" />`
      : h`<span class="foto foto-ini" aria-hidden="true">${ini}</span>`
  }</span>`;
}
const reduzMovimento = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/* --------------------------------------------------------- glossário */

function glossario() {
  const mapa = new Map();
  for (const [termo, texto] of GLOSSARIO_PADRAO) mapa.set(norm(termo), { termo, texto });
  for (const g of arr(st.dados?.glossario)) {
    const t = txt(g?.termo);
    const x = txt(g?.texto);
    if (t && x) mapa.set(norm(t), { termo: t, texto: x });
  }
  return mapa;
}
function explicar(termo) {
  return glossario().get(norm(termo)) || { termo, texto: 'Sem explicação cadastrada ainda.' };
}
const info = (termo) =>
  h`<button type="button" class="i" data-termo="${termo}" aria-label="O que é ${termo}?"><span aria-hidden="true">i</span></button>`;

/* ------------------------------------------------ médias (dois formatos) */

const MEDIAS_PADRAO = ['radar', 'ponderada', 'simples', 'ajustada_1t', 'acerto_1t'];
const ROTULO_CURTO = {
  radar: 'Agregador próprio',
  ponderada: 'Ponderada',
  simples: 'Simples',
  ajustada_1t: 'Ajustada pelo 1º turno',
  acerto_1t: 'Só as que mais acertaram',
};

// Aceita o formato novo (medias + medias_ordem) e o antigo (media + media_acerto_1t).
// O resto da página (projeção, apuração, método) continua lendo media e media_acerto_1t.
function normalizarDados(d) {
  if (!obj(d)) return d;
  const medias = {};
  for (const [k, v] of Object.entries(obj(d.medias) || {})) if (obj(v)) medias[k] = v;
  if (!medias.ponderada && obj(d.media)) medias.ponderada = d.media;
  if (!medias.acerto_1t && obj(d.media_acerto_1t)) medias.acerto_1t = d.media_acerto_1t;
  const ordem = arr(d.medias_ordem).filter((k) => typeof k === 'string' && medias[k]);
  for (const k of [...MEDIAS_PADRAO, ...Object.keys(medias)]) if (medias[k] && !ordem.includes(k)) ordem.push(k);
  // O agregador próprio já se chamou "Média Radar": arquivo antigo (ou em cache) sai com o nome novo.
  const rd = medias.radar;
  if (rd) {
    for (const campo of ['rotulo', 'rotulo_curto']) {
      if (!txt(rd[campo]) || /^m[eé]dia radar$/i.test(String(rd[campo]).trim())) rd[campo] = ROTULO_CURTO.radar;
    }
  }
  d.medias = medias;
  d.medias_ordem = ordem;
  if (!obj(d.media) && medias.ponderada) d.media = medias.ponderada;
  if (!obj(d.media_acerto_1t) && medias.acerto_1t) d.media_acerto_1t = medias.acerto_1t;
  return d;
}
const rotuloCurto = (k, m) => txt(m?.rotulo_curto) || ROTULO_CURTO[k] || txt(m?.rotulo) || k;
// "Como é feita esta média", para quem nunca viu estatística (sem sigla).
function explicacaoSimples(k, m) {
  const proprio = txt(m?.explicacao);
  if (proprio) return [proprio];
  const F = curto('flavio');
  if (k === 'radar') {
    const c = obj(m?.componentes) || {};
    const ps = arr(m?.pesquisas).filter(obj);
    const top = ps.slice(0, 4).map((q) => `${q.casa} ${fNum((num(q.peso) ?? 0) * 100, 0)}%`);
    const sen = obj(m?.sensibilidade);
    return [
      `É o agregador próprio do Radar: a nossa média das pesquisas. Junta as ${ps.length || num(m?.n_casas) || ''} casas com pesquisa recente de 2º turno, inclusive as que acertaram o 1º turno e não estão no resto do painel.`,
      `Pesa mais quem errou menos no 1º turno, a pesquisa mais nova e a que ouviu mais gente. Quem mais pesa hoje: ${top.join(', ')}.`,
      `No 1º turno as casas mostraram ${F} em média ${fNum(Math.abs(num(c.erro_medio_1t_casas_pp) ?? 0), 1)} ${Math.abs(num(c.erro_medio_1t_casas_pp) ?? 0) < 2 ? 'ponto' : 'pontos'} abaixo da urna. Corrigimos ${fNum((num(c.alfa) ?? 0.3) * 100, 0)}% desse erro: nos 2º turnos de 2014, 2018 e 2022 a média das pesquisas errou bem menos que no 1º turno, então o erro não costuma se repetir inteiro.`,
      `Soma a tendência das últimas semanas e o efeito da abstenção: em todas as 6 eleições desde 2002 a falta subiu um pouco mais no 2º turno nos estados mais petistas (efeito de ${fNum(Math.abs(num(c.abstencao_diferencial_pp) ?? 0), 2)} ponto).`,
      sen ? `Sem corrigir nada, daria ${curto('lula')} ${fNum(sen.sem_corrigir?.lula)} × ${F} ${fNum(sen.sem_corrigir?.flavio)}; corrigindo o erro inteiro, ${curto('lula')} ${fNum(sen.corrigindo_tudo?.lula)} × ${F} ${fNum(sen.corrigindo_tudo?.flavio)}.` : '',
      'Atualiza sozinha a cada pesquisa nova. A projeção com abstenção e a prévia da apuração partem dela.',
    ].filter(Boolean);
  }
  if (k === 'ponderada') {
    return [
      'Pegamos a pesquisa mais recente de cada instituto.',
      'Contam mais as mais novas (o peso cai pela metade a cada 10 dias) e as que ouviram mais gente.',
      'Também conta o histórico: instituto que errou menos nos 2º turnos de 2014 a 2022 pesa um pouco mais.',
    ];
  }
  if (k === 'simples') {
    return ['A pesquisa mais recente de cada instituto, todas com o mesmo peso: soma e divide pelo número de institutos.'];
  }
  if (k === 'ajustada_1t') {
    return [
      `No 1º turno quase todos os institutos mostraram ${F} abaixo do que ele teve nas urnas.`,
      `Aqui corrigimos cada instituto pelo próprio erro: se ele mostrou ${F} 2 pontos abaixo no 1º turno, somamos esses 2 pontos a ${F} na pesquisa de agora.`,
      'Nada garante que o erro se repita, por isso a margem de incerteza desta média é maior.',
    ];
  }
  if (k === 'acerto_1t') {
    const ps = arr(m?.pesquisas).filter(obj);
    const quem = ps.map((q) => `${q.casa} (errou ${fNum(Math.abs(num(q.erro_margem_1t_pp) ?? 0))})`);
    const usadas = ps.map((q) => `${q.casa}, ${txt(q.campo) || fData(q.data) || 'sem data'}: ${curto('lula')} ${fNum(q.validos?.lula) ?? '—'} × ${curto('flavio')} ${fNum(q.validos?.flavio) ?? '—'}`);
    if (!ps.length) {
      const casas = listaNomes(m?.casas);
      return [`Usamos só os institutos que chegaram mais perto do resultado do 1º turno${casas ? ` (${casas})` : ''} e quem acertou mais pesa mais.`];
    }
    return [
      `Comparamos a última pesquisa de 1º turno de cada instituto com a urna, inclusive os que não estão no resto do painel, e medimos o erro na diferença entre ${F} e ${curto('lula')}.`,
      `Ficam os ${ps.length} que chegaram mais perto: ${listaNomes(quem)} ${ps.length > 1 ? 'pontos' : 'ponto'}. Quem errou menos pesa mais.`,
      `Vale a pesquisa de 2º turno mais recente de cada um: ${usadas.join('; ')}.`,
      ...ps.filter((q) => txt(q.ressalva)).map((q) => `Ressalva sobre ${q.casa}: ${q.ressalva}`),
    ];
  }
  return [txt(m?.nota) || 'Explicação desta média: sem dado ainda.'];
}

function mediaSelKey(d) {
  const ordem = arr(d?.medias_ordem);
  return ordem.includes(st.mediaSel) ? st.mediaSel : ordem[0] || null;
}

/* ------------------------------------------------- contagem regressiva */

// Dias de calendário em Brasília (UTC-3, sem horário de verão desde 2019) entre agora e o instante ms.
function diasAte(ms, agora = Date.now()) {
  const dia = (t) => Math.floor((t - 3 * 3600000) / 86400000);
  return dia(ms) - dia(agora);
}

function partesTempo(ms) {
  const tot = Math.ceil(ms / 60000);
  return { d: Math.floor(tot / 1440), h: Math.floor((tot % 1440) / 60), m: tot % 60 };
}
function atualizarContagem() {
  const e = obj(st.dados?.eleicao) || {};
  const ab = msDe(e.abertura) ?? msDe(CFG.abertura);
  const fe = msDe(e.fechamento) ?? msDe(CFG.fechamento);
  const agora = Date.now();
  const dois = (n) => String(n).padStart(2, '0');
  const partes = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
  };
  // Relógio sempre logo abaixo do título, até o fechamento das urnas.
  const relogio = (p, comDias, antes = '') =>
    h`${antes ? h`<span class="cont-e">${antes}</span> ` : ''}<b>${comDias ? p.d * 24 + p.h : p.h}h</b> <b>${dois(p.m)}min</b> <b>${dois(p.s)}s</b>`;
  let grande;
  let linha;
  let legenda;
  let acao = '';
  const fecha = fHoraCurta(fe);
  if (agora < ab) {
    const p = partes(fe - agora);
    // "É hoje" vale pelo dia do calendário em Brasília, não por faltar menos de 24 h para o fechamento:
    // no sábado depois das 17h o relógio já está abaixo de 24 h e ainda é véspera.
    const dias = diasAte(fe, agora);
    if (p.d >= 1) {
      grande = p.d === 1 ? 'Falta 1\u00a0dia' : `Faltam ${p.d}\u00a0dias`;
      linha = relogio(p, false, 'e');
      legenda = `até as urnas fecharem, às ${fecha} de Brasília`;
    } else if (dias >= 1) {
      grande = 'É amanhã';
      linha = relogio(p, true);
      legenda = `até as urnas fecharem, amanhã às ${fecha} de Brasília · abrem às ${fHoraCurta(ab)}`;
    } else {
      grande = 'É hoje';
      linha = relogio(p, true);
      legenda = `até as urnas fecharem, às ${fecha} de Brasília · abrem às ${fHoraCurta(ab)}`;
    }
  } else if (agora < fe) {
    const p = partes(fe - agora);
    grande = 'Urnas abertas';
    linha = relogio(p, true);
    legenda = `para as urnas fecharem, às ${fecha} de Brasília`;
  } else {
    grande = 'Urnas fechadas';
    linha = '';
    legenda = 'A apuração está em andamento, ao vivo, direto dos arquivos do TSE (Tribunal Superior Eleitoral).';
    acao = h`<a class="cont-botao" href="#apuracao">Acompanhar a apuração ao vivo →</a>`;
    if (st.tv && st.aba === 'resumo') mostrarAba('apuracao', false);
  }
  const g = $('#cont-grande');
  if (g && g.textContent !== grande) g.textContent = grande;
  const r = $('#cont-relogio');
  const lh = emHtml(linha);
  if (r && r._h !== lh) {
    r._h = lh;
    r.innerHTML = lh;
    r.hidden = !lh;
  }
  const lg = $('#cont-legenda');
  if (lg && lg.textContent !== legenda) lg.textContent = legenda;
  const a = $('#cont-acao');
  const ah = emHtml(acao);
  if (a && a._h !== ah) {
    a._h = ah;
    a.innerHTML = ah;
  }
  atualizarCarimbo();
  if (agora >= fe) atualizarTopo('apuracao', '', 0);
  else if (agora >= ab) atualizarTopo('aberta', 'Urnas abertas · fecham em', fe - agora);
  else atualizarTopo('antes', diasAte(fe, agora) >= 1 ? 'Urnas fecham em' : `Abrem às ${fHoraCurta(ab)} · fecham em`, fe - agora);
}

// Relógio do topo, em todas as abas: HH:MM:SS até o fechamento das urnas; depois, o atalho da apuração.
// Só o algarismo que mudou é trocado, e ele entra com a animação de virada (.tc-vira).
function atualizarTopo(modo, rotulo, ms) {
  const el = $('#topo-cont');
  if (!el) return;
  if (el._modo !== modo || el._rot !== rotulo) {
    el._modo = modo;
    el._rot = rotulo;
    el.dataset.modo = modo;
    el.innerHTML = emHtml(
      modo === 'apuracao'
        ? h`<a class="tc-vivo" href="#apuracao"><i aria-hidden="true"></i><span class="tc-longo">Apuração ao vivo</span><span class="tc-curto">Ao vivo</span></a>`
        : h`<span class="tc-rot">${rotulo}</span><span class="tc-rel" role="timer"></span>`,
    );
  }
  const r = $('.tc-rel', el);
  if (!r) return;
  const s = Math.max(0, Math.floor(ms / 1000));
  const dois = (n) => String(n).padStart(2, '0');
  const t = `${dois(Math.floor(s / 3600))}:${dois(Math.floor((s % 3600) / 60))}:${dois(s % 60)}`;
  if (r._t === t) return;
  const velho = r._t || '';
  r._t = t;
  r.setAttribute('aria-label', `${Math.floor(s / 3600)} horas e ${Math.floor((s % 3600) / 60)} minutos`);
  if (velho.length !== t.length) {
    r.innerHTML = [...t].map((c) => (c === ':' ? '<i class="tc-sep">:</i>' : `<b class="tc-d">${c}</b>`)).join('');
    return;
  }
  [...t].forEach((c, i) => {
    if (c === velho[i]) return;
    const n = r.children[i];
    n.textContent = c;
    n.classList.remove('tc-vira');
    void n.offsetWidth;
    n.classList.add('tc-vira');
  });
}

/* ------------------------------------------------------ carga de dados */

const TENTATIVAS_MS = [3000, 8000, 15000, 30000, 60000];

// Texto de erro em português para quem lê no celular. O navegador e a rede dizem "Failed to fetch",
// "Load failed", "HTTP 503": nada disso chega à tela. limparErro troca os pedaços em inglês dentro de
// frases que já vêm em português (como as do módulo de mercados, que junta a mensagem do navegador).
const TROCAS_ERRO = [
  [/failed to fetch dynamically imported module[^;,)]*/gi, 'não consegui carregar uma parte da página'],
  [/importing a module script failed\.?/gi, 'não consegui carregar uma parte da página'],
  [/failed to fetch|load failed|network ?error[^;,)]*|network request failed|networkerror when attempting to fetch resource\.?|err_internet_disconnected|err_network_changed|net::err_[a-z_]+/gi, 'sem conexão'],
  [/the operation was aborted\.?|signal is aborted[^;,)]*|aborterror|request timed out|timed? ?out/gi, 'sem resposta a tempo'],
  [/bloqueia por CORS/gi, 'não libera a leitura direta pelo navegador'],
  [/bloqueado \(CORS\)/gi, 'bloqueado pelo navegador'],
  [/\bCORS\b/g, 'regra do navegador'],
  [/HTTP (5\d\d)/g, 'o servidor está instável (erro $1)'],
  [/HTTP 404/g, 'arquivo não encontrado (erro 404)'],
  [/HTTP 403/g, 'acesso negado (erro 403)'],
  [/HTTP 429/g, 'muitos pedidos seguidos (erro 429)'],
  [/HTTP (\d{3})/g, 'o servidor respondeu com erro $1'],
  [/unexpected (token|end of json)[^;,)]*|json\.parse[^;,)]*|is not valid json[^;,)]*/gi, 'o arquivo veio incompleto'],
  [/\b(type|reference|syntax|range)error:?[^;,)]*/gi, 'erro inesperado na página'],
];
function limparErro(t) {
  let s = String(t ?? '');
  for (const [re, troca] of TROCAS_ERRO) s = s.replace(re, troca);
  return s;
}
function erroLegivel(e) {
  const m = String(e?.message || e || '');
  if (/failed to fetch|load failed|networkerror|network request failed|net::err_/i.test(m)) return 'sem conexão com a internet ou com o site neste momento';
  if (/abort|timed? ?out/i.test(m)) return 'o servidor demorou a responder';
  if (/HTTP 5\d\d/.test(m)) return 'o servidor do site está instável';
  return limparErro(m);
}

// Só avisa quando a falha persiste: duas tentativas seguidas e mais de 2 minutos sem conseguir.
const falhaPersistente = () => st.erro && st.falhasSeguidas >= 2 && Date.now() - st.erroDesde > 120000;

async function carregarDados() {
  const sep = URL_DADOS.includes('?') ? '&' : '?';
  const url = `${URL_DADOS}${sep}v=${Math.floor(Date.now() / 60000)}`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const texto = await r.text();
    let dados;
    try {
      dados = JSON.parse(texto);
    } catch {
      throw new Error('o arquivo não é um JSON válido');
    }
    if (!obj(dados)) throw new Error('formato inesperado');
    normalizarDados(dados);
    st.erro = null;
    st.falhasSeguidas = 0;
    st.erroDesde = 0;
    clearTimeout(st.timerTentativa);
    st.lidoEm = Date.now();
    st.okEm = st.lidoEm;
    st.carregando = false;
    if (texto !== st.texto) {
      const anterior = st.dados;
      // Só há "novidade" a partir da segunda leitura: a primeira carga nunca dispara o aviso.
      const novas = anterior ? acharNovas(anterior, dados) : [];
      const antes = anterior ? fotografarNumeros() : null;
      if (novas.length) marcarNovas(novas);
      st.texto = texto;
      st.dados = dados;
      aplicarCores();
      renderizarTudo();
      if (antes) animarNumeros(antes);
      if (novas.length) anunciarNovas(novas, anterior, dados);
    } else {
      renderizarFaixaTopo();
      atualizarCarimbo();
    }
  } catch (e) {
    st.erro = erroLegivel(e);
    st.falhasSeguidas += 1;
    if (!st.erroDesde) st.erroDesde = Date.now();
    st.lidoEm = Date.now();
    // Nova tentativa em segundos: a falha típica é a rede acordando (Mac saindo do repouso,
    // celular trocando de Wi-Fi para 4G); esperar o próximo minuto deixava o aviso na tela.
    clearTimeout(st.timerTentativa);
    st.timerTentativa = setTimeout(carregarDados, TENTATIVAS_MS[Math.min(st.falhasSeguidas - 1, TENTATIVAS_MS.length - 1)]);
    const primeira = st.carregando;
    st.carregando = false;
    if (primeira || !st.dados) renderizarTudo();
    else renderizarFaixaTopo();
  }
}

/* ----------------------------------------- pesquisa que acabou de entrar */

const NOVA_DESTAQUE_MS = 5 * 60 * 1000; // a linha fica destacada na aba Pesquisas
const AVISO_NOVA_MS = 20 * 1000; // o aviso do topo some sozinho

// Identidade de uma pesquisa entre uma leitura e outra: casa + registro no TSE (ou data e campo,
// quando a casa não informa o registro).
function chavePesquisa(p) {
  const reg = txt(p?.registro);
  return `${norm(p?.casa)}|${reg ? norm(reg) : `${txt(p?.data) || ''}|${norm(p?.campo)}`}`;
}
const idPesquisa = (chave) => `pq-${chave.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;

// Pesquisas da leitura nova que não estavam na anterior. Sem pesquisa na anterior não dá para dizer
// o que é novo (arquivo vazio ou lacuna passageira): não anuncia nada.
function acharNovas(ant, novo) {
  const antes = arr(ant?.pesquisas).filter(obj);
  if (!antes.length) return [];
  const vistas = new Set(antes.map(chavePesquisa));
  const achadas = new Map();
  for (const p of arr(novo?.pesquisas).filter(obj)) {
    const k = chavePesquisa(p);
    if (txt(p.casa) && !vistas.has(k) && !achadas.has(k)) achadas.set(k, p);
  }
  return [...achadas.values()];
}

function marcarNovas(novas) {
  const ate = Date.now() + NOVA_DESTAQUE_MS;
  for (const p of novas) {
    const chave = chavePesquisa(p);
    st.novas.set(chave, { ate, id: idPesquisa(chave) });
  }
  agendarFimDestaque();
}
const novaAtiva = (p) => {
  const n = st.novas.get(chavePesquisa(p));
  return n && n.ate > Date.now() ? n : null;
};
function agendarFimDestaque() {
  clearTimeout(st.timerNovas);
  const agora = Date.now();
  for (const [k, v] of st.novas) if (v.ate <= agora) st.novas.delete(k);
  for (const el of $$('.pesq.nova')) {
    if (!st.novas.has(el.dataset.chave)) {
      el.classList.remove('nova');
      $('.nova-tag', el)?.remove();
    }
  }
  if (!st.novas.size) return;
  const prox = Math.min(...[...st.novas.values()].map((v) => v.ate));
  st.timerNovas = setTimeout(agendarFimDestaque, Math.max(1000, prox - agora + 300));
}

// "Quaest 24/10: Flávio 51 × Lula 49" (votos válidos; sem eles, os totais como a casa divulgou).
function resumoPesquisa(p) {
  const v = obj(p.validos);
  const t = obj(p.totais);
  const base = num(v?.lula) !== null && num(v?.flavio) !== null ? v : num(t?.lula) !== null && num(t?.flavio) !== null ? t : null;
  const casa = txt(p.casa) || 'Casa';
  const dia = fData(p.data);
  const quando = dia ? ` ${dia}` : '';
  if (!base) return `${casa}${quando}: números ainda sem leitura`;
  const cp = casasPub(base.lula, base.flavio);
  const lid = num(base.flavio) >= num(base.lula) ? 'flavio' : 'lula';
  const outro = lid === 'flavio' ? 'lula' : 'flavio';
  return `${casa}${quando}: ${curto(lid)} ${nf(cp).format(num(base[lid]))} × ${curto(outro)} ${nf(cp).format(num(base[outro]))}`;
}

// A frase da média: "o agregador próprio mudou: Flávio de 51,6% para 51,9%".
function fraseMedia(ant, novo) {
  const a = obj(ant?.medias?.radar) || obj(ant?.media);
  const b = obj(novo?.medias?.radar) || obj(novo?.media);
  const aL = num(a?.validos?.lula);
  const aF = num(a?.validos?.flavio);
  const bL = num(b?.validos?.lula);
  const bF = num(b?.validos?.flavio);
  if (bL === null || bF === null) return '';
  const lid = bF >= bL ? 'flavio' : 'lula';
  const antes = lid === 'flavio' ? aF : aL;
  const depois = lid === 'flavio' ? bF : bL;
  const nome = (obj(novo?.medias?.radar) ? rotuloCurto('radar', novo.medias.radar) : 'a média').toLowerCase();
  if (antes === null) return `${nome}: ${curto(lid)} ${fNum(depois)}%`;
  if (fNum(antes) === fNum(depois)) return `a média não mudou: ${curto(lid)} segue em ${fNum(depois)}%`;
  return `a média mudou de ${fNum(antes)}% para ${fNum(depois)}% (${curto(lid)}, ${nome})`;
}

function anunciarNovas(novas, ant, novo) {
  const el = $('#novas');
  if (!el || !novas.length) return;
  st.avisoItens = [...novas.map(resumoPesquisa), ...(el.hidden ? [] : st.avisoItens || [])].slice(0, 6);
  const ids = novas.map((p) => novaAtiva(p)?.id).filter(Boolean);
  st.avisoDestino = ids[0] || st.avisoDestino || null;
  const qtd = st.avisoItens.length;
  el.innerHTML = emHtml(h`<div class="novas-cartao" role="status">
      <div class="novas-cab">
        <span class="novas-pulso" aria-hidden="true"></span>
        <b class="novas-tit">Acabou de entrar</b>
        <span class="novas-qtd">${qtd === 1 ? 'pesquisa nova' : `${qtd} pesquisas novas`}</span>
        <button type="button" class="novas-x" data-acao="fechar-novas" aria-label="Fechar o aviso">×</button>
      </div>
      <ul class="novas-lista">${st.avisoItens.map((x) => h`<li>${x}</li>`)}</ul>
      ${fraseMedia(ant, novo) ? h`<p class="novas-media">${fraseMedia(ant, novo).replace(/^./, (c) => c.toUpperCase())}.</p>` : ''}
      <a class="novas-ver" href="#pesquisas" data-acao="ver-novas">Ver na lista →</a>
    </div>`);
  el.hidden = false;
  posicionarNovas();
  requestAnimationFrame(() => el.classList.add('aberto'));
  window.addEventListener('scroll', posicionarNovas, { passive: true });
  armarAvisoNovas();
}
// O aviso só começa a contar o tempo com a aba à vista: quem volta depois de uma hora ainda o vê.
function armarAvisoNovas() {
  clearTimeout(st.timerAviso);
  if (!document.hidden) st.timerAviso = setTimeout(ocultarNovas, AVISO_NOVA_MS);
}
// Logo abaixo da barra de abas (que gruda no topo ao rolar), sem tapar o conteúdo que o leitor lê.
function posicionarNovas() {
  const el = $('#novas');
  const abas = $('.abas');
  if (!el || el.hidden || !abas) return;
  el.style.top = `${Math.max(0, abas.getBoundingClientRect().bottom) + 8}px`;
}
function ocultarNovas() {
  const el = $('#novas');
  if (!el) return;
  clearTimeout(st.timerAviso);
  window.removeEventListener('scroll', posicionarNovas);
  el.classList.remove('aberto');
  st.avisoItens = [];
  setTimeout(() => {
    if (!el.classList.contains('aberto')) {
      el.hidden = true;
      el.innerHTML = '';
    }
  }, reduzMovimento() ? 0 : 320);
}

/* ------------------------------------------ média que se move no lugar */

// Antes de redesenhar, guarda o valor de cada número e a barra dos blocos; depois do desenho, os
// números contam do valor antigo ao novo (sem piscar: o texto já começa no valor antigo) e as
// barras deslizam. Quem pede "reduzir movimento" vê o valor novo direto.
function fotografarNumeros() {
  const cu = new Map();
  for (const el of $$('[data-cu]')) {
    const v = Number(el.dataset.v);
    if (Number.isFinite(v)) cu.set(el.dataset.cu, v);
  }
  const seg = new Map();
  for (const el of $$('[data-segag]')) seg.set(el.dataset.segag, el.style.flexGrow);
  return { cu, seg, placar: $$('[data-bloco="pesquisas"]').map((c) => lerPlacar(c)) };
}

function contar(el, de, para, ms = 900) {
  const casas = Number(el.dataset.casas) || 0;
  const suf = el.dataset.sufixo || '';
  const final = el.textContent;
  cancelAnimationFrame(el._raf);
  const t0 = performance.now();
  const passo = (agora) => {
    const k = Math.min(1, (agora - t0) / ms);
    if (k >= 1) {
      el.textContent = final;
      return;
    }
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = `${nf(casas).format(de + (para - de) * e)}${suf}`;
    el._raf = requestAnimationFrame(passo);
  };
  el.textContent = `${nf(casas).format(de)}${suf}`;
  el._raf = requestAnimationFrame(passo);
}

function animarNumeros(antes) {
  if (!antes || reduzMovimento()) return;
  for (const el of $$('[data-cu]')) {
    const de = antes.cu.get(el.dataset.cu);
    const para = Number(el.dataset.v);
    if (Number.isFinite(de) && Number.isFinite(para) && de !== para) contar(el, de, para);
  }
  const segs = $$('[data-segag]');
  const novos = segs.map((el) => el.style.flexGrow);
  segs.forEach((el) => {
    const a = antes.seg.get(el.dataset.segag);
    if (a) el.style.flexGrow = a;
  });
  if (segs.length) {
    void segs[0].offsetWidth;
    requestAnimationFrame(() => segs.forEach((el, i) => (el.style.flexGrow = novos[i])));
  }
  $$('[data-bloco="pesquisas"]').forEach((c, i) => {
    if (antes.placar[i]) animarPlacar(c, antes.placar[i]);
  });
}

/* ------------------------------------------------- "atualizado às ..." */

// Diz a verdade sobre a idade do número: a hora em que os dados foram gerados, a hora em que a página
// conseguiu conferir pela última vez e, se a rede falhou, que o último dado é aquele.
function textoCarimbo() {
  const g = msDe(st.dados?.gerado_em);
  if (g === null) return st.dados ? 'hora de geração dos dados não informada' : '';
  const quando = mesmoDia(g, Date.now()) ? `às ${fHora(g)}` : `em ${fDataHora(g)}`;
  if (falhaPersistente()) return `sem conexão agora; o último dado foi gerado ${quando}`;
  return `atualizado ${quando}${st.okEm ? ` · conferido às ${fHora(st.okEm)}` : ''}`;
}
function atualizarCarimbo() {
  const el = $('#ag-carimbo');
  if (!el) return;
  const t = textoCarimbo();
  if (el._t !== t) {
    el._t = t;
    el.textContent = t;
  }
  const ok = !st.erro;
  if (el.dataset.estado !== (ok ? 'ok' : 'erro')) el.dataset.estado = ok ? 'ok' : 'erro';
  const v = $('#ag-vivo');
  if (v && v.dataset.estado !== (ok ? 'ok' : 'erro')) v.dataset.estado = ok ? 'ok' : 'erro';
}

function aplicarCores() {
  const raiz = document.documentElement.style;
  raiz.setProperty('--lula', cand('lula').cor);
  raiz.setProperty('--flavio', cand('flavio').cor);
}

/* ------------------------------------------------------------ mercados */

async function carregarModulo() {
  st.modTentativas += 1;
  const url =
    st.modTentativas > 1 ? `${URL_MERCADOS}${URL_MERCADOS.includes('?') ? '&' : '?'}r=${Date.now()}` : URL_MERCADOS;
  try {
    const m = await import(url);
    const api = typeof m.lerMercados === 'function' ? m : typeof m.default?.lerMercados === 'function' ? m.default : null;
    if (!api) throw new Error('o módulo não tem lerMercados()');
    st.mod = api;
    st.modErro = null;
    // Preço novo (WebSocket ou balde de 15 s do Mac): relê na hora, sem esperar o relógio de 60 s.
    if (typeof api.aoMudar === 'function' && !st.desfazAoMudar) st.desfazAoMudar = api.aoMudar(() => atualizarMercados());
  } catch (e) {
    st.mod = null;
    st.modErro = erroLegivel(e).slice(0, 140);
    st.modProxima = Date.now() + CFG.cadaModulo;
  }
}

async function atualizarMercados() {
  if (st.lendoMerc) return;
  if (document.hidden && st.merc) return;
  st.lendoMerc = true;
  try {
    if (st.mod === undefined || (st.mod === null && Date.now() >= st.modProxima)) await carregarModulo();
    if (st.mod) {
      try {
        const r = await st.mod.lerMercados();
        if (!obj(r) || !Array.isArray(r.fontes)) throw new Error('resposta sem fontes');
        st.merc = r;
        st.mercErro = null;
        st.mercEm = Date.now();
      } catch (e) {
        st.mercErro = erroLegivel(e).slice(0, 140);
      }
    }
  } finally {
    st.lendoMerc = false;
  }
  renderizarMercados();
  renderizarFaixaTopo();
  if (st.aba === 'mercados') carregarHistoricos();
  st.apur?.mercadosMudaram();
}

// A aba Apuração lê os mercados daqui: o preço de cada candidato já vem normalizado (soma 100%), para
// o número que ela mostra bater com o das outras abas. O preço original fica em prob_bruta.
let _mercNorm = { de: null, para: null };
function mercadosNormalizados() {
  const m = st.merc;
  if (!m) return m;
  if (_mercNorm.de === m) return _mercNorm.para;
  const para = {
    ...m,
    fontes: arr(m.fontes).map((f) => {
      const par = obj(f) && f.status !== 'erro' ? parMercado(f) : null;
      if (!par) return f;
      const L = f.candidatos.lula;
      const F = f.candidatos.flavio;
      return { ...f, candidatos: { ...f.candidatos, lula: { ...L, prob_bruta: L.prob, prob: par.li / 100 }, flavio: { ...F, prob_bruta: F.prob, prob: par.fi / 100 } } };
    }),
  };
  _mercNorm = { de: m, para };
  return para;
}

function normalizarHist(pontos) {
  const lista = arr(pontos)
    .map((p) => ({ t: msDe(p?.t), l: num(p?.lula), f: num(p?.flavio) }))
    .filter((p) => p.t !== null && (p.l !== null || p.f !== null))
    .sort((a, b) => a.t - b.t);
  const max = Math.max(0, ...lista.flatMap((p) => [p.l ?? 0, p.f ?? 0]));
  const k = max <= 1.5 ? 100 : 1; // 0..1 vira %; se já vier em %, mantém
  // O histórico também sai normalizado (soma 100,0 em cada ponto, uma casa decimal), como os cartões.
  return lista.map((p) => {
    const l = p.l === null ? null : p.l * k;
    const f = p.f === null ? null : p.f * k;
    if (l === null || f === null || !(l + f > 0)) return { t: p.t, l, f };
    const a = (l / (l + f)) * 1000;
    const b = (f / (l + f)) * 1000;
    let ai = Math.floor(a + 1e-9);
    let bi = Math.floor(b + 1e-9);
    if (1000 - ai - bi > 0) {
      if (a - ai >= b - bi) ai += 1;
      else bi += 1;
    }
    return { t: p.t, l: ai / 10, f: bi / 10 };
  });
}

async function carregarHistoricos(forcar = false) {
  if (!st.mod || typeof st.mod.lerHistorico !== 'function') {
    atualizarHistoricoDom();
    return;
  }
  const fontes = arr(st.merc?.fontes).filter((f) => obj(f) && txt(f.id));
  const dias = st.dias;
  const pendentes = fontes.filter((f) => {
    const atual = st.hist.get(`${f.id}:${dias}`);
    return forcar || !atual || (!atual.lendo && Date.now() - atual.em > CFG.cadaHistorico);
  });
  if (!pendentes.length) return;
  for (const f of pendentes) {
    const k = `${f.id}:${dias}`;
    const atual = st.hist.get(k);
    st.hist.set(k, { ...(atual || { pontos: null, erro: null, origem: null, atualizado: null, em: 0 }), lendo: true });
  }
  await Promise.all(
    pendentes.map(async (f) => {
      const k = `${f.id}:${dias}`;
      const atual = st.hist.get(k);
      try {
        const bruto = await st.mod.lerHistorico(f.id, dias);
        st.hist.set(k, {
          pontos: normalizarHist(bruto),
          erro: null,
          origem: bruto?.origem ?? null,
          atualizado: bruto?.atualizado_em ?? null,
          em: Date.now(),
          lendo: false,
        });
      } catch (e) {
        st.hist.set(k, { ...atual, erro: erroLegivel(e).slice(0, 140), em: Date.now(), lendo: false });
      }
    }),
  );
  if (dias === st.dias) atualizarHistoricoDom();
}

/* ------------------------------------------------------ renderização */

function trocarHtml(el, conteudo) {
  if (!el) return;
  const abertos = new Set($$('details[open][data-k]', el).map((x) => x.dataset.k));
  // Controle deslizante do simulador de abstenção: a leitura nova não zera o que o leitor ajustou.
  const sims = $$('[data-sim-ab-in]', el).map((i) => [i.dataset.simAbIn, i.value]);
  el.innerHTML = emHtml(conteudo);
  if (abertos.size) for (const x of $$('details[data-k]', el)) if (abertos.has(x.dataset.k)) x.open = true;
  if (sims.some(([, v]) => v !== '0')) {
    for (const [k, v] of sims) {
      const i = $(`[data-sim-ab-in="${k}"]`, el);
      if (i) i.value = v;
    }
    const caixa = $('[data-sim-ab]', el);
    if (caixa) atualizarSimAbst(caixa);
  }
  desenharVisiveis(false, el);
}

// Só para o CSS do Modo TV: com o agregador próprio escolhido, o cartão verde já mostra os mesmos números.
function marcarMedia() {
  document.body.dataset.mediaSel = (st.dados && mediaSelKey(st.dados)) || '';
}

function renderizarTudo() {
  renderizarFaixaTopo();
  const d = st.dados;
  marcarMedia();
  trocarHtml($('#painel-resumo'), htmlResumo(d));
  trocarHtml($('#painel-pesquisas'), htmlPesquisas(d));
  trocarHtml($('#merc-conteudo') || $('#painel-mercados'), htmlAbaMercados());
  _assinHist = '';
  trocarHtml($('#painel-metodo'), htmlMetodo(d));
  renderizarRodape();
  atualizarContagem();
  if (st.aba === 'mercados') carregarHistoricos();
  if (st.apur && st.dados) st.apur.dadosMudaram();
}

function renderizarMercados() {
  for (const el of $$('[data-merc]')) trocarHtml(el, htmlMercados(el.dataset.merc));
  for (const el of $$('[data-merc-fonte]')) trocarHtml(el, htmlFonteMercados());
  for (const el of $$('[data-merc-aviso]')) trocarHtml(el, avisoBloqueioMerc());
  for (const el of $$('[data-comp]')) trocarHtml(el, htmlComparacao());
  for (const el of $$('[data-tri]')) trocarHtml(el, htmlTriangulacao());
  for (const el of $$('[data-agch]')) trocarHtml(el, chancePolymarket(el.dataset.agch));
  for (const el of $$('[data-lac-merc]')) trocarHtml(el, htmlLacunasMercado());
  atualizarHistoricoDom();
}

// Redesenha o histórico só quando algo mudou (a leitura de 60 s não apaga a dica aberta).
let _assinHist = '';
function atualizarHistoricoDom(forcar = false) {
  for (const b of $$('[data-dias]')) b.setAttribute('aria-pressed', String(Number(b.dataset.dias) === st.dias));
  const assin = JSON.stringify([
    st.dias,
    st.mod === undefined ? 'u' : st.mod === null ? 'n' : typeof st.mod.lerHistorico,
    !!st.mercErro,
    arr(st.merc?.fontes).map((f) => [f?.id, f?.nome]),
    [...st.hist.entries()].map(([k, v]) => [k, v.em, !!v.lendo, v.pontos?.length ?? -1, v.erro, v.origem, v.atualizado]),
    $$('[data-hist]').length,
  ]);
  if (!forcar && assin === _assinHist) return;
  _assinHist = assin;
  for (const el of $$('[data-hist]')) trocarHtml(el, htmlHistoricos());
}

function htmlSemDados() {
  if (st.carregando) return h`<p class="estado">Carregando os dados…</p>`;
  return lacunaBloco(
    `Sem dados ainda: não consegui ler os dados do Radar${st.erro ? ` (${st.erro})` : ''}. A página tenta de novo sozinha em alguns segundos.`,
  );
}

function renderizarFaixaTopo() {
  const el = $('#faixa-topo');
  if (!el) return;
  const d = st.dados;
  const itens = [];
  if (st.erro && !d && !st.carregando) {
    itens.push(
      h`<div class="alerta"><p><b>Não consegui carregar os dados agora</b> (${st.erro}). A página tenta de novo sozinha em alguns segundos.</p><button type="button" data-acao="recarregar">Tentar agora</button></div>`,
    );
  } else if (d && falhaPersistente()) {
    itens.push(
      h`<div class="alerta"><p>Sem atualização há alguns minutos (${st.erro}). Os números abaixo são de ${ou(fDataHora(d.gerado_em))}; a página continua tentando sozinha.</p><button type="button" data-acao="recarregar">Tentar agora</button></div>`,
    );
  }
  if (d) {
    if (/^\s*EXEMPLO/i.test(String(d.manchete || '')) || /exemplo/i.test(String(d.versao || ''))) {
      itens.push(h`<div class="alerta"><p><b>Dados de EXEMPLO</b>, fictícios, só para testar a página. Não são pesquisas reais.</p></div>`);
    }
    const g = msDe(d.gerado_em);
    if (g === null) {
      itens.push(h`<div class="alerta"><p>Os dados não dizem quando foram gerados: confira a data de cada bloco.</p></div>`);
    } else if (Date.now() - g > CFG.horasVelho * HORA) {
      itens.push(
        h`<div class="alerta"><p><b>Dados de ${fDataHora(g)}</b>, ${fIdade(g)}. A atualização automática pode ter parado; os números abaixo são dessa hora.</p></div>`,
      );
    }
  }
  el.innerHTML = emHtml(itens);
}

function renderizarRodape() {
  const el = $('#rodape-meta');
  if (!el) return;
  const d = st.dados;
  const partes = ['Radar Eleitoral · versão de bolso do 2º turno'];
  const g = fDataHora(d?.gerado_em);
  if (g) partes.push(`dados gerados em ${g}`);
  if (txt(d?.versao)) partes.push(`versão ${d.versao}`);
  el.innerHTML = emHtml(h`${partes.join(' · ')} · <button type="button" data-acao="compartilhar">Compartilhar</button>`);
}

/* ---------------------------------------------------------------- RESUMO */

function htmlResumo(d) {
  if (!d) return h`<div class="heroi">${blocoContagem()}</div>${htmlSemDados()}${blocoMercadosResumo()}`;
  return h`
    <div class="heroi">${blocoContagem()}</div>
    <div class="duo-pesq">
      <div class="duo-a" data-bloco="pesquisas">${blocoPesquisas(d)}</div>
      <div class="duo-b">${blocoUltimas(d)}</div>
    </div>
    ${blocoProjecao(d)}
    ${blocoMercadosResumo()}`;
}

// Bandeira do Brasil em SVG com a geometria oficial (Lei 5.700/1971, anexo): retângulo de 20 × 14
// módulos, losango a 1,7 módulo das bordas, círculo de 3,5 módulos de raio, faixa branca de 0,5
// módulo em arco de 8 e 7,5 módulos, e as 27 estrelas nas posições do desenho oficial. 1 módulo = 210
// unidades; a origem é o centro do círculo. Sem o lema: em tamanho de celular ele não se lê.
// A página mostra a bandeira em fatias verticais que sobem e descem em fase (ondulação suave, só com
// transform de CSS, sem JavaScript por quadro); com "reduzir movimento" fica parada.
const COR_BANDEIRA = { verde: '#009C3B', amarelo: '#FFDF00', azul: '#002776' };
const ESTRELAS_BANDEIRA = [
  // [x, y, raio]: raios 31,5 (1ª grandeza) 26,25 21 15 e 10,5 (5ª)
  [-600, -132, 31.5], [-535, 177, 31.5], [-625, 243, 26.25], [-463, 132, 15], [-382, 250, 26.25], [-404, 323, 21],
  [228, -228, 31.5], [515, 258, 31.5], [617, 265, 21], [545, 323, 26.25], [368, 477, 26.25], [367, 551, 21],
  [441, 419, 21], [500, 382, 26.25], [365, 405, 21], [-280, 30, 26.25], [200, -37, 21], [0, 330, 31.5],
  [85, 184, 26.25], [0, 118, 26.25], [-74, 184, 21], [-37, 235, 15], [220, 495, 26.25], [283, 430, 21],
  [162, 412, 21], [-295, 390, 31.5], [0, 575, 10.5],
];
function estrelaBandeira(cx, cy, R) {
  const r = R * 0.381966;
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const ang = (-90 + k * 36) * (Math.PI / 180);
    const rr = k % 2 === 0 ? R : r;
    pts.push(`${(cx + rr * Math.cos(ang)).toFixed(1)},${(cy + rr * Math.sin(ang)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}"/>`;
}
function svgBandeira() {
  const c = COR_BANDEIRA;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2100 -1470 4200 2940" width="4200" height="2940">` +
    `<rect x="-2100" y="-1470" width="4200" height="2940" fill="${c.verde}"/>` +
    `<path d="M-1743 0 0 1113 1743 0 0-1113Z" fill="${c.amarelo}"/>` +
    `<circle r="735" fill="${c.azul}"/>` +
    `<clipPath id="g"><circle r="735"/></clipPath>` +
    `<path clip-path="url(#g)" fill="#fff" d="m-2205 1470a1785 1785 0 0 1 3570 0h-105a1680 1680 0 1 0-3360 0z"/>` +
    `<g fill="#fff">${ESTRELAS_BANDEIRA.map(([x, y, R]) => estrelaBandeira(x, y, R)).join('')}</g>` +
    `</svg>`
  );
}
const FATIAS_BANDEIRA = 24;
// O SVG vira imagem de fundo de cada fatia (uma folha de estilo criada uma vez, no início).
function instalarBandeira() {
  if (document.getElementById('estilo-bandeira')) return;
  const uri = `data:image/svg+xml,${encodeURIComponent(svgBandeira()).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29')}`;
  const el = document.createElement('style');
  el.id = 'estilo-bandeira';
  el.textContent = `.bandeira-onda i{background-image:url("${uri}")}`;
  document.head.append(el);
}
const BANDEIRA = cru(
  `<span class="bandeira-onda" role="img" aria-label="Bandeira do Brasil">${Array.from({ length: FATIAS_BANDEIRA }, (_, i) => `<i style="--i:${i}"></i>`).join('')}<b class="onda-luz" aria-hidden="true"></b></span>`,
);

// 1º turno dentro do cartão verde: quem terminou na frente primeiro, foto grande, nome curto e % dos
// válidos, em linhas alinhadas (foto, nome, %); um toque leva ao detalhe na aba Pesquisas.
function bloco1TCartao() {
  const t = obj(st.dados?.primeiro_turno);
  const lista = arr(t?.candidatos).filter(obj);
  const res = { lula: acharNo1T(lista, 'lula'), flavio: acharNo1T(lista, 'flavio') };
  const pL = num(res.lula?.validos_pct);
  const pF = num(res.flavio?.validos_pct);
  if (pL === null || pF === null) {
    return h`<a class="cont-1t" href="#pesquisas" data-ir="1turno"><span class="c1-tit">1º turno · TSE</span><span class="c1-dif">resultado: sem dado ainda</span></a>`;
  }
  const ordem = pF > pL ? ['flavio', 'lula'] : ['lula', 'flavio'];
  const dpp = Math.abs(pF - pL);
  const dv = num(t.diferenca_votos) ?? (num(res.lula?.votos) !== null && num(res.flavio?.votos) !== null ? Math.abs(res.lula.votos - res.flavio.votos) : null);
  const pct = (id) => (id === 'lula' ? pL : pF);
  const rotulo = `1º turno, resultado do TSE: ${ordem.map((id) => `${curto(id)} ${fPct(pct(id), 2)}`).join(', ')}. Ver detalhes do 1º turno`;
  return h`<a class="cont-1t" href="#pesquisas" data-ir="1turno" aria-label="${rotulo}">
    <span class="c1-tit">1º turno · TSE${fData(t.data) ? ` · ${fData(t.data)}` : ''}</span>
    <span class="c1-linhas">${ordem.map((id) => h`<span class="c1-l">${avatar(id, 48)}<span class="c1-nome">${curto(id)}</span><b>${fPct(pct(id), 2)}</b></span>`)}</span>
    <span class="c1-dif">+${fNum(dpp, 2)} ${dpp < 2 ? 'ponto' : 'pontos'}${dv !== null ? ` · ${fGrande(dv)} de votos` : ''}</span>
    <span class="c1-ver">ver detalhes do 1º turno →</span>
  </a>`;
}

// Como o agregador próprio se saiu no 1º turno (radar_1t): o placar corrigido contra a urna.
function recordeAgregador() {
  const r = obj(st.dados?.radar_1t);
  const c = obj(r?.corrigida);
  const u = obj(r?.resultado);
  if (!c || num(c.lula) === null || num(c.flavio) === null) return '';
  const lid = (o) => (num(o.flavio) >= num(o.lula) ? 'flavio' : 'lula');
  const outro = (id) => (id === 'flavio' ? 'lula' : 'flavio');
  const temUrna = u && num(u.lula) !== null && num(u.flavio) !== null;
  const margemC = num(c.flavio) - num(c.lula);
  let erro = num(r?.erro_margem_pp?.corrigida);
  if (erro === null && temUrna) erro = margemC - (num(u.flavio) - num(u.lula));
  erro = erro === null ? null : Math.abs(erro);
  const pontos = erro === null ? '' : `${fNum(erro, 2)} ${erro < 2 ? 'ponto' : 'pontos'}`;
  const acertou = temUrna ? lid(c) === lid(u) : null;
  const frase =
    acertou === null || erro === null
      ? h`No 1º turno, o agregador mostrou ${curto(lid(c))} na frente${pontos ? h` e errou a diferença por <b>${pontos}</b>` : ''}.`
      : acertou
        ? h`No 1º turno, o agregador <b>cravou o vencedor</b> e errou a diferença por <b>${erro < 1 ? 'só ' : ''}${pontos}</b>.`
        : h`No 1º turno, o agregador <b>não acertou o vencedor</b> e errou a diferença por <b>${pontos}</b>.`;
  const par = (o, casas) => `${curto(lid(o))} ${fNum(o[lid(o)], casas)} × ${curto(outro(lid(o)))} ${fNum(o[outro(lid(o))], casas)}`;
  return h`<p class="ag-rec">${frase}</p>
    ${temUrna ? h`<p class="ag-rec-det">Agregador: ${par(c, 1)} · urna (TSE): ${par(u, 2)}, em % dos votos válidos.</p>` : ''}`;
}

// "Agregador próprio": o valor de hoje da nossa média, grande, com a chance de cada um e o retrospecto.
function blocoAgregador() {
  const d = st.dados;
  const m = obj(d?.medias?.radar);
  const vL = num(m?.validos?.lula);
  const vF = num(m?.validos?.flavio);
  const nc = num(m?.n_casas) ?? (arr(m?.casas).length || null);
  const ate = fData(m?.as_of) || fData(d?.media?.as_of);
  const col = (id, v, dir) => {
    const c = cand(id);
    return h`<div class="ag-c${dir ? ' dir' : ''}" data-cand="${id}" style="--c:${c.cor}">
      <div class="ag-quem">${dir ? '' : avatar(id, 40)}<span>${curto(id)}</span>${dir ? avatar(id, 40) : ''}</div>
      <div class="ag-num">${v !== null ? h`<span data-cu="ag-${id}" data-v="${v}" data-casas="1">${fNum(v)}</span><small>%</small>` : LAC}</div>
      <div class="ag-ch" data-agch="${id}">${chancePolymarket(id)}</div>
    </div>`;
  };
  let barra = '';
  if (vL !== null && vF !== null && vL + vF > 0) {
    const a = (vL / (vL + vF)) * 100;
    barra = h`<div class="ag-barra" role="img" aria-label="${curto('lula')} ${fPct(vL)}, ${curto('flavio')} ${fPct(vF)} dos votos válidos"><span data-segag="lula" style="flex:${pctCss(a)} 1 0px"></span><span data-segag="flavio" style="flex:${pctCss(100 - a)} 1 0px"></span><i aria-hidden="true"></i></div>`;
  }
  return h`<section class="agreg" id="sec-agregador" aria-label="Agregador próprio: a média das pesquisas de hoje">
    <div class="ag-cab"><p class="ag-tit">Agregador próprio ${info('Agregador próprio')}</p><span class="ag-vivo" id="ag-vivo"><i aria-hidden="true"></i>hoje</span></div>
    <p class="ag-sub">Média das pesquisas · % dos votos válidos</p>
    ${m ? h`<div class="ag-duelo">${col('lula', vL, false)}${col('flavio', vF, true)}</div>${barra}` : lacunaBloco('Agregador próprio: sem dado ainda.')}
    <p class="ag-fatos">${nc !== null ? `${fInt(nc)} ${plural(nc, 'casa', 'casas')} de pesquisa` : ''}${nc !== null && ate ? ' · ' : ''}${ate ? `pesquisas até ${ate}` : ''}</p>
    <p class="ag-carimbo" id="ag-carimbo" aria-live="off">${textoCarimbo()}</p>
    ${recordeAgregador()}
  </section>`;
}

// Chance de vitória pelo preço do Polymarket (normalizada para somar 100% entre os dois), com o nome
// do mercado escrito ao lado: quem lê precisa saber que o número vem de lá, não das pesquisas.
function chancePolymarket(id) {
  if (st.mod === undefined) return h`<span class="ag-pm">Polymarket</span> …`;
  const f = arr(st.merc?.fontes).find((x) => obj(x) && x.id === 'polymarket');
  const par = f && f.status !== 'erro' ? parMercado(f) : null;
  const v = par ? (id === 'lula' ? par.li : par.fi) : null;
  if (v === null) return h`<span class="ag-pm">Polymarket</span> sem dado agora`;
  return h`<b data-cu="ag-ch-${id}" data-v="${v}" data-casas="0" data-sufixo="%">${v}%</b> de chance <span class="ag-pm">no Polymarket</span>`;
}

function blocoContagem() {
  const e = obj(st.dados?.eleicao) || {};
  const fe = msDe(e.fechamento) ?? msDe(CFG.fechamento);
  return h`<section class="heroi-item ord-1 cont" id="sec-contagem" aria-label="Contagem até o fechamento das urnas">
    <div class="cont-cartao">
      <p class="cont-quando"><span>2º turno</span><b>${fSemana(fe) || 'domingo'}, ${fData(fe) || '25/10'}</b></p>
      <div class="cont-principal">
        <p class="cont-grande" id="cont-grande">&nbsp;</p>
        <p class="cont-relogio" id="cont-relogio" aria-live="off"></p>
        <p class="cont-legenda" id="cont-legenda"></p>
      </div>
      <div class="cont-lado">${BANDEIRA}${bloco1TCartao()}</div>
      ${st.dados ? blocoAgregador() : ''}
      <div id="cont-acao"></div>
    </div>
  </section>`;
}

// A mais recente de cada casa: as do painel (com a anterior da mesma casa, para a variação) e as que
// só entram no Agregador próprio (Palver, Gerp, Veritá, Futura...), da mais nova para a mais antiga.
function ultimasPorCasa(d) {
  const porCasa = new Map();
  const doPainel = arr(d?.pesquisas)
    .filter((p) => obj(p) && txt(p.casa) && msDe(p.data) !== null && p.pos_1o_turno !== false && num(p.validos?.lula) !== null)
    .sort((a, b) => msDe(b.data) - msDe(a.data));
  for (const p of doPainel) {
    const k = norm(p.casa);
    const atual = porCasa.get(k);
    const item = { casa: p.casa, data: p.data, registro: txt(p.registro), lula: num(p.validos.lula), flavio: num(p.validos?.flavio) ?? 100 - num(p.validos.lula) };
    if (!atual) porCasa.set(k, { ...item, ant: null });
    else if (!atual.ant) atual.ant = item;
  }
  for (const q of arr(d?.medias?.radar?.pesquisas).filter((x) => obj(x) && txt(x.casa) && num(x.lula) !== null)) {
    const k = norm(q.casa);
    const atual = porCasa.get(k);
    if (atual && (msDe(q.data) ?? 0) <= (msDe(atual.data) ?? 0)) continue;
    const lula = num(q.lula);
    porCasa.set(k, { casa: q.casa, data: q.data, registro: txt(q.registro), lula, flavio: Math.round((100 - lula) * 10) / 10, ant: atual ? { lula: atual.lula, data: atual.data } : null });
  }
  return [...porCasa.values()].sort((a, b) => (msDe(b.data) ?? 0) - (msDe(a.data) ?? 0) || a.casa.localeCompare(b.casa));
}

const hojeBrasilia = () => new Date(Date.now() - 3 * HORA).toISOString().slice(0, 10);

// Uma linha por pesquisa: casa, dia, Lula × Flávio com a barra, e quanto mexeu desde a anterior.
// "hoje" = divulgada hoje; "chegou" = entrou depois que a página abriu (pisca uma vez).
function linhaUltima(p, chegou) {
  const L = cand('lula');
  const F = cand('flavio');
  const hoje = String(p.data).slice(0, 10) === hojeBrasilia();
  const dl = p.ant && num(p.ant.lula) !== null ? p.lula - p.ant.lula : null;
  const lid = p.flavio > p.lula ? 'flavio' : p.lula > p.flavio ? 'lula' : null;
  return h`<li class="ul-l${chegou ? ' chegou' : ''}${hoje ? ' hoje' : ''}">
      <div class="ul-cab"><b class="ul-casa">${p.casa}</b>${hoje ? h`<span class="ul-nova">hoje</span>` : ''}<span class="ul-data">${fData(p.data) || ''}</span></div>
      <div class="ul-par">
        <span class="ul-v${lid === 'lula' ? ' lid' : ''}" style="--c:${L.cor}">${fNum(p.lula)}</span>
        <span class="ul-barra" aria-hidden="true"><i style="--c:${L.cor};flex:${pctCss(p.lula)} 1 0px"></i><i style="--c:${F.cor};flex:${pctCss(p.flavio)} 1 0px"></i></span>
        <span class="ul-v${lid === 'flavio' ? ' lid' : ''}" style="--c:${F.cor}">${fNum(p.flavio)}</span>
      </div>
      ${dl !== null
        ? h`<p class="ul-var">${Math.abs(dl) < 0.05 ? `igual à anterior (${fData(p.ant.data)})` : h`<i class="mc" style="--c:${cand(dl > 0 ? 'lula' : 'flavio').cor}"></i>${curto(dl > 0 ? 'lula' : 'flavio')} <b>+${fNum(Math.abs(dl))}</b> desde ${fData(p.ant.data)}`}</p>`
        : ''}
    </li>`;
}

function listaUltimas(lista) {
  const chave = (p) => p.registro || `${p.casa}|${p.data}`;
  const primeira = !st.regVistos;
  if (primeira) st.regVistos = new Set();
  const itens = lista.map((p) => linhaUltima(p, !primeira && !st.regVistos.has(chave(p))));
  for (const p of lista) st.regVistos.add(chave(p));
  return h`<ol class="ul-lista">${itens}</ol>`;
}

function blocoUltimas(d) {
  const lista = ultimasPorCasa(d);
  return h`<section class="bloco heroi-bloco ul" id="sec-ultimas">
    <div class="op-cab"><h2 class="titulo-heroi">Últimas pesquisas</h2><span class="ul-vivo" data-estado="${st.erro ? 'erro' : 'ok'}"><i aria-hidden="true"></i>ao vivo</span></div>
    <p class="op-unid">% dos votos válidos · a mais recente de cada casa</p>
    ${lista.length ? listaUltimas(lista.slice(0, 7)) : lacunaBloco('Últimas pesquisas: sem dado ainda.')}
    ${lista.length > 7 ? h`<p class="ver-mais"><a href="#pesquisas">Todas as ${lista.length} casas →</a></p>` : ''}
  </section>`;
}

/* "O que dizem as pesquisas": as quatro médias e a tabela por instituto. */
function blocoPesquisas(d) {
  const sub = st.subaba === 'instituto' ? 'instituto' : 'media';
  return h`<section class="bloco heroi-bloco op" id="sec-media">
    <div class="op-cab"><h2 class="titulo-heroi">O que dizem as pesquisas</h2><p class="op-unid">% dos votos válidos ${info('Votos válidos')}</p></div>
    <div class="sub-abas" role="tablist" aria-label="Como ver as pesquisas">
      <button type="button" role="tab" data-subaba="media" aria-selected="${String(sub === 'media')}">Média</button>
      <button type="button" role="tab" data-subaba="instituto" aria-selected="${String(sub === 'instituto')}">Por instituto</button>
    </div>
    ${sub === 'instituto' ? htmlPorInstituto(d) : htmlMediaSel(d)}
  </section>`;
}

function htmlMediaSel(d) {
  const ordem = arr(d.medias_ordem);
  const k = mediaSelKey(d);
  if (!k) return lacunaBloco('Média das pesquisas: sem dado ainda.');
  const m = d.medias[k];
  const base = obj(d.media) || {};
  const chips = h`<div class="chips" role="radiogroup" aria-label="Qual média">${ordem.map(
    (x) => h`<button type="button" class="chip" role="radio" aria-checked="${String(x === k)}" data-media="${x}">${rotuloCurto(x, d.medias[x])}</button>`,
  )}</div>`;
  const vL = num(m.validos?.lula);
  const vF = num(m.validos?.flavio);
  const fxL = faixa(m.faixa_validos?.lula);
  const fxF = faixa(m.faixa_validos?.flavio);
  const parP = parDe(m.prob_vitoria);
  const coluna = (id, v, fx, ch, dir) => {
    const c = cand(id);
    const quem = h`<span class="placar-quem">${curto(id)}<small>${txt(c.partido) || ''}${num(c.numero) !== null ? ` · ${c.numero}` : ''}</small></span>`;
    return h`<div class="placar-c${dir ? ' dir' : ''}" style="--c:${c.cor}">
        <div class="placar-nome">${dir ? h`${quem}${avatar(id, null, 'av-placar')}` : h`${avatar(id, null, 'av-placar')}${quem}`}</div>
        <div class="placar-num">${v !== null ? h`<span data-anim="${id}" data-v="${v}" data-casas="1">${fNum(v)}</span><small>%</small>` : LAC}</div>
        <div class="placar-faixa">${fx ? `faixa de ${fNum(fx[0])} a ${fNum(fx[1])}` : h`faixa: ${LAC}`}</div>
      </div>`;
  };
  const np = num(m.n_pesquisas) ?? (k === 'ponderada' ? num(base.n_pesquisas) : null);
  const nc = num(m.n_casas) ?? (arr(m.casas).length || null);
  const asOf = fData(m.as_of) || fData(base.as_of);
  const conta = [np !== null ? `${fInt(np)} ${plural(np, 'pesquisa', 'pesquisas')}` : null, nc !== null ? `${fInt(nc)} ${plural(nc, 'casa', 'casas')}` : null]
    .filter(Boolean)
    .join(' de ');
  const casas = k === 'acerto_1t' ? listaNomes(m.casas) : null;
  const mini = ordem.map((x) => {
    const q = d.medias[x];
    const a = num(q.validos?.lula);
    const b = num(q.validos?.flavio);
    return h`<button type="button" class="mq-c" data-media="${x}" aria-pressed="${String(x === k)}" aria-expanded="${String(x === k && st.explicaAberta)}" aria-controls="mq-explica" aria-label="${rotuloCurto(x, q)}: escolher e ver como é feita">
        <span class="mq-i" aria-hidden="true">i</span>
        <span class="mq-rot">${rotuloCurto(x, q)}</span>
        <span class="mq-v"><i class="mc" style="--c:${cand('lula').cor}"></i>${cuNum(`mq-${x}-l`, a)}<span class="mq-x">×</span>${cuNum(`mq-${x}-f`, b)}<i class="mc" style="--c:${cand('flavio').cor}"></i></span>
      </button>`;
  });
  return h`<p class="op-qual">Qual média ${info('Quatro médias')}</p>
    ${chips}
    <p class="op-rot">${txt(m.rotulo) || rotuloCurto(k, m)}</p>
    <div class="placar">${coluna('lula', vL, fxL, parP?.li ?? null, false)}${coluna('flavio', vF, fxF, parP?.fi ?? null, true)}</div>
    ${barraDupla(vL, vF, fxL)}
    <p class="contexto">${conta || h`Pesquisas: ${LAC}`} · depois do 1º turno${asOf ? ` · até ${asOf}` : ''}${casas ? ` · ${casas}` : ''}</p>
    <div class="mq" role="group" aria-label="As médias lado a lado; toque para ver como cada uma é feita">${mini}</div>
    ${st.explicaAberta ? painelExplica(k, m) : ''}
    <p class="fonte">Fonte: pesquisas registradas no TSE (Tribunal Superior Eleitoral); médias calculadas pelo Radar${fDataHora(d.gerado_em) ? ` · gerado em ${fDataHora(d.gerado_em)}` : ''}${creditosFotos() ? ` · Fotos: ${creditosFotos()}` : ''}</p>`;
}

function painelExplica(k, m) {
  const animar = st.animarExplica;
  st.animarExplica = false;
  return h`<div class="mq-explica${animar ? ' abrindo' : ''}" id="mq-explica" role="region" aria-labelledby="mq-explica-tit">
      <div class="mq-explica-cab">
        <p class="mq-explica-tit" id="mq-explica-tit">Como é feita esta média: ${rotuloCurto(k, m)}</p>
        <button type="button" class="mq-fechar" data-acao="fechar-explica" aria-label="Fechar a explicação">×</button>
      </div>
      ${explicacaoSimples(k, m).map((f) => h`<p>${f}</p>`)}
      <p class="mq-chance"><b>Chance de vitória:</b> em quantas de 100 eleições parecidas o candidato venceria, considerando o quanto as pesquisas costumam errar. Não é previsão garantida.</p>
      ${txt(m.nota) ? h`<p class="mq-tec"><b>Detalhe técnico:</b> ${m.nota}</p>` : ''}
    </div>`;
}

function htmlPorInstituto(d) {
  const lista = arr(d.por_instituto)
    .filter((x) => obj(x) && txt(x.casa))
    .sort((a, b) => (msDe(b.data) ?? 0) - (msDe(a.data) ?? 0));
  if (!lista.length) return lacunaBloco('Pesquisas por instituto: sem dado ainda.');
  const somaPeso = lista.reduce((s, x) => s + (num(x.peso_ponderada) ?? 0), 0);
  const pesoTxt = (v) => {
    v = num(v);
    if (v === null) return null;
    return somaPeso > 0.9 && somaPeso < 1.1 ? `${fNum(v * 100, 1)}% do peso da média ponderada` : `peso ${fNum(v, 2)}`;
  };
  const par = (v) => {
    const a = num(v?.lula);
    const b = num(v?.flavio);
    if (a === null && b === null) return LAC;
    return h`<span class="pi-par"><span><i class="mc" style="--c:${cand('lula').cor}"></i>${fNum(a) ?? '—'}</span><span><i class="mc" style="--c:${cand('flavio').cor}"></i>${fNum(b) ?? '—'}</span></span>`;
  };
  const erroTxt = (e) => {
    e = num(e);
    if (e === null) return h`<span class="lac">sem 1º turno</span>`;
    const quem = Math.abs(e) < 0.25 ? 'acertou' : e < 0 ? `subestimou ${curto('flavio')}` : `superestimou ${curto('flavio')}`;
    return h`<b>${fSinal(e)}</b><small>${quem}</small>`;
  };
  const p1 = (v) => {
    if (obj(v)) {
      const partes = [];
      if (fData(v.data)) partes.push(fData(v.data));
      if (txt(v.campo)) partes.push(`campo ${v.campo}`);
      if (txt(v.registro)) partes.push(v.registro);
      if (num(v.flavio_par) !== null) partes.push(`${curto('flavio')} ${fPct(v.flavio_par)} no par`);
      return partes.length ? partes.join(' · ') : null;
    }
    return txt(v);
  };
  return h`<div class="pi">
      <div class="pi-cab" aria-hidden="true"><span>Casa e data</span><span class="n">${curto('lula')} × ${curto('flavio')}</span><span class="n">Erro no 1º turno</span><span class="n">Ajustada</span><span></span></div>
      ${lista.map((x, i) => h`<details class="pi-l" data-k="pi:${x.casa}:${txt(x.data) || i}">
        <summary>
          <span class="pi-casa"><b>${x.casa}</b><small>${ou(fData(x.data))}</small></span>
          <span class="n">${par(x.validos)}</span>
          <span class="n pi-erro">${erroTxt(x.erro_1t_flavio_par_pp)}</span>
          <span class="n">${par(x.validos_ajustados)}</span>
          <span class="chev" aria-hidden="true"></span>
        </summary>
        <dl class="ficha">
          <div><dt>Campo</dt><dd>${ou(txt(x.campo))}</dd></div>
          <div><dt>Amostra</dt><dd>${num(x.amostra) !== null ? `${fInt(x.amostra)} entrevistas` : LAC}</dd></div>
          <div class="larga"><dt>Registro no TSE ${info('Registro no TSE')}</dt><dd>${ou(txt(x.registro))}</dd></div>
          <div class="larga"><dt>Votos totais ${info('Votos totais')}</dt><dd>${obj(x.totais) ? h`${curto('lula')} ${ou(fPub(x.totais.lula))} · ${curto('flavio')} ${ou(fPub(x.totais.flavio))} · brancos e nulos ${ou(fPub(x.totais.branco_nulo))} · indecisos ${ou(fPub(x.totais.indecisos))}` : LAC}</dd></div>
          <div class="larga"><dt>Na média ponderada ${info('Peso')}</dt><dd>${ou(pesoTxt(x.peso_ponderada))}</dd></div>
          <div class="larga"><dt>Pesquisa usada no 1º turno</dt><dd>${ou(p1(x.pesquisa_1t))}</dd></div>
          <div class="larga"><dt>Ajuste aplicado</dt><dd>${num(x.ajuste_aplicado_pp) !== null ? `${fSinal(x.ajuste_aplicado_pp)} ${Math.abs(num(x.ajuste_aplicado_pp)) < 2 ? 'ponto' : 'pontos'} para ${curto('flavio')} no par` : LAC}${txt(x.ajuste_origem) ? ` · origem: ${x.ajuste_origem}` : ''}</dd></div>
          <div class="larga"><dt>Divulgação</dt><dd>${linkExt(x.fonte_url, 'Abrir a fonte da pesquisa ↗') || LAC}</dd></div>
        </dl>
      </details>`)}
    </div>
    <p class="fonte">Fonte: registro de cada pesquisa no TSE e divulgação das casas; erro no 1º turno contra o resultado oficial do TSE</p>`;
}

function blocoTriangulacao() {
  return h`<section class="bloco heroi-bloco tri" id="sec-tri">
    <h2 class="titulo-heroi">Chance de vitória ${info('Chance de vitória')}</h2>
    <div data-tri>${htmlTriangulacao()}</div>
  </section>`;
}

// Cabeçalho de coluna com a foto pequena e o nome.
const cabecalhoCand = (id) => h`<th class="n"><span class="th-cand">${avatar(id, 22)}<span>${curto(id)}</span></span></th>`;

function htmlTriangulacao() {
  const d = st.dados;
  const k = mediaSelKey(d);
  const m = k ? d.medias[k] : null;
  const parP = parDe(m?.prob_vitoria);
  const fontes = arr(st.merc?.fontes).filter(obj);
  const fonte = (id) => fontes.find((f) => f.id === id);
  const merc = (id, quem) => {
    if (st.mod === undefined) return '…';
    const f = fonte(id);
    if (!f || f.status === 'erro') return '—';
    return fChance(parMercado(f), quem) ?? '—';
  };
  const estado = (id) => {
    const f = fonte(id);
    if (!f) return null;
    if (f.status === 'erro') return 'indisponível';
    if (f.origem === 'ao_vivo') return 'ao vivo';
    if (f.origem === 'vivo-15s') return `quase ao vivo ${fHoraSeg(f.atualizado_em) || ''}`.trim();
    return `snapshot ${fQuando(f.atualizado_em) || ''}`.trim();
  };
  const linha = (nome, sub, vL, vF, forte) =>
    h`<tr${forte ? cru(' class="tri-forte"') : ''}><td>${nome}${sub ? h`<small>${sub}</small>` : ''}</td><td class="n">${vL}</td><td class="n">${vF}</td></tr>`;
  return h`<table class="tab tri-tab">
      <thead><tr><th style="width:44%">Fonte</th>${cabecalhoCand('lula')}${cabecalhoCand('flavio')}</tr></thead>
      <tbody>
        ${linha('Pesquisas', m ? rotuloCurto(k, m).toLowerCase() : 'sem dado', parP ? cuNum('tri-l', parP.li, 0, '%') : LAC, parP ? cuNum('tri-f', parP.fi, 0, '%') : LAC, true)}
        ${linha('Polymarket', estado('polymarket'), merc('polymarket', 'lula'), merc('polymarket', 'flavio'))}
        ${linha('Kalshi', estado('kalshi'), merc('kalshi', 'lula'), merc('kalshi', 'flavio'))}
      </tbody>
    </table>
    <p class="nota">Pesquisas: ${m ? rotuloCurto(k, m).toLowerCase() : 'sem dado'} (modelo do Radar). Mercados estrangeiros; preço é informativo, não é convite a apostar. ${st.mod === null ? 'Mercados indisponíveis agora. ' : ''}Chance dos mercados normalizada para somar 100% entre os dois ${info('Chance normalizada')}</p>
    <p class="ver-mais"><a href="#mercados">Ver mercados e gráfico →</a></p>`;
}

function acharNo1T(lista, id) {
  return (
    lista.find((c) => c.id === id) ||
    lista.find((c) => !c.id && norm(c.nome).includes(id === 'lula' ? 'lula' : 'flavio')) ||
    null
  );
}

const creditosFotos = () =>
  ['lula', 'flavio']
    .map((id) => txt(cand(id).foto_credito))
    .filter(Boolean)
    .join('; ');

function blocoPrimeiroTurno(d) {
  const t = obj(d.primeiro_turno);
  const tit = h`<div class="op-cab"><h2 class="sobre pt-tit">Como terminou o 1º turno</h2><p class="op-unid">${fData(t?.data) ? `${fData(t.data)} · ` : ''}votos válidos · resultado oficial</p></div>`;
  if (!t) return h`<section class="bloco heroi-bloco" id="sec-1turno">${tit}${lacunaBloco('Resultado oficial do 1º turno: sem dado ainda.')}</section>`;
  const lista = arr(t.candidatos).filter(obj);
  const res = { lula: acharNo1T(lista, 'lula'), flavio: acharNo1T(lista, 'flavio') };
  const cartoes = ['lula', 'flavio'].map((id) => {
    const c = cand(id);
    const r = res[id];
    const ext = nomePartido(c.partido);
    return h`<article class="pt-c" style="--c:${c.cor}">
      ${foto(c)}
      <p class="pt-nome">${c.nome}</p>
      <p class="pt-part"><b>${ou(txt(c.partido))}${num(c.numero) !== null ? ` · ${c.numero}` : ''}</b>${ext ? h`<small>${ext}</small>` : ''}</p>
      <p class="pt-pct">${num(r?.validos_pct) !== null ? h`${fNum(r.validos_pct, 2)}<small>%</small>` : LAC}</p>
      <p class="pt-votos">${num(r?.votos) !== null ? `${fInt(r.votos)} votos` : LAC}</p>
    </article>`;
  });
  const finalistas = new Set(Object.values(res).filter(Boolean));
  const outros = lista.filter((c) => !finalistas.has(c));
  const somaOutros = outros.reduce((s, c) => s + (num(c.validos_pct) ?? 0), 0);
  const pL = num(res.lula?.validos_pct);
  const pF = num(res.flavio?.validos_pct);
  let barra = '';
  let frase = '';
  if (pL !== null && pF !== null) {
    const resto = Math.max(0, 100 - pL - pF);
    barra = h`<div class="barra pt-barra" role="img" aria-label="${curto('lula')} ${fPct(pL, 2)}, outros ${fPct(resto, 1)}, ${curto('flavio')} ${fPct(pF, 2)}">
        <span class="seg" style="--c:${cand('lula').cor};flex:${pctCss(pL)} 1 0px"></span>${resto > 0.05 ? h`<span class="seg pt-outros" style="flex:${pctCss(resto)} 1 0px"></span>` : ''}<span class="seg" style="--c:${cand('flavio').cor};flex:${pctCss(pF)} 1 0px"></span>
      </div>
      <div class="barra-leg"><span>${curto('lula')}</span><span>outros ${fPct(resto, 1)}</span><span>${curto('flavio')}</span></div>`;
    const lid = pF > pL ? 'flavio' : pL > pF ? 'lula' : null;
    const outro = lid === 'flavio' ? 'lula' : 'flavio';
    const dv = num(t.diferenca_votos) ?? (num(res.lula?.votos) !== null && num(res.flavio?.votos) !== null ? Math.abs(res.lula.votos - res.flavio.votos) : null);
    const dpp = Math.abs(pF - pL);
    frase = lid
      ? h`<b>${cand(lid).nome}</b> terminou <b>${fNum(dpp, 1)} ${dpp < 2 ? 'ponto' : 'pontos'}</b> à frente de ${curto(outro)}${dv !== null ? h` (<b>${fGrande(dv)}</b> de votos)` : ''}.`
      : h`Os dois terminaram empatados.`;
    if (outros.length) frase = h`${frase} ${outros.length === 1 ? 'O outro candidato somou' : `Os outros ${outros.length} candidatos somaram`} <b>${fPct(somaOutros, 1)}</b>.`;
  }
  const fonteRot = expandirFonte(t.fonte);
  const fonte = linkExt(t.fonte_url, fonteRot) || fonteRot;
  const secoes = num(t.secoes_totalizadas_pct);
  const creditos = ['lula', 'flavio'].map((id) => txt(cand(id).foto_credito)).filter(Boolean);
  return h`<section class="bloco heroi-bloco pt" id="sec-1turno">
    ${tit}
    <div class="pt-duelo">${cartoes}</div>
    ${barra}
    ${frase ? h`<p class="pt-frase">${frase}</p>` : ''}
    <p class="pt-abst">Abstenção: <b>${ou(fPct(t.abstencao_pct, 2))}</b> do eleitorado ${info('Abstenção')}${num(t.brancos_pct) !== null || num(t.nulos_pct) !== null ? h` · brancos ${ou(fPct(t.brancos_pct, 2))} e nulos ${ou(fPct(t.nulos_pct, 2))} de quem votou` : ''}</p>
    <details class="mais" data-k="1t-todos">
      <summary>Ver todos os candidatos e os estados</summary>
      <div class="mais-corpo">
        <h3 class="sub">Todos os candidatos, em % dos votos válidos</h3>
        <div class="graf" data-grafico="barras1t" role="img" aria-label="Barras com o resultado do 1º turno por candidato"></div>
        ${siglasHtml(lista)}
        <details class="mais" data-k="1t-tabela"><summary>Ver em tabela</summary>${tabela1T(lista)}</details>
        <h3 class="sub">Por estado ${info('UF')}</h3>
        ${tabelaUF(t)}
      </div>
    </details>
    <p class="fonte">Fonte: ${fonte}${secoes !== null ? `, ${fNum(secoes, secoes === 100 ? 0 : 2)}% das seções totalizadas` : ''}${fDataHora(t.atualizado_em) ? ` · atualizado em ${fDataHora(t.atualizado_em)}` : ''}${creditos.length ? ` · Fotos: ${creditos.join('; ')}` : ''}</p>
  </section>`;
}

function siglasHtml(lista) {
  const vistas = new Map();
  for (const c of lista) {
    const s = txt(c.partido);
    const nome = nomePartido(s);
    if (s && nome && norm(nome) !== norm(s) && !vistas.has(s)) vistas.set(s, nome);
  }
  if (!vistas.size) return '';
  return h`<p class="siglas">Siglas: ${[...vistas.entries()].map(([s, n], i) => h`${i ? ' · ' : ''}<b>${s}</b> ${n}`)}</p>`;
}

function tabela1T(lista) {
  const l = [...lista].sort((a, b) => (num(b.validos_pct) ?? -1) - (num(a.validos_pct) ?? -1));
  if (!l.length) return lacunaBloco('Votos por candidato no 1º turno: sem dado ainda.');
  return h`<div class="tab-wrap"><table class="tab">
    <thead><tr><th style="width:36%">Candidato</th><th>Partido</th><th class="n" style="width:20%">% válidos</th><th class="n" style="width:24%">Votos</th></tr></thead>
    <tbody>${l.map(
      (c) => h`<tr><td>${ou(txt(c.nome))}</td><td>${ou(txt(c.partido))}${nomePartido(c.partido) ? h`<small>${nomePartido(c.partido)}</small>` : ''}</td><td class="n">${ou(fPct(c.validos_pct))}</td><td class="n">${ou(fInt(c.votos))}</td></tr>`,
    )}</tbody></table></div>`;
}

function tabelaUF(t) {
  const linhas = arr(t.por_uf)
    .filter(obj)
    .filter((u) => txt(u.uf))
    .sort((a, b) => String(a.uf).localeCompare(String(b.uf), 'pt-BR'));
  if (!linhas.length) return lacunaBloco('Resultado por estado: sem dado ainda.');
  return h`<div class="tab-wrap"><table class="tab">
    <thead><tr><th style="width:18%">UF</th><th class="n">${curto('lula')}</th><th class="n">${curto('flavio')}</th><th class="n">Abstenção</th></tr></thead>
    <tbody>${linhas.map((u) => {
      const l = num(u.lula);
      const f = num(u.flavio);
      return h`<tr><td>${u.uf}</td><td class="n${l !== null && f !== null && l > f ? ' vence' : ''}">${ou(fPct(l))}</td><td class="n${l !== null && f !== null && f > l ? ' vence' : ''}">${ou(fPct(f))}</td><td class="n">${ou(fPct(u.abstencao_pct))}</td></tr>`;
    })}</tbody>
    <caption>${curto('lula')} e ${curto('flavio')} em % dos votos válidos no 1º turno; abstenção em % do eleitorado do estado. Em negrito, quem dos dois teve mais votos no estado.</caption>
  </table></div>`;
}

function blocoManchete(d) {
  const m = txt(d.manchete);
  const avisos = arr(d.avisos).filter(txt);
  let corpo;
  if (!m) {
    corpo = h`<p class="manchete-txt"><b>Em uma frase:</b> ${LAC}</p>`;
  } else {
    const r = /^(\s*(?:EXEMPLO\s*[:·—–-]?\s*)?Em uma frase:)\s*/i.exec(m);
    corpo = r ? h`<p class="manchete-txt"><b>${r[1].trim()}</b> ${m.slice(r[0].length)}</p>` : h`<p class="manchete-txt">${m}</p>`;
  }
  return h`<section class="manchete" id="sec-manchete">
    ${corpo}
    ${avisos.length ? h`<p class="avisos-mini"><a href="#metodo" data-ir="avisos">${avisos.length === 1 ? '1 aviso' : `${avisos.length} avisos`} sobre os dados →</a></p>` : ''}
    <p class="fonte">Radar Eleitoral${fDataHora(d.gerado_em) ? ` · gerado em ${fDataHora(d.gerado_em)}` : ''}</p>
  </section>`;
}

function barraDupla(vL, vF, fxL) {
  const L = cand('lula');
  const F = cand('flavio');
  if (vL === null && vF === null) return '';
  let a = vL ?? 100 - vF;
  let b = vF ?? 100 - vL;
  const tot = a + b;
  if (tot > 0) {
    a = (a / tot) * 100;
    b = (b / tot) * 100;
  }
  const banda = fxL
    ? h`<span class="banda" style="left:${pctCss(fxL[0])}%;width:${pctCss(fxL[1] - fxL[0])}%"></span>`
    : '';
  return h`<div class="barra" role="img" aria-label="${L.nome} ${fPct(vL) || 'sem dado'}, ${F.nome} ${fPct(vF) || 'sem dado'} dos votos válidos">
      <span class="seg" data-seg="lula" style="--c:${L.cor};flex:${pctCss(a)} 1 0px"></span><span class="seg" data-seg="flavio" style="--c:${F.cor};flex:${pctCss(b)} 1 0px"></span>${banda}<span class="meio"></span>
    </div>
    <div class="barra-leg"><span>← ${curto('lula')}</span><span>50%</span><span>${curto('flavio')} →</span></div>`;
}


// A projeção contada para leigo: de cada 100 eleitores, por que a abstenção
// sai daquele tamanho e quando ela muda o resultado. Os números vêm prontos
// do JSON (projecao.explicacao); aqui só se desenha.
const COR_FALTA = '#3a404c';
const COR_BN = '#6b7280';

function cemEleitores(e) {
  const c = obj(e?.de_cada_100);
  if (!c) return '';
  const ex = obj(e.de_cada_100_exato) || {};
  const ordem = [
    ['lula', `votam em ${curto('lula')}`, cand('lula').cor],
    ['flavio', `votam em ${curto('flavio')}`, cand('flavio').cor],
    ['branco_nulo', 'votam em branco ou anulam', COR_BN],
    ['nao_votam', 'não vão votar', COR_FALTA],
  ];
  const n = ordem.map(([k]) => Math.max(0, Math.round(num(c[k]) ?? 0)));
  if (n.reduce((a, b) => a + b, 0) !== 100) return '';
  const pontos = ordem.map(([k, , cor], i) => Array.from({ length: n[i] }, () => `<i style="--c:${cor}"></i>`).join('')).join('');
  const rot = ordem.map(([k, nome], i) => `${n[i]} ${nome}`).join(', ');
  return h`<div class="cem">
      <p class="cem-tit">De cada 100 eleitores, no domingo</p>
      <div class="cem-pontos" role="img" aria-label="De cada 100 eleitores: ${rot}">${cru(pontos)}</div>
      <ul class="cem-leg">${ordem.map(([k, nome, cor], i) => h`<li><i style="--c:${cor}"></i><b>${n[i]}</b> ${nome}${num(ex[k]) !== null && Math.abs(num(ex[k]) - n[i]) >= 0.05 ? h` <small>(${fNum(ex[k])})</small>` : ''}</li>`)}</ul>
    </div>`;
}

const listaOu = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join('; ')} ou ${xs[xs.length - 1]}`);

// Abstenção estado a estado (projecao.cenarios_uf, calculado em build_pocket.py): a tabela com
// a mudança de cada eleição desde 2002 e o simulador por região, refeito no navegador.
function contaAbstencao(cu, extraNNE, extraSul) {
  let val = 0;
  let lula = 0;
  let elei = 0;
  let falta = 0;
  for (const u of arr(cu?.ufs).filter(obj)) {
    const ex = u.regiao === 'N' || u.regiao === 'NE' ? extraNNE : extraSul;
    const ab = Math.min(95, Math.max(0, num(u.abst_base) + ex));
    const v = num(u.eleitorado) * (1 - ab / 100) * (1 - num(u.bn) / 100);
    val += v;
    lula += (v * num(u.lula_par)) / 100;
    elei += num(u.eleitorado);
    falta += (num(u.eleitorado) * ab) / 100;
  }
  if (!val) return null;
  return { abst: (100 * falta) / elei, lula: (100 * lula) / val, flavio: 100 - (100 * lula) / val, margem: val - 2 * lula };
}

function htmlSimAbst(cu, nne, sul) {
  const r = contaAbstencao(cu, nne, sul);
  const c = obj(cu?.centro);
  if (!r) return '';
  const lid = r.flavio >= r.lula ? 'flavio' : 'lula';
  const dl = c ? r.lula - num(c.lula) : null;
  return h`<p class="sim-ab-res"><b>${curto('lula')} ${fNum(r.lula, 2)}% × ${curto('flavio')} ${fNum(r.flavio, 2)}%</b> · ${curto(lid)} à frente por ${fGrande(Math.abs(r.margem))} de votos · abstenção total de ${fPct(r.abst, 1)}${dl !== null && Math.abs(dl) >= 0.005 ? ` · ${fSinal(dl * 1)} ${Math.abs(dl) < 2 ? 'ponto' : 'pontos'} para ${curto('lula')} em relação ao centro` : ''}</p>`;
}

function cenariosEstado(p) {
  const cu = obj(p?.cenarios_uf);
  if (!cu || !arr(cu.ufs).length) return '';
  const c = obj(cu.centro);
  const anos = arr(cu.anos).filter(obj);
  const linha = (rot, r, destaque) => {
    const lid = num(r.flavio) >= num(r.lula) ? 'flavio' : 'lula';
    return h`<tr class="${destaque ? 'destaque' : ''}"><td>${rot}</td><td class="n">${ou(fPct(r.abstencao_pct, 1))}</td><td class="n">${fNum(r.lula, 1)} × ${fNum(r.flavio, 1)}</td><td class="n">${curto(lid)} +${fGrande(Math.abs(num(r.margem_votos)))}</td></tr>`;
  };
  const amplitude = anos.length ? Math.max(...anos.map((a) => num(a.lula))) - Math.min(...anos.map((a) => num(a.lula))) : null;
  return h`<div class="cen-uf">
      <p class="cem-tit">Estado a estado: e se a abstenção mudar como em outras eleições?</p>
      <p class="porque-txt">Cada estado parte da falta que teve no 1º turno de 2026 e soma a mudança que teve entre os turnos em cada eleição desde 2002. A preferência de cada estado fica igual; só muda quem vai votar.</p>
      <div class="tab-wrap"><table class="tab">
        <thead><tr><th style="width:30%">Se mudar como em</th><th class="n">Abstenção</th><th class="n">${curto('lula')} × ${curto('flavio')}</th><th class="n">Diferença</th></tr></thead>
        <tbody>${c ? linha('Média de 2002 a 2022', c, true) : ''}${anos.map((a) => linha(String(a.ano), a, false))}</tbody>
        <caption>% dos votos válidos, Brasil sem o exterior. Diferença em votos.</caption>
      </table></div>
      ${amplitude !== null ? h`<p class="porque-txt">Entre o melhor e o pior desses cenários, ${curto('lula')} varia só <b>${fNum(amplitude, 2)} ponto</b>. Faltar mais gente numa região mexe pouco; o que vira o jogo é faltar mais eleitor de um dos candidatos, em qualquer lugar.</p>` : ''}
      <p class="cem-tit">Simule: e se faltar mais gente numa região?</p>
      <div class="sim-ab" data-sim-ab>
        <label>Norte e Nordeste <output data-sim-ab-v="nne">0 ponto</output>
          <input type="range" min="-5" max="5" step="0.5" value="0" data-sim-ab-in="nne" aria-label="Abstenção extra no Norte e Nordeste, em pontos" /></label>
        <label>Sul, Sudeste e Centro-Oeste <output data-sim-ab-v="sul">0 ponto</output>
          <input type="range" min="-5" max="5" step="0.5" value="0" data-sim-ab-in="sul" aria-label="Abstenção extra no Sul, Sudeste e Centro-Oeste, em pontos" /></label>
        <div data-sim-ab-res>${htmlSimAbst(cu, 0, 0)}</div>
      </div>
      <p class="fonte">Abstenção por estado: TSE (1º turno de 2026 e 2º turnos de 2002 a 2022); preferência por estado: prévia do Radar.</p>
    </div>`;
}

// Cartão 1: por que ~23 em cada 100 vão faltar (a conta do 1º turno mais a alta de costume, numa linha).
function cartaoFalta(e, p) {
  const t1 = num(e?.t1_2026);
  const ab = num(p.abstencao_estimada_pct);
  const dl = num(p.base_abstencao?.delta_medio_t1_t2_pp);
  const faltam = num(e?.de_cada_100?.nao_votam) ?? (ab !== null ? Math.round(ab) : null);
  if (t1 === null || ab === null || dl === null || faltam === null) return '';
  const subiu = num(e?.subiu_em);
  const total = num(e?.eleicoes);
  return h`<article class="proj-card">
      <h3 class="proj-tit">Por que ~${fInt(faltam)} em cada 100 vão faltar</h3>
      <p>No 1º turno faltaram <b>${fNum(t1)}%</b> dos eleitores. No 2º turno a falta costuma subir um pouco (<b>${fSinal(dl)} ponto</b> em média${subiu !== null && total !== null ? `; subiu em ${fInt(subiu)} das ${fInt(total)} eleições desde 2002` : ''}). A conta: <b>${fNum(t1)} + ${fNum(Math.abs(dl))} = ${fNum(ab)}%</b>.</p>
    </article>`;
}

// Cartão 2: isso muda quem ganha? Só se um lado faltar mais que o outro (o número vem de explicacao.virada).
function mudaResultado(p, e) {
  const v = obj(e?.virada);
  const casa = obj(v?.ficam_em_casa_de_cada_100);
  const quem = v?.quem_vira;
  const falta = v?.quem_falta_mais;
  const dif = num(v?.diferenca);
  const pode = casa && quem && falta && num(casa[falta]) !== null && num(casa[quem]) !== null;
  return h`<article class="proj-card">
      <h3 class="proj-tit">Isso muda quem ganha?</h3>
      ${pode
        ? h`<p><b>Só se um lado faltar mais que o outro.</b> ${curto(quem)} passaria à frente se ficassem em casa <b>${fNum(casa[falta])}</b> de cada 100 eleitores de ${curto(falta)} e só <b>${fNum(casa[quem])}</b> de cada 100 de ${curto(quem)}${dif !== null ? h` (<b>${fNum(dif)} ${dif < 2 ? 'ponto' : 'pontos'}</b> de diferença)` : ''}. Faltar igual dos dois lados não muda o placar.</p>`
        : h`<p>${ou(txt(p.virada?.texto))}</p>`}
    </article>`;
}

// Fora da abstenção: o outro risco é as pesquisas errarem como erraram no 1º turno.
function outroRisco(p) {
  const cen = arr(p.cenarios).filter(obj);
  const centro = cen.find((c) => c.central) || cen[1];
  const outro = cen.find((c) => centro && num(c.validos?.lula) !== num(centro.validos?.lula));
  if (!outro) return '';
  return h`<p class="porque-txt"><b>Outro risco, que não é abstenção:</b> se cada instituto errar como errou no 1º turno, o placar vai a ${curto('lula')} ${fPct(outro.validos?.lula)} × ${curto('flavio')} ${fPct(outro.validos?.flavio)}.</p>`;
}

// Cartão 3: chuva e locomoção no domingo (projecao.clima; sem ele o cartão some).
const LIMITE_CHUVA_MM = 2; // abaixo disso a região não entra na lista "vai chover"
const LIMITE_EFEITO_PP = 0.1; // abaixo disso o efeito no placar vira "praticamente nada"
function quandoClima(c) {
  const t = txt(c.previsao_para);
  if (!t) return 'o domingo da eleição';
  return t.replace(/^(\d{4})-(\d{2})-(\d{2})/, (_, a, m, d) => `${d}/${m}`);
}
function tabelaRegioesClima(regs) {
  return h`<div class="tab-wrap"><table class="tab clima-tab">
      <thead><tr><th style="width:36%">Região</th><th class="n">Chuva</th><th class="n">Chance de chuva</th><th class="n">Falta extra (pontos)</th></tr></thead>
      <tbody>${regs.map((r) => h`<tr><td>${r.nome}</td><td class="n">${ou(num(r.chuva_mm) !== null ? `${fNum(r.chuva_mm)} mm` : null)}</td><td class="n">${ou(num(r.prob_chuva_pct) !== null ? `${fInt(r.prob_chuva_pct)}%` : null)}</td><td class="n">${ou(num(r.abst_extra_pp) !== null ? fSinal2(r.abst_extra_pp) : null)}</td></tr>`)}</tbody>
    </table></div>`;
}
function cartaoClima(p) {
  const c = obj(p.clima);
  if (!c) return '';
  const regs = arr(c.regioes).filter((r) => obj(r) && txt(r.nome) && num(r.chuva_mm) !== null);
  const ef = num(c.efeito_abstencao_pp);
  const efL = num(c.efeito_lula_par_pp);
  if (!regs.length && ef === null) return '';
  const chove = regs.filter((r) => num(r.chuva_mm) >= LIMITE_CHUVA_MM).sort((a, b) => num(b.chuva_mm) - num(a.chuva_mm));
  const secas = regs.filter((r) => num(r.chuva_mm) < LIMITE_CHUVA_MM).map((r) => r.nome);
  const pequeno = efL !== null && Math.abs(efL) < LIMITE_EFEITO_PP;
  return h`<article class="proj-card">
      <h3 class="proj-tit">Chuva e locomoção no domingo</h3>
      ${chove.length
        ? h`${tabelaRegioesClima(chove)}${secas.length ? h`<p class="proj-nota">Chuva fraca ou nenhuma em ${listaNomes(secas)}.</p>` : ''}`
        : h`<p>Sem chuva relevante prevista (mais de ${fInt(LIMITE_CHUVA_MM)} mm) em nenhuma região.</p>`}
      ${ef !== null || efL !== null
        ? h`<p class="proj-efeito">Somando o país${ef !== null ? h`, a chuva muda a falta em <b>${fSinal2(ef)} ponto</b>` : ''}${efL !== null ? h`${ef !== null ? ' e' : ', a chuva muda'} a parte de ${curto('lula')} nos votos válidos em <b>${fSinal2(efL)} ponto</b>` : ''}${pequeno ? ': praticamente nada' : ''}.</p>`
        : ''}
      <p class="proj-nota">Previsão para ${quandoClima(c)}${txt(c.fonte) ? ` · ${c.fonte.split(',')[0]}` : ''}.</p>
    </article>`;
}
// Dentro do bloco recolhido: todas as regiões, a frase pronta e como o efeito foi medido.
function detalheClima(p) {
  const c = obj(p.clima);
  if (!c) return '';
  const regs = arr(c.regioes).filter((r) => obj(r) && txt(r.nome));
  return h`<p class="cem-tit">Chuva no domingo: como foi medida</p>
    ${regs.length ? tabelaRegioesClima(regs) : ''}
    ${txt(c.frase) ? h`<p class="porque-txt">${c.frase}</p>` : ''}
    ${txt(c.evidencia) ? h`<p class="porque-txt">${c.evidencia}</p>` : ''}
    <p class="fonte">${txt(c.fonte) ? `Fonte: ${c.fonte}` : ''}${fDataHora(c.coletado_em) ? ` · coletado em ${fDataHora(c.coletado_em)}` : ''}</p>`;
}

// Quanto a falta mudou do 1º para o 2º turno em cada eleição (barras), para quem quiser ver o histórico.
function historicoFalta(e, p) {
  const hist = arr(e?.historico).filter((r) => obj(r) && num(r.variacao) !== null);
  if (!hist.length) return '';
  const max = Math.max(...hist.map((r) => Math.abs(num(r.variacao))), 0.1);
  const fx = faixa(p.abstencao_faixa_pct);
  return h`<p class="cem-tit">Como a falta mudou em cada eleição</p>
    <p class="porque-txt">Pontos percentuais a mais (ou a menos) de eleitores faltando no 2º turno, comparado ao 1º.</p>
    <ul class="hist-abst">${hist.map((r) => {
      const v = num(r.variacao);
      return h`<li><span>${r.ano}</span><span class="trilho"><span class="${v < 0 ? 'neg' : ''}" style="width:${((Math.abs(v) / max) * 100).toFixed(1)}%"></span></span><b>${fSinal(v)}</b>${v < 0 ? h`<small>caiu</small>` : ''}</li>`;
    })}</ul>
    ${fx ? h`<p class="porque-txt">Por isso a previsão vai de ${fPct(fx[0])} (se cair como em 2022) a ${fPct(fx[1])} (se subir como em 2010, a maior alta).</p>` : ''}`;
}

function blocoProjecao(d) {
  const p = obj(d.projecao);
  const tit = h`<h2 class="sobre">Nível de abstenção</h2>`;
  if (!p) return h`<section class="bloco" id="sec-projecao">${tit}${lacunaBloco('Abstenção: sem dado ainda.')}</section>`;
  const e = obj(p.explicacao);
  const vL = num(p.votos?.lula);
  const vF = num(p.votos?.flavio);
  const coluna = (id, v, dir) => {
    const c = cand(id);
    return h`<div class="votos-c${dir ? ' dir' : ''}" style="--c:${c.cor}">
        <div class="placar-nome"><i class="mc"></i>${curto(id)}</div>
        <div class="votos-num">${v !== null ? fMilhoes(v) : LAC}</div>
        <div class="votos-rot">milhões de votos</div>
      </div>`;
  };
  const lider =
    p.lider === 'lula' || p.lider === 'flavio' ? p.lider : vL !== null && vF !== null ? (vL >= vF ? 'lula' : 'flavio') : null;
  const mg = num(p.margem_votos) ?? (vL !== null && vF !== null ? Math.abs(vL - vF) : null);
  const ab = num(p.abstencao_estimada_pct);
  const t1 = num(e?.t1_2026) ?? num(p.base_abstencao?.t1_2026_pct) ?? num(d.primeiro_turno?.abstencao_pct);
  const med = num(p.base_abstencao?.media_t2_2002_2022_pct);
  const fx = faixa(p.abstencao_faixa_pct);
  const tile = (chave, rot, v, sub) =>
    h`<div class="ab-tile ab-${chave}"><span class="ab-rot">${rot}</span><b>${v !== null ? cuNum(`ab-${chave}`, v, 1, '%') : LAC}</b>${sub ? h`<small>${sub}</small>` : ''}</div>`;
  return h`<section class="bloco" id="sec-projecao">
    ${tit}
    <div class="ab-tiles">
      ${tile('t1', `1º turno${fData(d.primeiro_turno?.data) ? `, ${fData(d.primeiro_turno.data)}` : ''}`, t1, 'faltaram')}
      ${tile('prev', 'Previsão para domingo', ab, fx ? `de ${fPct(fx[0])} a ${fPct(fx[1])}` : '')}
      ${tile('hist', '2º turnos de 2002 a 2022', med, 'média')}
    </div>
    <div class="ab-duo">
      ${cemEleitores(e)}
      ${barrasFalta(e)}
    </div>
    <div class="proj-cards">${mudaResultado(p, e)}</div>
    <details class="mais" data-k="cenarios-abst">
      <summary>Cenários de abstenção</summary>
      <div class="mais-corpo">
        <p class="cem-tit">Em votos, na previsão do meio</p>
        <div class="votos-duelo">${coluna('lula', vL, false)}${coluna('flavio', vF, true)}</div>
        <p class="linha-forte">Diferença: <b>${mg !== null ? `${fGrande(mg)} de votos` : LAC}</b>${lider && mg !== null ? ` (${curto(lider)} à frente)` : ''}</p>
        ${cenariosEstado(p)}
        <p class="cem-tit">Cenários em votos</p>
        ${tabelaCenarios(p, ab)}
      </div>
    </details>
  </section>`;
}

// Quanto a abstenção mudou do 1º para o 2º turno em cada eleição desde 2002, em barras.
function barrasFalta(e) {
  const hist = arr(e?.historico).filter((r) => obj(r) && num(r.variacao) !== null);
  if (!hist.length) return '';
  const max = Math.max(...hist.map((r) => Math.abs(num(r.variacao))), 0.1);
  return h`<div class="ab-hist">
      <p class="cem-tit">Do 1º para o 2º turno, em pontos</p>
      <ul class="hist-abst">${hist.map((r, i) => {
        const v = num(r.variacao);
        return h`<li style="--i:${i}"><span>${r.ano}</span><span class="trilho"><span class="${v < 0 ? 'neg' : ''}" style="width:${((Math.abs(v) / max) * 100).toFixed(1)}%"></span></span><b>${fSinal(v)}</b></li>`;
      })}</ul>
    </div>`;
}

function tabelaCenarios(p, ab) {
  const cen = arr(p.cenarios).filter(obj);
  if (!cen.length) return lacunaBloco('Cenários de abstenção: sem dado ainda.');
  let temCentral = false;
  const linhas = cen.map((c) => {
    const lv = num(c.votos?.lula);
    const fv = num(c.votos?.flavio);
    const ca = num(c.abstencao_pct);
    const central = c.central === true || (ab !== null && ca !== null && Math.abs(ca - ab) < 0.05 && !temCentral && c.central === undefined);
    if (central) temCentral = true;
    const cel = (v, pct, vence) =>
      h`<td class="n${vence ? ' vence' : ''}">${v !== null ? fMilhoes(v) : LAC}<small>${pct !== null ? fPct(pct) : 'sem dado'}</small></td>`;
    const nome = central ? 'Previsão do meio' : txt(c.nome);
    return h`<tr class="${central ? 'destaque' : ''}"><td>${ou(nome)}</td><td class="n">${ou(fPct(ca))}</td>${cel(lv, num(c.validos?.lula), lv !== null && fv !== null && lv > fv)}${cel(fv, num(c.validos?.flavio), lv !== null && fv !== null && fv > lv)}</tr>`;
  });
  return h`<div class="tab-wrap"><table class="tab">
    <thead><tr><th style="width:39%">Cenário</th><th class="n" style="width:21%">Abstenção</th><th class="n">${curto('lula')}</th><th class="n">${curto('flavio')}</th></tr></thead>
    <tbody>${linhas}</tbody>
    <caption>Votos em milhões; embaixo, a % dos votos válidos. Em negrito, quem fica à frente no cenário${temCentral ? '; com fundo, a previsão do meio' : ''}.</caption>
  </table></div>`;
}

function blocoMercadosResumo() {
  return h`<section class="bloco" id="sec-mercados-resumo">
    <h2 class="sobre">Mercados de previsão ao vivo ${info('Mercado de previsão')}</h2>
    <div data-merc="resumo">${htmlMercados('resumo')}</div>
    <div data-merc-aviso>${avisoBloqueioMerc()}</div>
  </section>`;
}

/* ------------------------------------------------------ mercados (html) */

function htmlMercados(variante) {
  if (st.mod === undefined) return h`<p class="estado">Carregando os mercados…</p>`;
  if (st.mod === null) {
    return lacunaBloco('Mercados indisponíveis agora: o módulo de leitura não carregou. A página tenta de novo sozinha a cada 5 minutos.');
  }
  const fontes = arr(st.merc?.fontes).filter(obj);
  if (!fontes.length) {
    return st.mercErro
      ? lacunaBloco(`Mercados indisponíveis agora (${st.mercErro}). Nova tentativa em 1 minuto.`)
      : h`<p class="estado">Lendo os mercados…</p>`;
  }
  return h`<div class="mercs">${fontes.map((f) => cartaoMercado(f, variante))}</div>
`;
}

function statusMercado(f) {
  const quando = f.atualizado_em || st.merc?.atualizado_em;
  if (f.status === 'erro') return h`<span class="merc-st"><i class="ponto-erro"></i>indisponível</span>`;
  if (f.origem === 'ao_vivo') {
    return h`<span class="merc-st" title="Lido direto na bolsa"><i class="pulso"></i>ao vivo · ${fHora(quando) || 'agora'}</span>`;
  }
  if (f.origem === 'vivo-15s') {
    return h`<span class="merc-st" title="O Radar lê a bolsa a cada 15 segundos e manda para cá; a hora é a da leitura"><i class="pulso"></i>quase ao vivo · ${fHoraSeg(quando) || 'agora'}</span>`;
  }
  return h`<span class="merc-st"><i class="ponto-snap"></i>snapshot de ${ou(fQuando(quando))}</span>`;
}

function volumeTexto(f) {
  const v = num(f.volume_usd);
  if (v === null) return null;
  if (f.id === 'kalshi') return `${fGrande(v)} de contratos de US$ 1 negociados`;
  return `${fDolar(v)} negociados`;
}

function cartaoMercado(f, variante) {
  const nome = txt(f.nome) || txt(f.id) || 'Mercado';
  const ok = f.status !== 'erro';
  // O que vai para a tela como chance é o par normalizado (soma 100%); o preço de cada lado
  // (compra, venda, último) segue como veio, na tabela do cartão completo.
  const par = ok ? parMercado(f) : null;
  const linhas = ['lula', 'flavio'].map((id) => {
    const bruto = num(f.candidatos?.[id]?.prob);
    const txtChance = par ? fChance(par, id) : ok && bruto !== null ? fProb(bruto) : null;
    return h`<div class="merc-linha"><span class="merc-cand">${avatar(id, 24)}${curto(id)}</span><span class="merc-num">${ok && txtChance !== null ? txtChance : LAC}</span></div>`;
  });
  let barra = '';
  if (par) {
    barra = h`<div class="barra fina" role="img" aria-label="${curto('lula')} ${fChance(par, 'lula')}, ${curto('flavio')} ${fChance(par, 'flavio')}">
        <span class="seg" style="--c:${cand('lula').cor};flex:${pctCss(par.l)} 1 0px"></span><span class="seg" style="--c:${cand('flavio').cor};flex:${pctCss(par.f)} 1 0px"></span>
      </div>`;
  }
  const link = linkExt(f.url, `abrir na ${nome} ↗`);
  const vol = volumeTexto(f);
  if (variante !== 'completo') {
    return h`<article class="merc${ok ? '' : ' falhou'}">
      <div class="merc-cab"><p class="merc-nome">${nome}</p>${statusMercado(f)}</div>
      ${linhas}${barra}
      ${ok ? '' : h`<p class="merc-erro">Sem preço agora; nova tentativa em 1 minuto.</p>`}
      ${vol ? h`<p class="merc-meta">${vol}</p>` : ''}
      ${link ? h`<p class="merc-link">${link}</p>` : ''}
    </article>`;
  }
  const brutoL = num(f.candidatos?.lula?.prob);
  const brutoF = num(f.candidatos?.flavio?.prob);
  const soma = brutoL !== null && brutoF !== null ? (brutoL + brutoF) * 100 : null;
  const precos = ['lula', 'flavio'].map((id) => {
    const c = obj(f.candidatos?.[id]) || {};
    return h`<tr><td>${curto(id)}</td><td class="n">${ou(fProb1(c.compra))}</td><td class="n">${ou(fProb1(c.venda))}</td><td class="n">${ou(fProb1(c.ultimo))}</td></tr>`;
  });
  const meta = [];
  if (vol) meta.push(h`${vol} ${info('Volume')}`);
  if (num(f.liquidez_usd) !== null) meta.push(h`liquidez ${fDolar(f.liquidez_usd)} ${info('Liquidez')}`);
  if (fDataAno(f.encerra_em)) meta.push(h`${f.id === 'kalshi' ? 'prazo máximo do contrato' : 'encerra em'} ${fDataAno(f.encerra_em)}`);
  return h`<article class="merc${ok ? '' : ' falhou'}">
    <div class="merc-cab"><p class="merc-nome">${nome}</p>${statusMercado(f)}</div>
    ${txt(f.titulo) ? h`<p class="merc-tit">${f.titulo}</p>` : ''}
    ${linhas}${barra}
    ${ok
      ? h`<table class="tab"><thead><tr><th style="width:28%">Preço</th><th class="n">Compra</th><th class="n">Venda</th><th class="n">Último</th></tr></thead><tbody>${precos}</tbody><caption>Preços originais, em centavos de dólar por contrato que paga US$ 1, lidos como %. ${info('Compra, venda e último')}${soma !== null ? ` Os dois preços do meio somam ${fNum(soma, 1)}%.` : ''}</caption></table>`
      : h`<p class="merc-erro">Sem preço agora; nova tentativa em 1 minuto.${txt(f.erro) ? h`<small>${limparErro(f.erro)}</small>` : ''}</p>`}
    ${meta.length ? h`<p class="merc-meta">${meta.map((x, i) => h`${i ? ' · ' : ''}${x}`)}</p>` : ''}
    ${link ? h`<p class="merc-link">${link}</p>` : ''}
  </article>`;
}

// Polymarket e Kalshi são proibidas no Brasil (Resolução CMN 5.298/2026). Quando o
// provedor do Mac passa a barrar os sites, o snapshot fica parado: a página diz desde
// quando e por quê, em vez de mostrar o preço velho como se fosse de agora.
function avisoBloqueioMerc() {
  const paradas = arr(st.merc?.fontes).filter((f) => obj(f) && f.origem === 'snapshot' && obj(f.bloqueio));
  if (!paradas.length) return '';
  const desde = paradas.map((f) => f.atualizado_em).filter(Boolean).sort()[0];
  const nomes = listaNomes(paradas.map((f) => txt(f.nome) || txt(f.id)));
  return h`<p class="aviso-bloqueio"><b>${paradas.length > 1 ? 'Preços parados' : `${nomes}: preço parado`}${fDataHora(desde) ? ` desde ${fDataHora(desde)}` : ''}.</b> Polymarket e Kalshi são bloqueadas no Brasil (Resolução CMN 5.298/2026, cumprida pela Anatel), e o provedor de internet do Radar passou a barrar os dois sites. Aqui fica o último preço guardado.</p>`;
}

function htmlFonteMercados() {
  if (st.mod === undefined) return h`Fonte: Polymarket e Kalshi · carregando…`;
  if (st.mod === null) {
    return h`Fonte: Polymarket e Kalshi · módulo de mercados indisponível agora (detalhe na aba Método, em Lacunas) · nova tentativa automática a cada 5 minutos`;
  }
  const nomes = arr(st.merc?.fontes)
    .map((f) => txt(f?.nome) || txt(f?.id))
    .filter(Boolean);
  return h`Fonte: ${listaNomes(nomes) || 'Polymarket e Kalshi'}, lidos ao vivo ou a cada 15 segundos${st.mercEm ? ` · última leitura às ${fHora(st.mercEm)}` : ''}${st.mercErro ? ` · a última leitura falhou (${st.mercErro})` : ''}`;
}

function htmlComparacao() {
  const d = st.dados;
  const linhas = arr(d?.medias_ordem).map((k) => ({
    nome: `Pesquisas: ${rotuloCurto(k, d.medias[k]).toLowerCase()}`,
    sub: 'modelo do Radar',
    l: fChance(parDe(d.medias[k]?.prob_vitoria), 'lula'),
    f: fChance(parDe(d.medias[k]?.prob_vitoria), 'flavio'),
  }));
  if (!linhas.length) linhas.push({ nome: 'Pesquisas', sub: 'sem dado ainda', l: null, f: null });
  if (st.mod === null) linhas.push({ nome: 'Mercados', sub: 'indisponíveis agora', l: null, f: null, traco: true });
  else if (st.mod === undefined) linhas.push({ nome: 'Mercados', sub: 'carregando…', l: null, f: null, traco: true });
  for (const f of arr(st.merc?.fontes).filter(obj)) {
    const ok = f.status !== 'erro';
    linhas.push({
      nome: txt(f.nome) || txt(f.id) || 'Mercado',
      sub: ok ? (f.origem === 'ao_vivo' ? 'mercado, ao vivo' : f.origem === 'vivo-15s' ? `mercado, quase ao vivo (${fHoraSeg(f.atualizado_em) || 'hora sem registro'})` : `mercado, snapshot de ${fQuando(f.atualizado_em) || 'hora sem registro'}`) : 'mercado indisponível agora',
      l: ok ? fChance(parMercado(f), 'lula') : null,
      f: ok ? fChance(parMercado(f), 'flavio') : null,
      traco: !ok,
    });
  }
  return h`<table class="tab">
    <thead><tr><th style="width:52%">Fonte</th>${cabecalhoCand('lula')}${cabecalhoCand('flavio')}</tr></thead>
    <tbody>${linhas.map((x) => {
      const cel = (v) => v ?? (x.traco ? '—' : LAC);
      return h`<tr><td>${x.nome}<small>${x.sub}</small></td><td class="n">${cel(x.l)}</td><td class="n">${cel(x.f)}</td></tr>`;
    })}</tbody>
    <caption>A chance das pesquisas sai do modelo do Radar; a dos mercados, do preço do contrato, normalizada para somar 100% entre os dois ${info('Chance normalizada')}. São medidas diferentes e podem divergir.</caption>
  </table>`;
}

function htmlHistoricos() {
  if (st.mod === undefined) return h`<p class="estado">Carregando…</p>`;
  if (st.mod === null) return lacunaBloco('Histórico dos mercados indisponível: o módulo de leitura não carregou.');
  if (typeof st.mod.lerHistorico !== 'function') return lacunaBloco('Histórico dos mercados: sem dado ainda.');
  const fontes = arr(st.merc?.fontes).filter((f) => obj(f) && txt(f.id));
  if (!fontes.length) return st.mercErro ? lacunaBloco('Histórico dos mercados: sem dado ainda.') : h`<p class="estado">Lendo os mercados…</p>`;
  const L = cand('lula');
  const F = cand('flavio');
  return fontes.map((f) => {
    const k = `${f.id}:${st.dias}`;
    const hs = st.hist.get(k);
    const nome = txt(f.nome) || f.id;
    let corpo;
    if (!hs || (hs.lendo && !hs.pontos)) corpo = h`<p class="estado">Carregando o histórico…</p>`;
    else if (!hs.pontos?.length) {
      corpo = lacunaBloco(hs.erro ? `Histórico de ${nome} indisponível agora (${hs.erro}).` : `Histórico de ${nome}: sem dado ainda.`);
    } else {
      const ult = hs.pontos[hs.pontos.length - 1];
      corpo = h`<div class="leg"><span><i class="lk" style="--c:${L.cor}"></i>${curto('lula')}</span><span><i class="lk" style="--c:${F.cor}"></i>${curto('flavio')}</span></div>
        <div class="graf" data-grafico="mercado" data-fonte="${f.id}" tabindex="0" role="img" aria-label="Histórico de ${nome}: ${curto('lula')} ${fNum(ult.l, 1) || 'sem dado'}%, ${curto('flavio')} ${fNum(ult.f, 1) || 'sem dado'}% no último ponto"></div>
        <details class="mais" data-k="th:${f.id}"><summary>Ver em tabela</summary>${tabelaHist(hs.pontos)}</details>`;
    }
    const origem = hs?.origem === 'ao_vivo' ? 'ao vivo' : hs?.origem === 'snapshot' ? `snapshot de ${fQuando(hs.atualizado) || 'hora sem registro'}` : null;
    return h`<div class="hist"><h3 class="hist-tit">${nome}${origem ? h`<small>${origem}</small>` : ''}</h3>${corpo}</div>`;
  });
}

function tabelaHist(pontos) {
  // Um ponto por dia (o último do dia), do mais novo para o mais velho.
  const porDia = new Map();
  for (const p of pontos) porDia.set(fmtDA.format(p.t), p);
  const linhas = [...porDia.values()].sort((a, b) => b.t - a.t);
  return h`<div class="tab-wrap"><table class="tab">
    <thead><tr><th>Dia</th><th class="n">${curto('lula')}</th><th class="n">${curto('flavio')}</th></tr></thead>
    <tbody>${linhas.map((p) => h`<tr><td>${fData(p.t)}<small>último preço às ${fHora(p.t)}</small></td><td class="n">${ou(fPct(p.l, 1))}</td><td class="n">${ou(fPct(p.f, 1))}</td></tr>`)}</tbody>
  </table></div>`;
}

function htmlLacunasMercado() {
  const out = [];
  if (st.mod === null) out.push(`Mercados de previsão: o módulo não carregou${st.modErro ? ` (${st.modErro})` : ''}; nova tentativa a cada 5 minutos.`);
  else if (st.mercErro) out.push(`Mercados de previsão: a última leitura falhou (${st.mercErro}).`);
  for (const f of arr(st.merc?.fontes).filter(obj)) {
    if (f.status === 'erro') out.push(`${txt(f.nome) || f.id}: indisponível agora${txt(f.erro) ? ` (${limparErro(f.erro)})` : ''}.`);
    else if (f.origem === 'vivo-15s') out.push(`${txt(f.nome) || f.id}: sem leitura direta neste aparelho; mostra a leitura do Radar de ${fHoraSeg(f.atualizado_em) || 'hora sem registro'} (o Radar lê a cada 15 segundos).`);
    else if (f.origem === 'snapshot') out.push(`${txt(f.nome) || f.id}: sem leitura ao vivo neste aparelho; mostra o snapshot de ${fQuando(f.atualizado_em) || 'hora sem registro'}.`);
  }
  if (!out.length) return '';
  return h`<ul class="lista-texto">${out.map((x) => h`<li>${x}</li>`)}</ul>`;
}

function htmlAbaMercados() {
  return h`
    <section class="bloco" id="sec-historico">
      <div class="op-cab">
        <h2 class="titulo-heroi">Polymarket e Kalshi</h2>
        <div class="seg-ctl curto" role="group" aria-label="Período do histórico">
          <button type="button" data-dias="7" aria-pressed="${String(st.dias === 7)}">7 dias</button>
          <button type="button" data-dias="30" aria-pressed="${String(st.dias === 30)}">30 dias</button>
        </div>
      </div>
      <p class="op-unid">% de chance de vitória no preço, hora a hora</p>
      <div data-hist>${htmlHistoricos()}</div>
    </section>`;
}

/* ------------------------------------------------------------ PESQUISAS */

function baseSerie(d) {
  const somas = arr(d?.serie_media)
    .map((p) => (num(p?.lula) ?? NaN) + (num(p?.flavio) ?? NaN))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!somas.length) return 'validos';
  return somas[Math.floor(somas.length / 2)] >= 96 ? 'validos' : 'totais';
}

function htmlPesquisas(d) {
  if (!d) return htmlSemDados();
  const ult = ultimasPorCasa(d);
  const noRanking = new Set(arr(d.ranking_1t).filter((x) => obj(x) && txt(x.casa)).map((x) => norm(x.casa)));
  const outras = ult.filter((p) => !noRanking.has(norm(p.casa)));
  return h`
    ${blocoPrimeiroTurno(d)}
    <section class="bloco" id="sec-ranking">
      <div class="op-cab"><h2 class="sobre">Quem mais acertou o 1º turno</h2><span class="ul-vivo" data-estado="${st.erro ? 'erro' : 'ok'}"><i aria-hidden="true"></i>ao vivo</span></div>
      <p class="op-unid">erro na diferença entre os dois · embaixo, a última pesquisa de 2º turno da casa</p>
      ${ranking(d, ult)}
    </section>
    ${outras.length ? h`<section class="bloco" id="sec-casas"><h2 class="sobre">Outras casas</h2><p class="op-unid">sem pesquisa de 1º turno para comparar · % dos votos válidos</p>${listaUltimas(outras)}</section>` : ''}
    <section class="bloco" id="sec-serie">
      <h2 class="sobre">Evolução da média</h2>
      ${graficoPesquisasHtml(d)}
    </section>`;
}

// O que o próprio Radar publicava no dia do 1º turno, lido do run guardado
// (build_pocket._radar_first_round), contra a urna.
function blocoRadar1t(d) {
  const r = obj(d.radar_1t);
  if (!r) return '';
  const linha = (nome, v, cls) => {
    const l = num(v?.lula);
    const f = num(v?.flavio);
    const m = l !== null && f !== null ? f - l : null;
    const quem = m === null ? null : m >= 0 ? curto('flavio') : curto('lula');
    return h`<tr class="${cls || ''}"><td>${nome}</td><td class="n">${ou(fPct(f))}</td><td class="n">${ou(fPct(l))}</td><td class="n">${m !== null ? `${quem} +${fNum(Math.abs(m))}` : LAC}</td></tr>`;
  };
  const casas = listaNomes(r.casas);
  const quando = fDataHora(r.publicado_em);
  return h`<section class="bloco" id="sec-radar-1t">
    <h2 class="sobre">${txt(r.rotulo) || 'Como o Radar se saiu no 1º turno'}</h2>
    ${txt(r.texto) ? h`<p class="em-frase">${r.texto}</p>` : ''}
    <div class="tab-wrap"><table class="tab">
      <thead><tr><th style="width:40%"></th><th class="n">${curto('flavio')}</th><th class="n">${curto('lula')}</th><th class="n">Diferença</th></tr></thead>
      <tbody>
        ${linha('Radar, cenário corrigido', r.corrigida, 'destaque')}
        ${linha('Média simples das pesquisas', r.simples)}
        ${linha('Urna (TSE)', r.resultado)}
      </tbody>
      <caption>% dos votos válidos, contando todos os candidatos do 1º turno. O cenário corrigido acertou quem ficou na frente; a média simples, não.</caption>
    </table></div>
    <p class="fonte">Versão publicada pelo Radar${quando ? ` em ${quando}` : ''}, antes de a votação terminar${casas ? `, com ${casas}` : ''} · resultado: TSE</p>
  </section>`;
}

// O gráfico começa no 1º turno: pesquisa de antes dele é simulação de outro momento
// (continua na lista por casa, com a ficha completa).
function corteGrafico(d) {
  const t1 = msDe(d.primeiro_turno?.data);
  return t1 === null ? null : t1 - 0.5 * DIA;
}

function graficoPesquisasHtml(d) {
  const serie = arr(d.serie_media).filter(obj);
  const corte = corteGrafico(d);
  const todas = arr(d.pesquisas).filter(obj);
  const pesq = todas.filter((p) => corte === null || (msDe(p.data) ?? Infinity) >= corte);
  const antes = todas.length - pesq.length;
  if (!serie.length && !pesq.length) return lacunaBloco('Série da média e pesquisas: sem dado ainda.');
  const base = baseSerie(d);
  const L = cand('lula');
  const F = cand('flavio');
  const ult = [...serie].filter((p) => msDe(p.data) !== null).sort((a, b) => msDe(a.data) - msDe(b.data)).pop();
  const temFora = pesq.some((p) => p.na_media === false && msDe(p.data) !== null);
  return h`<div class="leg">
      <span><i class="lk" style="--c:${L.cor}"></i>${curto('lula')}, média</span>
      <span><i class="lk" style="--c:${F.cor}"></i>${curto('flavio')}, média</span>
      <span><i class="pk" style="--c:${L.cor}"></i><i class="pk" style="--c:${F.cor}"></i>cada pesquisa</span>
      ${temFora ? h`<span><i class="pk vazado"></i>fora da média</span>` : ''}
    </div>
    ${serie.length ? '' : lacunaBloco('Linha da média: sem dado ainda. O gráfico mostra só as pesquisas.')}
    <div class="graf" data-grafico="pesquisas" tabindex="0" role="img" aria-label="Média das pesquisas no tempo${ult ? `; no último ponto, ${fData(ult.data)}: ${curto('lula')} ${fPct(ult.lula) || 'sem dado'}, ${curto('flavio')} ${fPct(ult.flavio) || 'sem dado'}` : ''}"></div>
    ${serie.length ? h`<details class="mais" data-k="tab-media"><summary>Ver os números da média</summary>${tabelaSerie(serie)}</details>` : ''}`;
}

function tabelaSerie(serie) {
  const l = serie
    .map((p) => ({ t: msDe(p.data), l: num(p.lula), f: num(p.flavio) }))
    .filter((p) => p.t !== null)
    .sort((a, b) => b.t - a.t);
  return h`<div class="tab-wrap"><table class="tab">
    <thead><tr><th>Dia</th><th class="n">${curto('lula')}</th><th class="n">${curto('flavio')}</th></tr></thead>
    <tbody>${l.map((p) => h`<tr><td>${fData(p.t)}</td><td class="n">${ou(fPct(p.l))}</td><td class="n">${ou(fPct(p.f))}</td></tr>`)}</tbody>
  </table></div>`;
}

function foraDaJanela(p, d) {
  const as = msDe(d.media?.as_of);
  const j = num(d.media?.janela_dias);
  const t = msDe(p.data);
  return as !== null && j !== null && t !== null && t < as - j * DIA;
}

function listaCasas(d) {
  const pesq = arr(d.pesquisas).filter(obj);
  if (!pesq.length) return lacunaBloco('Pesquisas do 2º turno: sem dado ainda.');
  const grupos = new Map();
  for (const p of pesq) {
    const c = txt(p.casa) || 'Casa não informada';
    if (!grupos.has(c)) grupos.set(c, []);
    grupos.get(c).push(p);
  }
  const porData = (a, b) => (msDe(b.data) ?? 0) - (msDe(a.data) ?? 0);
  const ordem = [...grupos.entries()]
    .map(([c, l]) => [c, [...l].sort(porData)])
    .sort((a, b) => porData(a[1][0], b[1][0]) || a[0].localeCompare(b[0], 'pt-BR'));
  const rk = new Map(arr(d.ranking_1t).filter(obj).map((r) => [norm(r.casa), r]));
  const top = new Set(arr(d.media_acerto_1t?.casas).map(norm));
  return h`<p class="nota">${fInt(pesq.length)} ${plural(pesq.length, 'pesquisa', 'pesquisas')} de ${fInt(grupos.size)} ${plural(grupos.size, 'casa', 'casas')}, da mais recente para a mais antiga. Números em votos totais ${info('Votos totais')}, como cada casa divulgou; o erro no 1º turno está em pontos percentuais (pp). Toque numa pesquisa para ver a ficha.</p>
    <div class="cab-lista" aria-hidden="true"><span>Divulgação</span><span>${curto('lula')}</span><span>${curto('flavio')}</span><span></span></div>
    ${ordem.map(([casa, lista]) => {
      const r = rk.get(norm(casa));
      return h`<article class="casa">
        <header class="casa-cab"><h3 class="casa-nome">${casa}</h3><p class="casa-meta">${lista.length} ${plural(lista.length, 'pesquisa', 'pesquisas')}${num(r?.erro_medio_pp) !== null ? ` · erro no 1º turno: ${fPP(r.erro_medio_pp)}` : ''}${top.has(norm(casa)) ? h` · <span class="selo">entre as que mais acertaram</span>` : ''}</p></header>
        ${lista.map((p, i) => itemPesquisa(p, casa, d, i))}
      </article>`;
    })}`;
}

function itemPesquisa(p, casa, d, i) {
  const L = cand('lula');
  const F = cand('flavio');
  const tL = num(p.totais?.lula);
  const tF = num(p.totais?.flavio);
  const vL = num(p.validos?.lula);
  const vF = num(p.validos?.flavio);
  const bn = num(p.totais?.branco_nulo);
  const ind = num(p.totais?.indecisos);
  const fora = p.na_media === false;
  const janela = num(d.media?.janela_dias);
  const cp = casasPub(tL, tF, bn, ind);
  const naMedia = fora
    ? foraDaJanela(p, d)
      ? `não: campo fora da janela de ${fInt(janela)} dias`
      : 'não entra na média'
    : p.na_media === true
      ? `sim${num(p.peso) !== null ? `, com peso ${fNum(p.peso, 2)}` : ''}`
      : null;
  const k = `p:${casa}:${txt(p.data) || i}:${txt(p.registro) || ''}`;
  const nv = novaAtiva(p);
  return h`<details class="pesq${nv ? ' nova' : ''}" data-k="${k}" data-chave="${chavePesquisa(p)}"${cru(nv ? ` id="${nv.id}"` : '')}>
    <summary>
      <span class="pesq-quando"><b>${ou(fData(p.data))}</b>${nv ? h`<small class="nova-tag">acabou de entrar</small>` : ''}${txt(p.campo) ? h`<small>campo ${p.campo}</small>` : ''}${fora ? h`<small class="fora">fora da média</small>` : ''}</span>
      <span class="pesq-v" style="--c:${L.cor}"><i class="mc"></i>${tL !== null ? fPub(tL, cp) : '—'}</span>
      <span class="pesq-v" style="--c:${F.cor}"><i class="mc"></i>${tF !== null ? fPub(tF, cp) : '—'}</span>
      <span class="chev" aria-hidden="true"></span>
    </summary>
    <dl class="ficha">
      <div class="larga"><dt>Votos válidos ${info('Votos válidos')}</dt><dd>${vL !== null || vF !== null ? `${curto('lula')} ${fPct(vL) || '—'} · ${curto('flavio')} ${fPct(vF) || '—'}` : LAC}</dd></div>
      <div class="larga"><dt>Votos totais</dt><dd>${tL !== null || tF !== null ? h`${curto('lula')} ${fPub(tL, cp) || '—'} · ${curto('flavio')} ${fPub(tF, cp) || '—'} · brancos e nulos ${ou(fPub(bn, cp))} · indecisos ${ou(fPub(ind, cp))}` : LAC}</dd></div>
      <div><dt>Amostra</dt><dd>${num(p.amostra) !== null ? `${fInt(p.amostra)} entrevistas` : LAC}</dd></div>
      <div><dt>Campo</dt><dd>${ou(txt(p.campo))}</dd></div>
      <div><dt>Registro no TSE ${info('Registro no TSE')}</dt><dd>${ou(txt(p.registro))}</dd></div>
      <div><dt>Modo</dt><dd>${ou(txt(p.modo))}</dd></div>
      <div class="larga"><dt>Contratante</dt><dd>${ou(txt(p.contratante))}</dd></div>
      <div class="larga"><dt>Na média ${info('Peso')}</dt><dd>${ou(naMedia)}</dd></div>
      <div class="larga"><dt>Divulgação</dt><dd>${linkExt(p.fonte_url, 'Abrir a fonte da pesquisa ↗') || LAC}</dd></div>
    </dl>
  </details>`;
}

function ranking(d, ult = ultimasPorCasa(d)) {
  const r = arr(d.ranking_1t).filter((x) => obj(x) && txt(x.casa));
  if (!r.length) return lacunaBloco('Ranking das casas no 1º turno: sem dado ainda.');
  // Ordem pelo erro na diferença Flávio − Lula, o mesmo critério da média.
  const ord = [...r].sort((a, b) => Math.abs(num(a.erro_margem_pp) ?? 1e9) - Math.abs(num(b.erro_margem_pp) ?? 1e9));
  const top = new Set(arr(d.media_acerto_1t?.casas).map(norm));
  const porCasa = new Map(ult.map((p) => [norm(p.casa), p]));
  const maxErro = Math.max(...ord.map((x) => Math.abs(num(x.erro_margem_pp) ?? 0)), 1);
  return h`<ol class="rk">${ord.map((x, i) => {
    const e = num(x.erro_margem_pp);
    const p = porCasa.get(norm(x.casa));
    const quem = e === null ? '' : Math.abs(e) < 0.25 ? 'acertou' : e < 0 ? `${curto('flavio')} abaixo` : `${curto('flavio')} acima`;
    return h`<li class="rk-l${top.has(norm(x.casa)) ? ' top' : ''}" style="--i:${i}">
        <div class="rk-cab">
          <span class="rk-pos">${i + 1}</span>
          <b class="rk-casa">${x.casa}</b>
          <span class="rk-erro"><b>${e !== null ? `${fNum(Math.abs(e), 1)} pt` : '—'}</b><small>${quem}</small></span>
        </div>
        <span class="rk-trilho" aria-hidden="true"><span style="width:${e !== null ? ((Math.abs(e) / maxErro) * 100).toFixed(1) : 0}%"></span></span>
        ${p ? h`<ol class="ul-lista rk-ult">${linhaUltima(p, false)}</ol>` : h`<p class="ul-var">Sem pesquisa de 2º turno ainda.</p>`}
      </li>`;
  })}</ol>`;
}

/* --------------------------------------------------------------- MÉTODO */

function passosProjecao(p) {
  const ab = num(p.abstencao_estimada_pct);
  const t1 = num(p.base_abstencao?.t1_2026_pct);
  const dl = num(p.base_abstencao?.delta_medio_t1_t2_pp);
  const comp = num(p.comparecimento_estimado);
  const bn = num(p.brancos_nulos_estimado_pct);
  const vL = num(p.votos?.lula);
  const vF = num(p.votos?.flavio);
  const val = num(p.votos_validos_estimados) ?? (vL !== null && vF !== null ? vL + vF : null);
  const sL = val && vL !== null ? (vL / val) * 100 : null;
  const sF = val && vF !== null ? (vF / val) * 100 : null;
  const mg = num(p.margem_votos) ?? (vL !== null && vF !== null ? Math.abs(vL - vF) : null);
  return h`<ol class="passos">
      <li><b>Quem pode votar:</b> ${num(p.eleitorado) !== null ? `${fGrande(p.eleitorado)} de eleitores, segundo o TSE.` : LAC}</li>
      <li><b>Quem deve faltar:</b> ${ou(fPct(ab))}. É a falta do 1º turno (${ou(fPct(t1))}) mais o quanto ela costuma subir no 2º turno (${dl !== null ? `${fSinal(dl)} ponto` : LAC}, média de 2002 a 2022). Sobram ${comp !== null ? `${fGrande(comp)} de eleitores votando` : LAC}.</li>
      <li><b>Quem anula ou vota em branco:</b> ${ou(fPct(bn))} de quem vota, como no 1º turno ${info('Brancos e nulos')}. Sobram ${val !== null ? `${fGrande(val)} de votos válidos` : LAC}.</li>
      <li><b>Como os votos se dividem:</b> pela média das pesquisas, ${curto('lula')} ${ou(fPct(sL))} → ${vL !== null ? `${fGrande(vL)} de votos` : LAC}; ${curto('flavio')} ${ou(fPct(sF))} → ${vF !== null ? `${fGrande(vF)} de votos` : LAC}. Diferença: ${mg !== null ? `${fGrande(mg)} de votos` : LAC}.</li>
    </ol>
    ${mudaResultado(p, obj(p.explicacao))}
    ${outroRisco(p)}`;
}

function htmlMetodo(d) {
  if (!d) return htmlSemDados();
  const m = obj(d.media);
  const p = obj(d.projecao);
  const janela = num(m?.janela_dias);
  return h`
    <section class="bloco" id="sec-como-media">
      <h2 class="sobre">Como a média é feita</h2>
      <p class="texto">Entram as pesquisas de 2º turno para presidente que aparecem na aba Pesquisas marcadas como “na média”: as de campo ${janela !== null ? `nos últimos ${fInt(janela)} dias` : h`dentro da janela (${LAC})`}${fData(m?.as_of) ? ` até ${fData(m.as_of)}` : ''}. Toda pesquisa divulgada tem registro no TSE (Tribunal Superior Eleitoral) ${info('Registro no TSE')}.</p>
      <p class="texto">Cada pesquisa conta com um peso de 0 a 1 ${info('Peso')}: casas que erraram menos no 1º turno pesam mais (ranking na aba Pesquisas). A média sai em votos válidos ${info('Votos válidos')}, a mesma conta que o TSE usa para declarar o vencedor: brancos, nulos e indecisos ficam de fora.</p>
      <p class="texto">A faixa ${info('Faixa')} é o intervalo provável em torno da média. A chance de vitória ${info('Chance de vitória')} diz em quantas de cada 100 eleições com este quadro cada candidato venceria.</p>
      ${txt(m?.nota) ? h`<p class="nota">${m.nota}</p>` : ''}
      <h3 class="sub">As médias lado a lado ${info('Quatro médias')}</h3>
      ${arr(d.medias_ordem).length
        ? h`<p class="texto">Quando as médias se afastam umas das outras, a escolha do método pesa no resultado; quando ficam juntas, o quadro é mais firme.</p>
          <dl class="glossario">${arr(d.medias_ordem).map((k) => {
            const q = d.medias[k];
            return h`<div><dt>${rotuloCurto(k, q)}${txt(q.rotulo) && txt(q.rotulo) !== rotuloCurto(k, q) ? h` <small class="nota">(${q.rotulo})</small>` : ''}</dt><dd>${curto('lula')} ${ou(fPct(q.validos?.lula))} × ${curto('flavio')} ${ou(fPct(q.validos?.flavio))}${k === 'acerto_1t' && listaNomes(q.casas) ? ` · ${listaNomes(q.casas)}` : ''}. ${txt(q.nota) || ''}</dd></div>`;
          })}</dl>`
        : lacunaBloco('Médias: sem dado ainda.')}
    </section>
    <section class="bloco" id="sec-como-projecao">
      <h2 class="sobre">Como a projeção é feita ${info('Projeção com abstenção')}</h2>
      ${p ? passosProjecao(p) : lacunaBloco('Projeção com abstenção: sem dado ainda.')}
    </section>
    <section class="bloco" id="sec-abstencao">
      <h2 class="sobre">Abstenção no 1º e no 2º turno, 2002 a 2022 ${info('Abstenção')}</h2>
      ${graficoAbstencaoHtml(d)}
    </section>
    <section class="bloco" id="sec-glossario">
      <h2 class="sobre">Glossário</h2>
      ${glossarioHtml()}
    </section>
    <section class="bloco" id="sec-lacunas">
      <h2 class="sobre">Lacunas</h2>
      ${lacunasHtml(d)}
      <div data-lac-merc>${htmlLacunasMercado()}</div>
    </section>
    <section class="bloco" id="sec-avisos">
      <h2 class="sobre">Avisos</h2>
      ${arr(d.avisos).filter(txt).length
        ? h`<ul class="lista-texto">${arr(d.avisos).filter(txt).map((x) => h`<li>${x}</li>`)}</ul>`
        : h`<p class="texto">Nenhum aviso neste momento.</p>`}
    </section>
    <section class="bloco" id="sec-sobre">
      <h2 class="sobre">Sobre os dados</h2>
      <p class="texto">1º turno: TSE. Pesquisas: registro no TSE e divulgação de cada casa. Mercados: Polymarket e Kalshi, lidos pelo seu aparelho (ao vivo), pela leitura do Radar a cada 15 segundos (quase ao vivo) ou da última coleta guardada (snapshot). Média e projeção: cálculo do Radar.</p>
      <p class="fonte">Arquivo: <a href="${URL_DADOS}">${URL_DADOS}</a>${txt(d.versao) ? ` · versão ${d.versao}` : ''}${fDataHora(d.gerado_em) ? ` · gerado em ${fDataHora(d.gerado_em)}` : ''}</p>
      <p class="ver-mais"><a class="botao-link" href="${CFG.versaoCompleta}">Versão completa do Radar →</a></p>
    </section>`;
}

function graficoAbstencaoHtml(d) {
  const linhas = arr(d.historico_abstencao).filter((r) => obj(r) && num(r.ano) !== null);
  const t1_26 = num(d.primeiro_turno?.abstencao_pct);
  const est = num(d.projecao?.abstencao_estimada_pct);
  if (!linhas.length && t1_26 === null && est === null) return lacunaBloco('Histórico da abstenção: sem dado ainda.');
  const tem26t2 = linhas.some((r) => num(r.ano) === 2026 && num(r.t2_pct) !== null);
  const fontes = linhas
    .filter((r) => num(r.ano) !== 2026)
    .sort((x, y) => x.ano - y.ano)
    .map((r) => linkExt(r.fonte_url, String(r.ano)))
    .filter(Boolean);
  return h`<div class="leg">
      <span><i class="lk" style="--c:${COR_T1}"></i>1º turno</span>
      <span><i class="lk" style="--c:${COR_T2}"></i>2º turno</span>
      ${est !== null && !tem26t2 ? h`<span><i class="pk estim"></i>2º turno de 2026, estimativa (com a faixa)</span>` : ''}
    </div>
    <div class="graf" data-grafico="abstencao" tabindex="0" role="img" aria-label="Abstenção no 1º e no 2º turno das eleições presidenciais de 2002 a 2022, com 2026"></div>
    <p class="nota">Em % do eleitorado. A estimativa de 2026 é a da projeção. Toque no gráfico para ver cada ano.</p>
    <details class="mais" data-k="tab-abst"><summary>Ver em tabela</summary>${tabelaAbstencao(d)}</details>
    <p class="fonte">Fonte: TSE (Tribunal Superior Eleitoral)${fontes.length ? h`, por ano: ${fontes.map((f, i) => h`${i ? ', ' : ''}${f}`)}` : ''}; 2026: 1º turno oficial e estimativa do Radar para o 2º turno</p>`;
}

function linhasAbstencao(d) {
  const linhas = arr(d.historico_abstencao)
    .filter(obj)
    .map((r) => ({ ano: num(r.ano), t1: num(r.t1_pct), t2: num(r.t2_pct), bn: num(r.brancos_nulos_t2_pct), url: r.fonte_url, est: false }))
    .filter((r) => r.ano !== null)
    .sort((a, b) => a.ano - b.ano);
  const t1_26 = num(d.primeiro_turno?.abstencao_pct);
  const est = num(d.projecao?.abstencao_estimada_pct);
  const fx = faixa(d.projecao?.abstencao_faixa_pct);
  let r26 = linhas.find((r) => r.ano === 2026);
  if (!r26 && (t1_26 !== null || est !== null)) {
    r26 = { ano: 2026, t1: t1_26, t2: null, bn: null, url: null, est: false };
    linhas.push(r26);
  } else if (r26 && r26.t1 === null) {
    r26.t1 = t1_26;
  }
  if (r26 && r26.t2 === null && est !== null) {
    r26.t2 = est;
    r26.est = true;
    r26.fx = fx;
    r26.bn = num(d.projecao?.brancos_nulos_estimado_pct);
  }
  return linhas;
}

function tabelaAbstencao(d) {
  const linhas = linhasAbstencao(d);
  if (!linhas.length) return lacunaBloco('Histórico da abstenção: sem dado ainda.');
  return h`<div class="tab-wrap"><table class="tab">
    <thead><tr><th style="width:20%">Ano</th><th class="n">1º turno</th><th class="n">2º turno</th><th class="n">Brancos e nulos no 2º turno</th></tr></thead>
    <tbody>${linhas.map(
      (r) => h`<tr class="${r.est ? 'destaque' : ''}"><td>${linkExt(r.url, String(r.ano)) || String(r.ano)}</td><td class="n">${ou(fPct(r.t1))}</td><td class="n">${ou(fPct(r.t2))}${r.est ? h`<small>estimativa</small>` : ''}</td><td class="n">${ou(fPct(r.bn))}${r.est && r.bn !== null ? h`<small>estimativa</small>` : ''}</td></tr>`,
    )}</tbody>
    <caption>Abstenção em % do eleitorado; brancos e nulos em % de quem votou.</caption>
  </table></div>`;
}

function glossarioHtml() {
  const itens = [...glossario().values()].sort((a, b) => a.termo.localeCompare(b.termo, 'pt-BR'));
  return h`<dl class="glossario">${itens.map((g) => h`<div><dt>${g.termo}</dt><dd>${g.texto}</dd></div>`)}</dl>`;
}

function lacunasHtml(d) {
  const doDado = arr(d.lacunas).filter(txt);
  const detectadas = [];
  const exigidos = [
    ['manchete', 'Manchete (“Em uma frase”)'],
    ['primeiro_turno', 'Resultado oficial do 1º turno'],
    ['media', 'Média das pesquisas'],
    ['media_acerto_1t', 'Média das casas que mais acertaram o 1º turno'],
    ['projecao', 'Projeção com abstenção'],
    ['pesquisas', 'Lista de pesquisas'],
    ['serie_media', 'Série da média'],
    ['ranking_1t', 'Ranking das casas no 1º turno'],
    ['historico_abstencao', 'Histórico da abstenção'],
  ];
  for (const [k, nome] of exigidos) {
    const v = d[k];
    if (v === null || v === undefined || (Array.isArray(v) && !v.length) || (typeof v === 'string' && !v.trim())) {
      detectadas.push(`${nome}: sem dado ainda.`);
    }
  }
  if (obj(d.primeiro_turno) && !arr(d.primeiro_turno.por_uf).length) detectadas.push('Resultado do 1º turno por estado: sem dado ainda.');
  if (!doDado.length && !detectadas.length) return h`<p class="texto">Nenhuma lacuna declarada nos dados.</p>`;
  return h`${doDado.length ? h`<ul class="lista-texto">${doDado.map((x) => h`<li>${x}</li>`)}</ul>` : ''}
    ${detectadas.length ? h`<p class="nota">Detectadas pela página:</p><ul class="lista-texto">${detectadas.map((x) => h`<li>${x}</li>`)}</ul>` : ''}`;
}

/* -------------------------------------------------------------- gráficos */

function ticksY(lo, hi, passo) {
  const out = [];
  for (let v = lo; v <= hi + 1e-9; v += passo) out.push(Math.round(v * 1000) / 1000);
  return out;
}

function ticksTempo(x0, x1, larguraPx) {
  const span = x1 - x0;
  const max = Math.max(2, Math.floor(larguraPx / 64));
  const out = [];
  if (span <= 3 * DIA) {
    const passos = [1, 2, 3, 4, 6, 12, 24].map((x) => x * HORA);
    const p = passos.find((x) => span / x <= max) || 24 * HORA;
    // Brasília é UTC−3 fixo: hora cheia local = múltiplo do passo + 3 h em UTC.
    for (let t = Math.ceil((x0 - 3 * HORA) / p) * p + 3 * HORA; t <= x1; t += p) {
      const { h: hh } = partesHora(t);
      out.push({ t, rot: hh === '00' ? fmtD.format(t) : `${+hh}h` });
    }
  } else {
    const passos = [1, 2, 3, 4, 5, 7, 14, 21, 28];
    const pd = passos.find((x) => span / (x * DIA) <= max) || 30;
    for (let t = Math.ceil((x0 - 15 * HORA) / DIA) * DIA + 15 * HORA; t <= x1; t += pd * DIA) out.push({ t, rot: fmtD.format(t) });
  }
  return out;
}

const linhaDica = (cor, valor, nome) =>
  h`<p class="dica-l"><i class="lk" style="--c:${cor}"></i><b>${ou(valor)}</b><span>${nome}</span></p>`;

/* Gráfico de linhas no tempo: grade, eixos, pontos soltos (pesquisas), linhas,
   números escritos nos pontos (sem colisão: o maior em cima, o menor embaixo,
   e no máximo um rótulo a cada `minDist` px) e cruz de leitura com dica. */
function desenharLinhasTempo(el, o) {
  const W = Math.round(el.clientWidth);
  if (W < 60) return;
  const H = o.altura ?? (W < 500 ? 264 : 300);
  const m = { t: 30, r: 30, b: 30, l: 38 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const sx = (v) => m.l + (o.x1 === o.x0 ? iw / 2 : ((v - o.x0) / (o.x1 - o.x0)) * iw);
  const sy = (v) => m.t + ih - ((v - o.yLo) / (o.yHi - o.yLo)) * ih;
  const fundo = [];
  const marcas = [];
  const textos = [];
  for (const v of ticksY(o.yLo, o.yHi, o.yPasso)) {
    const y = n2(sy(v));
    fundo.push(`<line class="g" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/>`);
    fundo.push(`<text class="tk" x="${m.l - 6}" y="${n2(y + 3.5)}" text-anchor="end">${esc(o.yFmt(v))}</text>`);
  }
  if (o.ref !== undefined && o.ref !== null) {
    const y = n2(sy(o.ref));
    fundo.push(`<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/>`);
  }
  fundo.push(`<line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`);
  for (const tk of ticksTempo(o.x0, o.x1, iw)) {
    const x = n2(sx(tk.t));
    const anc = x - m.l < 16 ? 'start' : W - m.r - x < 16 ? 'end' : 'middle';
    fundo.push(`<line class="ax" x1="${x}" x2="${x}" y1="${H - m.b}" y2="${H - m.b + 4}"/>`);
    fundo.push(`<text class="tk" x="${n2(anc === 'start' ? x - 4 : anc === 'end' ? x + 4 : x)}" y="${H - m.b + 17}" text-anchor="${anc}">${esc(tk.rot)}</text>`);
  }
  for (const ev of o.eventos || []) {
    if (ev.t < o.x0 || ev.t > o.x1) continue;
    const x = n2(sx(ev.t));
    fundo.push(`<line class="ev" x1="${x}" x2="${x}" y1="${m.t - 12}" y2="${H - m.b}"/>`);
    const anc = W - m.r - x < 46 ? 'end' : x - m.l < 46 ? 'start' : 'middle';
    fundo.push(`<text class="ev-t" x="${n2(anc === 'end' ? x - 3 : anc === 'start' ? x + 3 : x)}" y="${m.t - 16}" text-anchor="${anc}">${esc(ev.rot)}</text>`);
  }
  for (const p of o.soltos || []) {
    marcas.push(`<circle class="solto${p.vaz ? ' vaz' : ''}" cx="${n2(sx(p.t))}" cy="${n2(sy(p.y))}" r="3.6" style="--c:${p.cor}"/>`);
  }
  for (const se of o.series) {
    const pts = se.pts.filter((p) => p.y !== null && p.y !== undefined);
    if (!pts.length) continue;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${n2(sx(p.t))},${n2(sy(p.y))}`).join('');
    marcas.push(`<path class="ln${se.trac ? ' trac' : ''}" d="${d}" style="--c:${se.cor}"/>`);
  }
  // Rótulos: o último ponto sempre, o primeiro quando couber e, no meio, um a
  // cada minDist px (do fim para o começo), sem encostar no primeiro.
  const cands = (o.rotX || []).map((t) => ({ t, x: sx(t) }));
  const dist = o.minDist ?? 48;
  const escolhidos = [];
  if (cands.length) {
    escolhidos.push(cands[cands.length - 1]);
    let ultimoX = cands[cands.length - 1].x;
    const x0r = cands[0].x;
    for (let i = cands.length - 2; i >= 1; i--) {
      if (ultimoX - cands[i].x >= dist && cands[i].x - x0r >= dist) {
        escolhidos.push(cands[i]);
        ultimoX = cands[i].x;
      }
    }
    if (cands.length > 1 && ultimoX - x0r >= dist * 0.75) escolhidos.push(cands[0]);
  }
  escolhidos.forEach((c, idx) => {
    const vals = o.series
      .filter((se) => se.rotular !== false)
      .map((se) => ({ se, y: se.mapa.get(c.t) }))
      .filter((v) => v.y !== undefined && v.y !== null)
      .sort((a, b) => b.y - a.y);
    vals.forEach((v, k) => {
      const y = sy(v.y);
      let acima = k === 0;
      let ty = acima ? y - 9 : y + 17;
      if (acima && ty < 12) {
        acima = false;
        ty = y + 17;
      }
      // Sem espaço embaixo (perto do eixo), o rótulo sobe para cima do ponto.
      if (!acima && ty > H - m.b - 4) ty = y - 9;
      let anc = 'middle';
      let tx = c.x;
      if (c.x + 16 > W) {
        anc = 'end';
        tx = c.x + 4;
      } else if (c.x - 16 < 0) {
        anc = 'start';
        tx = c.x - 4;
      }
      marcas.push(`<circle class="mk" cx="${n2(c.x)}" cy="${n2(y)}" r="4" style="--c:${v.se.cor}"/>`);
      textos.push(`<text class="rot${idx === 0 ? ' fim' : ''}" x="${n2(tx)}" y="${n2(ty)}" text-anchor="${anc}">${esc(o.vFmt(v.y))}</text>`);
    });
  });
  const cruz = `<line class="cruz" x1="0" x2="0" y1="${m.t - 6}" y2="${H - m.b}" visibility="hidden"/><g class="realce"></g>`;
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">${fundo.join('')}${marcas.join('')}${cruz}${textos.join('')}</svg><div class="dica" hidden></div>`;
  el._dica = {
    xs: o.xs.map(sx),
    conteudo: (i) => o.dica(o.xs[i]),
    realce: (i) =>
      o.series
        .map((se) => {
          const y = se.mapa.get(o.xs[i]);
          return y === undefined || y === null ? null : { y: sy(y), cor: se.cor };
        })
        .filter(Boolean),
    topo: 4,
  };
  ligarDica(el);
}

function desenharPesquisas(el) {
  const d = st.dados;
  if (!d) return;
  const base = baseSerie(d);
  const L = cand('lula');
  const F = cand('flavio');
  const serie = arr(d.serie_media)
    .filter(obj)
    .map((p) => ({ t: msDe(p.data), l: num(p.lula), f: num(p.flavio) }))
    .filter((p) => p.t !== null)
    .sort((a, b) => a.t - b.t);
  const corte = corteGrafico(d);
  const pesq = arr(d.pesquisas)
    .filter(obj)
    .map((p) => {
      const v = base === 'validos' ? obj(p.validos) : obj(p.totais);
      return { t: msDe(p.data), l: num(v?.lula), f: num(v?.flavio), casa: txt(p.casa) || 'Casa', fora: p.na_media === false };
    })
    .filter((p) => p.t !== null && (p.l !== null || p.f !== null) && (corte === null || p.t >= corte));
  const xs = [...new Set([...serie.map((p) => p.t), ...pesq.map((p) => p.t)])].sort((a, b) => a - b);
  if (!xs.length) {
    el.innerHTML = emHtml(lacunaBloco('Sem pontos com data para desenhar.'));
    return;
  }
  let x0 = xs[0];
  let x1 = xs[xs.length - 1];
  const eventos = [];
  const eleicao = msDe(d.eleicao?.data) ?? msDe(CFG.dataEleicao);
  if (eleicao !== null && eleicao >= x1 && eleicao - x1 <= 10 * DIA) {
    x1 = eleicao;
    eventos.push({ t: eleicao, rot: '2º turno' });
  }
  const t1 = msDe(d.primeiro_turno?.data);
  if (t1 !== null && t1 <= x1 && t1 >= x0 - 4 * DIA) {
    x0 = Math.min(x0, t1);
    eventos.push({ t: t1, rot: '1º turno' });
  }
  const folga = Math.max((x1 - x0) * 0.02, 0.4 * DIA);
  const vals = [...serie.flatMap((p) => [p.l, p.f]), ...pesq.flatMap((p) => [p.l, p.f])].filter((v) => v !== null);
  let yLo;
  let yHi;
  let ref = null;
  let yPasso = 10;
  if (base === 'validos') {
    // Eixo simétrico em torno de 50%: 40% a 60% quando tudo cabe, abrindo de 5 em 5.
    const longe = Math.max(...vals.map((v) => Math.abs(v - 50))) + 1.5;
    const meia = Math.max(10, Math.ceil(longe / 5) * 5);
    yLo = 50 - meia;
    yHi = 50 + meia;
    yPasso = meia <= 15 ? 5 : 10;
    ref = 50;
  } else {
    yLo = 0;
    yHi = Math.max(60, Math.ceil((Math.max(...vals) + 4) / 10) * 10);
  }
  const mapaL = new Map(serie.filter((p) => p.l !== null).map((p) => [p.t, p.l]));
  const mapaF = new Map(serie.filter((p) => p.f !== null).map((p) => [p.t, p.f]));
  const soltos = [];
  for (const p of pesq) {
    if (p.l !== null) soltos.push({ t: p.t, y: p.l, cor: L.cor, vaz: p.fora });
    if (p.f !== null) soltos.push({ t: p.t, y: p.f, cor: F.cor, vaz: p.fora });
  }
  desenharLinhasTempo(el, {
    x0: x0 - folga,
    x1: x1 + folga,
    xs,
    rotX: serie.map((p) => p.t),
    yLo,
    yHi,
    yPasso,
    yFmt: (v) => `${v}%`,
    ref,
    eventos,
    soltos,
    series: [
      { cor: L.cor, pts: serie.map((p) => ({ t: p.t, y: p.l })), mapa: mapaL },
      { cor: F.cor, pts: serie.map((p) => ({ t: p.t, y: p.f })), mapa: mapaF },
    ],
    vFmt: (v) => fNum(v, 1),
    minDist: 46,
    dica: (t) => {
      const doDia = pesq.filter((p) => p.t === t);
      const temMedia = mapaL.has(t) || mapaF.has(t);
      return h`<p class="dica-tit">${fData(t)}</p>
        ${temMedia
          ? h`${linhaDica(L.cor, fPct(mapaL.get(t)), `${curto('lula')}, média`)}${linhaDica(F.cor, fPct(mapaF.get(t)), `${curto('flavio')}, média`)}`
          : h`<p class="dica-l"><span>sem ponto da média neste dia</span></p>`}
        ${doDia.length
          ? h`<p class="dica-sep">Pesquisas divulgadas no dia</p>${doDia.map(
              (p) => h`<p class="dica-l"><span>${p.casa}${p.fora ? ' (fora da média)' : ''}:</span> <b>${fNum(p.l) || '—'} × ${fNum(p.f) || '—'}</b></p>`,
            )}`
          : ''}`;
    },
  });
}

function desenharMercado(el) {
  const id = el.dataset.fonte;
  const hs = st.hist.get(`${id}:${st.dias}`);
  const pts = hs?.pontos;
  if (!pts?.length) return;
  const L = cand('lula');
  const F = cand('flavio');
  const xs = pts.map((p) => p.t);
  let x0 = xs[0];
  let x1 = xs[xs.length - 1];
  if (x1 - x0 < HORA) {
    x0 -= HORA;
    x1 += HORA;
  }
  const mapaL = new Map(pts.filter((p) => p.l !== null).map((p) => [p.t, p.l]));
  const mapaF = new Map(pts.filter((p) => p.f !== null).map((p) => [p.t, p.f]));
  desenharLinhasTempo(el, {
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
      { cor: L.cor, pts: pts.map((p) => ({ t: p.t, y: p.l })), mapa: mapaL },
      { cor: F.cor, pts: pts.map((p) => ({ t: p.t, y: p.f })), mapa: mapaF },
    ],
    vFmt: (v) => fNum(v, 1),
    minDist: 56,
    dica: (t) =>
      h`<p class="dica-tit">${fDataHora(t)}</p>${linhaDica(L.cor, fPct(mapaL.get(t), 1), curto('lula'))}${linhaDica(F.cor, fPct(mapaF.get(t), 1), curto('flavio'))}`,
  });
}

function desenharAbstencao(el) {
  const d = st.dados;
  if (!d) return;
  const linhas = linhasAbstencao(d);
  if (!linhas.length) {
    el.innerHTML = emHtml(lacunaBloco('Histórico da abstenção: sem dado ainda.'));
    return;
  }
  const W = Math.round(el.clientWidth);
  if (W < 60) return;
  const H = W < 500 ? 256 : 290;
  const m = { t: 26, r: 14, b: 30, l: 34 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const n = linhas.length;
  const sx = (i) => m.l + ((i + 0.5) / n) * iw;
  const vals = linhas.flatMap((r) => [r.t1, r.t2, ...(r.fx || [])]).filter((v) => v !== null && v !== undefined);
  if (!vals.length) {
    el.innerHTML = emHtml(lacunaBloco('Histórico da abstenção: sem números.'));
    return;
  }
  let lo = Math.floor((Math.min(...vals) - 1.5) / 5) * 5;
  const hi = Math.ceil((Math.max(...vals) + 1.5) / 5) * 5;
  if (hi - lo < 10) lo = hi - 10;
  lo = Math.max(0, lo);
  const sy = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
  const fundo = [];
  const marcas = [];
  const textos = [];
  for (const v of ticksY(lo, hi, 5)) {
    const y = n2(sy(v));
    fundo.push(`<line class="g" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/>`);
    fundo.push(`<text class="tk" x="${m.l - 6}" y="${n2(y + 3.5)}" text-anchor="end">${v}%</text>`);
  }
  fundo.push(`<line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`);
  linhas.forEach((r, i) => {
    fundo.push(`<text class="tk" x="${n2(sx(i))}" y="${H - m.b + 17}" text-anchor="middle">${r.ano}</text>`);
  });
  const caminho = (pts) => pts.map((p, k) => `${k ? 'L' : 'M'}${n2(p.x)},${n2(p.y)}`).join('');
  const p1 = linhas.map((r, i) => (r.t1 !== null ? { x: sx(i), y: sy(r.t1) } : null)).filter(Boolean);
  const p2 = linhas.map((r, i) => (r.t2 !== null && !r.est ? { x: sx(i), y: sy(r.t2) } : null)).filter(Boolean);
  if (p1.length) marcas.push(`<path class="ln" d="${caminho(p1)}" style="--c:${COR_T1}"/>`);
  if (p2.length) marcas.push(`<path class="ln" d="${caminho(p2)}" style="--c:${COR_T2}"/>`);
  const iEst = linhas.findIndex((r) => r.est);
  if (iEst >= 0) {
    const r = linhas[iEst];
    const x = sx(iEst);
    const ant = [...linhas.slice(0, iEst)].reverse().find((q) => q.t2 !== null && !q.est);
    if (ant) {
      const ia = linhas.indexOf(ant);
      marcas.push(`<path class="ln trac" d="M${n2(sx(ia))},${n2(sy(ant.t2))}L${n2(x)},${n2(sy(r.t2))}" style="--c:${COR_T2}"/>`);
    }
    if (r.fx) {
      const ya = n2(sy(r.fx[0]));
      const yb = n2(sy(r.fx[1]));
      marcas.push(`<line class="bigode" x1="${n2(x)}" x2="${n2(x)}" y1="${ya}" y2="${yb}" style="--c:${COR_T2}"/>`);
      marcas.push(`<line class="bigode" x1="${n2(x - 5)}" x2="${n2(x + 5)}" y1="${ya}" y2="${ya}" style="--c:${COR_T2}"/>`);
      marcas.push(`<line class="bigode" x1="${n2(x - 5)}" x2="${n2(x + 5)}" y1="${yb}" y2="${yb}" style="--c:${COR_T2}"/>`);
    }
  }
  linhas.forEach((r, i) => {
    const x = sx(i);
    const itens = [
      { v: r.t1, cor: COR_T1, vaz: false, leve: true },
      { v: r.t2, cor: COR_T2, vaz: r.est, leve: false },
    ].filter((q) => q.v !== null && q.v !== undefined);
    const ordenados = [...itens].sort((a, b) => b.v - a.v);
    ordenados.forEach((q, k) => {
      const y = sy(q.v);
      marcas.push(`<circle class="mk${q.vaz ? ' vaz' : ''}" cx="${n2(x)}" cy="${n2(y)}" r="4" style="--c:${q.cor}"/>`);
      let ty = k === 0 ? y - 9 : y + 17;
      if (q.vaz && r.fx && k === 0) ty = Math.min(ty, sy(r.fx[1]) - 6);
      if (q.vaz && r.fx && k === 1) ty = Math.max(ty, sy(r.fx[0]) + 14);
      textos.push(`<text class="rot${q.leve ? ' leve' : ''}" x="${n2(x)}" y="${n2(ty)}" text-anchor="middle">${esc(fNum(q.v, 1))}</text>`);
    });
  });
  const cruz = `<line class="cruz" x1="0" x2="0" y1="${m.t - 6}" y2="${H - m.b}" visibility="hidden"/><g class="realce"></g>`;
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">${fundo.join('')}${marcas.join('')}${cruz}${textos.join('')}</svg><div class="dica" hidden></div>`;
  el._dica = {
    xs: linhas.map((_, i) => sx(i)),
    conteudo: (i) => {
      const r = linhas[i];
      return h`<p class="dica-tit">${r.ano}</p>
        ${linhaDica(COR_T1, fPct(r.t1), '1º turno')}
        ${linhaDica(COR_T2, fPct(r.t2), r.est ? '2º turno, estimativa' : '2º turno')}
        ${r.est && r.fx ? h`<p class="dica-l"><span>faixa de ${fPct(r.fx[0])} a ${fPct(r.fx[1])}</span></p>` : ''}
        ${r.bn !== null && r.bn !== undefined ? h`<p class="dica-sep">Brancos e nulos no 2º turno: ${fPct(r.bn)}${r.est ? ' (estimativa)' : ''}</p>` : ''}`;
    },
    realce: (i) => {
      const r = linhas[i];
      return [
        r.t1 !== null ? { y: sy(r.t1), cor: COR_T1 } : null,
        r.t2 !== null ? { y: sy(r.t2), cor: COR_T2 } : null,
      ].filter(Boolean);
    },
    topo: 4,
  };
  ligarDica(el);
}

function barraH(x, y, len, esp) {
  const r = Math.min(4, len / 2, esp / 2);
  return `M${n2(x)},${n2(y)}h${n2(len - r)}a${r},${r} 0 0 1 ${r},${r}v${n2(esp - 2 * r)}a${r},${r} 0 0 1 -${r},${r}h-${n2(len - r)}z`;
}

function desenharBarras1T(el) {
  const t = obj(st.dados?.primeiro_turno);
  const lista = arr(t?.candidatos)
    .filter(obj)
    .filter((c) => num(c.validos_pct) !== null)
    .sort((a, b) => num(b.validos_pct) - num(a.validos_pct));
  if (!lista.length) {
    el.innerHTML = emHtml(lacunaBloco('Votos por candidato no 1º turno: sem dado ainda.'));
    return;
  }
  const W = Math.round(el.clientWidth);
  if (W < 60) return;
  const passo = 40;
  const esp = 10;
  const valW = 56;
  const H = lista.length * passo + 2;
  const max = Math.max(...lista.map((c) => num(c.validos_pct)), 0.0001);
  const comp = W - valW;
  const partes = [];
  const finalistas = new Map(['lula', 'flavio'].map((id) => [acharNo1T(lista, id), id]));
  lista.forEach((c, i) => {
    const v = num(c.validos_pct);
    const y0 = i * passo;
    const id = finalistas.get(c);
    const cor = id ? cand(id).cor : COR_OUTROS;
    const len = Math.max(2, (v / max) * comp);
    const titulo = `${c.nome || 'Sem nome'}${c.partido ? ` (${c.partido})` : ''}: ${fPct(v)} dos válidos${num(c.votos) !== null ? `, ${fInt(c.votos)} votos` : ''}`;
    partes.push(
      `<text class="nome-barra" x="0" y="${y0 + 13}">${esc(c.nome || 'Sem nome')}${c.partido ? `<tspan class="p"> · ${esc(c.partido)}</tspan>` : ''}</text>`,
    );
    partes.push(`<path d="${barraH(0, y0 + 20, len, esp)}" style="fill:${cor}"><title>${esc(titulo)}</title></path>`);
    partes.push(`<text class="val-barra" x="${n2(len + 6)}" y="${y0 + 29}">${esc(fPct(v))}</text>`);
  });
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">${partes.join('')}</svg>`;
}

const DESENHOS = { pesquisas: desenharPesquisas, mercado: desenharMercado, abstencao: desenharAbstencao, barras1t: desenharBarras1T };

function desenharVisiveis(forcar = false, raiz = document) {
  for (const el of $$('[data-grafico]', raiz)) {
    if (!el.isConnected || el.offsetParent === null) continue;
    const w = el.clientWidth;
    if (!forcar && el._w === w) continue;
    el._w = w;
    try {
      DESENHOS[el.dataset.grafico]?.(el);
    } catch (erro) {
      console.error('[2turno] gráfico', el.dataset.grafico, erro);
      el.innerHTML = emHtml(lacunaBloco('Gráfico indisponível agora.'));
    }
  }
}

/* --------------------------------------------------- dica dos gráficos */

function ligarDica(el) {
  if (el._ligado) return;
  el._ligado = true;
  // Mouse: a dica segue o cursor. Toque: aparece ao tocar e acompanha o dedo enquanto ele arrasta na
  // horizontal (a rolagem vertical continua da página: touch-action pan-y no gráfico).
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || el._baixo) moverDica(el, e.clientX);
  });
  el.addEventListener('pointerdown', (e) => {
    el._baixo = true;
    moverDica(el, e.clientX);
  });
  const soltar = () => {
    el._baixo = false;
  };
  el.addEventListener('pointerup', soltar);
  el.addEventListener('pointercancel', soltar);
  el.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') esconderDica(el);
  });
  el.addEventListener('keydown', (e) => {
    const info = el._dica;
    if (!info || !info.xs.length) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const n = info.xs.length;
      let i = el._idx ?? (e.key === 'ArrowLeft' ? n : -1);
      i += e.key === 'ArrowLeft' ? -1 : 1;
      mostrarDica(el, Math.max(0, Math.min(n - 1, i)));
    } else if (e.key === 'Escape') {
      esconderDica(el);
    }
  });
  el.addEventListener('blur', () => esconderDica(el));
}

function moverDica(el, clientX) {
  const info = el._dica;
  if (!info || !info.xs.length) return;
  const x = clientX - el.getBoundingClientRect().left;
  let melhor = 0;
  let dist = Infinity;
  info.xs.forEach((px, i) => {
    const dd = Math.abs(px - x);
    if (dd < dist) {
      dist = dd;
      melhor = i;
    }
  });
  mostrarDica(el, melhor);
}

function mostrarDica(el, i) {
  const info = el._dica;
  if (!info) return;
  el._idx = i;
  const x = info.xs[i];
  const cruz = el.querySelector('svg .cruz');
  const g = el.querySelector('svg .realce');
  if (cruz) {
    cruz.setAttribute('x1', n2(x));
    cruz.setAttribute('x2', n2(x));
    cruz.setAttribute('visibility', 'visible');
  }
  if (g) g.innerHTML = info.realce(i).map((p) => `<circle cx="${n2(x)}" cy="${n2(p.y)}" r="5" style="--c:${p.cor}"/>`).join('');
  const dica = el.querySelector('.dica');
  if (!dica) return;
  dica.innerHTML = emHtml(info.conteudo(i));
  dica.hidden = false;
  const W = el.clientWidth;
  const w = dica.offsetWidth;
  let left = x + 14;
  if (left + w > W) left = x - 14 - w;
  if (left < 0) left = Math.max(0, Math.min(W - w, x - w / 2));
  dica.style.left = `${Math.round(left)}px`;
  dica.style.top = `${Math.round(info.topo)}px`;
}

function esconderDica(el) {
  el._idx = undefined;
  const cruz = el.querySelector('svg .cruz');
  if (cruz) cruz.setAttribute('visibility', 'hidden');
  const g = el.querySelector('svg .realce');
  if (g) g.innerHTML = '';
  const dica = el.querySelector('.dica');
  if (dica) dica.hidden = true;
}

/* ------------------------------------------------------------ abas */

function abaDoHashTexto(hash) {
  const a = norm(String(hash || '').replace(/^#/, ''));
  return ABAS.includes(a) ? a : null;
}

function abaDoHash() {
  let s = location.hash.replace(/^#/, '');
  try {
    s = decodeURIComponent(s);
  } catch {
    /* hash malformado: ignora */
  }
  const a = norm(s);
  return ABAS.includes(a) ? a : null;
}

function mostrarAba(aba, rolar) {
  st.aba = aba;
  document.body.dataset.aba = aba;
  for (const p of $$('[data-painel]')) p.hidden = p.dataset.painel !== aba;
  for (const a of $$('.abas a')) {
    if (a.dataset.aba === aba) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = aba === 'resumo' ? '2º turno · Radar Eleitoral' : `${NOME_ABA[aba]} · 2º turno · Radar Eleitoral`;
  if (rolar) {
    const topo = $('.topo')?.offsetHeight ?? 0;
    if (window.scrollY > topo) window.scrollTo(0, topo);
  }
  desenharVisiveis(true);
  if (aba === 'mercados') {
    carregarHistoricos();
    montarHyperliquid();
  }
  if (st.apur) {
    if (aba === 'apuracao') st.apur.mostrar();
    else st.apur.esconder();
  }
  if (st.irPara) {
    const alvo = document.getElementById(st.irPara);
    st.irPara = null;
    if (alvo) alvo.scrollIntoView({ block: 'start' });
  }
}

/* ----------------------------------------------- folha de explicação */

function abrirFolha(termo) {
  const g = explicar(termo);
  const dlg = $('#folha');
  if (!dlg) return;
  $('#folha-tit').textContent = g.termo;
  $('#folha-txt').textContent = g.texto;
  if (typeof dlg.showModal === 'function') {
    if (!dlg.open) dlg.showModal();
  } else {
    dlg.setAttribute('open', '');
  }
}
function fecharFolha() {
  const dlg = $('#folha');
  if (!dlg) return;
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
}

function avisar(texto) {
  const el = $('#aviso-toque');
  if (!el) return;
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => {
    el.hidden = true;
  }, 2200);
}

async function compartilhar() {
  const dados = { title: document.title, text: 'Radar Eleitoral · 2º turno para presidente', url: location.href };
  if (navigator.share) {
    try {
      await navigator.share(dados);
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(location.href);
    avisar('Link copiado');
  } catch {
    avisar('Copie o endereço na barra do navegador');
  }
}

/* ---------------------------------------------------------- eventos */

// Refaz o rótulo e o resultado do simulador de abstenção por região a partir dos dois controles.
function atualizarSimAbst(caixa) {
  const cu = obj(st.dados?.projecao?.cenarios_uf);
  if (!caixa || !cu) return;
  const val = (k) => num(caixa.querySelector(`[data-sim-ab-in="${k}"]`)?.value) ?? 0;
  for (const k of ['nne', 'sul']) {
    const o = caixa.querySelector(`[data-sim-ab-v="${k}"]`);
    if (o) o.textContent = `${val(k) > 0 ? '+' : ''}${fNum(val(k), 1)} ${Math.abs(val(k)) < 2 ? 'ponto' : 'pontos'}`;
  }
  const res = caixa.querySelector('[data-sim-ab-res]');
  if (res) res.innerHTML = emHtml(htmlSimAbst(cu, val('nne'), val('sul')));
}

function ligarEventos() {
  // Simulador de abstenção por região: refaz a conta a cada movimento do controle.
  document.addEventListener('input', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-sim-ab-in]') : null;
    if (!el) return;
    const caixa = el.closest('[data-sim-ab]');
    if (caixa) atualizarSimAbst(caixa);
  });
  document.addEventListener('click', (e) => {
    const alvo = e.target instanceof Element ? e.target : null;
    if (!alvo) return;
    const bi = alvo.closest('.i[data-termo]');
    if (bi) {
      e.preventDefault();
      abrirFolha(bi.dataset.termo);
      return;
    }
    const bm = alvo.closest('[data-media]');
    if (bm && st.dados) {
      const ehCard = bm.classList.contains('mq-c');
      const mesma = bm.dataset.media === mediaSelKey(st.dados);
      if (!ehCard && mesma) return;
      if (ehCard) {
        const abrir = !(mesma && st.explicaAberta);
        st.animarExplica = abrir;
        st.explicaAberta = abrir;
      }
      st.mediaSel = bm.dataset.media;
      gravarPref('mediaSel2', st.mediaSel);
      marcarMedia();
      const seletor = bm.classList.contains('chip') ? `.chip[data-media="${st.mediaSel}"]` : `.mq-c[data-media="${st.mediaSel}"]`;
      const tinhaFoco = document.activeElement === bm;
      for (const c of $$('[data-bloco="pesquisas"]')) {
        const antes = lerPlacar(c);
        trocarHtml(c, blocoPesquisas(st.dados));
        animarPlacar(c, antes);
      }
      for (const el of $$('[data-tri]')) trocarHtml(el, htmlTriangulacao());
      if (tinhaFoco) $(seletor)?.focus({ preventScroll: true });
      if (ehCard && st.explicaAberta) $('#mq-explica')?.scrollIntoView({ block: 'nearest', behavior: reduzMovimento() ? 'auto' : 'smooth' });
      return;
    }
    const bs = alvo.closest('[data-subaba]');
    if (bs && st.dados) {
      if (bs.dataset.subaba === st.subaba) return;
      st.subaba = bs.dataset.subaba;
      const tinhaFoco = document.activeElement === bs;
      for (const c of $$('[data-bloco="pesquisas"]')) trocarHtml(c, blocoPesquisas(st.dados));
      if (tinhaFoco) $(`[data-subaba="${st.subaba}"]`)?.focus({ preventScroll: true });
      return;
    }
    const bd = alvo.closest('[data-dias]');
    if (bd) {
      const n = Number(bd.dataset.dias);
      if (n && n !== st.dias) {
        st.dias = n;
        gravarPref('dias', String(n));
        atualizarHistoricoDom();
        carregarHistoricos();
      }
      return;
    }
    const ac = alvo.closest('[data-acao]');
    if (ac) {
      const a = ac.dataset.acao;
      if (a === 'recarregar') carregarDados();
      else if (a === 'tv') entrarTV();
      else if (a === 'fechar-explica') {
        st.explicaAberta = false;
        for (const c of $$('[data-bloco="pesquisas"]')) trocarHtml(c, blocoPesquisas(st.dados));
        $(`.mq-c[data-media="${mediaSelKey(st.dados)}"]`)?.focus({ preventScroll: true });
      }
      else if (a === 'fechar-novas') ocultarNovas();
      else if (a === 'ver-novas') {
        e.preventDefault();
        st.irPara = st.avisoDestino || 'sec-casas';
        ocultarNovas();
        if (st.aba === 'pesquisas') mostrarAba('pesquisas', false);
        else location.hash = '#pesquisas';
      }
      else if (a === 'compartilhar') compartilhar();
      else if (a === 'fechar-folha') fecharFolha();
      return;
    }
    const ir = alvo.closest('a[data-ir]');
    if (ir) {
      st.irPara = `sec-${ir.dataset.ir}`;
      const destino = abaDoHashTexto(ir.getAttribute('href'));
      if (destino && destino === st.aba) {
        e.preventDefault();
        mostrarAba(destino, false);
      }
      return;
    }
    const aba = alvo.closest('.abas a');
    if (aba && aba.dataset.aba === st.aba) {
      e.preventDefault();
      const topo = $('.topo')?.offsetHeight ?? 0;
      if (window.scrollY > topo) window.scrollTo({ top: topo, behavior: 'smooth' });
    }
  });

  $('#folha')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) fecharFolha();
  });

  window.addEventListener('hashchange', () => {
    const a = abaDoHash();
    if (a) mostrarAba(a, true);
  });

  // Foto que não carrega vira as iniciais.
  document.addEventListener(
    'error',
    (e) => {
      const t = e.target;
      if (t instanceof HTMLImageElement && t.classList.contains('foto')) {
        const s = document.createElement('span');
        s.className = 'foto foto-ini';
        s.setAttribute('aria-hidden', 'true');
        s.textContent = t.dataset.ini || '?';
        t.replaceWith(s);
      }
    },
    true,
  );

  // Gráfico dentro de <details> só tem largura depois de aberto.
  document.addEventListener(
    'toggle',
    (e) => {
      const d = e.target;
      if (d instanceof HTMLDetailsElement && d.open) desenharVisiveis(false, d);
    },
    true,
  );

  document.addEventListener('pointerdown', (e) => {
    for (const g of $$('.graf')) if (!g.contains(e.target)) esconderDica(g);
  });

  let espera;
  const redesenhar = () => {
    clearTimeout(espera);
    espera = setTimeout(() => desenharVisiveis(false), 120);
  };
  if ('ResizeObserver' in window) new ResizeObserver(redesenhar).observe($('#conteudo'));
  else window.addEventListener('resize', redesenhar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && st.tv) sairTV();
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && st.tv) sairTV();
  });
  window.addEventListener('resize', () => {
    if (st.tv) zoomTV();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    atualizarContagem();
    if (!$('#novas')?.hidden) armarAvisoNovas();
    // Voltou para a aba (ou o Mac acordou): relê se o dado tem mais de 30 s ou se a última falhou.
    if (st.erro || Date.now() - st.lidoEm > 30000) carregarDados();
    if (Date.now() - st.mercEm > CFG.cadaMercado) atualizarMercados();
  });
  // A rede voltou: relê na hora, sem esperar o próximo minuto.
  window.addEventListener('online', () => {
    carregarDados();
    atualizarMercados();
  });
}

/* ------------------------------------------- transição entre as médias */

function lerPlacar(raiz) {
  const r = { num: {}, seg: {}, banda: null };
  for (const el of $$('[data-anim]', raiz)) r.num[el.dataset.anim] = Number(el.dataset.v);
  for (const el of $$('.barra [data-seg]', raiz)) r.seg[el.dataset.seg] = el.style.flexGrow;
  const b = $('.barra .banda', raiz);
  if (b) r.banda = { left: b.style.left, width: b.style.width };
  return r;
}

// Os números contam do valor antigo ao novo e a barra desliza; sem efeito extra.
function animarPlacar(raiz, antes) {
  if (reduzMovimento()) return;
  const segs = $$('.barra [data-seg]', raiz);
  const novos = segs.map((el) => el.style.flexGrow);
  const b = $('.barra .banda', raiz);
  const nb = b ? { left: b.style.left, width: b.style.width } : null;
  segs.forEach((el) => {
    if (antes.seg[el.dataset.seg]) el.style.flexGrow = antes.seg[el.dataset.seg];
  });
  if (b && antes.banda) {
    b.style.left = antes.banda.left;
    b.style.width = antes.banda.width;
  }
  void raiz.offsetWidth;
  requestAnimationFrame(() => {
    segs.forEach((el, i) => {
      el.style.flexGrow = novos[i];
    });
    if (b && nb) {
      b.style.left = nb.left;
      b.style.width = nb.width;
    }
  });
  for (const el of $$('[data-anim]', raiz)) {
    const de = antes.num[el.dataset.anim];
    const para = Number(el.dataset.v);
    if (!Number.isFinite(de) || !Number.isFinite(para) || de === para) continue;
    const casas = Number(el.dataset.casas) || 0;
    const suf = el.dataset.sufixo || '';
    const final = el.textContent;
    const t0 = performance.now();
    const passo = (agora) => {
      const k = Math.min(1, (agora - t0) / 450);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = k >= 1 ? final : `${nf(casas).format(de + (para - de) * e)}${suf}`;
      if (k < 1) requestAnimationFrame(passo);
    };
    el.textContent = `${nf(casas).format(de)}${suf}`;
    requestAnimationFrame(passo);
  }
}

/* ------------------------------------------------------------ modo TV */

// Tela cheia com letras grandes: antes das 17h mostra o topo do Resumo; depois, a apuração.
// Sai com Esc ou com um toque na tela.
// Cabe na largura e na altura: TV não rola. Mede a altura real do conteúdo e ajusta o zoom.
function zoomTV() {
  const raiz = document.documentElement.style;
  const main = $('#conteudo');
  const atual = Number(raiz.getPropertyValue('--tv-zoom')) || 1;
  const altura = main ? main.getBoundingClientRect().height / atual : 800;
  const faixa = document.body.classList.contains('com-faixa-sim') ? 56 : 0;
  const z = Math.max(0.6, Math.min(2.4, window.innerWidth / 1240, (window.innerHeight - faixa - 12) / Math.max(400, altura)));
  if (Math.abs(z - atual) / atual > 0.02) raiz.setProperty('--tv-zoom', String(Math.round(z * 100) / 100));
}
function entrarTV() {
  if (st.tv) return;
  st.tv = true;
  st.tvAbaAntes = st.aba;
  document.body.classList.add('tv');
  document.documentElement.style.setProperty('--tv-zoom', String(Math.max(1, Math.min(2.4, window.innerWidth / 1240))));
  const fe = msDe(st.dados?.eleicao?.fechamento) ?? msDe(CFG.fechamento);
  mostrarAba(Date.now() >= fe ? 'apuracao' : 'resumo', false);
  window.scrollTo(0, 0);
  try {
    const pedido = document.documentElement.requestFullscreen?.();
    if (pedido?.catch) pedido.catch(() => {});
  } catch {
    /* sem tela cheia: o modo TV funciona na janela mesmo */
  }
  avisar('Modo TV · Esc ou toque na tela para sair');
  requestAnimationFrame(() => requestAnimationFrame(zoomTV));
  clearInterval(st.tvTimer);
  st.tvTimer = setInterval(zoomTV, 3000);
  setTimeout(() => {
    if (st.tv) document.addEventListener('click', sairTV, { once: true });
  }, 300);
}
function sairTV() {
  if (!st.tv) return;
  st.tv = false;
  clearInterval(st.tvTimer);
  document.body.classList.remove('tv');
  document.removeEventListener('click', sairTV);
  if (document.fullscreenElement) {
    try {
      const pedido = document.exitFullscreen?.();
      if (pedido?.catch) pedido.catch(() => {});
    } catch {
      /* ignora */
    }
  }
  if (st.tvAbaAntes && st.tvAbaAntes !== st.aba) mostrarAba(st.tvAbaAntes, false);
}

/* ------------------------------------------------ apuração ao vivo */

// Cartões da Hyperliquid (EWZ e companhia) só ligam quando a aba Mercados abre: no celular, quem
// fica no Resumo não paga a conexão ao vivo.
let _hl = null;
function montarHyperliquid() {
  const raiz = $('#hl-vivo');
  if (!raiz) return;
  if (!_hl) _hl = import(URL_HYPERLIQUID).catch((e) => (console.error('[2turno] hyperliquid', e), null));
  _hl.then((m) => {
    try {
      m?.montar(raiz);
    } catch (e) {
      console.error('[2turno] hyperliquid', e);
    }
  });
}

async function carregarApuracao() {
  const painel = $('#painel-apuracao');
  if (!painel) return;
  // A apuração redesenha o próprio contêiner inteiro; o simulador do resultado final fica num irmão logo abaixo.
  const raiz = document.createElement('div');
  raiz.id = 'ap-vivo';
  raiz.innerHTML = painel.innerHTML;
  const raizSim = document.createElement('div');
  raizSim.id = 'ap-simulador';
  painel.replaceChildren(raiz, raizSim);
  import(URL_SIMULADOR)
    .then((m) => m.iniciar({ raiz: raizSim, painel, h, emHtml, num, txt, fNum, fInt, fHora, msDe, cand, curto, foto, lacunaBloco, params: PARAMS, dados: () => st.dados }))
    .catch((e) => console.error('[2turno] simulador', e));
  try {
    const mod = await import(URL_APURACAO);
    st.apur = mod.iniciar({
      raiz,
      h,
      emHtml,
      num,
      txt,
      fNum,
      fInt,
      fHora,
      fDataHora,
      msDe,
      cand,
      curto,
      foto,
      info,
      lacunaBloco,
      params: PARAMS,
      dados: () => st.dados,
      mercados: () => mercadosNormalizados(),
      desenharLinhasTempo,
      registrarDesenho: (tipo, fn) => {
        DESENHOS[tipo] = fn;
      },
      desenharGrafico: (el) => {
        if (!el?.isConnected || el.offsetParent === null) return;
        el._w = el.clientWidth;
        try {
          DESENHOS[el.dataset.grafico]?.(el);
        } catch (erro) {
          console.error('[2turno] gráfico', el.dataset.grafico, erro);
        }
      },
    });
    if (st.aba === 'apuracao') st.apur.mostrar();
  } catch (e) {
    raiz.innerHTML = emHtml(lacunaBloco(`Apuração ao vivo indisponível agora: o módulo não carregou (${erroLegivel(e).slice(0, 120)}).`));
  }
}

// Depois do fechamento das urnas (e por 3 dias), a página abre direto na apuração.
function abaPadrao() {
  if (PARAMS.get('eleicao') !== null || PARAMS.get('sim') !== null) return 'apuracao';
  const fe = msDe(st.dados?.eleicao?.fechamento) ?? msDe(CFG.fechamento);
  const agora = Date.now();
  return agora >= fe && agora < fe + 3 * DIA ? 'apuracao' : 'resumo';
}

/* ------------------------------------------------------------ início */

function iniciar() {
  // Chave nova em 24/10: todo mundo passa a abrir no Agregador próprio (a escolha antiga era a ponderada).
  st.mediaSel = lerPref('mediaSel2', 'radar');
  st.dias = lerPref('dias', '30') === '7' ? 7 : 30;
  instalarBandeira();
  const tb = $('#topo-bandeira');
  if (tb && !tb.firstChild) tb.innerHTML = emHtml(BANDEIRA);
  ligarEventos();
  atualizarContagem();
  setInterval(atualizarContagem, 1000);
  mostrarAba(abaDoHash() || abaPadrao(), false);
  carregarDados();
  atualizarMercados();
  carregarApuracao();
  setInterval(carregarDados, CFG.cadaDado);
  setInterval(atualizarMercados, CFG.cadaMercado);
}

iniciar();
