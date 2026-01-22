module.exports = async (req, res) => {
    const { orderid } = req.query;
    if (!orderid) return res.status(400).json({ error: "Order ID kosong" });

    // Server Key Anda yang sudah dikonfirmasi
    const serverKey = 'Mid-server-595S3Ppw3df5Oe1nY2i2kOdx';
    const authBase64 = Buffer.from(serverKey + ':').toString('base64');

    try {
        // Kita paksa cek ke Sandbox karena Key Anda adalah key Sandbox
        const response = await fetch(`https://app.sandbox.midtrans.com/v2/${orderid.trim()}/status`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${authBase64}`,
                'Accept': 'application/json'
            }
        });

        const data = await response.json();
        
        // DEBUG: Jika 404, kita tampilkan semua info dari Midtrans
        if (data.status_code === "404") {
            return res.status(200).json({
                error: "Midtrans menjawab: ID tidak ada",
                order_id_yang_dicari: orderid,
                server_response: data
            });
        }

        return res.status(200).json(data);

    } catch (error) {
        return res.status(500).json({ error: "Koneksi Gagal", details: error.message });
    }
};
