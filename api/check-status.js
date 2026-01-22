const https = require('https');

module.exports = async (req, res) => {
    try {
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

        // Menggunakan Promise agar async/await berjalan lancar
        const getStatus = () => {
            return new Promise((resolve, reject) => {
                const request = https.request(options, (response) => {
                    let resData = '';
                    response.on('data', (chunk) => resData += chunk);
                    response.on('end', () => resolve(resData));
                });
                request.on('error', (e) => reject(e));
                request.end();
            });
        };

        const result = await getStatus();
        const jsonRes = JSON.parse(result);
        
        // Kirim hasil ke browser
        res.status(200).json(jsonRes);

    } catch (error) {
        // Jika ada error, kirim pesan error agar tidak crash 500
        res.status(500).json({ error: error.message });
    }
};
