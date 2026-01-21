const crypto = require('crypto');
const axios = require('axios');

module.exports = async (req, res) => {
    // Memastikan hanya POST yang diizinkan
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { userid, game, product, price } = req.body;

        // --- KONFIGURASI ---
        const merchantCode = 'DS27606'; // Ganti dengan Merchant Code Anda
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

        // --- HIT API DUITKU ---
        const response = await axios.post('https://passport-sandbox.duitku.com/webapi/api/merchant/v2/inquiry', payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000
        });

        // Kirim hasil ke frontend
        return res.status(200).json(response.data);

    } catch (error) {
        console.error("Backend Error:", error.message);
        
        // Kirim detail error agar kita bisa baca di browser
        return res.status(500).json({ 
            statusMessage: "Error Backend", 
            details: error.response ? error.response.data : error.message 
        });
    }
};
