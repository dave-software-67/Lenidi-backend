const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC = process.env.PAYSTACK_PUBLIC_KEY;

app.use(cors());
app.use(express.json());

const DATA_FILE = path.join('/tmp', 'payments.json');
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { return {}; }
}
function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch (e) {}
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'Lenidi Backend' });
});

app.get('/public-key', (req, res) => {
  res.json({ publicKey: PAYSTACK_PUBLIC });
});

app.post('/create-payment', async (req, res) => {
  try {
    const { email, plan, amount, type } = req.body;
    if (!email || !amount) return res.status(400).json({ error: 'Email and amount required' });
    const reference = 'LENIDI_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const data = loadData();
    data[reference] = {
      email: email.toLowerCase(),
      plan: plan || null,
      amount: amount,
      type: type || 'boost',
      status: 'pending',
      createdAt: Date.now()
    };
    saveData(data);
    res.json({ reference, publicKey: PAYSTACK_PUBLIC, email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/webhook/paystack', (req, res) => {
  try {
    const event = req.body;
    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      const data = loadData();
      if (data[reference]) {
        data[reference].status = 'paid';
        data[reference].paidAt = Date.now();
        data[reference].amountPaid = event.data.amount / 100;
        saveData(data);
      }
    }
    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(200);
  }
});

app.get('/check-payment/:reference', (req, res) => {
  try {
    const ref = req.params.reference;
    const data = loadData();
    const payment = data[ref];
    if (!payment) return res.json({ status: 'not_found' });
    res.json({
      status: payment.status,
      plan: payment.plan,
      amount: payment.amount,
      type: payment.type,
      email: payment.email
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/verify/:reference', async (req, res) => {
  try {
    const ref = req.params.reference;
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${ref}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );
    if (response.data.data.status === 'success') {
      const data = loadData();
      if (data[ref]) {
        data[ref].status = 'paid';
        data[ref].paidAt = Date.now();
        saveData(data);
      }
      return res.json({ status: 'paid', data: response.data.data });
    }
    res.json({ status: response.data.data.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/all-payments', (req, res) => {
  res.json(loadData());
});

app.listen(PORT, () => {
  console.log('🚀 Lenidi backend running on port ' + PORT);
});
