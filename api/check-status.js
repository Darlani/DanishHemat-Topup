module.exports = async (req, res) => {
    const { orderid } = req.query;

    if (!orderid) {
        return res.status(400).json({ error: "Order ID diperlukan" });
    }

    const serverKey = 'Mid-server-595S3Ppw3df5Oe1nY2i2kOdx';
    const authBase64 = Buffer.from(serverKey + ':').toString('base64');

    try {
        const response = await fetch(`https://app.sandbox.midtrans.com/v2/${orderid}/status`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${authBase64}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        
        // Kirim hasil ke browser
        return res.status(200).json(data);

    } catch (error) {
        return res.status(500).json({ 
            error: "Gagal menghubungi Midtrans", 
            details: error.message 
        });
    }
};
