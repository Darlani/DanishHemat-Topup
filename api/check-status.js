const https = require('https');

module.exports = async (req, res) => {
    const { orderid } = req.query;

    if (!orderid) {
        return res.status(400).json({ error: "Order ID diperlukan" });
    }

    const serverKey = 'Mid-server-595S3Ppw3df5Oe1nY2i2kOdx';
    const authBase64 = Buffer.from(serverKey + ':').toString('base64');

    // Membungkus permintaan HTTPS ke dalam Promise agar Vercel tidak menutup koneksi terlalu cepat
    const checkMidtrans = () => {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'app.sandbox.midtrans.com',
                path: `/v2/${orderid}/status`,
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${authBase64}`,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            };

            const request = https.request(options, (response) => {
                let data = '';
                response.on('data', (chunk) => { data += chunk; });
                response.on('end', () => resolve(data));
            });

            request.on('error', (e) => reject(e));
            request.end();
        });
    };

    try {
        const rawData = await checkMidtrans();
        
        if (!rawData) {
            return res.status(500).json({ error: "Data dari Midtrans kosong (Empty Response)" });
        }

        const jsonRes = JSON.parse(rawData);
        res.status(200).json(jsonRes);

    } catch (error) {
        res.status(500).json({ error: "Gagal memproses status", details: error.message });
    }
};
