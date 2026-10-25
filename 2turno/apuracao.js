/* Radar Eleitoral · 2º turno · APURAÇÃO AO VIVO (o "processador" da noite de 25/10)
 *
 * Módulo ES sem dependências, carregado pelo app.js com import dinâmico.
 * - Lê o TSE direto do navegador (CORS liberado): Brasil a cada 1 s; a abrangência
 *   (progresso de cada UF, um arquivo só) a cada 1 s diz quais UFs mudaram, e só essas
 *   são relidas, até 5 por vez, na hora em que a rede do TSE renova a cópia do arquivo
 *   (o Cache-Control de cada resposta diz quando). As 27 capitais (arquivo de cada
 *   município) são lidas a cada ~30 s, escalonadas, sem nunca atrasar o Brasil nem os
 *   estados. Detalhes em "leitura do TSE".
 * - Projeta o resultado final UF por UF: o que já foi apurado + o que falta,
 *   misturando o observado na UF com a prévia (modelo_uf do JSON; se faltar,
 *   o cálculo de reserva descrito em montarBase).
 * - Projeção final: dois motores. O simulador municipal do Mac (simulador.js repassa o
 *   arquivo) quando o dado tem até 3 min e cobre parte relevante; senão, o modelo por UF
 *   desta página. A tela diz qual está em uso e mostra os dois quando divergem.
 * - Chance de vitória por Monte Carlo (2.000 sorteios, sementes fixas para o
 *   número não "tremer" entre leituras). Os MESMOS sorteios dão a chance de cada
 *   estado (fatia de sorteios em que cada candidato vence naquele estado), então a
 *   chance nacional e as dos estados são coerentes entre si.
 * - Painel "Estados, número a número" (todos os 27 + Exterior), situação de cada estado
 *   (aguardando, indefinido, provável, definido) e destaques ("O que está
 *   acontecendo") com 1º turno, histórico 2002-2022, capitais e pesquisas.
 * - Urnas apuradas (v5, 24/10/2026): o TSE conta seções eleitorais, e cada seção tem uma urna. A página mostra
 *   "312.450 de 499.248 urnas apuradas (62,58%)" no país, "N de M urnas" em cada estado (tabela, detalhe, ícone e
 *   rótulo do ladrilho) e usa as urnas que faltam, o ritmo (urnas por minuto) e a fase de cada estado em quatro
 *   destaques novos (urnas-onde, urnas-ritmo, urnas-fases, urnas-triangulacao). O percentual apurado sai de
 *   seções totalizadas ÷ seções (st ÷ ts), com piso: nunca arredonda para cima.
 * - Tela estável (v5): no iPhone o Safari não tem "scroll anchoring", então tudo que muda de altura acima da leitura faz a
 *   página pular. Por isso cada bloco ao vivo tem altura reservada pelo pior caso (CSS no fim do style.css e, para o que
 *   depende da largura real, medições únicas: reservarLinhasUF e reservarDuo): os destaques ocupam seis espaços de altura
 *   fixa (texto cortado com "ler tudo", troca no lugar), a faixa "a projeção aponta virada" tem sempre o mesmo tamanho, as
 *   linhas dos estados têm a altura do pior caso e as ordens "% apurado" e "Mais disputados" só refazem ao toque. Nada rola
 *   a página sozinho: só o toque do leitor (abrir um estado) faz scroll. Medido com overflow-anchor desligado: CLS < 0,05.
 * - Erros de rede nunca aparecem em inglês: a linha de status traduz ("sem conexão com o TSE neste momento;
 *   tentando de novo em N s"). O texto técnico fica só no console e no gancho de teste.
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
  // Ritmo de leitura do TSE (medido na rede real em 24/10/2026, resultados.tse.jus.br, Akamai):
  // cada resposta traz Cache-Control: max-age = tempo que falta para a cópia daquela máquina vencer
  // (59 s logo depois de renovada), mas a máquina RENOVA a cópia sozinha quando ela chega a ~12 s
  // de idade: numa conexão fixa o max-age vai de 57 a 45 e volta a 57, de 12 em 12 s, e é nesse
  // ritmo que um número novo do TSE chega a quem lê. Ninguém, nem o site do TSE, vê um número
  // antes de a máquina renovar a cópia. O que esta página controla é o tempo entre a renovação
  // e a tela: lê o Brasil e a abrangência a cada 1 s, com pedido condicional (If-None-Match; sem
  // mudança o TSE responde 304, uns 300 bytes), e caça os estados que a abrangência diz que
  // mudaram na hora em que o max-age mostra que a máquina vai renovar. Nada de parâmetro na URL
  // para "furar" o cache e nada de cabeçalho que force preflight: iria até a origem do TSE.
  // Custo por aba aberta: ~2 pedidos/s de 304 + estados que mudam + capitais (ver o fim do arquivo).
  CADA_BR_MS: 1000,
  CADA_AB_MS: 1000,
  // Relógio interno (decide o que pedir) e variação sorteada em cada espera (aparelhos não sincronizam).
  TIQUE_MS: 250,
  JITTER: 0.08,
  // Renovação da cópia na rede do TSE: idade, em s, em que a máquina renova (aprendida em tempo real,
  // este é o ponto de partida) e max-age de uma cópia recém-renovada.
  RENOVA_S: 12.5,
  TTL_REDE_S: 59,
  // Caça a um estado que a abrangência diz ter mudado: desiste depois deste tempo (a leitura de rotina segue).
  CACA_MAX_MS: 60000,
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
  INS_MIN: { vs1t: 20, virou: 30, placar: 10, regiao: 15, termometro: 30, capital: 20, capitais: 30, momento: 5, pesquisas: 15, transf: 1, ponto: 8, falta: 15, ritmo: 12, urnas: 15, urnasRitmo: 12, urnasFase: 10 },
  // Destaques das urnas (v5). Estado entra em "onde estão as urnas que faltam" com ao menos URNAS_LISTA_MIN urnas por apurar;
  // "quase pronto" = URNAS_FECHADO% das urnas ou mais; "mal começou" = abaixo de URNAS_LARGADA%; o ritmo pede uma janela de
  // URNAS_JANELA_MIN minutos (de preferência 15) e ao menos URNAS_RITMO_MIN urnas novas dentro dela.
  URNAS_LISTA_MIN: 300,
  URNAS_FECHADO: 95,
  URNAS_LARGADA: 10,
  URNAS_JANELA_MIN: 10,
  URNAS_JANELA_PREF: 15,
  URNAS_RITMO_MIN: 100,
  // Eleitores por urna na simulação (o país tem 158,7 milhões de eleitores em 499.248 seções).
  ELEITORES_POR_URNA_SIM: 318,
  // Atrasos (hora da totalização do TSE → hora da leitura aqui) guardados para a mediana.
  ATRASOS_N: 30,
  // Estados: no máximo 5 pedidos no ar; cada um relido quando a abrangência avisa que
  // mudou e, como rede de segurança, ao menos a cada 60 s enquanto conta (15 s se a
  // abrangência falhar; 5 min depois de 100% totalizado).
  UF_PARALELO: 5,
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
  // Projeção final pelo simulador municipal do Mac: arquivo com até 3 min (4 min para sair, histerese),
  // ao menos 5% das seções e 8% do eleitorado no modelo; mostra os dois motores se divergirem mais que 1 ponto.
  SIM_FRESCO_MS: 180000,
  SIM_FRESCO_SAI_MS: 240000,
  SIM_MIN_SECOES: 5,
  SIM_MIN_MODELADO: 8,
  DIVERGE_PP: 1.0,
  // Curva da contagem de referência (1º turno de 2026 e 2º turno de 2022), arquivo opcional do site.
  CURVA_URL: '/data/pocket/curva_apuracao.json',
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

// Cores: tudo vem das variáveis CSS do site (modo escuro). Os valores abaixo só entram se a variável
// faltar (por exemplo, se o CSS ainda não carregou). A chance de vitória usa --chance-verde e
// --chance-vermelho (não são cores de partido).
const TEMA_PADRAO = {
  fundo: '#0f1115', cartao: '#171a21', sobreTinta: '#0f1115', tinta: '#eceef2', tinta2: '#b9bfca', tinta3: '#8d95a3',
  linha: '#262b35', linha2: '#363c48', suave: '#1b1f27', suave2: '#232832',
  lula: '#ef4a5e', lulaTexto: '#ff7b8a', flavio: '#5b8cf0', flavioTexto: '#8fb0ff',
  vivo: '#34c27a', alerta: '#f2c46b', chanceVerde: '#176b3d', chanceVermelho: '#a83a38',
};
const TEMA_VARS = {
  fundo: '--fundo', cartao: '--cartao', sobreTinta: '--sobre-tinta', tinta: '--tinta', tinta2: '--tinta-2', tinta3: '--tinta-3',
  linha: '--linha', linha2: '--linha-2', suave: '--suave', suave2: '--suave-2',
  lula: '--lula', lulaTexto: '--lula-texto', flavio: '--flavio', flavioTexto: '--flavio-texto',
  vivo: '--vivo', alerta: '--alerta', chanceVerde: '--chance-verde', chanceVermelho: '--chance-vermelho',
};
let temaCache = null;
let temaEm = 0;
// Lê as variáveis CSS (cache de 5 s: o tema não muda no meio da noite, mas o CSS pode chegar depois do módulo).
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
    t[k] = corParaRgb(x) ? x : TEMA_PADRAO[k];
  }
  temaCache = t;
  temaEm = agora;
  return t;
}

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
  ufOrd: 'regiao', // ordem do painel Estados: regiao | maiores | disputa | apurado
  ufOrdEm: 0, // última reordenação das linhas (ms)
  ev: [], // eventos da noite (estado decidido, virada, troca de liderança, marcos de urnas), do mais novo ao mais antigo
  evN: 0,
  evNovo: false,
  evOk: false, // só avisa depois da primeira leitura com votos (quem abre no meio da noite não recebe tudo de uma vez)
  evT0: 0,
  histAberto: false, // histórico 2002-2022 aberto no detalhe do estado
  insTodos: false, // lista "Ver todos" aberta
  insVisto: new Map(), // id do destaque → { d: desde quando aparece (ms), u: última vez visto (ms) }
  cap: new Map(), // capitais: cod → arquivo do TSE lido
  atrasos: [], // hora da totalização do TSE × hora em que esta página viu a versão
  simDoc: null, // simulador.json do Mac, repassado pelo simulador.js ({ doc, em, modo })
  motorSim: false, // a projeção final está usando o simulador municipal (com histerese: entra com 3 min, sai com 4)
  curva: null, // curva da contagem de referência (1º turno de 2026 e 2º turno de 2022): objeto, ou false se o arquivo não existe
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
// Cor em #rgb, #rrggbb, rgb() ou rgba() → [r, g, b] (ou null).
function corParaRgb(s) {
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
const hexRgb = (hx) => corParaRgb(hx) ?? [0, 0, 0];
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
  const a = hexRgb(T.tinta);
  const b = hexRgb(T.sobreTinta);
  return contraste(fundoRgb, a) >= contraste(fundoRgb, b) ? T.tinta : T.sobreTinta;
}
// Do neutro ao verde forte (quem ganha chance) ou ao vermelho (quem perde), sobre o fundo escuro.
function corChance(p) {
  const T = tema();
  if (p === null || p === undefined || !Number.isFinite(p)) return { fundo: rgb(hexRgb(T.suave)), tinta: T.tinta, forca: 0, neutro: true };
  const forca = Math.pow(Math.min(1, Math.abs(p - 0.5) * 2), 0.8);
  const c = misturar(T.suave, p >= 0.5 ? T.chanceVerde : T.chanceVermelho, forca);
  return { fundo: rgb(c), tinta: tintaSobre(c), forca, neutro: forca < 0.02 };
}
// Ladrilho com números: fundo escuro com um toque da cor de quem lidera na projeção (mais forte = margem
// maior); os números nas cores de texto dos candidatos (--lula-texto / --flavio-texto) ficam legíveis em cima.
function corLadrilhoNum(corPartido, margem, prev) {
  const T = tema();
  const t = prev ? 0.05 + Math.min(0.08, margem * 0.4) : 0.08 + Math.min(0.14, (margem / 0.3) * 0.14);
  const c = misturar(T.cartao, corPartido, t);
  return { fundo: rgb(c), tinta: tintaSobre(c) };
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

// Botão "i" das urnas: abre a folha de explicação do site (a mesma dos demais termos), com texto próprio desta aba.
const iUrnas = () =>
  C.h`<button type="button" class="i" data-ap-termo="urnas" aria-label="O que são urnas apuradas?"><span aria-hidden="true">i</span></button>`;
const EXPLICA_AP = {
  urnas: [
    'Urnas (seções)',
    'O TSE (Tribunal Superior Eleitoral) conta a apuração por seção eleitoral, e cada seção eleitoral tem uma urna: urnas e seções são a mesma contagem. “312.450 de 499.248 urnas apuradas” quer dizer que 312.450 seções já foram totalizadas, de 499.248 no país. O percentual é urnas apuradas ÷ urnas, sem arredondar para cima: só chega a 100% com todas. Em média, cada urna tem pouco mais de 300 eleitores aptos, e nem todos comparecem; por isso as urnas que faltam não viram votos na mesma proporção em todo estado.',
  ],
};
function abrirExplicaAp(chave) {
  const x = EXPLICA_AP[chave];
  const dlg = document.getElementById('folha');
  const tit = document.getElementById('folha-tit');
  const txt = document.getElementById('folha-txt');
  if (!x || !dlg || !tit || !txt) return;
  tit.textContent = x[0];
  txt.textContent = x[1];
  if (typeof dlg.showModal === 'function') {
    if (!dlg.open) dlg.showModal();
  } else dlg.setAttribute('open', '');
}

// Urnas (= seções eleitorais, uma urna por seção). Número inteiro com ponto de milhar; "uma urna" no singular.
const fUrn = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : C.fInt(v));
const urnasTxt = (n) => `${fUrn(n)} ${n === 1 ? 'urna' : 'urnas'}`;
// Eleitores aptos por extenso curto, com a preposição certa: "58,3 milhões de eleitores aptos", "812 mil eleitores aptos".
function eleitoresAptos(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${votosCurto(a)} de eleitores aptos`;
  return `${votosCurto(a)} ${a === 1 ? 'eleitor apto' : 'eleitores aptos'}`;
}
// Ritmo em urnas por minuto: inteiro a partir de 10, uma casa abaixo disso.
const fRate = (v) => (v >= 10 ? C.fInt(Math.round(v)) : C.fNum(v, 1));
// Regiões para somar urnas (ZZ = Exterior); a ordem é a dos vetores guardados em cada ponto da série.
const REGS = ['N', 'NE', 'CO', 'SE', 'S', 'EX'];
const REGS_NOME = { N: 'Norte', NE: 'Nordeste', CO: 'Centro-Oeste', SE: 'Sudeste', S: 'Sul', EX: 'Exterior' };
// Urnas apuradas por região (vetor na ordem de REGS); null onde falta ler algum estado da região.
function urnasPorRegiao(linhas) {
  return REGS.map((g) => {
    let s = 0;
    for (const u of linhas) {
      if (REGIAO[u.uf] !== g) continue;
      if (u.st === null) return null;
      s += u.st;
    }
    return s;
  });
}
function urnasTotaisRegiao(linhas) {
  return REGS.map((g) => {
    let s = 0;
    for (const u of linhas) {
      if (REGIAO[u.uf] !== g) continue;
      if (u.ts === null) return null;
      s += u.ts;
    }
    return s;
  });
}
// Urnas do país para a tela: do mesmo arquivo do apurado (Brasil, ou a soma dos 28 estados quando todos foram lidos).
// Antes de qualquer leitura de voto, o total vem da abrangência. Sem os dois números, não mostra nada.
function urnasNacional(cont) {
  let st = null;
  let ts = cont.ts > 0 ? cont.ts : null;
  if (cont.fonte === 'br' || (cont.fonte === 'estados' && ts !== null)) st = Number.isFinite(cont.st) ? cont.st : null;
  else if (cont.fonte === 'nada') st = 0;
  if (ts === null && st !== null) {
    const abTs = R.ab?.br?.ts;
    ts = abTs > 0 ? abTs : null;
  }
  if (st === null || ts === null) return null;
  return { st, ts, falta: Math.max(0, ts - st), pct: (st / ts) * 100, aptos: Math.max(0, (cont.te ?? 0) - (cont.est ?? 0)), fonte: cont.fonte };
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
  const st = pBR(s.st);
  const ts = pBR(s.ts);
  return {
    st,
    ts,
    // % das seções: seções totalizadas ÷ seções (o mesmo número que as urnas mostram). O pst do arquivo vem arredondado
    // e chega a "100,00" com seções faltando; sem st/ts, vale o do arquivo.
    pst: ts > 0 && st !== null ? (st / ts) * 100 : pBR(s.pstn ?? s.pst) ?? 0,
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
    // Urnas (= seções, uma urna por seção): apuradas, total e as que faltam. Sem leitura do estado só se sabe o total
    // (a abrangência traz o de todos os estados); as apuradas só vêm do arquivo do próprio estado, para a tela nunca
    // mostrar um número da abrangência e depois um menor do arquivo.
    const abTs = R.ab?.ufs?.get(uf)?.ts;
    const ts = o ? (o.ts > 0 ? o.ts : null) : abTs > 0 ? abTs : null;
    const st = o && o.st !== null ? o.st : null;
    const urnasFalta = ts !== null && st !== null ? Math.max(0, ts - st) : null;
    return { uf, b, o, te, est, f, L, F, vv: o ? o.vv : 0, shareObs, compObs, bnObs, fim, sec, st, ts, urnasFalta };
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
  const urnas = urnasNacional(cont);
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
  const projUF = {
    L: projL,
    F: projF,
    pL: totalVal > 0 ? (projL / totalVal) * 100 : null,
    pF: totalVal > 0 ? (projF / totalVal) * 100 : null,
    parL: projL + projF > 0 ? (projL / (projL + projF)) * 100 : null,
    motor: 'estados',
  };
  // Motor da projeção final: o simulador municipal do Mac, quando o dado é recente e cobre parte relevante; senão, o
  // modelo por estado desta página. Os dois ficam à mão: a tela mostra os dois quando divergem.
  const sim = projecaoSimulador(cont);
  const proj = sim ? sim.proj : projUF;
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
  let pLUF;
  let pDiv = false;
  let pBruto = null; // antes da suavização (o ensaio confere a regra por ele)
  if (tudo || definido) {
    pL = dif > 0 ? 1 : dif < 0 ? 0 : 0.5;
    pLUF = pL;
  } else if (eleitoTSE) {
    pL = eleitoTSE === 'lula' ? 1 : 0;
    pLUF = pL;
  } else {
    // 100% e 0% ficam para quando está decidido; antes disso, no máximo ">99%".
    pLUF = clamp(mc.nac, 0.001, 0.999);
    pL = pLUF;
    if (sim && Number.isFinite(sim.chanceL)) {
      // O simulador municipal tem a palavra, mas não sozinho: quando ele e o modelo por estado (contas independentes)
      // se afastam mais de 25 pontos de chance, a tela mostra a média dos dois e diz que divergem. No ensaio da noite,
      // um simulador com viés de 1,4 ponto deu >99% para quem perdeu.
      const pS = clamp(sim.chanceL, 0.001, 0.999);
      pDiv = Math.abs(pS - pLUF) > 0.25;
      pL = pDiv ? (pS + pLUF) / 2 : pS;
    }
    pBruto = pL;
    pL = suavizarChance(pL);
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
    linhas, swing, g, fNac, rem, remCont, remMax: remMaxCont, cont, urnas, proj, projUF, sim, motor: sim ? 'simulador' : 'estados', pL, pLUF, pDiv, pBruto, faixaUF: mc.faixa,
    definido, tudo, eleitoTSE, decidido, lidos, semLeitura, completo, totalVal,
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
// A chance mostrada caminha para a nova em ~30 s em vez de saltar: na disputa apertada do ensaio, cada leitura nova
// do simulador trocava o favorito (de 12% para 76% em 28 s). Decidido não passa por aqui.
function suavizarChance(p) {
  const t = A.modo === 'sim' ? A.sim?.relogio ?? Date.now() : Date.now(); // na simulação, o relógio da noite fictícia
  const s = A._pSuave;
  const out = !s ? p : t > s.t ? s.p + (p - s.p) * (1 - Math.exp(-(t - s.t) / 30000)) : s.p;
  A._pSuave = { p: out, t };
  return out;
}

function montecarlo(linhas, projL, projF, rem) {
  const z = normais();
  const S = UFS.length + 1;
  const V = projL + projF;
  const uf = new Float64Array(linhas.length);
  if (V <= 0) {
    uf.fill(0.5);
    return { nac: 0.5, uf, faixa: null };
  }
  const phi = clamp(rem / V, 0, 1);
  const sNac = (A.base.sigmaNac / 100) * phi;
  const d0 = A.base.sigmaNac / 100; // deslocamento nacional comum, em fração dos válidos que faltam
  const base = projL - projF;
  const ms = new Float64Array(MODELO.SORTEIOS);
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
    ms[k] = m;
    vit += m > 0 ? 1 : m === 0 ? 0.5 : 0;
  }
  for (let i = 0; i < uf.length; i++) uf[i] /= MODELO.SORTEIOS;
  // Faixa de 80% da participação final de Lula nos válidos (os mesmos sorteios da chance).
  ms.sort();
  const parte = (q) => clamp((V + ms[Math.floor(q * (MODELO.SORTEIOS - 1))]) / (2 * V), 0, 1) * 100;
  return { nac: vit / MODELO.SORTEIOS, uf, faixa: [parte(0.1), parte(0.9)] };
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
    // Mesma régua da faixa "Virada à vista": afirmar só com 80% de chance ou mais para quem a projeção aponta.
    const chLp = lp === 'lula' ? r.pL : 1 - r.pL;
    out.push(
      chLp >= 0.8
        ? { id: 'virada', tag: BR, p: 95, tom: 'forte', html: h`A projeção já aponta <b>${n(lp)}</b>, embora <b>${n(lc)}</b> lidere a contagem.` }
        : { id: 'virada', tag: BR, p: 90, html: h`Disputa aberta: <b>${n(lc)}</b> lidera a contagem, e a projeção dá a <b>${n(lp)}</b> ${chanceTxt(chLp)} de chance de virar. Ainda dá para os dois.` },
    );
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

  // k) neste ponto da contagem, em eleições anteriores (arquivo curva_apuracao.json; sem ele, nada disto aparece)
  const contando = r.cont.pst > 0 && r.cont.pst < 99.5 && !r.tudo && !r.decidido;
  if (contando && r.cont.pst >= MIN.ponto && r.cont.L + r.cont.F > 0 && A.curva) {
    const p = r.cont.pst;
    const hoje = (100 * r.cont.L) / (r.cont.L + r.cont.F);
    const dif = r.cont.L - r.cont.F;
    const refs = A.curva.series.map((s) => ({ s, ...pontoCurva(s, p) })).filter((x) => x.ok);
    for (const x of refs) {
      const s = x.s;
      const adv = nomeAdvCurva(s);
      const liderRef = x.dif >= 0 ? n('lula') : adv;
      const fimPar = s.final.par_pt_pct;
      const virada = s.trocas_pct?.length ? s.trocas_pct[0] : null;
      const viradaTxt =
        virada === null ? '' : virada > p ? h` ${n('lula')} só passou à frente aos <b>${C.fNum(virada, 0)}%</b> apurados.` : h` A virada já tinha acontecido, aos ${C.fNum(virada, 0)}%.`;
      out.push({
        id: `ponto-${s.id}`,
        tag: 'Histórico',
        p: s.turno === 1 ? 57 : 56,
        html: h`Neste ponto da contagem (<b>${pctPiso(p, 0)}</b> das seções), ${s.turno === 1 ? 'no 1º turno' : 'no 2º turno'} de ${s.ano}, ${liderRef} liderava por <b>${votosDif(x.dif)}</b> (${x.dif >= 0 ? '' : n('lula') + ' com '}<b>${pct1(x.par)}</b> dos votos dos dois); no fim, ${n('lula')} chegou a <b>${pct1(fimPar)}</b> (${sinalPP(fimPar - x.par)} ${pontosTxt(fimPar - x.par)}).${viradaTxt} Hoje: ${n('lula')} <b>${pct1(hoje)}</b>. <span class="ap-nota-in">Contagens de eleições diferentes chegam em ordens diferentes: compare a tendência, não o número.</span>`,
      });
    }
    if (refs.length) {
      const quemHoje = dif > 0 ? n('lula') : dif < 0 ? n('flavio') : null;
      const partes = refs.map((x) => {
        const q = x.dif >= 0 ? n('lula') : nomeAdvCurva(x.s);
        return h`<b>${votosCurto(Math.abs(x.dif))}</b> a favor de ${q} ${x.s.turno === 1 ? 'no 1º turno' : 'no 2º turno'} de ${x.s.ano}`;
      });
      out.push({
        id: 'diferenca-ponto',
        tag: 'Histórico',
        p: 54,
        html: h`${quemHoje ? h`Na contagem de agora, ${quemHoje} está à frente por <b>${votosDif(dif)}</b>.` : 'A contagem de agora está empatada.'} No mesmo ponto (${pctPiso(p, 0)} das seções), a diferença era de ${partes.map((x, i) => h`${i ? ' e de ' : ''}${x}`)}.`,
      });
    }
  }

  // l) onde está o que falta e o que deve render, por região
  if (contando && r.cont.pst >= MIN.falta && r.rem > 0) {
    const nomeR = { ...REGIAO_NOME, EX: 'Exterior' };
    const { por, netTot } = faltaPorRegiao(r);
    const lista = Object.entries(por)
      .map(([g, v]) => ({ g, ...v }))
      .filter((x) => x.rem >= 20000)
      .sort((a, b) => b.rem - a.rem)
      .slice(0, 3);
    const dif = r.cont.L - r.cont.F;
    const lc2 = lider(r.cont.L, r.cont.F);
    if (lista.length && lc2) {
      const quemNet = netTot >= 0 ? 'lula' : 'flavio';
      const veredito = vereditoFalta(h, n, netTot, dif, lc2);
      out.push({
        id: 'falta-regiao',
        tag: 'Brasil',
        p: 59,
        html: h`O que falta apurar, por região (estimativa da mesa): ${lista.map((x, i) => h`${i ? '; ' : ''}<b>${nomeR[x.g]}</b> ${votosCurto(x.rem)} de votos válidos, saldo de ${votosCurto(Math.abs(x.net))} para ${n(x.net >= 0 ? 'lula' : 'flavio')}`)}. Somando o país, o que falta deve render <b>+${votosCurto(Math.abs(netTot))}</b> a ${n(quemNet)}; hoje ${n(lc2)} está à frente por ${votosCurto(Math.abs(dif))}: ${veredito}.`,
      });
    }
  }

  // m) ritmo da contagem e quando chega a 95% (faixa entre o ritmo de 2022 e o do 1º turno de 2026)
  const rit = ritmoContagem();
  if (contando && rit && r.cont.pst >= MIN.ritmo) {
    const eta = rit.eta;
    const nomeSerie = (s) => (s.turno === 1 ? `do 1º turno de ${s.ano}` : `de ${s.ano}`);
    let tail = '';
    if (eta?.length === 1) {
      tail = h` Pelo ritmo de hoje, com a reta final ${nomeSerie(eta[0].s)}, 95% das seções sai por volta de <b>${C.fHora(eta[0].t)}</b> (estimativa).`;
    } else if (eta?.length >= 2) {
      const [a, b] = eta;
      tail =
        Math.abs(b.t - a.t) <= 120000
          ? h` Pelo ritmo de hoje, 95% das seções sai por volta de <b>${C.fHora(a.t)}</b> (estimativa).`
          : h` Pelo ritmo de hoje, com a reta final ${nomeSerie(a.s)}, 95% das seções sai por volta de <b>${C.fHora(a.t)}</b>; com a reta final mais lenta ${nomeSerie(b.s)}, por volta de <b>${C.fHora(b.t)}</b> (estimativas).`;
    }
    out.push({
      id: 'ritmo-contagem',
      tag: 'Brasil',
      p: 45,
      html: h`Nos últimos <b>${rit.min} min</b>, a apuração foi de ${pctPiso(rit.de, 0)} para <b>${pctPiso(rit.ate, 0)}</b> das seções (${C.fNum(rit.porMin, 1)} ${rit.porMin < 2 ? 'ponto' : 'pontos'} por minuto${rit.votosMin ? `, uns ${votosCurto(rit.votosMin)} votos válidos por minuto` : ''}).${tail}`,
    });
  }

  // n) as urnas (seções) que faltam: onde estão, em que ritmo entram, fase de cada estado e a conta do que vem por aí
  insightsUrnas(r, out, { n, h, MIN, contando });
}

// Quatro destaques com as urnas apuradas (uma urna por seção): onde estão as que faltam, o ritmo, a fase de cada estado e a
// triangulação urnas × comparecimento × participação projetada. Cada um tem mínimo de apuração (INS_MIN) para não nascer
// com a contagem ainda no início, e nenhum fala em resultado nacional: só em estimativa do que falta.
function insightsUrnas(r, out, { n, h, MIN, contando }) {
  if (!contando) return;
  const c = r.cont;
  const ufs = r.linhas.filter((u) => u.uf !== 'ZZ');
  const todasLidas = r.linhas.every((u) => u.o && u.st !== null && u.ts !== null);

  // a) onde estão as urnas que faltam e o que devem render (estados com mais urnas por apurar)
  if (c.pst >= MIN.urnas && todasLidas && r.rem > 0) {
    const totFalta = r.linhas.reduce((s, u) => s + u.urnasFalta, 0);
    const maiores = r.linhas
      .filter((u) => u.urnasFalta >= MODELO.URNAS_LISTA_MIN)
      .sort((a, b) => b.urnasFalta - a.urnasFalta || b.te - a.te)
      .slice(0, 3);
    if (maiores.length && totFalta > 0) {
      const parte = maiores.reduce((s, u) => s + u.urnasFalta, 0) / totFalta;
      const itens = maiores.map((u, i) => {
        const net = u.rem * (2 * u.share - 1);
        const saldo = Math.abs(net) < 500 ? 'saldo esperado perto de zero' : `saldo esperado de ${votosCurto(Math.abs(net))} para ${n(net >= 0 ? 'lula' : 'flavio')}`;
        return h`${i ? '; ' : ''}<b>${nomeUF(u.uf)}</b> ${urnasTxt(u.urnasFalta)} (${pctPiso(u.sec, 0)} apurado), ${saldo}`;
      });
      out.push({
        id: 'urnas-onde',
        tag: 'Estado',
        p: 52,
        html: h`Onde estão as urnas que faltam: ${itens}. ${maiores.length === 1 ? 'Esse estado tem' : `Os ${maiores.length} juntos têm`} <b>${C.fNum(parte * 100, 0)}%</b> das ${fUrn(totFalta)} urnas que faltam no país. O saldo é a estimativa da mesa para os votos que ainda vão entrar.`,
      });
    }
  }

  // b) ritmo em urnas por minuto, no país e por região
  const rt = ritmoUrnas();
  if (rt && c.pst >= MIN.urnasRitmo) {
    const tsReg = urnasTotaisRegiao(r.linhas);
    const stReg = urnasPorRegiao(r.linhas);
    const pctReg = (i) => (tsReg[i] > 0 && stReg[i] !== null ? (stReg[i] / tsReg[i]) * 100 : null);
    const lista = rt.regs
      .map((x, i) => (x && x.d > 0 && pctReg(i) !== null ? { ...x, i, taxa: x.d / rt.dMin, pct: pctReg(i) } : null))
      .filter(Boolean)
      .sort((a, b) => b.d - a.d);
    const paradas = rt.regs
      .map((x, i) => (x && x.d === 0 && pctReg(i) !== null && pctReg(i) < 100 ? { ...x, i, pct: pctReg(i) } : null))
      .filter(Boolean);
    const porRegiao = lista.length
      ? h` Por região: ${lista.map((x, i) => h`${i ? '; ' : ''}<b>${REGS_NOME[x.g]}</b> ${fRate(x.taxa)} por minuto (${pctPiso(x.pct, 0)} apurado)`)}.`
      : '';
    const sem = paradas.length ? h` Sem urna nova no período: ${paradas.map((x, i) => h`${i ? '; ' : ''}${REGS_NOME[x.g]} (${pctPiso(x.pct, 0)} apurado)`)}.` : '';
    out.push({
      id: 'urnas-ritmo',
      tag: 'Brasil',
      p: 46,
      html: h`Nos últimos <b>${rt.min} min</b> entraram <b>${fUrn(rt.d)}</b> urnas no país, em média <b>${fRate(rt.porMin)} por minuto</b>.${porRegiao}${sem}`,
    });
  }

  // c) fase de cada estado: quase prontos (95% das urnas ou mais) e os que mal começaram (abaixo de 10%)
  if (c.pst >= MIN.urnasFase) {
    const lidos = ufs.filter((u) => u.o && u.st !== null && u.ts > 0);
    const pctU = (u) => (u.st / u.ts) * 100;
    const prontos = lidos.filter((u) => pctU(u) >= MODELO.URNAS_FECHADO).sort((a, b) => b.te - a.te);
    const largada = lidos.filter((u) => pctU(u) < MODELO.URNAS_LARGADA).sort((a, b) => b.te - a.te);
    if (prontos.length || largada.length) {
      const totE = ufs.reduce((s, u) => s + u.te, 0) || 1;
      const nL = prontos.filter((u) => u.lider === 'lula').length;
      const nF = prontos.filter((u) => u.lider === 'flavio').length;
      const parte1 = prontos.length
        ? h`<b>${prontos.length}</b> ${prontos.length === 1 ? 'estado já passou' : 'estados já passaram'} de ${MODELO.URNAS_FECHADO}% das urnas (${nomesUF(prontos.map((u) => u.uf))}): ${n('lula')} lidera em <b>${nL}</b> e ${n('flavio')} em <b>${nF}</b>`
        : '';
      const parte2 = largada.length
        ? h`<b>${largada.length}</b> ${largada.length === 1 ? 'ainda está' : 'ainda estão'} abaixo de ${MODELO.URNAS_LARGADA}% (${nomesUF(largada.map((u) => u.uf))}), com <b>${C.fNum((largada.reduce((s, u) => s + u.te, 0) / totE) * 100, 1)}%</b> do eleitorado: ali a projeção ainda se apoia mais na prévia do que na contagem`
        : '';
      out.push({
        id: 'urnas-fases',
        tag: 'Estado',
        p: 53,
        html: h`Fase da contagem por estado, pelas urnas apuradas: ${parte1}${prontos.length && largada.length ? '; ' : ''}${parte2}.`,
      });
    }
  }

  // d) triangulação: urnas que faltam × eleitores por urna × comparecimento × brancos e nulos × participação projetada
  const u0 = r.urnas;
  const lc = lider(c.L, c.F);
  if (c.pst >= MIN.urnas && u0 && u0.falta > 0 && u0.aptos > 0 && r.rem > 0 && r.remCont > 0 && lc) {
    const aptosUF = r.linhas.reduce((s, u) => s + u.remMax, 0);
    const compens = r.linhas.reduce((s, u) => s + u.remMax * clamp(u.comp, 0, 1), 0);
    if (aptosUF > 0 && compens > 0) {
      const comp = compens / aptosUF;
      const bn = 1 - r.rem / compens;
      const shareL = r.linhas.reduce((s, u) => s + u.rem * u.share, 0) / r.rem;
      const { netTot } = faltaPorRegiao(r);
      const dif = c.L - c.F;
      const quemNet = netTot >= 0 ? 'lula' : 'flavio';
      out.push({
        id: 'urnas-triangulacao',
        tag: 'Brasil',
        p: 61,
        html: h`Triangulação do que falta: <b>${urnasTxt(u0.falta)}</b>, com ${eleitoresAptos(u0.aptos)} (cerca de <b>${C.fInt(u0.aptos / u0.falta)}</b> por urna). Com comparecimento esperado de <b>${C.fNum(comp * 100, 1)}%</b> e <b>${C.fNum(bn * 100, 1)}%</b> de brancos e nulos, são uns <b>${votosDif(r.remCont, 'válido')}</b>. Pela mesa, ${n('lula')} fica com <b>${C.fNum(shareL * 100, 1)}%</b> deles, saldo de <b>+${votosCurto(Math.abs(netTot))}</b> para ${n(quemNet)}; hoje ${n(lc)} está à frente por ${votosCurto(Math.abs(dif))}: ${vereditoFalta(h, n, netTot, dif, lc)}.`,
      });
    }
  }
}

// Votos válidos que faltam e saldo esperado (Lula − Flávio) por região, pela conta de cada estado (rem e share).
function faltaPorRegiao(r) {
  const por = {};
  for (const u of r.linhas) {
    const g = REGIAO[u.uf];
    por[g] = por[g] || { rem: 0, net: 0 };
    por[g].rem += u.rem;
    por[g].net += u.rem * (2 * u.share - 1);
  }
  const netTot = Object.values(por).reduce((s, v) => s + v.net, 0);
  return { por, netTot };
}
// O que o saldo esperado do que falta quer dizer para a diferença de hoje (dif = Lula − Flávio na contagem).
function vereditoFalta(h, n, netTot, dif, lc) {
  const quemNet = netTot >= 0 ? 'lula' : 'flavio';
  const suficiente = (netTot > 0 && dif < 0 && netTot > -dif) || (netTot < 0 && dif > 0 && -netTot > dif);
  return suficiente
    ? h`pela estimativa, o que falta é suficiente para ${n(quemNet)} passar à frente`
    : quemNet === lc
      ? h`o que falta reforça a vantagem de ${n(lc)}`
      : h`pela estimativa, o que falta não chega para ${n(quemNet)} virar`;
}

// "São Paulo, Minas Gerais e mais 2" (nomes sem preposição, até max nomes).
function nomesUF(ufs, max = 4) {
  const nomes = ufs.slice(0, max).map(nomeUF);
  const mais = ufs.length - nomes.length;
  if (mais > 0) nomes.push(`mais ${mais}`);
  return nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : nomes[0] || '';
}

// Ritmo da contagem em urnas por minuto: país e regiões, da série da própria tela (hora da totalização do TSE). Janela de
// 15 min (ou, sem ponto tão antigo, a série toda desde que tenha ao menos 10 min), com ao menos URNAS_RITMO_MIN urnas novas.
function ritmoUrnas() {
  const s = A.serie.filter((x) => Number.isFinite(x.t) && Number.isFinite(x.st));
  if (s.length < 3) return null;
  const ult = s[s.length - 1];
  let ref = null;
  for (let i = s.length - 2; i >= 0; i--) {
    if (s[i].t <= ult.t - MODELO.URNAS_JANELA_PREF * 60000) {
      ref = s[i];
      break;
    }
  }
  if (!ref && ult.t - s[0].t >= MODELO.URNAS_JANELA_MIN * 60000) ref = s[0];
  if (!ref) return null;
  const dMin = (ult.t - ref.t) / 60000;
  const d = ult.st - ref.st;
  if (!(dMin >= MODELO.URNAS_JANELA_MIN) || !(d >= MODELO.URNAS_RITMO_MIN)) return null;
  const regs = REGS.map((g, i) => {
    const a = ult.rg?.[i];
    const b = ref.rg?.[i];
    return Number.isFinite(a) && Number.isFinite(b) && a >= b ? { g, d: a - b } : null;
  });
  return { min: Math.round(dMin), dMin, d, porMin: d / dMin, regs, t: ult.t };
}

// Valor da curva de referência (votos acumulados dos dois finalistas) quando a contagem estava em p% das seções.
function pontoCurva(s, p) {
  const x = s?.pct;
  if (!Array.isArray(x) || x.length < 3 || !(p > 0)) return { ok: false };
  const interp = (arrY, i, t) => arrY[i] + (arrY[i + 1] - arrY[i]) * t;
  let i = 0;
  while (i < x.length - 2 && x[i + 1] <= p) i++;
  const t = clamp((p - x[i]) / (x[i + 1] - x[i]), 0, 1);
  const pt = interp(s.pt, i, t);
  const adv = interp(s.adv, i, t);
  if (!(pt + adv > 0)) return { ok: false };
  return { ok: true, pt, adv, par: (100 * pt) / (pt + adv), dif: pt - adv, min: interp(s.min, i, t) };
}
// Minuto (depois das 17h) em que a série de referência chegou a p% das seções.
const minutoCurva = (s, p) => {
  const r = pontoCurva(s, p);
  return r.ok ? r.min : null;
};
// Adversário de Lula em cada série, como a página o chama.
const nomeAdvCurva = (s) => (s.id === '2t2022' ? 'Bolsonaro' : C.curto('flavio'));

// Ritmo da contagem nos últimos ~15 min (da própria série da tela, na hora do TSE) e quando chega a 95% pelas curvas
// de referência. Só com ao menos 10 min de série, avanço de ao menos 1 ponto e ritmo parecido nas duas metades.
function ritmoContagem() {
  const s = A.serie.filter((x) => Number.isFinite(x.t) && Number.isFinite(x.pst) && x.pst > 0);
  if (s.length < 4) return null;
  const ult = s[s.length - 1];
  let ref = null;
  for (let i = s.length - 2; i >= 0; i--) {
    if (s[i].t <= ult.t - 15 * 60000) {
      ref = s[i];
      break;
    }
  }
  if (!ref && ult.t - s[0].t >= 10 * 60000) ref = s[0];
  if (!ref) return null;
  const dMin = (ult.t - ref.t) / 60000;
  const dP = ult.pst - ref.pst;
  if (dMin < 10 || dP < 1) return null;
  // metades: ritmo parecido nas duas
  const meioT = ref.t + (ult.t - ref.t) / 2;
  let mid = ref;
  for (const x of s) if (x.t <= meioT && x.t >= ref.t) mid = x;
  const p1 = ((mid.pst - ref.pst) / Math.max(1e-9, (mid.t - ref.t) / 60000));
  const p2 = ((ult.pst - mid.pst) / Math.max(1e-9, (ult.t - mid.t) / 60000));
  if (!(p1 > 0 && p2 > 0) || p2 / p1 > 2 || p1 / p2 > 2) return null;
  const votosMin = Number.isFinite(ult.vv) && Number.isFinite(ref.vv) && ult.vv > ref.vv ? (ult.vv - ref.vv) / dMin : null;
  let eta = null;
  if (A.curva && ult.pst < 93) {
    const ts = [];
    for (const sr of A.curva.series) {
      const ma = minutoCurva(sr, ref.pst);
      const mb = minutoCurva(sr, ult.pst);
      const m95 = minutoCurva(sr, 95);
      if (ma === null || mb === null || m95 === null || mb - ma < 2) continue;
      const k = clamp(dMin / (mb - ma), 0.4, 3);
      ts.push({ s: sr, t: ult.t + k * (m95 - mb) * 60000 });
    }
    if (ts.length) eta = ts.sort((a, b) => a.t - b.t);
  }
  return { min: Math.round(dMin), de: ref.pst, ate: ult.pst, porMin: dP / dMin, votosMin, eta };
}

// Curva da contagem de referência (1º turno de 2026 e 2º turno de 2022). Arquivo opcional do site; sem ele, os destaques
// "Neste ponto da contagem" e a estimativa de horário simplesmente não aparecem.
async function carregarCurva() {
  if (A.curva !== null) return;
  A.curva = false;
  // se a rede falhar na hora, tenta mais uma vez daqui a 90 s (404 = o site ainda não publicou o arquivo: não insiste)
  const outraVez = () => {
    if ((A.curvaTent ?? 0) < 1) {
      A.curvaTent = (A.curvaTent ?? 0) + 1;
      setTimeout(() => {
        if (A.curva === false) {
          A.curva = null;
          carregarCurva();
        }
      }, 90000);
    }
  };
  try {
    const r = await fetch(MODELO.CURVA_URL, { cache: 'no-cache' });
    if (!r.ok) {
      if (r.status >= 500) outraVez();
      return;
    }
    const d = await r.json();
    const num = (v) => Number.isFinite(v);
    const series = arr(d?.series).filter(
      (s) =>
        s && typeof s.id === 'string' && num(s.turno) && num(s.ano) && Array.isArray(s.pct) && s.pct.length >= 10 &&
        ['pt', 'adv', 'min'].every((k) => Array.isArray(s[k]) && s[k].length === s.pct.length && s[k].every(num)) &&
        s.pct.every(num) && obj(s.final) && num(s.final.par_pt_pct),
    );
    if (series.length) {
      A.curva = { series };
      if (A.res && A.raiz && A.modo === 'vivo') pedirTela();
    }
  } catch {
    /* sem curva: tudo segue sem os destaques históricos por ponto da contagem */
    outraVez();
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

