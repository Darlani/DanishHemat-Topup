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
        
        const serverKey = 'Mid-server-595S3Ppw3df5Oe1nY2i2kOdx'; // GANTI DENGAN SERVER KEY ANDA
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
            const botToken = '8469153308:AAHLKFcEmXjOpknq7yIQLt2NqrEhpzh8J1w'; // GANTI DENGAN TOKEN DARI BOTFATHER
            const chatId = '5225711089';     // GANTI DENGAN ANGKA DARI USERINFOBOT
            
            const pesan = `✅ *PEMBAYARAN LUNAS*\n\n` +
                          `🆔 *Order ID:* ${orderId}\n` +
                          `👤 *User ID:* ${notification.customer_details.first_name}\n` +
                          `💰 *Total:* Rp${parseInt(grossAmount).toLocaleString('id-ID')}\n` +
                          `📱 *Status:* ${transactionStatus.toUpperCase()}`;

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
        res.status(500).json({ error: error.message });
    }
};
