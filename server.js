const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Allow your app to make requests to this backend
app.use(cors());
app.use(express.json());

// Paystack Secret Key from environment variables
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// Simple health check for Render
app.get('/', (req, res) => {
    res.send('Lenidi backend is running');
});

// The endpoint your app calls to verify a payment
app.get('/api/verify', async (req, res) => {
    const { reference } = req.query;

    if (!reference) {
        return res.status(400).json({ ok: false, error: 'No reference provided' });
    }

    try {
        const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET}`,
                'Content-Type': 'application/json',
            },
        });

        const data = await response.json();

        // Check if Paystack says the payment was successful
        if (data.status && data.data && data.data.status === 'success') {
            const amountPaid = data.data.amount / 100; // Paystack uses kobo/pesewas
            
            // Log it so you can see successful payments in Render's dashboard
            console.log(`✅ Payment verified for ${reference}: GHC ${amountPaid}`);

            // Send success back to your app
            return res.json({
                ok: true,
                reference: reference,
                amount: amountPaid,
                currency: data.data.currency,
            });
        } else {
            return res.status(400).json({ ok: false, error: 'Payment not successful' });
        }
    } catch (error) {
        console.error('Verification error:', error);
        return res.status(500).json({ ok: false, error: 'Verification failed' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
