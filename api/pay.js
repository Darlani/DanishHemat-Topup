const crypto = require('crypto');
const https = require('https');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    try {
        const { userid, game, product, price } = req.body;

        const merchantCode = 'DS27606'; 
        const apiKey = '5c32a1f212281470dd2613ed52b5a370'; 
        const merchantOrderId = 'DH-' + Date.now();
        
        // Buat signature MD5
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

        const options = {
            hostname: 'passport-sandbox.duitku.com',
            path: '/webapi/api/merchant/v2/inquiry',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': payload.length
            }
        };

        const request = https.request(options, (response) => {
            let body = '';
            response.on('data', (chunk) => body += chunk);
            response.on('end', () => {
                try {
                    res.status(200).json(JSON.parse(body));
                } catch (e) {
                    res.status(500).json({ error: "Respon Duitku bukan JSON", details: body });
                }
            });
        });

        request.on('error', (error) => {
            res.status(500).json({ error: "Gagal ke Duitku", details: error.message });
        });

        request.write(payload);
        request.end();

    } catch (error) {
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
};
