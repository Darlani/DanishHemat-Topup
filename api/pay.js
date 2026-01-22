const https = require('https');

async function readBody(req) {
    const buffers = [];
    for await (const chunk of req) { buffers.push(chunk); }
    const data = Buffer.concat(buffers).toString();
    try { return JSON.parse(data); } catch (e) { return {}; }
}

module.exports = async (req, res) => {
    // Header CORS agar tidak diblokir browser
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const body = await readBody(req);
        const { userid, game, product, price } = body;

        // --- KONFIGURASI MIDTRANS ---
        // Ganti teks di bawah ini dengan Server Key Sandbox Anda
        const serverKey = 'Mid-server-595S3Ppw3df5Oe1nY2i2kOdx'; 
        const authBase64 = Buffer.from(serverKey + ':').toString('base64');
        
        const payload = JSON.stringify({
            transaction_details: {
                order_id: 'ORDER-' + Date.now(), // ID Unik transaksi
                gross_amount: parseInt(price)    // Total nominal (Integer)
            },
            custom_field1: userid,
            custom_field2: `${game} - ${product}`,
            item_details: [{
                id: product.substring(0, 50),
                price: parseInt(price),
                quantity: 1,
                name: `${game.substring(0, 15)} ${product.substring(0, 30)}`.trim().substring(0, 50)
            }],
            customer_details: {
                first_name: userid,
                email: "customer@gmail.com"
            }
        });

        const options = {
            hostname: 'app.sandbox.midtrans.com',
            path: '/snap/v1/transactions',
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Basic ${authBase64}`,
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const request = https.request(options, (response) => {
            let resData = '';
            response.on('data', (chunk) => resData += chunk);
            response.on('end', () => {
                try {
                    res.status(200).json(JSON.parse(resData));
                } catch (e) {
                    res.status(500).json({ error: "Respon Midtrans bukan JSON", details: resData });
                }
            });
        });

        request.on('error', (e) => res.status(500).json({ error: e.message }));
        request.write(payload);
        request.end();

    } catch (error) {
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
};