/* Projeção final pelo simulador municipal. Devolve null (e a tela usa o modelo por estado) se: não há arquivo do
 * simulador, ele é de teste fora do teste, tem mais de 3 min (4 min para sair, histerese), cobre menos de 5% das seções
 * ou 8% do eleitorado, está mais de 15 pontos de seções atrás da leitura do TSE feita aqui, ou veio sem os números.
 * Com tudo apurado, a projeção é o próprio resultado e o motor não importa (tela usa a contagem). */
function projecaoSimulador(cont) {
  A.simParado = null;
  A.simAval = null;
  const s = simVivo();
  if (!s) {
    A.motorSim = false;
    return null;
  }
  const d = s.doc;
  const ger = C.num(d.gerado_ms);
  const p = obj(d.projecao);
  const ap = obj(d.apuracao);
  const lulaPct = C.num(p?.lula_pct);
  const flavioPct = C.num(p?.flavio_pct);
  const secoes = C.num(ap?.secoes_pct);
  const modelado = C.num(ap?.eleitorado_modelado_pct);
  const vot = obj(p?.votos);
  const vL = C.num(vot?.lula);
  const vF = C.num(vot?.flavio);
  const agora = A.modo === 'sim' ? Date.now() : Date.now();
  if (ger === null || lulaPct === null || flavioPct === null || vL === null || vF === null || secoes === null || modelado === null) {
    A.motorSim = false;
    return null;
  }
  const idade = agora - ger;
  const lim = A.motorSim ? MODELO.SIM_FRESCO_SAI_MS : MODELO.SIM_FRESCO_MS;
  const atras = (cont?.pst ?? 0) - secoes;
  A.simAval = { ger, idade, secoes, modelado, lulaPct, faixa: p?.faixa80?.lula ?? null, chance: C.num(p?.chance?.lula), vL, vF, antes: A.motorSim, atras };
  const cobre = secoes >= MODELO.SIM_MIN_SECOES && modelado >= MODELO.SIM_MIN_MODELADO;
  if (idade > lim || idade < -600000 || !cobre || atras > 15) {
    A.motorSim = false;
    // o simulador existe mas não serve agora: a tela diz por quê, em uma linha
    A.simParado = { ger, idade, cobre, atras, secoes };
    return null;
  }
  A.motorSim = true;
  const fx = Array.isArray(p?.faixa80?.lula) ? p.faixa80.lula : null;
  const ch = C.num(p?.chance?.lula);
  return {
    doc: d,
    ger,
    idade,
    secoes,
    modelado,
    faixa: fx && C.num(fx[0]) !== null && C.num(fx[1]) !== null ? [C.num(fx[0]), C.num(fx[1])] : null,
    chanceL: ch,
    comparecimento: C.num(p?.comparecimento_pct),
    proj: { L: vL, F: vF, pL: lulaPct, pF: flavioPct, parL: lulaPct, motor: 'simulador' },
  };
}

