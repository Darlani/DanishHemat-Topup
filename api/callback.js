const crypto = require('crypto');

async function readBody(req) {
    const buffers = [];
    for await (const chunk of req) { buffers.push(chunk); }
    const data = Buffer.concat(buffers).toString();
    try { return JSON.parse(data); } catch (e) { return {}; }
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

    try {
        const notification = await readBody(req);
        
        // --- KONFIGURASI ---
        const serverKey = 'MASUKKAN_SERVER_KEY_SANDBOX_ANDA'; 
        const orderId = notification.order_id;
        const statusCode = notification.status_code;
        const grossAmount = notification.gross_amount;
        const transactionStatus = notification.transaction_status;
        const fraudStatus = notification.fraud_status;

        // 1. Validasi Signature (Keamanan agar tidak bisa dipalsukan orang lain)
        const signatureString = orderId + statusCode + grossAmount + serverKey;
        const localSignature = crypto.createHash('sha512').update(signatureString).digest('hex');

        if (localSignature !== notification.signature_key) {
            return res.status(401).json({ message: 'Invalid Signature' });
        }

        // 2. Logika Pemrosesan Status Pembayaran
        console.log(`Transaksi ${orderId}: Status ${transactionStatus}`);

        if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
            if (fraudStatus === 'challenge') {
                // Pembayaran dicurigai fraud, perlu dicek manual
                console.log("Status: Challenge");
            } else if (fraudStatus === 'accept') {
                // PEMBAYARAN BERHASIL (Lunas)
                console.log("Status: Berhasil / Lunas");
                // DI SINI: Tempat Anda menaruh logika kirim Diamond otomatis
            }
        } else if (transactionStatus === 'cancel' || transactionStatus === 'deny' || transactionStatus === 'expire') {
            // Pembayaran gagal atau kadaluarsa
            console.log("Status: Gagal");
        } else if (transactionStatus === 'pending') {
            // Menunggu pembayaran
            console.log("Status: Pending");
        }

        res.status(200).json({ status: 'OK' });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
