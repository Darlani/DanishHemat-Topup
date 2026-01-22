const crypto = require('crypto');
const https = require('https');

// Fungsi pembantu untuk membaca body request di Vercel
const parseRequestBody = (req) => {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                resolve({});
            }
        });
        req.on('error', reject);
    });
};

module.exports = async (req, res) => {
    // 1. Setup CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    try {
        // 2. PARSE BODY (Sangat Penting untuk Vercel)
        const bodyData = await parseRequestBody(req);
        const { userid, game, product, price } = bodyData;

        // 3. Validasi input
        if (!userid || !price) {
            return res.status(400).json({ 
                error: "Data tidak lengkap", 
                received: bodyData 
            });
        }

        const merchantCode = 'DS27606';
        const apiKey = '5c32a1f212281470dd2613ed52b5a370';
        const merchantOrderId = 'DH-' + Date.now();

        // 4. Signature MD5
        const stringToHash = merchantCode + merchantOrderId + price.toString() + apiKey;
        const signature = crypto.createHash('md5').update(stringToHash).digest('hex');

        const payload = JSON.stringify({
            merchantCode,
            paymentAmount: parseInt(price),
            merchantOrderId,
            productDetails: `Topup ${game} - ${product} (${userid})`,
            email: 'customer@gmail.com',
            signature,
            callbackUrl: `https://${req.headers.host}/api/callback`,
            returnUrl: `https://${req.headers.host}/`,
            expiryPeriod: 60
        });

        // 5. Request ke Duitku
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
            let responseBody = '';
            response.on('data', (chunk) => (responseBody += chunk));
            response.on('end', () => {
                try {
                    const jsonRes = JSON.parse(responseBody);
                    res.status(200).json(jsonRes);
                } catch (e) {
                    res.status(500).json({ error: "Respon Duitku bukan JSON", details: responseBody });
                }
            });
        });

        request.on('error', (error) => {
            res.status(500).json({ error: "Gagal menyambung ke Duitku", details: error.message });
        });

        request.write(payload);
        request.end();

    } catch (error) {
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
};
