const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC = process.env.PAYSTACK_PUBLIC_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!PAYSTACK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing environment variables!');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const payments = {};

app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'Lenidi Backend' });
});

app.get('/public-key', (req, res) => {
  res.json({ publicKey: PAYSTACK_PUBLIC });
});

// ============================================================
// PAYSTACK INITIALIZE - calls real API
// ============================================================
app.post('/create-payment', async (req, res) => {
  try {
    const email = req.body.email;
    const plan = req.body.plan;
    const amount = req.body.amount;
    const type = req.body.type;
    
    if (!email || !amount) {
      return res.status(400).json({ error: 'Email and amount required' });
    }

    const reference = 'LENIDI_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    
    // Save pending payment
    payments[reference] = {
      email: email.toLowerCase(),
      plan: plan || null,
      amount: amount,
      type: type || 'boost',
      status: 'pending',
      createdAt: Date.now()
    };

    // Call Paystack API to initialize transaction
    const paystackRes = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: email,
        amount: Math.round(amount * 100), // Pesewas
        currency: 'GHS',
        reference: reference,
        callback_url: 'https://lenidi-backend.onrender.com/payment-success'
      },
      {
        headers: {
          Authorization: 'Bearer ' + PAYSTACK_SECRET,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!paystackRes.data || !paystackRes.data.status) {
      console.error('Paystack error:', paystackRes.data);
      return res.status(500).json({ error: 'Paystack initialization failed' });
    }

    const authorizationUrl = paystackRes.data.data.authorization_url;
    const accessCode = paystackRes.data.data.access_code;

    res.json({
      reference: reference,
      publicKey: PAYSTACK_PUBLIC,
      email: email,
      authorization_url: authorizationUrl,
      access_code: accessCode
    });
  } catch (err) {
    console.error('Create-payment error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// ============================================================
// PAYMENT SUCCESS PAGE
// ============================================================
app.get('/payment-success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Payment Successful</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
        .card { background: #fff; border-radius: 20px; padding: 32px 24px; max-width: 380px; width: 100%; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
        .icon { width: 72px; height: 72px; border-radius: 50%; background: #dcfce7; color: #16a34a; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 36px; }
        h1 { font-size: 22px; color: #1e2a3a; margin-bottom: 8px; }
        p { font-size: 14px; color: #5e6f7e; line-height: 1.6; margin-bottom: 20px; }
        .brand { font-size: 24px; font-weight: 800; color: #ff6b00; margin-bottom: 16px; }
        .btn { display: inline-block; background: #ff6b00; color: #fff; padding: 12px 28px; border-radius: 60px; text-decoration: none; font-weight: 700; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="brand">Lenidi</div>
        <div class="icon">✓</div>
        <h1>Payment Successful!</h1>
        <p>Your payment has been received. Please return to the Lenidi app — your purchase will be confirmed automatically within a few seconds.</p>
        <p style="font-size:12px;color:#94a3b8;">You can close this browser window now.</p>
      </div>
    </body>
    </html>
  `);
});

// ============================================================
// PAYSTACK WEBHOOK
// ============================================================
app.post('/webhook/paystack', (req, res) => {
  try {
    const event = req.body;
    console.log('Webhook received:', event.event);
    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      if (payments[reference]) {
        payments[reference].status = 'paid';
        payments[reference].paidAt = Date.now();
      }
    }
    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(200);
  }
});

// ============================================================
// CHECK PAYMENT
// ============================================================
app.get('/check-payment/:reference', async (req, res) => {
  const ref = req.params.reference;
  try {
    // First check local cache
    const payment = payments[ref];
    if (payment && payment.status === 'paid') {
      return res.json({ status: 'paid', plan: payment.plan, amount: payment.amount, type: payment.type, email: payment.email });
    }
    // Otherwise verify directly with Paystack
    const verifyRes = await axios.get(
      'https://api.paystack.co/transaction/verify/' + ref,
      { headers: { Authorization: 'Bearer ' + PAYSTACK_SECRET } }
    );
    if (verifyRes.data && verifyRes.data.data && verifyRes.data.data.status === 'success') {
      if (payments[ref]) {
        payments[ref].status = 'paid';
      }
      return res.json({
        status: 'paid',
        plan: payment ? payment.plan : null,
        amount: payment ? payment.amount : verifyRes.data.data.amount / 100,
        type: payment ? payment.type : 'boost',
        email: payment ? payment.email : verifyRes.data.data.customer.email
      });
    }
    if (!payment) {
      return res.json({ status: 'not_found' });
    }
    res.json({ status: payment.status, plan: payment.plan, amount: payment.amount, type: payment.type, email: payment.email });
  } catch (err) {
    if (payments[ref]) {
      return res.json({ status: payments[ref].status, plan: payments[ref].plan, amount: payments[ref].amount, type: payments[ref].type, email: payments[ref].email });
    }
    res.json({ status: 'not_found' });
  }
});

app.get('/all-payments', (req, res) => {
  res.json(payments);
});

// ============================================================
// PRODUCTS
// ============================================================
app.get('/products', async (req, res) => {
  try {
    const result = await supabase.from('products').select('*').order('created_at', { ascending: false }).limit(200);
    if (result.error) throw result.error;
    res.json(result.data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/products', async (req, res) => {
  try {
    const p = req.body;
    if (!p.title || !p.price || !p.seller_email) {
      return res.status(400).json({ error: 'Title, price, and seller_email required' });
    }
    const insertData = {
      title: p.title, price: p.price, price_raw: p.price_raw || 0,
      category: p.category, location: p.location, description: p.description,
      seller_email: p.seller_email, seller_name: p.seller_name,
      seller_phone: p.seller_phone, whatsapp: p.whatsapp,
      brand: p.brand, model: p.model, condition: p.condition, color: p.color,
      storage: p.storage, ram: p.ram, network: p.network, card_slot: p.card_slot,
      rear_cam: p.rear_cam, front_cam: p.front_cam, screen_size: p.screen_size,
      display_type: p.display_type, chipset: p.chipset, sim: p.sim, os: p.os,
      battery: p.battery, year: p.year, mileage: p.mileage, transmission: p.transmission,
      fuel: p.fuel, bedrooms: p.bedrooms, bathrooms: p.bathrooms, size: p.size,
      processor: p.processor, material: p.material, company: p.company,
      job_type: p.job_type, salary: p.salary, service_type: p.service_type,
      experience: p.experience,
      photos: p.photos || [],
      badge: p.badge || 'NEW',
      is_boosted: p.is_boosted || false,
      is_vip: p.is_vip || false
    };
    const result = await supabase.from('products').insert([insertData]).select().single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/products/:id', async (req, res) => {
  try {
    const result = await supabase.from('products').delete().eq('id', req.params.id);
    if (result.error) throw result.error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// USERS
// ============================================================
app.post('/users', async (req, res) => {
  try {
    const u = req.body;
    if (!u.email || !u.name) return res.status(400).json({ error: 'email and name required' });
    const userData = {
      email: u.email.toLowerCase(), name: u.name, phone: u.phone, pfp: u.pfp,
      boosts: u.boosts || 0, verify: u.verify || '',
      subscription: u.subscription, subscription_until: u.subscription_until,
      last_active: new Date().toISOString()
    };
    const result = await supabase.from('users').upsert([userData], { onConflict: 'email' }).select().single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/users/:email', async (req, res) => {
  try {
    const result = await supabase.from('users').select('*').eq('email', req.params.email.toLowerCase()).single();
    if (result.error && result.error.code !== 'PGRST116') throw result.error;
    res.json(result.data || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// REPORTS
// ============================================================
app.post('/reports', async (req, res) => {
  try {
    const result = await supabase.from('reports').insert([req.body]).select().single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// BLOCKED
// ============================================================
app.post('/blocks', async (req, res) => {
  try {
    const result = await supabase.from('blocked_users').insert([req.body]).select().single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log('Lenidi backend running on port ' + PORT);
  console.log('Supabase:', SUPABASE_URL);
  console.log('Paystack mode:', PAYSTACK_SECRET && PAYSTACK_SECRET.startsWith('sk_live_') ? 'LIVE' : 'TEST');
});
