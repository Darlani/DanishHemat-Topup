const crypto = require('crypto');

module.exports = async (req, res) => {
    // Tambahkan header agar bisa dipanggil dari domain manapun
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Harus POST' });
    }

    try {
        const { userid, game, product, price } = req.body;

        // --- PASTI KAN DATA INI BENAR ---
        const merchantCode = 'DS27606'; // Kode Merchant (huruf D)
        const apiKey = '5c32a1f212281470dd2613ed52b5a370'; // API Key panjang
        // -------------------------------

        const merchantOrderId = 'DH-' + Date.now();
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
        return res.status(500).json({ error: error.message });
    }
};
