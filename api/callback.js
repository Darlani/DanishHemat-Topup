const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const body = typeof req.body === 'string'
      ? JSON.parse(req.body)
      : req.body;

    const {
      merchantCode,
      amount,
      merchantOrderId,
      reference,
      signature,
      resultCode
    } = body;

    // 🔐 Validasi signature dari Duitku
    const apiKey = process.env.DUITKU_API_KEY;
    const expectedSignature = crypto
      .createHash('md5')
      .update(merchantCode + amount + merchantOrderId + apiKey)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(400).json({ message: 'Invalid signature' });
    }

    // ✅ Status transaksi
    const status =
      resultCode === '00' ? 'PAID' :
      resultCode === '01' ? 'PENDING' :
      'FAILED';

    // 🧾 Update database (lihat bagian 2)
    await updateTransactionStatus({
      merchantOrderId,
      reference,
      status,
      rawCallback: body
    });

    // ⚠️ Duitku WAJIB menerima 200 OK
    return res.status(200).json({ message: 'Callback received' });

  } catch (err) {
    return res.status(500).json({
      error: 'Callback error',
      details: err.message
    });
  }
};

/* ====== DB Helper ====== */
async function updateTransactionStatus(data) {
  const db = require('../lib/db');
  await db.execute(
    `UPDATE transactions 
     SET status=?, reference=?, callback_payload=?, updated_at=NOW()
     WHERE merchant_order_id=?`,
    [
      data.status,
      data.reference,
      JSON.stringify(data.rawCallback),
      data.merchantOrderId
    ]
  );
}
