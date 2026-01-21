import crypto from 'crypto';
import axios from 'axios';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { userid, game, product, price } = req.body;

        // AMBIL DARI GAMBAR DASHBOARD ANDA
        const merchantCode = 'DS27606'; // Ganti dengan Merchant Code Anda
        const apiKey = '5c32a1f212281470dd2613ed52b5a370'; // Ganti dengan API Key Anda
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

        const response = await axios.post('https://passport-sandbox.duitku.com/webapi/api/merchant/v2/inquiry', payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        return res.status(200).json(response.data);

    } catch (error) {
        // Ini akan membantu kita melihat error asli di Tab Network browser
        return res.status(500).json({ 
            statusMessage: "Error", 
            error: error.response ? error.response.data : error.message 
        });
    }
}
