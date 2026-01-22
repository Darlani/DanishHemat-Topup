const crypto = require('crypto');
const https = require('https');

async function readBody(req) {
    const buffers = [];
    for await (const chunk of req) { buffers.push(chunk); }
    const data = Buffer.concat(buffers).toString();
    try { return JSON.parse(data); } catch (e) { return {}; }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const body = await readBody(req);
        const { userid, game, product, price } = body;

        if (!price) {
            return res.status(400).json({ statusMessage: "Harga tidak ditemukan" });
        }

        // KONFIGURASI SANDBOX
        const merchantCode = 'DS27606'; 
        const apiKey = '5c32a1f212281470dd2613ed52b5a370';
        const merchantOrderId = 'DH-' + Date.now();
        const paymentAmount = parseInt(price);

        // Signature MD5 Sandbox: merchantCode + merchantOrderId + paymentAmount + apiKey
        const stringToHash = merchantCode + merchantOrderId + paymentAmount + apiKey;
        const signature = crypto.createHash('md5').update(stringToHash).digest('hex');

        const payload = JSON.stringify({
            merchantCode,
            paymentAmount,
            merchantOrderId,
            productDetails: `Topup ${game || 'Game'} - ${product || 'Produk'} (${userid || 'No ID'})`,
            email: 'customer@gmail.com',
            signature,
            callbackUrl: `https://${req.headers.host}/api/callback`,
            returnUrl: `https://${req.headers.host}/`,
            expiryPeriod: 60
        });

        const options = {
            hostname: 'passport-sandbox.duitku.com',
            path: '/webapi/api/merchant/v2/inquiry',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const request = https.request(options, (response) => {
            let resData = '';
            response.on('data', (chunk) => resData += chunk);
            response.on('end', () => {
                try {
                    const result = JSON.parse(resData);
                    res.status(200).json(result);
                } catch (e) {
                    res.status(500).json({ statusMessage: "Respon server Duitku tidak valid", details: resData });
                }
            });
        });

        request.on('error', (e) => res.status(500).json({ statusMessage: e.message }));
        request.write(payload);
        request.end();

    } catch (error) {
        res.status(500).json({ statusMessage: "Internal Server Error", error: error.message });
    }
};
