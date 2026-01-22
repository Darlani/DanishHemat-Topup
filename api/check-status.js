const https = require('https');

module.exports = async (req, res) => {
    // Ambil orderid dari URL: /api/check-status?orderid=XXX
    const { orderid } = req.query;

    if (!orderid) {
        return res.status(400).json({ error: "Order ID diperlukan" });
    }

    const serverKey = 'Mid-server-595S3Ppw3df5Oe1nY2i2kOdx';
    const authBase64 = Buffer.from(serverKey + ':').toString('base64');

    const options = {
        hostname: 'app.sandbox.midtrans.com', // Gunakan 'api.midtrans.com' jika sudah produksi
        path: `/v2/${orderid}/status`,
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Basic ${authBase64}`
        }
    };

    const request = https.request(options, (response) => {
        let resData = '';
        response.on('data', (chunk) => resData += chunk);
        response.on('end', () => {
            try {
                res.status(200).json(JSON.parse(resData));
            } catch (e) {
                res.status(500).json({ error: "Gagal memproses data Midtrans" });
            }
        });
    });

    request.on('error', (e) => res.status(500).json({ error: e.message }));
    request.end();
};
