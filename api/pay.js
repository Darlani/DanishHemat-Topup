const crypto = require('crypto');

export default async function handler(req, res) {
    // Memastikan hanya metode POST yang diizinkan
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { userid, game, product, price } = req.body;

        // Validasi data input
        if (!price || isNaN(price)) {
            return res.status(400).json({ statusMessage: "Harga tidak valid" });
        }

        const merchantCode = 'DS27606'; // GANTI DENGAN KODE D ANDA
        const apiKey = '5c32a1f212281470dd2613ed52b5a370'; // GANTI DENGAN API KEY ANDA
        const merchantOrderId = 'DH-' + Date.now();
        
        // Buat Signature MD5 (Penting: price harus string/number murni tanpa titik)
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

        // Menggunakan fetch bawaan Vercel Runtime
        const response = await fetch('https://passport-sandbox.duitku.com/webapi/api/merchant/v2/inquiry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        // Kirim hasil kembali ke frontend
        return res.status(200).json(data);

    } catch (error) {
        console.error("Error Detail:", error);
        return res.status(500).json({ 
            statusMessage: "Internal Server Error", 
            error: error.message 
        });
    }
}