// "Quando fica definido", só com fatos do simulador: desde quando (e com quanto apurado) a faixa de 80% deixou de
// incluir 50% e continua assim. Não projeta o futuro: antes disso, só diz que a faixa ainda inclui 50%.
function faixaDefinida(doc) {
  const s = arr(doc?.serie).filter((x) => x && Number.isFinite(x.t) && Number.isFinite(x.pct) && Number.isFinite(x.lula) && Number.isFinite(x.lo) && Number.isFinite(x.hi));
  if (s.length < 3) return null;
  const ult = s[s.length - 1];
  const lado = (x) => (x.lo > 50 ? 1 : x.hi < 50 ? -1 : 0);
  const l0 = lado(ult);
  if (l0 === 0) return { fora: false, lo: ult.lo, hi: ult.hi };
  let i = s.length - 1;
  while (i > 0 && lado(s[i - 1]) === l0) i--;
  return { fora: true, quem: l0 > 0 ? 'lula' : 'flavio', t: s[i].t, pct: s[i].pct, n: s.length - i };
}

// Destaque na tela (v5): etiqueta + texto dentro de .ap-corpo (que o CSS limita a poucas linhas, com "ler tudo"), e o botão
// "ler tudo / recolher" por cima da última linha. Altura fixa por espaço: o conteúdo que muda nunca empurra o resto da página.
function criarLi(x, completa) {
  const li = document.createElement('li');
  li.dataset.id = x.id;
  li.className = 'ap-in';
  li.innerHTML = `<div class="ap-corpo"><span class="ap-tag t-${slugTag(x.tag)}">${x.tag}</span><span class="ap-txt"></span></div>${completa ? '<small class="ap-desde"></small>' : ''}<button type="button" class="ap-mais" aria-expanded="false" tabindex="-1"></button>`;
  return li;
}
// Marca o destaque que não cabe nas linhas do espaço (para mostrar "ler tudo"). Só mexe em classe e texto do botão: o tamanho não muda.
function medirCorte(li) {
  const c = li.querySelector('.ap-corpo');
  const bt = li.querySelector('.ap-mais');
  if (!c || !bt) return;
  const aberto = li.classList.contains('aberto');
  const corta = aberto || c.scrollHeight > c.clientHeight + 2;
  li.classList.toggle('cortado', corta);
  const rot = aberto ? 'recolher' : 'ler tudo';
  if (bt.textContent !== rot) bt.textContent = rot;
  bt.setAttribute('aria-expanded', aberto ? 'true' : 'false');
  bt.tabIndex = corta ? 0 : -1;
}
function medirCortes() {
  for (const li of $$('.ap-in')) medirCorte(li);
}
function preencherLi(li, x, completa, animar) {
  const corpo = C.emHtml(x.html);
  const trocou = li.dataset.id !== x.id;
  if (trocou) {
    li.dataset.id = x.id;
    li.classList.remove('aberto');
    const tg = li.querySelector('.ap-tag');
    tg.className = `ap-tag t-${slugTag(x.tag)}`;
    tg.textContent = x.tag;
    li._h = undefined;
  }
  let mudou = false;
  if (li._h !== corpo) {
    mudou = li._h !== undefined;
    li.querySelector('.ap-txt').innerHTML = corpo;
    li._h = corpo;
    medirCorte(li);
  }
  li.classList.toggle('forte', x.tom === 'forte');
  if (animar && !reduzMovimento()) {
    if (trocou) {
      // só a opacidade: troca de destaque no mesmo espaço, sem mexer no tamanho
      li.classList.add('entrando');
      requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove('entrando')));
      setTimeout(() => li.classList.remove('entrando'), 600); // aba em segundo plano não roda requestAnimationFrame
    } else if (mudou && (!li._acesoEm || Date.now() - li._acesoEm > 20000)) {
      // Acende no máximo a cada 20 s: com a leitura a cada poucos segundos os números mudam toda hora.
      li._acesoEm = Date.now();
      li.classList.remove('mudou');
      void li.offsetWidth;
      li.classList.add('mudou');
    }
  }
  if (completa) {
    const d = li.querySelector('.ap-desde');
    const t = A.insVisto.get(x.id)?.d;
    const txt = t ? `desde ${C.fHora(t).replace('h', ':')}` : '';
    if (d && d.textContent !== txt) d.textContent = txt;
  }
}
// Lista com espaços fixos (v5, celular e computador): o espaço i mostra o i-ésimo destaque; quando o destaque do espaço muda,
// o texto é trocado no lugar (sem inserir nem tirar linhas da página), então o que está abaixo nunca se mexe sozinho.
function sincronizarSlots(ol, itens) {
  if (ol._modo !== 'slots') {
    ol.innerHTML = '';
    ol._modo = 'slots';
  }
  while (ol.children.length > itens.length) ol.lastElementChild.remove();
  itens.forEach((x, i) => {
    let li = ol.children[i];
    if (!li) {
      li = criarLi(x, false);
      ol.appendChild(li);
      li.classList.add('entrando');
      requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove('entrando')));
      setTimeout(() => li.classList.remove('entrando'), 600);
    }
    preencherLi(li, x, false, true);
  });
}
// Sincroniza uma lista de destaques sem recriar o que já está na tela: o que continua só troca o texto (se mudou); o que
// entra anima de cima; o que sai desliza para a direita. Usada na lista completa ("Ver todos") e no Modo TV.
function sincronizarLista(ol, itens, { animar, completa }) {
  if (ol._modo !== 'lista') {
    ol.innerHTML = '';
    ol._modo = 'lista';
  }
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
    if (!li) {
      li = criarLi(x, completa);
      li.className = `ap-in${animar ? ' entrando' : ''}`;
      if (animar) {
        requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove('entrando')));
        setTimeout(() => li.classList.remove('entrando'), 600); // aba em segundo plano não roda requestAnimationFrame
      }
    }
    preencherLi(li, x, completa, animar);
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
  if (emTV()) sincronizarLista(ol, mostrar, { animar: true, completa: false });
  else sincronizarSlots(ol, mostrar);
  const vazio = $('[data-ap-ins-vazio]');
  if (vazio) vazio.hidden = mostrar.length > 0;
  // Lista completa (Ver todos): todos os destaques vivos, com a etiqueta e o "desde".
  const todos = $('[data-ap-ins-todos]');
  const bt = $('[data-ap="ins-todos"]');
  if (bt) {
    const rot = A.insTodos ? 'Esconder a lista' : `Ver todos (${lista.length})`;
    if (bt.textContent !== rot) bt.textContent = rot;
    bt.setAttribute('aria-expanded', A.insTodos ? 'true' : 'false');
    // o botão fica sempre no lugar (sem destaque ainda, só desabilitado): aparecer e sumir mexeria na página
    bt.disabled = lista.length === 0;
  }
  if (todos) {
    todos.hidden = !A.insTodos || lista.length === 0;
    if (A.insTodos) sincronizarLista(todos, lista, { animar: false, completa: true });
  }
  // depois de tudo no lugar (e visível): quais destaques não cabem nas linhas do espaço (mostram "ler tudo")
  medirCortes();
}

