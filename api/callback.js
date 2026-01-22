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
        
        const serverKey = 'Mid-server-595S3Ppw3df5Oe1nY2i2kOdx'; 
        const orderId = notification.order_id;
        const statusCode = notification.status_code;
        const grossAmount = notification.gross_amount;
        const transactionStatus = notification.transaction_status;

        const signatureString = orderId + statusCode + grossAmount + serverKey;
        const localSignature = crypto.createHash('sha512').update(signatureString).digest('hex');

        if (localSignature !== notification.signature_key) {
            return res.status(401).json({ message: 'Invalid Signature' });
        }

        if (transactionStatus === 'settlement' || transactionStatus === 'capture') {
    const botToken = '8469153308:AAHLKFcEmXjOpknq7yIQLt2NqrEhpzh8J1w';
    const chatId = '5225711089';
    
    // AMBIL DARI CUSTOM FIELDS
    const user_id_game = notification.custom_field1 || "Tidak Ada ID";
    const nama_produk = notification.custom_field2 || "Produk Tidak Diketahui";
    const order_id_fix = notification.order_id || "Tanpa ID";
    const nominal = notification.gross_amount || "0";

    const sekarang = new Date();
    const opsiWaktu = { 
        timeZone: 'Asia/Jakarta', 
        day: '2-digit', 
        month: 'long', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    };
    const waktuWIB = sekarang.toLocaleString('id-ID', opsiWaktu);

    const pesan = `✅ *PEMBAYARAN LUNAS*\n` +
                  `📅 ${waktuWIB} WIB\n\n` +
                  `🎮 *Game/Produk:* ${nama_produk}\n` +
                  `👤 *User ID Game:* ${user_id_game}\n` +
                  `💰 *Total:* Rp${parseInt(nominal).toLocaleString('id-ID')}\n` +
                  `🆔 *Order ID:* ${order_id_fix}\n` +
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
