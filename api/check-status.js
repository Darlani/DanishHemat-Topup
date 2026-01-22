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
            'Authorization': `Basic ${authBase64}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        timeout: 10000 // Beri waktu tunggu 10 detik
    };

    const request = https.get(options, (response) => {
        let resData = '';
        
        response.on('data', (chunk) => {
            resData += chunk;
        });

        response.on('end', () => {
            if (!resData) {
                return res.status(500).json({ error: "Midtrans mengirim data kosong" });
            }

            try {
                const jsonRes = JSON.parse(resData);
                res.status(200).json(jsonRes);
            } catch (e) {
                res.status(500).json({ 
                    error: "Format data salah", 
                    raw: resData 
                });
            }
        });
    });

    request.on('error', (e) => {
        res.status(500).json({ error: "Koneksi ke Midtrans gagal: " + e.message });
    });

    request.on('timeout', () => {
        request.destroy();
        res.status(504).json({ error: "Midtrans terlalu lama menjawab (Timeout)" });
    });
};