/* ================================================================ estados */

/* v6 (24/10/2026): os 27 estados e o Exterior em cartões do mesmo tamanho, agrupados por região (Norte, Nordeste,
 * Centro-Oeste, Sudeste, Sul e, por último, Exterior). O mesmo cartão serve à prévia e à apuração: antes do primeiro voto
 * mostra a prévia do estado; na contagem, o apurado, a barra de urnas e a situação (definido, provável). Quando um estado
 * muda de situação ou de líder, o cartão pulsa e o evento entra na lista "Agora". Tocar num cartão abre o detalhe numa
 * folha (só números, sem texto explicativo). A ordem "Mais apurados" e "Mais disputados" só é refeita quando o leitor
 * toca no botão: reordenar sozinho, com a leitura em curso, faria os cartões pularem enquanto ele lê. */

// Com uma casa, sem arredondar para cima: "99,9%" e nunca "100%" com seção faltando.
const um = (v) => Math.round(v * 10) / 10;
const f1 = (v) => C.fNum(v, 1);
const fSec1 = (v) => (v > 0 && v < 0.1 ? '<0,1%' : v >= 100 ? '100%' : `${C.fNum(Math.floor(v * 10) / 10, 1)}%`);
const f1p = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : C.fNum(um(v), 1));
// Votos em forma curta para cartões: "9,1 mi", "820 mil", "312".
function votosMi(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `${C.fNum(Math.round((a / 1e6) * 10) / 10, 1)} mi`;
  if (a >= 1e3) return `${C.fNum(Math.round(a / 1e3), 0)} mil`;
  return C.fNum(Math.round(a), 0);
}

// Troca o número contando do valor antigo ao novo; devolve true quando o valor mudou
// (a primeira pintura não conta como mudança).
function numLad(el, para, fmt, dur = 600) {
  if (!el) return false;
  if (el._v === para) return false;
  const mudou = el._v !== undefined;
  animarNumero(el, para, fmt, dur);
  return mudou;
}

// Acende uma vez (0,7 s). Na noite real a leitura é a cada 10 s; na simulação acelerada os números mudam a cada segundo, e o
// intervalo mínimo de 3 s por cartão evita que o painel pisque sem parar. Respeita prefers-reduced-motion.
function brilhar(el, forte) {
  if (reduzMovimento()) return;
  const agora = Date.now();
  if (!forte && el._brilhoEm && agora - el._brilhoEm < 3000) return;
  el._brilhoEm = agora;
  el.classList.remove('rx-brilha');
  void el.offsetWidth;
  el.classList.add('rx-brilha');
  clearTimeout(el._brilho);
  el._brilho = setTimeout(() => el.classList.remove('rx-brilha'), 800);
}

const eleitoradoUF = (uf) => A.base?.ufs.get(uf)?.eleitorado ?? (PARTE_2022[uf] ?? 0) * ELEITORADO_2026;
const ORDENS = [
  ['regiao', 'Por região'],
  ['maiores', 'Maiores'],
  ['disputa', 'Mais disputados'],
  ['apurado', 'Mais apurados'],
];
const ufsDaRegiao = (g) => UFS.filter((uf) => REGIAO[uf] === g).sort((a, b) => eleitoradoUF(b) - eleitoradoUF(a));

function htmlCartaoUF(uf, contagem) {
  const h = C.h;
  const sg = uf === 'ZZ' ? 'EXT' : uf;
  const peso = (eleitoradoUF(uf) / ELEITORADO_2026) * 100;
  return h`<li class="rx-it" data-uf="${uf}"><button type="button" class="rx-uf prev" data-uf="${uf}" aria-label="${nomeUF(uf)}" aria-haspopup="dialog">
    <span class="rx-c1" aria-hidden="true"><b class="rx-sg">${sg}</b><i class="rx-st" data-st></i><small class="rx-pv">prévia</small></span>
    <span class="rx-c2" aria-hidden="true"><span class="rx-n rx-nl"><em>L</em><b data-pl>—</b></span><span class="rx-n rx-nf"><b data-pf>—</b><em>F</em></span></span>
    <span class="rx-c3" aria-hidden="true"><span class="rx-div"><i data-bl></i></span></span>
    <span class="rx-c4" aria-hidden="true">${contagem
      ? h`<span class="rx-urn"><i data-b></i></span><b class="rx-sp" data-sp>0%</b>`
      : h`<small class="rx-k">eleitorado</small><b class="rx-sp">${C.fNum(peso, peso < 1 ? 2 : 1)}%</b>`}</span>
  </button></li>`;
}

function htmlEstados(contagem) {
  const h = C.h;
  const ords = contagem ? ORDENS : ORDENS.filter(([k]) => k !== 'apurado');
  return h`<div class="rx-ufs" style="--uf-l:${tema().lulaTexto};--uf-f:${tema().flavioTexto}">
    <div class="rx-ord" role="group" aria-label="Ordenar os estados">${ords.map(([k, rot]) => h`<button type="button" class="rx-ord-b" data-ap="ord-uf" data-ord="${k}" aria-pressed="${A.ufOrd === k ? 'true' : 'false'}">${rot}</button>`)}</div>
    <div class="rx-regs" data-rx-regs>${REGS.map((g) => h`<section class="rx-reg" data-reg="${g}" aria-label="${REGS_NOME[g]}">
      <header class="rx-reg-cab"><h3>${REGS_NOME[g]}</h3><span class="rx-reg-p"><b data-rg-p>—</b> <small data-rg-u>${contagem ? 'urnas' : 'do eleitorado'}</small></span><span class="rx-reg-bar" aria-hidden="true"><i data-rg-b></i></span></header>
      <ol class="rx-grade" data-grade="${g}">${ufsDaRegiao(g).map((uf) => htmlCartaoUF(uf, contagem))}</ol>
    </section>`)}</div>
    <ol class="rx-grade rx-todos" data-rx-todos hidden></ol>
    <dialog class="rx-sheet" data-rx-sheet aria-label="Detalhe do estado"><div class="rx-sheet-in" data-rx-sheet-in></div></dialog>
  </div>`;
}

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

// "3.120 de 5.000 urnas" (estado lido) ou "5.000 urnas" (só o total, antes da primeira leitura do estado); '' sem dado.
function urnasLinha(u) {
  if (u.st !== null && u.ts !== null) return `${fUrn(u.st)} de ${fUrn(u.ts)} urnas`;
  if (u.ts !== null) return `${fUrn(u.ts)} urnas`;
  if (u.st !== null) return urnasTxt(u.st);
  return '';
}

function atualizarCartaoUF(u, contagem) {
  const el = $(`.rx-uf[data-uf="${u.uf}"]`);
  if (!el) return;
  const comVoto = contagem && !!u.o && u.L + u.F > 0;
  // Sem voto contado (ou antes das 17h) o cartão mostra a prévia do estado; com voto, o apurado.
  let pL;
  if (comVoto) pL = um(u.parObs);
  else {
    const pj = u.projL + u.projF > 0 ? u.projL / (u.projL + u.projF) : u.share;
    pL = um(pj * 100);
  }
  const pF = um(100 - pL);
  const quem = pL >= 50 ? 'lula' : 'flavio';
  const cor = corLadrilhoNum(C.cand(quem).cor, Math.abs(pL - 50) / 50, !comVoto);
  el.style.setProperty('--rx-bg', cor.fundo);
  el.style.setProperty('--rx-acc', C.cand(quem).cor);
  const [br, bg, bb] = hexRgb(C.cand(quem).cor);
  el.style.setProperty('--brilho', `rgba(${br},${bg},${bb},0.5)`);
  el.classList.toggle('prev', !comVoto);
  el.classList.toggle('lid-l', quem === 'lula');
  el.classList.toggle('lid-f', quem === 'flavio');
  el.classList.toggle('sel', A.ufSel === u.uf);
  let mudou = numLad(el.querySelector('[data-pl]'), pL, f1);
  mudou = numLad(el.querySelector('[data-pf]'), pF, f1) || mudou;
  const bl = el.querySelector('[data-bl]');
  if (bl) bl.style.width = `${clamp(pL, 0, 100).toFixed(1)}%`;
  if (contagem) {
    const sec = Number.isFinite(u.o?.pst) && !(u.ts > 0 && u.st !== null) ? u.o.pst : u.sec;
    const secP = u.fim ? 100 : sec >= 1 ? Math.floor(sec) : sec > 0 ? 0.5 : 0;
    mudou = numLad(el.querySelector('[data-sp]'), secP, (v) => (v > 0 && v < 1 ? '<1%' : `${C.fNum(Math.floor(v), 0)}%`)) || mudou;
    const barra = el.querySelector('[data-b]');
    if (barra) barra.style.width = `${clamp(sec, 0, 100).toFixed(1)}%`;
  }
  // situação: o selo do canto e os eventos (a primeira pintura não gera evento)
  const st = el.querySelector('[data-st]');
  const sit = comVoto ? u.status : 'aguardando';
  const q = comVoto ? u.quem || '' : '';
  if (st && (st.dataset.s !== sit || st.dataset.q !== q)) {
    st.dataset.s = sit;
    st.dataset.q = q;
  }
  const ant = el._ev;
  const lid = comVoto && u.sec >= 15 ? u.lider : null;
  const novo = { status: sit, lid: lid ?? ant?.lid ?? null, fim: !!u.fim };
  if (ant && contagem) {
    if (sit !== ant.status && sit === 'definido') {
      evento({ tipo: 'def', uf: u.uf, quem: u.quem, forte: true });
      brilhar(el, true);
    } else if (sit !== ant.status && sit === 'provavel' && ant.status !== 'definido') {
      evento({ tipo: 'prov', uf: u.uf, quem: u.quem });
    } else if (lid && ant.lid && lid !== ant.lid) {
      evento({ tipo: 'virou', uf: u.uf, quem: lid, forte: true });
      brilhar(el, true);
      el.classList.remove('rx-virou');
      void el.offsetWidth;
      el.classList.add('rx-virou');
      clearTimeout(el._virou);
      el._virou = setTimeout(() => el.classList.remove('rx-virou'), 2400);
    }
    if (u.fim && !ant.fim) evento({ tipo: 'fim', uf: u.uf });
  }
  el._ev = novo;
  if (mudou) brilhar(el);
  const nome = nomeUF(u.uf);
  const urnT = contagem ? urnasLinha(u) : '';
  const s = situacaoUF(u);
  el.setAttribute(
    'aria-label',
    `${nome}: ${comVoto ? 'apurado' : 'prévia'} ${C.curto('lula')} ${f1(pL)}%, ${C.curto('flavio')} ${f1(pF)}%` +
      (contagem ? `; ${fSec1(u.sec)} das urnas${urnT ? ` (${urnT})` : ''}; ${s.txt}${s.sub ? `, ${s.sub}` : ''}` : ''),
  );
}

// Cabeçalho de cada região: urnas apuradas (na contagem) ou parte do eleitorado (antes dela).
function atualizarRegioes(r, contagem) {
  const st = urnasPorRegiao(r.linhas);
  const ts = urnasTotaisRegiao(r.linhas);
  const teTot = r.linhas.reduce((s, u) => s + u.te, 0);
  REGS.forEach((g, i) => {
    const sec = $(`.rx-reg[data-reg="${g}"]`);
    if (!sec) return;
    const p = sec.querySelector('[data-rg-p]');
    const b = sec.querySelector('[data-rg-b]');
    let v = null;
    if (contagem) v = st[i] !== null && ts[i] ? (st[i] / ts[i]) * 100 : null;
    else {
      const te = r.linhas.filter((u) => REGIAO[u.uf] === g).reduce((s, u) => s + u.te, 0);
      v = teTot > 0 ? (te / teTot) * 100 : null;
    }
    if (v === null) {
      if (p.textContent !== '—') {
        p._v = undefined;
        p.textContent = '—';
      }
      if (b) b.style.width = '0%';
      return;
    }
    numLad(p, v, contagem ? (x) => (x >= 100 ? '100%' : `${C.fNum(Math.floor(x * 10) / 10, 1)}%`) : (x) => `${C.fNum(x, 1)}%`);
    if (b) b.style.width = `${clamp(contagem ? v : v, 0, 100).toFixed(1)}%`;
  });
}

function chaveOrdem(u) {
  if (A.ufOrd === 'apurado') return [u.o ? u.sec : -1, u.te];
  if (A.ufOrd === 'disputa') return [u.projPar !== null ? -Math.abs(u.projPar - 50) : -1e9, u.te];
  return [u.te, 0];
}
// Agrupa por região (padrão) ou junta todos numa lista só, ordenada. Os cartões são os mesmos elementos, só trocam de lugar
// (os números que já estão contando não reiniciam).
function aplicarOrdem(r) {
  const regs = $('[data-rx-regs]');
  const todos = $('[data-rx-todos]');
  if (!regs || !todos) return;
  const porRegiao = A.ufOrd === 'regiao';
  regs.hidden = !porRegiao;
  todos.hidden = porRegiao;
  const li = (uf) => A.raiz.querySelector(`.rx-it[data-uf="${uf}"]`);
  if (porRegiao) {
    for (const g of REGS) {
      const ol = $(`[data-grade="${g}"]`);
      if (ol) for (const uf of ufsDaRegiao(g)) if (li(uf)) ol.appendChild(li(uf));
    }
  } else {
    const ordem = [...r.linhas].sort((a, b) => {
      const ka = chaveOrdem(a);
      const kb = chaveOrdem(b);
      return kb[0] - ka[0] || kb[1] - ka[1];
    });
    for (const u of ordem) if (li(u.uf)) todos.appendChild(li(u.uf));
  }
  pintarOrdem();
}
function pintarOrdem() {
  for (const b of $$('[data-ap="ord-uf"]')) b.setAttribute('aria-pressed', b.dataset.ord === A.ufOrd ? 'true' : 'false');
}

function atualizarMapa(r) {
  const contagem = A.modo !== 'pre';
  for (const u of r.linhas) atualizarCartaoUF(u, contagem);
  atualizarRegioes(r, contagem);
  atualizarDetalheUF(r);
}

/* ------------------------------------------------------- detalhe do estado */

// A folha com os números do estado. Abre por cima (não empurra a página) e se atualiza no lugar enquanto a contagem anda.
function abrirUF(uf) {
  const d = $('[data-rx-sheet]');
  if (!d) return;
  A.ufSel = uf;
  if (!d._ok) {
    d._ok = true;
    d.addEventListener('close', () => {
      A.ufSel = null;
      for (const e of $$('.rx-uf.sel')) e.classList.remove('sel');
    });
    d.addEventListener('click', (e) => {
      if (e.target === d) fecharUF();
    });
  }
  if (A.res) atualizarDetalheUF(A.res);
  if (!d.open) {
    try {
      d.showModal();
    } catch {
      d.setAttribute('open', '');
    }
  }
  for (const e of $$('.rx-uf')) e.classList.toggle('sel', e.dataset.uf === uf);
}
function fecharUF() {
  const d = $('[data-rx-sheet]');
  A.ufSel = null;
  if (d?.open) {
    try {
      d.close();
    } catch {
      d.removeAttribute('open');
    }
  }
  for (const e of $$('.rx-uf.sel')) e.classList.remove('sel');
}

