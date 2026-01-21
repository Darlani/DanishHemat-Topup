const crypto = require('crypto');

module.exports = async (req, res) => {
    // Tambahkan header CORS agar browser tidak memblokir
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { userid, game, product, price } = req.body;

        // --- KONFIGURASI ---
        const merchantCode = 'DS27606'; // Ganti dengan Kode D Anda
        const apiKey = '5c32a1f212281470dd2613ed52b5a370'; // Ganti dengan API Key Anda
        const merchantOrderId = 'DH-' + Date.now();
        
        // --- SIGNATURE ---
        const stringToHash = merchantCode + merchantOrderId + price + apiKey;
        const signature = crypto.createHash('md5').update(stringToHash).digest('hex');

        const payload = {
            merchantCode,
            paymentAmount: parseInt(price),
            merchantOrderId,
            productDetails: `Topup ${game} - ${product}`,
            email: 'customer@gmail.com',
            signature,
            callbackUrl: `https://${req.headers.host}/api/callback`,
            returnUrl: `https://${req.headers.host}/`,
            expiryPeriod: 60
        };

        // Menggunakan fetch bawaan Node.js 18 ke atas
        const response = await fetch('https://passport-sandbox.duitku.com/webapi/api/merchant/v2/inquiry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        // Kirim hasil balik ke frontend
        return res.status(200).json(data);

    } catch (error) {
        console.error("Fetch Error:", error.message);
        return res.status(500).json({ statusMessage: "Gagal ke Duitku", error: error.message });
    }
};
