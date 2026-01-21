const crypto = require('crypto');
const axios = require('axios');

export default async function handler(req, res) {
    // 1. Hanya izinkan metode POST
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { userid, game, product, price } = req.body;

        // 2. Kredensial Sandbox (Pastikan sesuai dengan Dashboard Sandbox Anda)
        const merchantCode = 'DS27606'; // Ganti dengan Merchant Code (huruf D)
        const apiKey = '5c32a1f212281470dd2613ed52b5a370'; // Ganti dengan API Key panjang
        const merchantOrderId = 'DH-' + Date.now();
        
        // 3. Buat Signature MD5
        const stringToHash = merchantCode + merchantOrderId + price + apiKey;
        const signature = crypto.createHash('md5').update(stringToHash).digest('hex');

        // 4. Siapkan Data untuk Duitku
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

        // 5. Panggil API Duitku menggunakan Axios
        const response = await axios.post('https://passport-sandbox.duitku.com/webapi/api/merchant/v2/inquiry', payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000 // Tunggu maksimal 15 detik
        });

        // 6. Kirim respon sukses ke Frontend
        return res.status(200).json(response.data);

    } catch (error) {
        // Log ini akan muncul di Dashboard Vercel jika terjadi error lagi
        console.error("DEBUG ERROR:", error.response ? error.response.data : error.message);
        
        return res.status(500).json({ 
            statusMessage: "Koneksi ke Duitku Bermasalah", 
            error: error.message 
        });
    }
}
