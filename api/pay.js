const crypto = require('crypto');

export default async function handler(req, res) {
    // 1. Ambil data dari Frontend
    const { userid, game, product, price } = req.body;

    // 2. Kredensial Duitku (Ganti dengan milik Anda)
    const merchantCode = 'DXXXX'; // Merchant Code Sandbox Anda
    const apiKey = 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'; // API Key Sandbox Anda
    const merchantOrderId = 'DH-' + Date.now();

    // 3. Buat Signature sesuai aturan Duitku
    const signature = crypto.createHash('md5')
        .update(merchantCode + merchantOrderId + price + apiKey)
        .digest('hex');

    const payload = {
        merchantCode,
        paymentAmount: parseInt(price),
        merchantOrderId,
        productDetails: `Topup ${game} - ${product} (ID: ${userid})`,
        email: 'customer@gmail.com', // Bisa disesuaikan
        signature,
        callbackUrl: 'https://domain-anda.vercel.app/api/callback', // Nanti kita buat
        returnUrl: 'https://domain-anda.vercel.app/',
        expiryPeriod: 60
    };

    try {
        const response = await fetch('https://passport-sandbox.duitku.com/webapi/api/merchant/v2/inquiry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        // Kirim balik data (termasuk reference) ke Frontend
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ error: 'Gagal menghubungi Duitku' });
    }
}
