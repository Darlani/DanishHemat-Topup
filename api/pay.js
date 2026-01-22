const crypto = require('crypto');
const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    // 🔹 Pastikan body ter-parse
    const body = typeof req.body === 'string'
      ? JSON.parse(req.body)
      : req.body;

    const { userid, game, product, price } = body;

    if (!userid || !game || !product || !price) {
      return res.status(400).json({ message: 'Data tidak lengkap' });
    }

    const merchantCode = process.env.DS27606;
    const apiKey = process.env.5c32a1f212281470dd2613ed52b5a370;
    const merchantOrderId = 'DH-' + Date.now();

    const signature = crypto
      .createHash('md5')
      .update(merchantCode + merchantOrderId + price + apiKey)
      .digest('hex');

    const payload = JSON.stringify({
      merchantCode,
      paymentAmount: parseInt(price),
      merchantOrderId,
      productDetails: `Topup ${game} - ${product} (${userid})`,
      email: 'customer@gmail.com',
      signature,
      callbackUrl: `https://${req.headers.host}/api/callback`,
      returnUrl: `https://${req.headers.host}/`,
      expiryPeriod: 60
    });

    const options = {
      hostname: 'passport-sandbox.duitku.com',
      path: '/webapi/api/merchant/v2/inquiry',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const duitkuReq = https.request(options, duitkuRes => {
      let data = '';

      duitkuRes.on('data', chunk => data += chunk);
      duitkuRes.on('end', () => {
        try {
          res.status(200).json(JSON.parse(data));
        } catch {
          res.status(500).json({
            error: 'Respon Duitku bukan JSON',
            raw: data
          });
        }
      });
    });

    duitkuReq.on('error', err => {
      res.status(500).json({
        error: 'Gagal menghubungi Duitku',
        details: err.message
      });
    });

    duitkuReq.write(payload);
    duitkuReq.end();

  } catch (err) {
    res.status(500).json({
      error: 'Internal Server Error',
      details: err.message
    });
  }
};
