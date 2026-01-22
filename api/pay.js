const https = require('https');

async function readBody(req) {
    const buffers = [];
    for await (const chunk of req) { buffers.push(chunk); }
    const data = Buffer.concat(buffers).toString();
    try { return JSON.parse(data); } catch (e) { return {}; }
}
module.exports = async (req, res) => {
    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // 2. Cara Aman Membaca Body di Vercel
        let body = {};
        if (typeof req.body === 'string') {
            body = JSON.parse(req.body);
        } else if (req.body) {
            body = req.body;
        } else {
            // Jika req.body benar-benar kosong, kita baca manual
            const buffers = [];
            for await (const chunk of req) { buffers.push(chunk); }
            const rawData = Buffer.concat(buffers).toString();
            body = JSON.parse(rawData || '{}');
        }

        const { userid, game, product, price } = body;

        // Validasi input
        if (!userid || !price) {
            return res.status(400).json({ error: "Data tidak lengkap" });
        }

        const serverKey = 'Mid-server-595S3Ppw3df5Oe1nY2i2kOdx'; 
        const authBase64 = Buffer.from(serverKey + ':').toString('base64');
        
        // Buat Order ID unik
        const orderId = 'DS-' + Math.floor(Date.now() / 1000); 

        const payload = {
            transaction_details: {
                order_id: orderId,
                gross_amount: parseInt(price)
            },
            custom_field1: userid,
            custom_field2: `${game} - ${product}`,
            item_details: [{
                id: String(product).substring(0, 50),
                price: parseInt(price),
                quantity: 1,
                name: `${game} ${product}`.substring(0, 50).trim()
            }],
            customer_details: {
                first_name: userid,
                email: "customer@gmail.com"
            }
        };

        const response = await fetch('https://app.sandbox.midtrans.com/snap/v1/transactions', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Basic ${authBase64}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        // Kirim respon balik ke frontend
        return res.status(200).json({ ...data, order_id: orderId });

    } catch (error) {
        console.error("Pay Error:", error);
        return res.status(500).json({ 
            error: "Internal Server Error", 
            details: error.message 
        });
    }
};
