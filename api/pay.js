const crypto = require('crypto');

module.exports = async (req, res) => {
    // Header untuk keamanan dan akses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    try {
        const { userid, game, product, price } = req.body;

        // --- PASTIKAN DATA INI BENAR SESUAI DASHBOARD ---
        const merchantCode = 'DS27606'; // Ganti dengan Kode Merchant Anda
        const apiKey = '5c32a1f212281470dd2613ed52b5a370'; // Ganti dengan API Key Anda
        // ----------------------------------------------

        const merchantOrderId = 'DH-' + Date.now();
        
        // Buat Signature MD5
        const stringToHash = merchantCode + merchantOrderId + price + apiKey;
        const signature = crypto.createHash('md5').update(stringToHash).digest('hex');

        const payload = {
            merchantCode,
            paymentAmount: parseInt(price),
            merchantOrderId,
            productDetails: `Topup ${game} - ${product} (${userid})`,
            email: 'customer@gmail.com',
            signature,
            callbackUrl: `https://${req.headers.host}/api/callback`,
            returnUrl: `https://${req.headers.host}/`,
            expiryPeriod: 60
        };

        const response = await fetch('https://passport-sandbox.duitku.com/webapi/api/merchant/v2/inquiry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        return res.status(200).json(data);

    } catch (error) {
        return res.status(500).json({ statusMessage: "Server Error", details: error.message });
    }
};
