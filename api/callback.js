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
        
        // Perhatian: Pastikan Server Key ini sesuai dengan Environment (Sandbox/Production)
        const serverKey = 'Mid-server-595S3Ppw3df5Oe1nY2i2kOdx'; 
        const orderId = notification.order_id;
        const statusCode = notification.status_code;
        const grossAmount = notification.gross_amount;
        const transactionStatus = notification.transaction_status;

        // 1. Validasi Signature
        const signatureString = orderId + statusCode + grossAmount + serverKey;
        const localSignature = crypto.createHash('sha512').update(signatureString).digest('hex');

        if (localSignature !== notification.signature_key) {
            return res.status(401).json({ message: 'Invalid Signature' });
        }

        // 2. Logika Notifikasi Telegram saat Lunas
        if (transactionStatus === 'settlement' || transactionStatus === 'capture') {
            const botToken = '8469153308:AAHLKFcEmXjOpknq7yIQLt2NqrEhpzh8J1w';
            const chatId = '5225711089';
            
            // Perbaikan: Variabel diambil sekali saja agar tidak error
            const user_id_game = notification.custom_field1 || "Tidak Ada ID";
            const order_id_fix = notification.order_id || "Tanpa ID";
            const nominal = notification.gross_amount || "0";

            const pesan = `✅ *PEMBAYARAN LUNAS*\n\n` +
                          `🆔 *Order ID:* ${order_id_fix}\n` +
                          `👤 *User ID Game:* ${user_id_game}\n` +
                          `💰 *Total:* Rp${parseInt(nominal).toLocaleString('id-ID')}\n` +
                          `📱 *Status:* ${transactionStatus.toUpperCase()}`;

            // Menggunakan fetch bawaan Node.js (Vercel mendukung ini)
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: pesan,
                    parse_mode: 'Markdown'
                })
            });
        }

        res.status(200).json({ status: 'OK' });

    } catch (error) {
        // Jika ada error, vercel logs akan mencatat ini
        res.status(500).json({ error: error.message });
    }
};
