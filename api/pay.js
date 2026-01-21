const crypto = require('crypto');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    const { userid, game, product, price } = req.body;

    // --- MASUKKAN DATA SANDBOX ANDA DI SINI ---
    const merchantCode = 'DS27606'; // Ganti dengan Merchant Code (huruf D)
    const apiKey = '5c32a1f212281470dd2613ed52b5a370'; // Ganti dengan API Key panjang
    // ------------------------------------------

    const merchantOrderId = 'DH-' + Date.now();
    
    // Pembuatan Signature MD5
    const stringToHash = merchantCode + merchantOrderId + price + apiKey;
    const signature = crypto.createHash('md5').update(stringToHash).digest('hex');

    const payload = {
        merchantCode,
        paymentAmount: parseInt(price),
        merchantOrderId,
        productDetails: `Topup ${game} - ${product} (${userid})`,
        email: 'customer@gmail.com',
        signature,
        // Sesuaikan dengan URL Vercel Anda
        callbackUrl: `https://${req.headers.host}/api/callback`,
        returnUrl: `https://${req.headers.host}/`,
        expiryPeriod: 60
    };

    try {
        const response = await fetch('https://passport-sandbox.duitku.com/webapi/api/merchant/v2/inquiry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ statusMessage: "Gagal koneksi ke Duitku" });
    }
}
