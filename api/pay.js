// api/pay.js
const crypto = require('crypto');

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({message: 'Method not allowed'});

    const { userid, game, product, price } = req.body;

    // Pastikan variabel ini ada di Dashboard Duitku (Mode Produksi)
    const merchantCode = 'MXXXXX'; 
    const apiKey = 'YOUR_API_KEY';
    const merchantOrderId = 'DH-' + Date.now();

    // Pastikan price adalah integer
    const amount = parseInt(price);

    const signature = crypto.createHash('md5')
        .update(merchantCode + merchantOrderId + amount + apiKey)
        .digest('hex');

    const payload = {
        merchantCode,
        paymentAmount: amount,
        merchantOrderId,
        productDetails: `${game} - ${product}`,
        email: 'customer@gmail.com',
        signature,
        callbackUrl: 'https://domain-anda.vercel.app/api/callback',
        returnUrl: 'https://domain-anda.vercel.app/',
        expiryPeriod: 60
    };

    try {
        const response = await fetch('https://passport.duitku.com/webapi/api/merchant/v2/inquiry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        res.status(200).json(result);
    } catch (err) {
        res.status(500).json({ statusMessage: "Server Error" });
    }
}
