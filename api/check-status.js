module.exports = async (req, res) => {
    const { orderid } = req.query;
    if (!orderid) return res.status(400).json({ error: "Order ID diperlukan" });

    const serverKey = 'Mid-server-595S3Ppw3df5Oe1nY2i2kOdx';
    const authBase64 = Buffer.from(serverKey + ':').toString('base64');

    // Kita coba panggil Sandbox dulu, jika 404 kita coba Production
    const endpoints = [
        `https://app.sandbox.midtrans.com/v2/${orderid}/status`,
        `https://app.midtrans.com/v2/${orderid}/status`
    ];

    try {
        let finalData = null;

        for (let url of endpoints) {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${authBase64}`,
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                finalData = await response.json();
                break; // Jika ketemu, berhenti mencari
            }
        }

        if (finalData) {
            return res.status(200).json(finalData);
        } else {
            return res.status(404).json({ 
                error: "Order ID benar-benar tidak ditemukan di Sandbox maupun Production",
                checked_id: orderid 
            });
        }

    } catch (error) {
        return res.status(500).json({ error: "Server Error", details: error.message });
    }
};
