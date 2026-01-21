const crypto = require('crypto');
const https = require('https');

module.exports = async (req, res) => {
    // Hanya terima POST
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { userid, game, product, price } = req.body;

        // --- GANTI DATA INI DENGAN DATA SANDBOX ANDA ---
        const merchantCode = 'DS27606'; // Contoh: D1234
        const apiKey = '5c32a1f212281470dd2613ed52b5a370'; // API Key panjang Anda
        // ----------------------------------------------

        const merchantOrderId = 'DH-' + Date.now();
        
        // Buat Signature MD5
        const stringToHash = merchantCode + merchantOrderId + price + apiKey;
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
            let responseData = '';
            response.on('data', (chunk) => { responseData += chunk; });
            response.on('end', () => {
                try {
                    const result = JSON.parse(responseData);
                    res.status(200).json(result);
                } catch (e) {
                    res.status(500).json({ statusMessage: "Respon Duitku bukan JSON" });
                }
            });
        });

        request.on('error', (err) => {
            res.status(500).json({ statusMessage: "Gagal koneksi ke Duitku: " + err.message });
        });

        request.write(payload);
        request.end();

    } catch (error) {
        res.status(500).json({ statusMessage: "Internal Server Error: " + error.message });
    }
};
