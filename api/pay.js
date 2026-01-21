const crypto = require('crypto');
const axios = require('axios');

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { userid, game, product, price } = req.body;

        // --- VALIDASI DATA ---
        if (!userid || !price) {
            return res.status(400).json({ statusMessage: "Data tidak lengkap" });
        }

        // --- MASUKKAN DATA SANDBOX ---
        const merchantCode = 'DS27606'; // GANTI DENGAN KODE D ANDA
        const apiKey = '5c32a1f212281470dd2613ed52b5a370'; // GANTI DENGAN API KEY ANDA
        const merchantOrderId = 'DH-' + Date.now();
        
        // --- BUAT SIGNATURE ---
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

        // --- CALL DUITKU ---
        const response = await axios.post('https://passport-sandbox.duitku.com/webapi/api/merchant/v2/inquiry', payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        // Kirim hasil dari Duitku ke Frontend
        return res.status(200).json(response.data);

    } catch (error) {
        // Jika Duitku memberikan error (misal: signature salah)
        if (error.response) {
            return res.status(200).json(error.response.data);
        }
        // Jika error koneksi server
        return res.status(500).json({ statusMessage: "Server Error: " + error.message });
    }
}
