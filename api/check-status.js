module.exports = async (req, res) => {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { userid, game, product, price } = req.body; // Vercel otomatis parse body jika pakai method POST

        const serverKey = 'Mid-server-595S3Ppw3df5Oe1nY2i2kOdx'; 
        const authBase64 = Buffer.from(serverKey + ':').toString('base64');
        
        // Buat Order ID yang konsisten
        const orderId = 'DS-' + Math.floor(Date.now() / 1000); 

        const payload = {
            transaction_details: {
                order_id: orderId,
                gross_amount: parseInt(price)
            },
            custom_field1: userid,
            custom_field2: `${game} - ${product}`,
            item_details: [{
                id: product.substring(0, 50),
                price: parseInt(price),
                quantity: 1,
                name: `${game.substring(0, 15)} ${product.substring(0, 30)}`.trim()
            }],
            customer_details: {
                first_name: userid,
                email: "customer@gmail.com"
            }
        };

        const response = await fetch('https://app.sandbox.midtrans.com/snap/v1/transactions', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Basic ${authBase64}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        // Tambahkan order_id ke dalam respon agar client tahu ID-nya
        res.status(200).json({ ...data, order_id: orderId });

    } catch (error) {
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
};
