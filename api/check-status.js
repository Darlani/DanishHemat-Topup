module.exports = async (req, res) => {
    const { orderid } = req.query;

    if (!orderid) {
        return res.status(400).json({ error: "Order ID diperlukan" });
    }

    // PASTIKAN: Tidak ada spasi di awal/akhir kunci ini
    const serverKey = 'Mid-server-595S3Ppw3df5Oe1nY2i2kOdx';
    const authBase64 = Buffer.from(serverKey + ':').toString('base64');

    try {
        const response = await fetch(`https://app.sandbox.midtrans.com/v2/${orderid}/status`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${authBase64}`,
                'Accept': 'application/json'
            }
        });

        // Cek jika response kosong atau error 401 (Unauthorized)
        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).json({ 
                error: "Midtrans menolak permintaan", 
                status: response.status,
                details: errorText 
            });
        }

        const data = await response.json();
        return res.status(200).json(data);

    } catch (error) {
        return res.status(500).json({ 
            error: "Masalah pada Server/Koneksi", 
            details: error.message 
        });
    }
};
