const https = require('https');

module.exports = async (req, res) => {
    const { orderid } = req.query;

    if (!orderid) {
        return res.status(400).json({ error: "Order ID diperlukan" });
    }

    const serverKey = 'Mid-server-595S3Ppw3df5Oe1nY2i2kOdx';
    const authBase64 = Buffer.from(serverKey + ':').toString('base64');

    const options = {
        hostname: 'app.sandbox.midtrans.com',
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
                const jsonRes = JSON.parse(resData);
                // Jika Midtrans kasih status_code 404, kita kirim apa adanya agar tahu pesannya
                res.status(200).json(jsonRes);
            } catch (e) {
                // Jika bukan JSON, tampilkan teks aslinya untuk debug
                res.status(500).json({ error: "Respon bukan JSON", raw: resData });
            }
        });
    });

    request.on('error', (e) => res.status(500).json({ error: e.message }));
    request.end();
};
