module.exports = async (req, res) => {
    const { orderid } = req.query;
    const serverKey = 'Mid-server-595S3Ppw3df5Oe1nY2i2kOdx'; // Server Key Anda
    const auth = Buffer.from(serverKey + ':').toString('base64');

    try {
        const response = await fetch(`https://app.sandbox.midtrans.com/v2/${orderid}/status`, {
            headers: { 'Authorization': `Basic ${auth}` }
        });
        const data = await response.json();
        res.status(200).json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