function capitalUF(uf) {
  const c = (A.base.capitais || []).find((x) => x.uf === uf);
  if (!c) return null;
  const o = A.cap.get(c.cod);
  if (!o || !(o.L + o.F > 0)) return { nome: c.nome, sec: null, par: null };
  const sec = o.ts > 0 && o.st !== null ? (o.st / o.ts) * 100 : o.pst;
  return { nome: c.nome, sec, par: (100 * o.L) / (o.L + o.F) };
}

function htmlHistorico(u) {
  const h = C.h;
  const hist = A.base.hist;
  const e = hist?.ufs.get(u.uf);
  if (!e) return '';
  const nac = new Map((hist.anos || []).map((y) => [y.ano, y]));
  const lin = e.anos.map((y) => {
    const n = nac.get(y.ano);
    return h`<tr><th scope="row">${y.ano}</th><td class="n">${pct1(y.par)}</td><td class="n">${n && n.par !== null ? pct1(n.par) : '—'}</td><td class="n rx-acomp" data-ok="${y.acompanhou ? 'sim' : 'nao'}">${y.acompanhou ? '✓' : '✕'}</td></tr>`;
  });
  return h`<table class="rx-tab rx-tab-h"><thead><tr><th></th><th class="n">PT no estado</th><th class="n">PT no país</th><th class="n">Com o país</th></tr></thead><tbody>${lin}</tbody></table>`;
}

const nomeCidadeSim = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (m) => m.toLowerCase());

function atualizarDetalheUF(r) {
  const caixa = $('[data-rx-sheet-in]');
  if (!caixa || !A.ufSel) return;
  const u = r.linhas.find((x) => x.uf === A.ufSel);
  if (!u) return;
  const h = C.h;
  const L = C.curto('lula');
  const F = C.curto('flavio');
  const contagem = A.modo !== 'pre';
  const comVoto = contagem && !!u.o && u.L + u.F > 0;
  const sit = situacaoUF(u);
  const pjL = u.projL + u.projF > 0 ? (u.projL / (u.projL + u.projF)) * 100 : null;
  const apL = comVoto ? u.parObs : null;
  const t1L = u.t1Par;
  const par = (id, v) => (v === null ? null : id === 'lula' ? v : 100 - v);
  const lin = (id) => h`<tr><th scope="row"><i class="rx-dot" style="--c:${C.cand(id).cor}"></i>${C.curto(id)}</th><td class="n">${pct1(par(id, apL))}</td><td class="n"><b>${pct1(par(id, pjL))}</b></td><td class="n">${pct1(par(id, t1L))}</td></tr>`;
  const kpi = (k, v, extra = '') => h`<div class="rx-kpi ${extra}"><span>${k}</span><b>${v}</b></div>`;
  const liq = u.rem * (2 * u.share - 1);
  const virou = comVoto && u.lider && u.lider1T && u.lider !== u.lider1T;
  const cap = capitalUF(u.uf);
  const sim = simVivo();
  const simUF = sim ? arr(sim.doc.ufs).find((x) => String(x?.uf).toUpperCase() === u.uf) : null;
  const simCid = sim ? arr(sim.doc.pesam).filter((x) => String(x?.uf).toUpperCase() === u.uf).slice(0, 3) : [];
  const e = A.base.hist?.ufs.get(u.uf);
  const secU = u.o ? u.sec : 0;
  const kpis = [];
  if (comVoto) kpis.push(kpi('Votos nos dois', C.fInt(u.L + u.F)));
  if (u.rem > 0) kpis.push(kpi('Faltam', h`${votosCurto(u.rem)}${comVoto && Math.abs(liq) >= 1000 ? h` <small class="q-${liq >= 0 ? 'lula' : 'flavio'}">${C.curto(liq >= 0 ? 'lula' : 'flavio')} +${votosCurto(Math.abs(liq))}</small>` : ''}`));
  if (comVoto && u.dT1 !== null) kpis.push(kpi('vs 1º turno', h`<span class="q-${u.dT1 >= 0 ? 'lula' : 'flavio'}">${um(u.dT1) === 0 ? '0,0' : `+${C.fNum(Math.abs(u.dT1), 1)} ${u.dT1 >= 0 ? L : F}`}</span>${virou ? h` <small class="rx-virou-t">⇄ virou</small>` : ''}`));
  if (u.compObs !== null) kpis.push(kpi('Comparecimento', `${C.fNum(u.compObs * 100, 1)}%`));
  if (comVoto && u.status !== 'definido') kpis.push(kpi('Chance no estado', h`<span class="q-lula">${L} ${chanceTxt(u.chance)}</span> <span class="q-flavio">${F} ${chanceTxt(1 - u.chance)}</span>`, 'larga'));
  if (u.faixa) kpis.push(kpi('Faixa de 80%', `${L} ${pct1(u.faixa[0])} a ${pct1(u.faixa[1])}`, 'larga'));
  if (cap) kpis.push(kpi(`Capital · ${cap.nome}`, cap.sec === null ? 'sem leitura' : h`${fSec1(cap.sec)} · ${L} ${pct1(cap.par)}`, 'larga'));
  const cidades = simUF && simCid.length
    ? h`<ul class="rx-cid">${simCid.map((x) => h`<li><span>${nomeCidadeSim(x.nome)}</span><em>${C.fNum(C.num(x.apurado_pct) ?? 0, 0)}%</em><b class="q-${C.num(x.saldo) >= 0 ? 'lula' : 'flavio'}">${C.curto(C.num(x.saldo) >= 0 ? 'lula' : 'flavio')} +${votosCurto(Math.abs(C.num(x.saldo) ?? 0))}</b></li>`)}</ul>`
    : '';
  htmlEm(
    '[data-rx-sheet-in]',
    h`<header class="rx-sh-cab">
        <div><h3>${nomeUF(u.uf)}</h3><p>${u.uf === 'ZZ' ? 'Votos no exterior' : u.uf}${e ? h` · votou com o país em ${e.acompanhou} de ${e.eleicoes}` : ''}</p></div>
        <button type="button" class="rx-x" data-ap="fechar-uf" aria-label="Fechar">×</button>
      </header>
      <p class="rx-sh-sit ${sit.cls}"><b>${sit.txt}</b>${sit.sub ? h` <span>${sit.sub}</span>` : ''}</p>
      <div class="rx-sh-urn"><span class="rx-urn"><i style="width:${clamp(secU, 0, 100).toFixed(1)}%"></i></span><p><b>${u.o ? fSec1(u.sec) : '—'}</b> <span>${urnasLinha(u) || ''}</span></p></div>
      <table class="rx-tab"><thead><tr><th></th><th class="n">Apurado</th><th class="n">Projeção</th><th class="n">1º turno</th></tr></thead><tbody>${lin('lula')}${lin('flavio')}</tbody></table>
      <div class="rx-kpis">${kpis}</div>
      ${cidades}
      ${A.base.hist?.ufs.has(u.uf) ? h`<button type="button" class="rx-hist-bt" data-ap="hist" aria-expanded="${A.histAberto ? 'true' : 'false'}">Histórico 2002 a 2022 <i aria-hidden="true">${A.histAberto ? '▴' : '▾'}</i></button>${A.histAberto ? htmlHistorico(u) : ''}` : ''}`,
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
    vv: r.cont.L + r.cont.F,
    m: r.motor === 'simulador' ? 's' : 'e',
    // urnas apuradas no país e por região (vetor na ordem de REGS): base do ritmo em urnas por minuto
    st: r.urnas ? r.urnas.st : null,
    rg: urnasPorRegiao(r.linhas),
  };
  const n = A.serie.length;
  const ult = A.serie[n - 1];
  if (ult && t < ult.t) return false;
  if (ult && t === ult.t) {
    // Mesma totalização: refaz o último ponto (a projeção muda a cada UF lida). Antes cada
    // UF lida virava um ponto novo com a mesma hora: o teto de 1.500 chegava em ~50 min e o
    // gráfico perdia o começo da noite.
    if (ult.pst === p.pst && ult.pL === p.pL && ult.jL === p.jL && ult.aL === p.aL && ult.m === p.m && ult.st === p.st && JSON.stringify(ult.rg) === JSON.stringify(p.rg)) return false;
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
  const mo = new Map(pts.map((p) => [p.t, p.m === 's' ? 'simulador municipal' : 'modelo por estado']));
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
      C.h`<p class="dica-tit">${C.fHora(t)} · ${pctPiso(pst.get(t), 1)} apurado</p><p class="dica-l"><i class="lk" style="--c:${L.cor}"></i><b>${chanceTxt(mL.get(t) / 100)}</b><span>${C.curto('lula')}</span></p><p class="dica-l"><i class="lk" style="--c:${F.cor}"></i><b>${chanceTxt(mF.get(t) / 100)}</b><span>${C.curto('flavio')}</span></p><p class="dica-sep">Motor: ${mo.get(t)}</p>`,
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
  const mo = new Map(pts.map((p) => [p.t, p.m === 's' ? 'simulador municipal' : 'modelo por estado']));
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
        <p class="dica-sep">Apurado: ${C.curto('lula')} ${pct1(aL.get(t))} · ${C.curto('flavio')} ${pct1(aF.get(t))} · projeção: ${mo.get(t)}</p>`,
  });
}

/* ============================================================ esqueletos */

/* v6 (24/10/2026): a aba sem texto explicativo. Cada cartão fala por si: número, barra, cor e movimento. O que antes era
 * parágrafo ("De onde vem a prévia", "Como a projeção funciona", legendas, notas de rodapé) saiu da tela; o que sobrou de
 * texto são rótulos de uma ou duas palavras e, no fim, uma linha de aviso (não é resultado oficial). */

function htmlLados(prevOnly) {
  const h = C.h;
  return ['lula', 'flavio'].map((id) => {
    const c = C.cand(id);
    return h`<div class="rx-lado${prevOnly ? ' pre' : ''}" data-lado="${id}">
      <div class="rx-quem">${C.foto(c)}<div><p class="rx-nome">${c.nome}</p><p class="rx-part">${C.txt(c.partido) || ''}${C.num(c.numero) !== null ? ` · ${c.numero}` : ''}</p></div></div>
      ${prevOnly
        ? h`<p class="rx-ch-rot">chance no Polymarket</p><p class="rx-ch" data-ch="${id}">—</p><p class="rx-sub">pesquisas <b data-pv="${id}">—</b></p>`
        : h`<p class="rx-votos"><b data-votos="${id}">0</b></p><p class="rx-pct"><b data-pct="${id}">—</b><small> dos válidos</small></p><p class="rx-chip"><span>chance</span> <b data-ch="${id}">—</b></p>`}
    </div>`;
  });
}

function htmlGraficosNoite() {
  const h = C.h;
  return h`<section class="bloco ap-sec-graf rx-graf">
      <h2 class="sobre">Ao longo da noite</h2>
      <h3 class="sub">Chance de vitória</h3>
      <div class="leg"><span><i class="lk" style="--c:${C.cand('lula').cor}"></i>${C.curto('lula')}</span><span><i class="lk" style="--c:${C.cand('flavio').cor}"></i>${C.curto('flavio')}</span></div>
      <div class="graf" data-grafico="apur-chance" tabindex="0" role="img" aria-label="Chance de vitória ao longo da apuração"></div>
      <h3 class="sub">Apurado × projeção</h3>
      <div class="leg"><span><i class="lk" style="--c:${C.cand('lula').cor}"></i>${C.curto('lula')}, projeção</span><span><i class="lk" style="--c:${C.cand('flavio').cor}"></i>${C.curto('flavio')}, projeção</span><span><i class="lk trac" style="--c:var(--tinta-2)"></i>apurado</span></div>
      <div class="graf" data-grafico="apur-votos" tabindex="0" role="img" aria-label="Apurado e projeção ao longo da apuração"></div>
    </section>`;
}

// Um cartão de "apurado" ou de "projeção": dois percentuais que contam, a barra dividida e a diferença em votos.
function htmlPar(chave) {
  const h = C.h;
  const lin = (id) => h`<div class="rx-par-l" data-id="${id}"><span class="rx-par-n"><i class="rx-dot" style="--c:${C.cand(id).cor}"></i>${C.curto(id)}</span><b data-p="${id}">—</b></div>`;
  return h`<div class="rx-par" data-par="${chave}">${lin('lula')}${lin('flavio')}
    <div class="rx-par-bar" aria-hidden="true"><span data-bl style="--c:${C.cand('lula').cor}"></span><span data-bf style="--c:${C.cand('flavio').cor}"></span></div>
    <p class="rx-par-dif" data-dif><span data-d1>—</span><small data-d2></small></p></div>`;
}

function esqueletoPainel() {
  const h = C.h;
  const sim = A.modo === 'sim';
  A.ufOrd = 'regiao';
  const linhasFalta = REGS.map((g) => h`<li data-g="${g}"><span class="rx-fr-n">${REGS_NOME[g]}</span><span class="rx-fr-b" aria-hidden="true"><i data-fb></i></span><b class="rx-fr-v" data-fv>—</b><em class="rx-fr-s" data-fs></em></li>`);
  const ticks = REGS.filter((g) => g !== 'EX').flatMap((g) => ufsDaRegiao(g)).map((uf) => h`<i data-tk="${uf}"></i>`);
  return h`
    ${sim
      ? h`<div class="ap-sim rx-simb" role="note"><b>Simulação · números fictícios</b><span class="ap-sim-acoes"><button type="button" data-ap="sim-reiniciar">Recomeçar</button><button type="button" data-ap="sim-sair">Sair</button></span></div>`
      : ''}
    ${A.teste ? h`<div class="alerta"><p><b>Teste com a eleição ${A.eleicao}</b> (1º turno de 04/10): números reais daquele dia.</p></div>` : ''}
    ${A.fonteTeste ? h`<div class="alerta"><p><b>Fonte de teste</b> (${A.fonteTeste.replace(/\/oficial\/ele2026$/, '')}): números fictícios.</p></div>` : ''}
    <section class="ap-topo rx-topo" aria-label="Chance de vitória e votos apurados">
      <header class="rx-cab"><span class="rx-vivo${sim ? ' sim' : ''}"><i aria-hidden="true"></i>${sim ? 'Simulação' : 'Ao vivo'}</span><span class="rx-hora" data-ap-hora>—</span></header>
      <div class="rx-hero">${htmlLados(false)}</div>
      <div class="rx-chbar" aria-hidden="true"><span data-seg="lula"></span><span data-seg="flavio"></span><i></i></div>
      <p class="rx-chleg"><span>Chance de vitória</span><span class="rx-motor" data-ap-chmotor>modelo por estado</span><span class="rx-def" data-ap-def hidden></span></p>
    </section>
    <section class="bloco rx-dest" aria-label="Destaques agora">
      <h2 class="sobre">Destaques agora</h2>
      <ol class="ap-ins sim-ins" data-rx-dest aria-live="polite"></ol>
      <p class="estado" data-rx-dest-vazio>Os destaques entram aqui assim que a projeção começar.</p>
      <ol class="rx-feed rx-feed-topo" data-rx-feed aria-live="off"><li class="rx-ev rx-ev-vazio">Os eventos da noite entram aqui</li><li class="rx-ev rx-ev-vazio" aria-hidden="true"></li></ol>
    </section>
    <section class="bloco ap-prog-b ap-sec-prog rx-prog">
      <div class="rx-prog-cab"><p class="rx-prog-num"><b data-ap-pst>0%</b><span> das urnas apuradas</span></p><p class="rx-prog-lido" data-ap-lidos></p></div>
      <div class="rx-prog-bar" aria-hidden="true"><i data-ap-barra></i></div>
      <p class="rx-urnas" data-ap-urnas><span class="rx-ur"><b data-ur-st>—</b> <small>de</small> <b data-ur-ts>—</b> <small>urnas</small></span><span class="rx-ur-f"><small>faltam</small> <b data-ur-falta>—</b></span></p>
      <p class="rx-oculto" data-ap-atraso hidden></p>
    </section>
    <section class="bloco ap-sec-duo rx-duo">
      <p class="rx-virada" data-ap-virada data-v="espera">Aguardando os primeiros votos</p>
      <div class="ap-duo rx-duo-g">
        <div class="ap-card rx-card"><p class="rx-card-t">Apurado agora</p>${htmlPar('ap')}<p class="rx-card-f"><span data-vv>—</span></p></div>
        <div class="ap-card ap-card-proj rx-card"><p class="rx-card-t">Projeção final</p>${htmlPar('proj')}<p class="rx-card-f" data-ap-proj-f><span data-motor>—</span><span data-faixa></span></p></div>
      </div>
    </section>
    <section class="bloco ap-sec-ins rx-agora">
      <h2 class="sobre">Agora</h2>
      <div class="rx-tiles">
        <div class="rx-tile" data-t="ritmo"><span class="rx-tk">Ritmo</span><b class="rx-tv" data-rx-v="ritmo">—</b><span class="rx-ts" data-rx-s="ritmo">urnas por min</span></div>
        <div class="rx-tile" data-t="eta"><span class="rx-tk">Previsão</span><b class="rx-tv" data-rx-v="eta">—</b><span class="rx-ts" data-rx-s="eta">95% das urnas</span></div>
        <div class="rx-tile" data-t="falta"><span class="rx-tk">Faltam</span><b class="rx-tv" data-rx-v="falta">—</b><span class="rx-ts" data-rx-s="falta">votos válidos</span></div>
        <div class="rx-tile" data-t="est"><span class="rx-tk">Estados à frente</span><b class="rx-tv"><span class="q-lula" data-rx-est="l">0</span> <i>×</i> <span class="q-flavio" data-rx-est="f">0</span></b><span class="rx-ts"><span class="q-lula">${C.curto('lula')}</span> · <span class="q-flavio">${C.curto('flavio')}</span></span><span class="rx-ticks" aria-hidden="true">${ticks}</span></div>
      </div>
      <div class="rx-falta"><p class="rx-falta-h"><span>Falta apurar</span><span>saldo esperado</span></p><ul>${linhasFalta}</ul></div>
      <ol class="rx-feed" data-rx-feed aria-live="polite"><li class="rx-ev rx-ev-vazio">Os eventos da noite entram aqui</li><li class="rx-ev rx-ev-vazio" aria-hidden="true"></li><li class="rx-ev rx-ev-vazio" aria-hidden="true"></li><li class="rx-ev rx-ev-vazio" aria-hidden="true"></li></ol>
    </section>
    <section class="bloco ap-sec-mapa rx-estados" aria-label="Estados">
      <h2 class="sobre">Estados</h2>
      ${htmlEstados(true)}
    </section>
    ${htmlGraficosNoite()}
    <div class="rx-toasts" data-rx-toasts aria-live="polite"></div>`;
}

function esqueletoPre() {
  const h = C.h;
  A.ufOrd = 'regiao';
  const e = obj(C.dados()?.eleicao) || {};
  const fe = C.msDe(e.fechamento) ?? C.msDe('2026-10-25T17:00:00-03:00');
  const ab = C.msDe(e.abertura) ?? C.msDe('2026-10-25T08:00:00-03:00');
  const hora = (t) => C.fHora(t).replace('h00', 'h');
  const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit' }).format(fe).replace('.', '');
  const un = (k, rot) => h`<div class="rx-un${k === 'd' ? '' : ' on'}" data-un="${k}"><b><span>00</span></b><small>${rot}</small></div>`;
  return h`
    <section class="ap-pre rx-pre" aria-label="Contagem para o fechamento das urnas">
      <div class="rx-cont">
        <p class="rx-cont-top"><span class="rx-pulse" aria-hidden="true"></span><span>Urnas fecham às ${hora(fe)}</span><span class="rx-cont-dia">${dia}</span></p>
        <div class="rx-rel" role="timer" data-rx-rel>${un('d', 'dias')}${un('h', 'h')}<i class="rx-sepr" aria-hidden="true">:</i>${un('m', 'min')}<i class="rx-sepr" aria-hidden="true">:</i>${un('s', 's')}</div>
        <div class="rx-dia" aria-hidden="true"><i data-rx-dia></i></div>
        <p class="rx-dia-l" aria-hidden="true"><span>${hora(ab)}</span><span>${hora(fe)}</span></p>
        <button type="button" class="rx-cta" data-ap="sim">Ver apuração simulada</button>
      </div>
    </section>
    <section class="bloco rx-previa">
      <h2 class="sobre">Prévia</h2>
      <div class="rx-hero">${htmlLados(true)}</div>
      <div class="rx-chbar" aria-hidden="true"><span data-seg="lula"></span><span data-seg="flavio"></span><i></i></div>
    </section>
    <section class="bloco ap-sec-mapa rx-estados" aria-label="Estados">
      <h2 class="sobre">Estados</h2>
      ${htmlEstados(false)}
    </section>
`;
}

/* ============================================================ atualização */

// Chance do Lula no Polymarket, já normalizada pelo app (soma 100% entre os dois); null sem dado.
function chancePolyLula() {
  const poly = arr(C.mercados?.()?.fontes).find((f) => f?.id === 'polymarket' && f.status !== 'erro');
  return C.num(poly?.candidatos?.lula?.prob);
}

function pintarChance(pL) {
  for (const id of ['lula', 'flavio']) {
    const p = pL === null ? null : id === 'lula' ? pL : 1 - pL;
    const cor = corChance(p);
    for (const lado of $$(`.rx-lado[data-lado="${id}"]`)) {
      lado.style.setProperty('--cc', cor.fundo);
      lado.style.color = cor.tinta;
      lado.dataset.f = cor.neutro ? 'n' : p >= 0.5 ? 'v' : 'r';
      lado.classList.toggle('escuro', luminancia(hexRgb(cor.tinta)) > 0.4);
    }
    for (const seg of $$(`.rx-chbar [data-seg="${id}"]`)) {
      seg.style.background = cor.neutro ? 'var(--linha-2)' : cor.fundo;
      seg.style.flexGrow = String(p === null ? 1 : Math.max(0.0001, p));
    }
    for (const el of $$(`[data-ch="${id}"]`)) {
      const t = chanceTxt(p);
      if (el.textContent !== t) el.textContent = t;
    }
  }
}

/* ---------------------------------------------- eventos da noite (lista e aviso) */

const MARCOS = [10, 25, 50, 75, 90, 95, 99];
function evento(e) {
  const t = A.modo === 'sim' ? A.sim?.relogio ?? Date.now() : Date.now();
  if (!A.evOk) return;
  A.evN += 1;
  A.ev.unshift({ ...e, t, id: A.evN });
  if (A.ev.length > 40) A.ev.length = 40;
  A.evNovo = true;
  if (e.forte && A.ativo && !document.hidden) avisar(e);
}
function descreverEvento(e) {
  const n = (id) => C.curto(id);
  switch (e.tipo) {
    case 'def': return { ic: '✓', cls: `q-${e.quem}`, txt: `${nomeUF(e.uf)}: ${n(e.quem)} venceu` };
    case 'prov': return { ic: '◐', cls: `q-${e.quem}`, txt: `${nomeUF(e.uf)}: ${n(e.quem)} provável` };
    case 'virou': return { ic: '⇄', cls: `q-${e.quem}`, txt: `${nomeUF(e.uf)}: virou para ${n(e.quem)}` };
    case 'fim': return { ic: '●', cls: '', txt: `${nomeUF(e.uf)}: 100% apurado` };
    case 'lider': return { ic: '⇄', cls: `q-${e.quem}`, txt: `${n(e.quem)} passa à frente na contagem` };
    case 'virada': return { ic: '⇄', cls: `q-${e.quem}`, txt: `Projeção aponta ${n(e.quem)} à frente no fim` };
    case 'marco': return { ic: '▮', cls: '', txt: `${e.p}% das urnas apuradas` };
    case 'nac': return { ic: '✓', cls: `q-${e.quem}`, txt: e.txt };
    default: return { ic: '●', cls: '', txt: '' };
  }
}
function pintarFeed() {
  // dois lugares: "Destaques agora", logo abaixo dos cards (os 2 últimos), e o bloco "Agora" (os 4 últimos)
  const ols = $$('[data-rx-feed]');
  if (!ols.length || !A.evNovo) return;
  A.evNovo = false;
  const h = C.h;
  for (const ol of ols) {
    const n = ol.classList.contains('rx-feed-topo') ? 2 : 4;
    const lista = A.ev.slice(0, n);
    const vistos = ol._vistos || new Set();
    ol.innerHTML = C.emHtml(
      h`${lista.map((e) => {
        const x = descreverEvento(e);
        return h`<li class="rx-ev ${x.cls}${vistos.has(e.id) ? '' : ' rx-entra'}" data-t="${e.tipo}"><time>${hms(e.t).slice(0, 5)}</time><i aria-hidden="true">${x.ic}</i><span>${x.txt}</span></li>`;
      })}${Array.from({ length: n - lista.length }, () => h`<li class="rx-ev rx-ev-vazio" aria-hidden="true"></li>`)}`,
    );
    ol._vistos = new Set(lista.map((e) => e.id));
  }
}
// Aviso rápido no topo da tela (5 s) para o que mais importa: estado decidido, virada de estado, troca de liderança.
function avisar(e) {
  const box = $('[data-rx-toasts]');
  if (!box) return;
  const x = descreverEvento(e);
  const t = document.createElement('div');
  t.className = `rx-toast ${x.cls}`;
  t.setAttribute('role', 'status');
  const ic = document.createElement('i');
  ic.setAttribute('aria-hidden', 'true');
  ic.textContent = x.ic;
  const tx = document.createElement('span');
  tx.textContent = x.txt;
  t.append(ic, tx);
  box.appendChild(t);
  while (box.children.length > 2) box.firstElementChild.remove();
  setTimeout(() => {
    t.classList.add('sai');
    setTimeout(() => t.remove(), 450);
  }, 5000);
}

/* --------------------------------------------------------- apurado × projeção */

// Preenche um cartão "apurado" ou "projeção": percentuais que contam, barra dividida e a diferença em votos.
function atualizarPar(chave, L, F, pL, pF, ok, casas = 2) {
  const box = $(`[data-par="${chave}"]`);
  if (!box) return;
  const fmt = casas === 2 ? pct2 : pct1;
  const bL = box.querySelector('[data-bl]');
  const bF = box.querySelector('[data-bf]');
  const dif = box.querySelector('[data-dif]');
  const d1 = dif.querySelector('[data-d1]');
  const d2 = dif.querySelector('[data-d2]');
  const pl = box.querySelector('[data-p="lula"]');
  const pf = box.querySelector('[data-p="flavio"]');
  if (!ok) {
    for (const x of [pl, pf]) {
      if (x.textContent !== '—') {
        x._v = undefined;
        x.textContent = '—';
      }
    }
    bL.style.flexGrow = '1';
    bF.style.flexGrow = '1';
    if (d1.textContent !== '—') d1.textContent = '—';
    if (d2.textContent) d2.textContent = '';
    if (dif.dataset.q) dif.dataset.q = '';
    return;
  }
  animarNumero(pl, pL, fmt, 600);
  animarNumero(pf, pF, fmt, 600);
  const soma = L + F;
  bL.style.flexGrow = String(soma > 0 ? Math.max(0.001, L / soma) : 1);
  bF.style.flexGrow = String(soma > 0 ? Math.max(0.001, F / soma) : 1);
  const d = L - F;
  const quem = d > 0 ? 'lula' : d < 0 ? 'flavio' : '';
  const t = quem ? `${C.curto(quem)} +${votosMi(Math.abs(d))}` : 'empate';
  const pts = Math.abs(pL - pF);
  const t2 = quem ? `${C.fNum(pts, casas)} ${Math.round(pts * 10 ** casas) / 10 ** casas === 1 ? 'ponto' : 'pontos'} de diferença` : '';
  if (d1.textContent !== t) d1.textContent = t;
  if (d2.textContent !== t2) d2.textContent = t2;
  if (dif.dataset.q !== quem) dif.dataset.q = quem;
}

const MOTOR_ROT = { simulador: 'Simulador municipal', estados: 'Modelo por estado' };
// A margem de erro da projeção dita como se fala: onde Lula termina em 8 de cada 10 cenários.
const faixaTxt = (fx) => `${C.curto('lula')} de ${pct1(fx[0])} a ${pct1(fx[1])} em 8 de 10 cenários`;

function atualizarProj(r, temVoto) {
  const c = r.cont;
  const mot = $('[data-motor]');
  const fx = $('[data-faixa]');
  let rot = '';
  let faixa = '';
  if (r.tudo && temVoto) {
    atualizarPar('proj', c.L, c.F, c.pL, c.pF, true, 2);
    rot = 'Resultado final';
  } else if (r.motor === 'simulador' && r.sim && temVoto) {
    const s = r.sim;
    atualizarPar('proj', s.proj.L, s.proj.F, s.proj.pL, s.proj.pF, true, 1);
    rot = MOTOR_ROT.simulador;
    if (s.faixa) faixa = faixaTxt(s.faixa);
  } else if (!r.completo) {
    atualizarPar('proj', 0, 0, 0, 0, false);
    rot = `Lendo estados ${r.lidos}/${UFS.length}`;
  } else {
    atualizarPar('proj', r.proj.L, r.proj.F, r.proj.pL, r.proj.pF, true, 1);
    // sem voto apurado a projeção é a das pesquisas (o Agregador próprio do Resumo), e a tela diz isso
    rot = temVoto ? MOTOR_ROT.estados : 'Pesquisas · antes dos votos';
    if (temVoto && !r.decidido && r.faixaUF) faixa = faixaTxt(r.faixaUF);
  }
  if (mot && mot.textContent !== rot) mot.textContent = rot;
  if (fx && fx.textContent !== faixa) fx.textContent = faixa;
}

/* -------------------------------------------------------------- "Agora" */

function atualizarAgora(r, temVoto) {
  const set = (k, v, s) => {
    const ve = $(`[data-rx-v="${k}"]`);
    const se = $(`[data-rx-s="${k}"]`);
    if (ve && v !== undefined && ve.textContent !== v) {
      ve._v = undefined;
      ve.textContent = v;
    }
    if (se && s !== undefined && se.textContent !== s) se.textContent = s;
  };
  const rit = temVoto ? ritmoUrnas() : null;
  const rc = temVoto ? ritmoContagem() : null;
  // Ritmo da contagem (urnas por minuto) e previsão de quando ela chega a 95% (pelas curvas do 1º turno e de 2022) ou a 100%
  // se o ritmo atual se mantivesse.
  if (rit) {
    numLad($('[data-rx-v="ritmo"]'), rit.porMin, fRate);
    set('ritmo', undefined, `urnas por min · ${rit.min} min`);
  } else set('ritmo', '—', 'urnas por min');
  let etaT = null;
  let etaRot = '95% das urnas';
  if (r.tudo) set('eta', 'fim', 'apuração concluída');
  else {
    if (rc?.eta?.length) etaT = rc.eta[Math.floor(rc.eta.length / 2)].t;
    else if (rit && r.urnas && r.urnas.falta > 0) {
      etaT = rit.t + (r.urnas.falta / rit.porMin) * 60000;
      etaRot = '100% no ritmo atual';
    }
    if (etaT !== null && Number.isFinite(etaT)) set('eta', C.fHora(etaT), etaRot);
    else set('eta', '—', 'calculando');
  }
  if (temVoto && Number.isFinite(r.remCont)) {
    numLad($('[data-rx-v="falta"]'), r.tudo ? 0 : r.remCont, votosMi);
    set('falta', undefined, 'votos válidos');
  } else set('falta', '—', 'votos válidos');
  // estados à frente na contagem (27 UFs; o Exterior não entra na conta)
  let nl = 0;
  let nf = 0;
  const lid = new Map();
  for (const u of r.linhas) {
    if (u.uf === 'ZZ') continue;
    const q = u.o && u.L + u.F > 0 ? u.lider : null;
    lid.set(u.uf, q);
    if (q === 'lula') nl++;
    else if (q === 'flavio') nf++;
  }
  numLad($('[data-rx-est="l"]'), nl, (v) => C.fNum(Math.round(v), 0));
  numLad($('[data-rx-est="f"]'), nf, (v) => C.fNum(Math.round(v), 0));
  for (const t of $$('[data-tk]')) {
    const q = lid.get(t.dataset.tk) || '';
    if (t.dataset.q !== q) t.dataset.q = q;
  }
  // o que falta apurar, por região, e para quem pende (saldo esperado pela mesa)
  const fr = faltaPorRegiao(r);
  let max = 0;
  for (const g of REGS) max = Math.max(max, fr.por[g]?.rem ?? 0);
  for (const g of REGS) {
    const li = $(`.rx-falta li[data-g="${g}"]`);
    if (!li) continue;
    const x = fr.por[g];
    const fv = li.querySelector('[data-fv]');
    const fb = li.querySelector('[data-fb]');
    const fs = li.querySelector('[data-fs]');
    if (!temVoto || !x) {
      if (fv.textContent !== '—') {
        fv._v = undefined;
        fv.textContent = '—';
      }
      fb.style.width = '0%';
      if (fs.textContent) fs.textContent = '';
      continue;
    }
    const rem = r.tudo ? 0 : x.rem;
    numLad(fv, rem, votosMi);
    fb.style.width = `${max > 0 ? clamp((rem / max) * 100, 0, 100).toFixed(1) : 0}%`;
    const q = Math.abs(x.net) >= 1000 && rem > 0 ? (x.net >= 0 ? 'lula' : 'flavio') : '';
    const t = q ? `${C.curto(q)} +${votosMi(Math.abs(x.net))}` : '';
    if (fs.textContent !== t) fs.textContent = t;
    if (fs.dataset.q !== q) fs.dataset.q = q;
  }
}

function atualizarTela() {
  const r = processar();
  A.res = r;
  if (!r || !A.raiz) return;
  if (A.modo === 'pre') {
    // Antes das 17h a chance é a do Polymarket (a mesma do Resumo); o modelo por estado só entra com voto apurado.
    pintarChance(chancePolyLula());
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
  // Das 17h ao primeiro voto o modelo por estado só repetiria as pesquisas (e dava 79% contra os 83% do Resumo):
  // a chance segue a do Polymarket, como antes das 17h, e o modelo assume com o primeiro voto apurado.
  const pPoly = temVoto ? null : chancePolyLula();
  if (pPoly !== null) pintarChance(pPoly);
  else pintarChance(!r.completo && r.motor !== 'simulador' && temVoto && !decidido ? null : r.pL);
  let chMotor = r.motor === 'simulador' && !decidido ? (r.pDiv ? 'média de dois modelos, que divergem' : 'simulador municipal') : 'modelo por estado';
  if (pPoly !== null) chMotor = 'Polymarket · antes dos votos';
  else if (temVoto && !decidido && !r.pDiv) {
    // histerese: entra com a chance entre 35% e 65% e só sai fora de 30% a 70% (o rótulo não pisca a cada leitura)
    const dist = Math.abs(r.pL - 0.5);
    A._equil = dist < 0.15 || (A._equil === true && dist < 0.2);
    if (A._equil) chMotor = `disputa equilibrada · ${chMotor}`;
  }
  texto('[data-ap-chmotor]', chMotor);
  // Os avisos só começam depois que a primeira leitura com votos foi vista: quem abre a página no meio da noite não recebe
  // de uma vez tudo o que já tinha acontecido.
  if (temVoto && !A.evT0) A.evT0 = Date.now();
  A.evOk = temVoto && Date.now() - A.evT0 >= (A.modo === 'vivo' ? 20000 : 0);
  for (const id of ['lula', 'flavio']) {
    animarNumero($(`[data-votos="${id}"]`), id === 'lula' ? c.L : c.F, (v) => C.fInt(Math.round(v)), 700);
    const el = $(`[data-pct="${id}"]`);
    if (el) {
      if (temVoto) animarNumero(el, id === 'lula' ? c.pL : c.pF, pct2, 600);
      else if (el.textContent !== '—') {
        el._v = undefined;
        el.textContent = '—';
      }
    }
  }
  const msg = r.tudo && temVoto ? 'Apuração concluída' : r.definido ? 'Matematicamente definido' : r.eleitoTSE ? 'Eleito, segundo o TSE' : '';
  const def = $('[data-ap-def]');
  if (def) {
    def.hidden = !msg;
    if (def.textContent !== msg) def.textContent = msg;
  }
  // diferença em votos entre os dois, logo abaixo dos candidatos (no cartão "Apurado agora" também)
  // Progresso das urnas: o número conta, a barra anda e o ponto na ponta pulsa (CSS).
  const pstV = r.tudo ? 100 : c.pst <= 0 ? 0 : c.pst;
  animarNumero($('[data-ap-pst]'), pstV, (v) => (v <= 0 ? '0%' : v >= 100 ? '100%' : pctPiso(v, 2)), 600);
  const barra = $('[data-ap-barra]');
  if (barra) barra.style.width = `${clamp(pstV, 0, 100)}%`;
  const u = r.urnas;
  if (u) {
    animarNumero($('[data-ur-st]'), u.st, (v) => fUrn(Math.round(v)), 600);
    texto('[data-ur-ts]', fUrn(u.ts));
    animarNumero($('[data-ur-falta]'), r.tudo ? 0 : u.falta, (v) => fUrn(Math.round(v)), 600);
  }
  const falta = r.semLeitura.length;
  texto('[data-ap-lidos]', A.modo === 'vivo' && (!r.completo || falta) ? `${r.lidos} de ${UFS.length} estados` : '');
  atualizarHora();
  atualizarPar('ap', c.L, c.F, c.pL, c.pF, temVoto, 2);
  texto('[data-vv]', temVoto ? `${votosMi(c.L + c.F)} votos válidos` : '');
  atualizarProj(r, temVoto);
  const vir = $('[data-ap-virada]');
  const lc = lider(c.L, c.F);
  const lp = lider(r.proj.L, r.proj.F);
  const comparavel = r.completo || r.motor === 'simulador';
  const divergem = comparavel && temVoto && !r.decidido && lc && lp && lc !== lp;
  // "Virada à vista" só com 80% de chance ou mais para quem a projeção aponta; abaixo disso a disputa está aberta e a
  // faixa diz isso (no ensaio, a 50/50 ela dizia "Lula termina à frente" e trocava a cada 0,1 ponto de projeção).
  const temVirada = divergem && (lp === 'lula' ? r.pL : 1 - r.pL) >= 0.8;
  if (vir) {
    // Faixa de altura fixa: a mensagem muda de texto (e de cor, na virada), mas a página não se mexe quando ela muda.
    let v = 'igual';
    let t;
    if (temVirada) {
      v = 'virada';
      t = `Virada à vista: a projeção aponta ${C.curto(lp)} à frente no fim; ${C.curto(lc)} lidera agora`;
    } else if (divergem) t = `Disputa apertada: ${C.curto(lc)} lidera agora, e a projeção ainda não aponta vencedor`;
    else if (!temVoto) {
      v = 'espera';
      t = 'Aguardando os primeiros votos';
    } else if (!comparavel) {
      v = 'espera';
      t = 'Lendo os estados';
    } else if (r.tudo) t = 'Apuração concluída';
    else if (r.decidido) t = 'Contagem decidida';
    else if (lc && lp) t = `Contagem e projeção: ${C.curto(lc)} à frente`;
    else t = 'Empate na contagem ou na projeção';
    if (vir.dataset.v !== v) vir.dataset.v = v;
    if (vir.textContent !== t) vir.textContent = t;
  }
  // eventos nacionais (a primeira leitura só marca o ponto de partida)
  if (temVoto) {
    if (c.pst >= 5) {
      if (A._lid === undefined) A._lid = lc;
      else if (lc && A._lid && lc !== A._lid) {
        evento({ tipo: 'lider', quem: lc, forte: true });
        A._lid = lc;
      } else if (lc) A._lid = lc;
    }
    const pctU = r.urnas ? r.urnas.pct : c.pst;
    if (A._marco === undefined) A._marco = MARCOS.filter((m) => m <= pctU).pop() ?? 0;
    else for (const m of MARCOS) if (m > A._marco && pctU >= m) {
      A._marco = m;
      evento({ tipo: 'marco', p: m });
    }
    // um aviso por virada: o mesmo lado só volta ao feed depois de 15 min (no ensaio, 50 avisos iguais numa noite)
    const tVir = A.modo === 'sim' ? A.sim?.relogio ?? Date.now() : Date.now();
    if (A._vir !== undefined && temVirada && !A._vir && (A._virQuem !== lp || tVir - A._virEm > 15 * 60000)) {
      evento({ tipo: 'virada', quem: lp, forte: true });
      A._virQuem = lp;
      A._virEm = tVir;
    }
    A._vir = !!temVirada;
    const fecha = r.tudo ? 'tudo' : r.definido ? 'def' : r.eleitoTSE ? 'tse' : '';
    if (A._fecha === undefined) A._fecha = fecha;
    else if (fecha && fecha !== A._fecha) {
      A._fecha = fecha;
      const q = r.definido || r.eleitoTSE || lc;
      evento({ tipo: 'nac', quem: q, forte: true, txt: fecha === 'tudo' ? `Apuração concluída: ${C.curto(q)} à frente` : fecha === 'def' ? `${C.curto(q)} matematicamente definido` : `${C.curto(q)} eleito, segundo o TSE` });
    }
  }
  atualizarAgora(r, temVoto);
  if (r.completo && pontoSerie(r)) for (const g of $$('[data-grafico^="apur-"]')) C.desenharGrafico(g);
  atualizarMapa(r);
  pintarFeed();
}

// Hora com segundos ("19:42:10"): a cada 10 s de leitura, minuto só não diz se está andando.
function hms(t) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(t);
}
// Faixa curta no topo: a hora da última totalização do TSE (ou a hora simulada) e, se algo falhar, o aviso.
function atualizarHora() {
  const el = $('[data-ap-hora]');
  if (!el || !A.res) return;
  if (A.modo === 'sim') {
    const s = `hora simulada ${C.fHora(A.sim.relogio)}`;
    if (el.textContent !== s) el.textContent = s;
    return;
  }
  const agora = Date.now();
  const t = A.res.cont.tTot;
  const e = R.erros.get('br');
  const falta = Math.max(0, Math.ceil(((R.prox.get('br') ?? agora) - agora) / 1000));
  let s;
  let ruim = false;
  if (e) {
    s = `${e.amigavel || 'falha ao ler o TSE'} · nova tentativa em ${falta} s`;
    ruim = true;
  } else if (R.okEm && agora - R.okEm > MODELO.SEM_RESPOSTA_MS) {
    s = `sem resposta do TSE desde ${hms(R.okEm)}`;
    ruim = true;
  } else if (!R.okEm && R.inicio && agora - R.inicio > MODELO.SEM_RESPOSTA_MS) {
    s = 'o TSE ainda não respondeu';
    ruim = true;
  } else s = t ? `TSE · ${hms(t)}` : A.res.cont.pst > 0 ? 'TSE totalizando' : 'aguardando o TSE';
  if (el.textContent !== s) el.textContent = s;
  el.classList.toggle('erro', ruim);
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
    // A parte que a página não controla: a rede do TSE renova a cópia de cada arquivo de tempos em tempos.
    const idadeBR = idadeRede('br');
    if (idadeBR !== null && R.fixa >= 0.6) p.push(`cópia do arquivo na rede do TSE com ${Math.round(idadeBR)} s (a rede renova a cada ~${Math.round(R.renovaS)} s)`);
    s = p.join(' · ');
  }
  // No ao vivo o espaço do atraso fica reservado (ele só ganha texto); fora dele, nunca é mostrado.
  el.hidden = A.modo !== 'vivo';
  if (el.textContent !== s) el.textContent = s;
}

function atualizarPre() {
  const e = obj(C.dados()?.eleicao) || {};
  const fe = C.msDe(e.fechamento) ?? C.msDe('2026-10-25T17:00:00-03:00');
  const ab = C.msDe(e.abertura) ?? C.msDe('2026-10-25T08:00:00-03:00');
  const agora = Date.now();
  const falta = fe - agora;
  if (falta <= 0) {
    trocarModo('vivo');
    return;
  }
  // O preço do Polymarket chega e muda depois que a aba abriu: a prévia acompanha sem esperar nova leitura de dados.
  const pPoly = chancePolyLula();
  if (A.pPoly !== pPoly) {
    A.pPoly = pPoly;
    pintarChance(pPoly);
  }
  const rel = $('[data-rx-rel]');
  if (!rel) return;
  const s = Math.floor(falta / 1000);
  const d = Math.floor(s / 86400);
  const vals = { d, h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
  for (const [k, v] of Object.entries(vals)) {
    const un = rel.querySelector(`[data-un="${k}"]`);
    if (!un) continue;
    if (k === 'd') un.classList.toggle('on', d >= 1);
    const b = un.querySelector('b span');
    const t = String(v).padStart(2, '0');
    if (b.textContent !== t) {
      b.textContent = t;
      if (un._pronto && !reduzMovimento()) {
        un.classList.remove('vira');
        void un.offsetWidth;
        un.classList.add('vira');
      }
    }
    un._pronto = true;
  }
  if (rel._m !== vals.m) {
    rel._m = vals.m;
    rel.setAttribute('aria-label', `Faltam ${d ? `${d} d ` : ''}${vals.h} h e ${vals.m} min para o fechamento das urnas`);
  }
  const dia = $('[data-rx-dia]');
  if (dia) dia.style.width = `${clamp(((agora - ab) / Math.max(1, fe - ab)) * 100, 0, 100).toFixed(2)}%`;
}

/* =============================================================== leitura */

/* Como a página lê o TSE (v4, 24/10/2026; revisto contra o simulador work/pocket/qa_apuracao/sim_tse4.py, que imita
 * o que foi medido na rede real: renovação da cópia a cada ~12 s, uma máquina por conexão, duas camadas de cache,
 * 503, 429, resposta de 8 s, JSON cortado, UF parada, Brasil à frente e atrás dos estados e versão velha depois da nova):
 * - Um relógio de 250 ms decide o que pedir. Cada arquivo tem no máximo um pedido no ar, com tempo-limite.
 * - Brasil e abrangência a cada 1 s (a abrangência com 0,5 s de defasagem em relação ao Brasil). A abrangência diz
 *   quais UFs mudaram; essas são relidas na hora (até 5 no ar, primeiro as com mais eleitorado por apurar).
 * - Caça: se a abrangência já mostra uma versão que a cópia da rede do TSE ainda não entrega, o próximo pedido
 *   daquele arquivo sai quando o max-age mostra que a máquina vai renovar a cópia (ver esperaCaca), em vez de
 *   tentar às cegas. Sem max-age, ou se a página muda de máquina o tempo todo, volta a 1 s, 1 s, 1,5 s, 2 s, 3 s...
 *   Rede de segurança: toda UF em contagem é relida ao menos a cada 60 s (15 s sem abrangência).
 *   Se a abrangência mostra o Brasil à frente do arquivo Brasil lido, o Brasil também é caçado.
 * - cache: 'no-cache': o navegador revalida com If-None-Match/If-Modified-Since e, sem mudança, o TSE devolve 304
 *   (~300 bytes). Nada de parâmetro para furar o cache. Depois de um JSON cortado, o próximo pedido daquele arquivo
 *   é cache: 'reload' (sem isso o navegador revalidava, recebia 304 e reusava o corpo cortado).
 * - Versão mais velha que a já lida é descartada (compVersao).
 * - Erro: nova tentativa em 5, 10, 20, 40 s, até 1 min; 429 pausa tudo por 30 s; três erros seguidos pausam UFs e
 *   abrangência e só o Brasil sonda até o TSE voltar.
 * - Aba do navegador em segundo plano, ou outra aba da página aberta: continua lendo, em metade do ritmo (o navegador
 *   pode espaçar mais depois de 5 min oculta); ao voltar, lê na hora.
 */
const R = {
  relogio: null,
  emVoo: new Map(), // arquivo -> AbortController
  prox: new Map(), // arquivo -> não pedir antes de (ms)
  erros: new Map(), // arquivo -> { n, msg, status, cortado }
  tentou: new Map(), // UF -> pedidos feitos
  lidoEm: new Map(), // UF -> última resposta boa (ms)
  pend: new Map(), // UF -> { st, n, t0 }: a abrangência diz que há versão nova
  pendBR: null, // { st, n, t0 }: idem para o arquivo Brasil
  rede: new Map(), // arquivo -> { em, max }: Cache-Control da última resposta (hora de chegada e max-age)
  ttlRede: MODELO.TTL_REDE_S, // max-age de uma cópia recém-renovada (aprendido: o maior visto)
  renovaS: MODELO.RENOVA_S, // idade em que a máquina renova a cópia (aprendida das renovações vistas no Brasil)
  fixa: 0.5, // 0..1: quanto a página fica na mesma máquina do TSE (o max-age cai 1 por segundo, sem saltos aleatórios)
  renovacoes: 0, // renovações vistas no arquivo Brasil/abrangência (para a tela)
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
  ultTela: 0, // última vez que a tela foi refeita (uma leitura sem novidade não a refaz, mas a cada 5 s ela é refeita mesmo assim)
};

function zerarLeitura() {
  for (const ctl of R.emVoo.values()) ctl?.abort?.();
  clearTimeout(R.relogio);
  clearTimeout(R.tela);
  R.relogio = null;
  R.tela = null;
  for (const k of ['emVoo', 'prox', 'erros', 'tentou', 'lidoEm', 'pend', 'rede']) R[k] = new Map();
  R.pendBR = null;
  R.ttlRede = MODELO.TTL_REDE_S;
  R.renovaS = MODELO.RENOVA_S;
  R.fixa = 0.5;
  R.renovacoes = 0;
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
  R.ultTela = 0;
}

function falha(msg, status = 0) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

// Texto de erro para a tela: sempre em português e curto. O texto técnico (message) fica só no console e no gancho de teste.
function erroAmigavel(e) {
  const m = String(e?.message || e || '');
  const st = Number(e?.status) || 0;
  if (e?.cortado || /incompleto|interrompid/i.test(m)) return 'o TSE enviou um arquivo incompleto';
  if (st === 429 || /\b429\b|pausa/i.test(m)) return 'o TSE pediu uma pausa';
  if (st === 404) return 'o TSE ainda não publicou este arquivo';
  if (st >= 500) return 'o servidor do TSE está instável';
  if (st >= 400) return 'o TSE recusou o pedido';
  if (/demorou|abort|timeout|timed out/i.test(m)) return 'o TSE demorou a responder';
  if (/sem conex|failed to fetch|load failed|network|fetch/i.test(m)) return 'sem conexão com o TSE neste momento';
  if (/formato|sem lula|inesperado/i.test(m)) return 'o arquivo do TSE veio em formato inesperado';
  return 'falha ao ler o TSE';
}

// Cache-Control de cada resposta = tempo que falta para a cópia daquela máquina do TSE vencer. Daí saem: a idade da
// cópia, quando a máquina vai renová-la e se a página continua na mesma máquina. Nada disso muda o que é mostrado:
// só decide QUANDO pedir de novo.
function registrarRede(chave, cacheControl) {
  const m = /max-age\s*=\s*(\d+)/i.exec(cacheControl || '');
  if (!m) {
    R.rede.delete(chave);
    return;
  }
  const max = Number(m[1]);
  const agora = Date.now();
  const p = R.rede.get(chave);
  if (max > R.ttlRede && max <= 120) R.ttlRede = max;
  if (p && agora - p.em <= 2500 && (chave === 'br' || chave === 'ab')) {
    const dt = (agora - p.em) / 1000;
    const esperado = p.max - dt;
    const renovou = max > esperado + 2.5 && max >= R.ttlRede - 8;
    const seguiu = Math.abs(max - esperado) <= 2.5;
    R.fixa = R.fixa * 0.85 + (renovou || seguiu ? 1 : 0) * 0.15;
    if (renovou) {
      // a cópia estava com idade (ttl − max anterior) + dt quando renovou: aprende o ponto de renovação
      const idade = R.ttlRede - p.max + dt;
      if (idade >= 6 && idade <= 60) R.renovaS = R.renovaS * 0.7 + idade * 0.3;
      R.renovacoes += 1;
    }
  }
  R.rede.set(chave, { em: agora, max });
}

// Idade estimada, em s, da cópia que a rede do TSE tem agora do arquivo (a partir da última resposta).
function idadeRede(chave) {
  const m = R.rede.get(chave);
  if (!m) return null;
  return Math.max(0, R.ttlRede - m.max + (Date.now() - m.em) / 1000);
}

// Quanto esperar (ms) para pedir de novo um arquivo que a abrangência diz ter versão nova que a cópia ainda não
// entrega. Com a página fixa numa máquina do TSE, a nova versão chega quando a máquina renova a cópia (aos ~12 s de
// idade): espera até lá (de 4 em 4 s, no máximo) e depois pede a cada 0,5 a 1,25 s. Sem essa informação, escada de 1 a 5 s.
const ESCADA_CACA = [1000, 1000, 1500, 2000, 3000, 5000];
function esperaCaca(chave, n) {
  const idade = idadeRede(chave);
  if (idade !== null && R.fixa >= 0.6) {
    const falta = R.renovaS - idade;
    // no máximo 4 s de espera por vez: se a página trocar de máquina do TSE no meio, a próxima leitura já refaz a conta
    if (falta > 0.7) return Math.min(falta + 0.3, 4) * 1000;
    return 500 + 250 * Math.min(n, 4);
  }
  return ESCADA_CACA[Math.min(n, ESCADA_CACA.length - 1)];
}
const comJitter = (ms) => ms * (1 - MODELO.JITTER + Math.random() * 2 * MODELO.JITTER);

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
    try {
      registrarRede(chave, r.headers.get('cache-control'));
    } catch {
      /* cabeçalho ilegível: só deixa de caçar pelo max-age */
    }
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
  R.erros.set(chave, { n, msg: String(e?.message || e).slice(0, 60), amigavel: erroAmigavel(e), status: e.status ?? 0, cortado: !!e.cortado });
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

// Junta as respostas que chegam juntas (até 5 UFs) num redesenho só. 25 ms: o número novo vai à tela quase na hora.
function pedirTela() {
  if (R.tela) return;
  R.tela = setTimeout(() => {
    R.tela = null;
    R.ultTela = Date.now();
    atualizarTela();
  }, 25);
}

async function lerBR() {
  let mudou = true; // um erro também refaz a tela (a linha de aviso)
  try {
    const novo = lerTSE(await baixarJSON('br', urlTSE('br')));
    deuCerto('br');
    mudou = compVersao(A.br, novo) > 0;
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
      // Caça ao Brasil: a abrangência já mostrava mais seções do que este arquivo trouxe.
      const p = R.pendBR;
      if (p && (novo.st ?? 0) >= p.st) R.pendBR = null;
      if (R.pendBR && Date.now() - R.pendBR.t0 < MODELO.CACA_MAX_MS) {
        // Caça ao Brasil: nunca mais devagar que a leitura de rotina (1 s). Com a página fixa numa máquina do TSE, perto da
        // hora em que ela renova a cópia (ver idadeRede) lê de 0,5 em 0,5 s.
        R.pendBR.n += 1;
        const idade = idadeRede('br');
        const perto = idade !== null && R.fixa >= 0.6 && R.renovaS - idade > -1.5 && R.renovaS - idade < 1.2;
        R.prox.set('br', Date.now() + comJitter(perto ? 500 : MODELO.CADA_BR_MS * ritmo()));
      } else {
        R.pendBR = null;
        R.prox.set('br', Date.now() + comJitter(MODELO.CADA_BR_MS * ritmo()));
      }
    } else {
      // Máquina do TSE com versão mais velha que a já lida: descarta e tenta de novo mais cedo.
      R.velhas += 1;
      R.prox.set('br', Date.now() + (MODELO.CADA_BR_MS * ritmo()) / 2);
    }
  } catch (e) {
    deuErro('br', e);
  }
  if (mudou) pedirTela();
  puxarUFs();
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
          if (!R.pend.has(uf)) {
            R.pend.set(uf, { st: x.st, n: 0, t0: Date.now() });
            if (!R.erros.has(uf)) R.prox.set(uf, 0); // lê já: a cópia daquele estado pode ter renovado antes da abrangência
          } else R.pend.get(uf).st = Math.max(R.pend.get(uf).st, x.st);
        } else if (x) R.pend.delete(uf);
      }
      // O Brasil na abrangência já está à frente do arquivo Brasil lido: lê e caça o Brasil.
      if (ab.br && A.br && ab.br.st > (A.br.st ?? 0) && !R.erros.has('br')) {
        if (!R.pendBR) R.pendBR = { st: ab.br.st, n: 0, t0: Date.now() };
        else R.pendBR.st = Math.max(R.pendBR.st, ab.br.st);
        if (!R.emVoo.has('br') && (R.prox.get('br') ?? 0) > Date.now() + 1000) R.prox.set('br', 0);
      }
    }
    R.prox.set('ab', Date.now() + comJitter(MODELO.CADA_AB_MS * ritmo()));
  } catch (e) {
    deuErro('ab', e);
    // Sem abrangência (fora do ar ou formato novo): as UFs voltam ao ciclo curto.
    if ((R.erros.get('ab')?.n ?? 0) >= 2) R.abOk = false;
  }
  puxarUFs();
}

async function lerUF(uf) {
  R.tentou.set(uf, (R.tentou.get(uf) ?? 0) + 1);
  let mudou = true;
  try {
    const novo = lerTSE(await baixarJSON(uf, urlTSE(uf)));
    deuCerto(uf);
    const cmp = compVersao(A.ufs.get(uf), novo);
    mudou = cmp > 0;
    if (cmp >= 0) A.ufs.set(uf, novo);
    else R.velhas += 1;
    R.lidoEm.set(uf, Date.now());
    const p = R.pend.get(uf);
    if (p) {
      if ((A.ufs.get(uf)?.st ?? -1) >= p.st) R.pend.delete(uf);
      else if (Date.now() - p.t0 > MODELO.CACA_MAX_MS) R.pend.delete(uf);
      else {
        // A abrangência já mostra a versão nova, mas a cópia da rede do TSE ainda entrega a anterior: caça.
        p.n += 1;
        R.prox.set(uf, Date.now() + comJitter(esperaCaca(uf, p.n - 1)));
      }
    }
  } catch (e) {
    deuErro(uf, e);
  }
  if (mudou) pedirTela();
  puxarUFs();
}

const urlCap = (c) => `${A.fonte}/${A.eleicao}/dados/${c.uf.toLowerCase()}/${c.cod}-c0001-e${codEleicao()}-u.json`;

// Capital = arquivo do município, mesmo formato do arquivo do estado. Erro de uma capital não
// derruba nada: ela espera a sua vez (deuErro) e as demais seguem.
async function lerCap(c) {
  const chave = `cap:${c.cod}`;
  R.tentou.set(chave, (R.tentou.get(chave) ?? 0) + 1);
  let mudou = true;
  try {
    const novo = lerTSE(await baixarJSON(chave, urlCap(c)));
    R.erros.delete(chave);
    const cmp = compVersao(A.cap.get(c.cod), novo);
    mudou = cmp > 0;
    if (cmp >= 0) A.cap.set(c.cod, novo);
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
  if (mudou) pedirTela();
}

// No máximo uma capital nova por tique, até 4 no ar, e só quando o Brasil, a abrangência e
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
// Ocupa as vagas de UF. Chamada a cada tique e também ao fim de cada leitura: a carga inicial das 28
// (e uma rodada de UFs que mudaram) anda no ritmo da rede, não do relógio.
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
  R.relogio = setTimeout(tique, MODELO.TIQUE_MS);
  try {
    agendar();
  } catch (e) {
    console.error('[apuração] leitura', e);
  }
  // Leituras sem novidade não refazem a tela; mesmo assim ela é refeita a cada 5 s (idade do simulador, "há N min", destaques com prazo)
  if (Date.now() - R.ultTela > 5000) pedirTela();
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
  if (!R.prox.has('ab')) R.prox.set('ab', Date.now() + MODELO.CADA_AB_MS / 2); // abrangência meio ciclo atrás do Brasil: os pedidos não saem juntos
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
      ts: Math.max(1, Math.round(te / MODELO.ELEITORES_POR_URNA_SIM)),
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
  let stT = 0;
  let tsT = 0;
  for (const uf of UFS) {
    const u = s.ufs.get(uf);
    const p = clamp((tau - u.ini) / u.dur, 0, 1);
    const f = p * p * (3 - 2 * p);
    const e = Math.round(u.te * f);
    const st = Math.round(u.ts * f);
    stT += st;
    tsT += u.ts;
    const cc = Math.round(e * u.comp);
    const bn = Math.round(cc * u.bn);
    const v = cc - bn;
    const sh = clamp(u.share + u.vies * (1 - f), 0.02, 0.98);
    const l = Math.round(v * sh);
    A.ufs.set(uf, { pst: u.ts > 0 ? (st / u.ts) * 100 : f * 100, st, ts: u.ts, te: u.te, est: e, c: cc, vb: Math.round(bn * 0.4), tvn: bn - Math.round(bn * 0.4), vv: v, L: l, F: v - l, pL: null, pF: null, tTot: s.relogio, em: Date.now() });
    te += u.te;
    est += e;
    c += cc;
    vb += bn;
    vv += v;
    L += l;
    F += v - l;
  }
  A.br = { pst: tsT > 0 ? (stT / tsT) * 100 : 0, st: stT, ts: tsT, te, est, c, vb, tvn: 0, vv, L, F, pL: vv > 0 ? (L / vv) * 100 : null, pF: vv > 0 ? (F / vv) * 100 : null, tTot: s.relogio };
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

// Os avisos e a lista da noite recomeçam do zero quando a fonte muda (ao vivo, simulação, recomeço).
function zerarEventos() {
  A.ev = [];
  A.evN = 0;
  A.evNovo = false;
  A.evOk = false;
  A.evT0 = 0;
  A._lid = undefined;
  A._marco = undefined;
  A._vir = undefined;
  A._fecha = undefined;
}

function trocarModo(modo) {
  pararTimers();
  zerarLeitura();
  A.modo = modo;
  A.ufSel = null;
  zerarEventos();
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
  for (const feed of $$('[data-rx-feed]')) {
    feed._vistos = new Set(A.ev.slice(0, 4).map((e) => e.id));
    A.evNovo = A.ev.length > 0;
  }
  if (A.modo === 'pre') {
    atualizarPre();
    atualizarTela();
    // Contagem até as 17h roda mesmo com a aba fechada, para a troca para "ao vivo" acontecer na hora.
    if (A.modo === 'pre') A.timers.push(setInterval(atualizarPre, 250));
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
  if (!A.fonteTeste && !A.teste) return; // só no simulador local (?tse=) ou no teste com outra eleição (?eleicao=6257)
  const txt = (html) => C.emHtml(html).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  window.__apuracao = {
    estado() {
      atualizarHora(); // o texto do atraso acompanha a última leitura (o teste lê no meio de um segundo)
      const r = A.res;
      // ufs: o que entrou na última conta (é com isso que os destaques foram escritos);
      // ufsLidas: o que já chegou do TSE (pode estar um passo à frente da conta).
      const ufs = {};
      for (const u of r?.linhas || []) {
        if (u.o) ufs[u.uf] = { st: u.o.st, ts: u.o.ts, est: u.est, te: u.te, c: u.o.c, L: u.L, F: u.F, tTot: u.o.tTot, rem: u.rem, share: u.share, comp: u.comp, bn: u.bn };
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
          // pL e parL são os efetivos (motor em uso); projL/projF/parLUF/pLUF são sempre os do modelo por estado
          pL: r.pL, pLUF: r.pLUF, pBruto: r.pBruto, pDiv: r.pDiv, equil: A._equil === true, parL: r.proj.parL, parLUF: r.projUF.parL, projL: r.projUF.L, projF: r.projUF.F,
          motor: r.motor, efL: r.proj.L, efF: r.proj.F, definido: r.definido, tudo: r.tudo,
          eleitoTSE: r.eleitoTSE, completo: r.completo, lidos: r.lidos, remCont: r.remCont, remMax: r.remMax, swing: r.swing, urnas: r.urnas,
          sim: r.sim && { ger: r.sim.ger, idade: r.sim.idade, secoes: r.sim.secoes, modelado: r.sim.modelado, faixa: r.sim.faixa, chanceL: r.sim.chanceL },
        },
        rede: { fixa: R.fixa, renovaS: R.renovaS, ttl: R.ttlRede, renovacoes: R.renovacoes, idadeBR: idadeRede('br'), caca: R.pend.size, cacaBR: !!R.pendBR },
        curva: A.curva ? A.curva.series.map((s) => s.id) : A.curva,
        simParado: A.simParado,
        simAval: A.simAval,
        simDoc: A.simDoc && obj(A.simDoc.doc) && {
          modo: A.simDoc.modo, em: A.simDoc.em, ger: C.num(A.simDoc.doc.gerado_ms), secoes: C.num(A.simDoc.doc.apuracao?.secoes_pct),
          modelado: C.num(A.simDoc.doc.apuracao?.eleitorado_modelado_pct), lulaPct: C.num(A.simDoc.doc.projecao?.lula_pct),
          faixa: A.simDoc.doc.projecao?.faixa80?.lula ?? null, chance: C.num(A.simDoc.doc.projecao?.chance?.lula),
          vL: C.num(A.simDoc.doc.projecao?.votos?.lula), vF: C.num(A.simDoc.doc.projecao?.votos?.flavio), serieN: arr(A.simDoc.doc.serie).length,
        },
        motorSim: A.motorSim,
        ritmo: (() => {
          const x = ritmoContagem();
          return x && { ...x, eta: x.eta && x.eta.map((y) => ({ id: y.s.id, t: y.t })) };
        })(),
        agoraPag: Date.now(),
        insights: r && A.modo !== 'pre' ? calcularInsights(r).map((x) => ({ id: x.id, tag: x.tag, p: x.p, txt: txt(x.html) })) : [],
        // painel dos estados: o que a conta (processar) decidiu para cada linha
        estados: Object.fromEntries(
          (r?.linhas || []).map((u) => [
            u.uf,
            {
              status: u.status, quem: u.quem, chance: u.chance, prevChance: u.prevChance, sec: u.sec, fim: u.fim, defUF: u.defUF,
              L: u.L, F: u.F, te: u.te, est: u.est, rem: u.rem, sig: u.sig, projL: u.projL, projF: u.projF, parObs: u.parObs,
              t1Par: u.t1Par, dT1: u.dT1, lider: u.lider, lider1T: u.lider1T, faixa: u.faixa, projPar: u.projPar, faltaMax: u.faltaMax,
              compObs: u.compObs, tTot: u.o?.tTot ?? null, st: u.o?.st ?? null, ts: u.o?.ts ?? null, c: u.o?.c ?? null, share: u.share,
              urnasFalta: u.urnasFalta, tsTotal: u.ts, remMax: u.remMax, comp: u.comp, bn: u.bn,
            },
          ]),
        ),
        capitais: Object.fromEntries([...A.cap].map(([cod, o]) => [cod, { st: o.st, ts: o.ts, L: o.L, F: o.F, tTot: o.tTot }])),
        atrasos: A.atrasos.map((x) => ({ ...x })),
        brVisto: A.br && { vistoEm: A.br.vistoEm, vistoVivo: A.br.vistoVivo, tTot: A.br.tTot, tGer: A.br.tGer },
        sigmaNac: A.base?.sigmaNac,
        rot: A.rot,
        serie: A.serie.length,
        serieFim: A.serie.slice(-150).map((x) => ({ ...x })),
        // texto técnico dos erros (só no gancho) e o que a tela mostrou no lugar
        errosTela: Object.fromEntries([...R.erros].map(([k, e]) => [k, e.amigavel])),
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
    const alvo = e.target instanceof Element ? e.target.closest('[data-ap], .rx-uf[data-uf]') : null;
    if (!alvo) return;
    if (alvo.matches('.rx-uf[data-uf]')) {
      // O detalhe do estado abre numa folha por cima da página: a lista embaixo não se mexe.
      abrirUF(alvo.dataset.uf);
      return;
    }
    const a = alvo.dataset.ap;
    if (a === 'ord-uf') {
      if (ORDENS.some(([k]) => k === alvo.dataset.ord)) {
        A.ufOrd = alvo.dataset.ord;
        if (A.res) aplicarOrdem(A.res);
      }
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
      fecharUF();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (A.modo === 'vivo') ligarVivo();
    manterTelaAcesa();
  });
  // Girou o aparelho ou mudou a largura: refaz as alturas reservadas (linhas dos estados, cartões) e o corte dos destaques.
  let rz = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => {
      if (!A.raiz || !A.res || A.modo === 'pre') return;
    });
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
  carregarCurva();
  montarTela();
  return {
    mostrar() {
      A.ativo = true;
      if (!A.base && C.dados()) montarTela();
      else if (A.modo === 'vivo') ligarVivo();
      else if (A.modo === 'sim' && !A.sim?.fim) ligarSimulacao();
      else if (A.modo === 'pre') {
        if (!A.timers.length) A.timers.push(setInterval(atualizarPre, 250));
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
      // a aba não mostra mais os destaques em texto; os mercados seguem lidos pelo cálculo (ver ganchoTeste)
    },
    abaPadrao() {
      return A.modo === 'vivo' && !A.teste ? 'apuracao' : null;
    },
  };
}
