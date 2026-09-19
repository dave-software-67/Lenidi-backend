const express = require('express');
const cors = require('cors');
const axios = require('axiosACK');
const { createClient } = require('@supabase/supabase-js');

const_P app = express();
const PORT = process.env.PORT || 3000;

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
constUB PAYSTACK_PUBLIC = process.env.PAYSTACK_PUBLIC_KEY;
const SUPABASE_URL = process.env.SUPABASE_URLLIC;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!PAYSTACK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing environment variables!');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Simple in-memory payments tracking
const payments = {};

// ==================== HEALTH ====================
app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'Lenidi Backend', supabase: !!SUPABASE_URL });
});

app.get('/public-key', (req, res) => {
  res.json({ publicKey: PAYSTACK_PUBLIC });
});

// ==================== PAYMENTS ====================
app.post('/create-payment', async (req, res) => {
  try {
    const { email, plan, amount, type } = req.body;
    if (!email || !amount) return res.status(400).json({ error: 'Email and amount required' });
    const reference = 'LENIDI_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    payments[reference] = {
      email: email.toLowerCase(),
      plan: plan || null,
      amount: amount,
      type: type || 'boost',
      status: 'pending',
      createdAt: Date.now()
    };
    res.json({ reference, publicKey: PAYST, email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/webhook/paystack', (req, res) => {
  try {
    const event = req.body;
    console.log('📩 Webhook:', event.event);
    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      if (payments[reference]) {
        payments[reference].status = 'paid';
        payments[reference].paidAt = Date.now();
        payments[reference].amountPaid = event.data.amount / 100;
        console.log('✅ Payment confirmed:', reference);
      }
    }
    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(200);
  }
});

app.get('/check-payment/:reference', (req, res) => {
  const ref = req.params.reference;
  const payment = payments[ref];
  if (!payment) return res.json({ status: 'not_found' });
  res.json({
    status: payment.status,
    plan: payment.plan,
    amount: payment.amount,
    type: payment.type,
    email: payment.email
  });
});

app.get('/verify/:reference', async (req, res) => {
  try {
    const ref = req.params.reference;
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${ref}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
    );
    if (response.data.data.status === 'success') {
      if (payments[ref]) {
        payments[ref].status = 'paid';
        payments[ref].paidAt = Date.now();
      }
      return res.json({ status: 'paid', data: response.data.data });
    }
    res.json({ status: response.data.data.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/all-payments', (req, res) => {
  res.json(payments);
});

// ==================== PRODUCTS ====================
app.get('/products', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('is_vip', { ascending: false })
      .order('is_boosted', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/products/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
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
    const { data, error } = await supabase
      .from('products')
      .insert([{
        title: p.title,
        price: p.price,
        price_raw: p.price_raw || 0,
        category: p.category,
        location: p.location,
        description: p.description,
        seller_email: p.seller_email,
        seller_name: p.seller_name,
        seller_phone: p.seller_phone,
        whatsapp: p.whatsapp,
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
      }])
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/products/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== USERS ====================
app.post('/users', async (req, res) => {
  try {
    const u = req.body;
    if (!u.email || !u.name) return res.status(400).json({ error: 'email and name required' });
    const { data, error } = await supabase
      .from('users')
      .upsert([{
        email: u.email.toLowerCase(),
        name: u.name,
        phone: u.phone,
        pfp: u.pfp,
        boosts: u.boosts || 0,
        verify: u.verify || '',
        subscription: u.subscription,
        subscription_until: u.subscription_until,
        last_active: new Date().toISOString()
      }], { onConflict: 'email' })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/users/:email', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', req.params.email.toLowerCase())
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json(data || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/users/:email', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .update(req.body)
      .eq('email', req.params.email.toLowerCase())
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== REPORTS ====================
app.post('/reports', async (req, res) => {
  try {
    const r = req.body;
    const { data, error } = await supabase
      .from('reports')
      .insert([{
        product_id: r.product_id,
        reporter_email: r.reporter_email,
        reported_email: r.reported_email,
        reason: r.reason,
        details: r.details
      }])
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/reports', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== BLOCKS ====================
app.post('/blocks', async (req, res) => {
  try {
    const b = req.body;
    const { data, error } = await supabase
      .from('blocked_users')
      .insert([{
        blocker_email: b.blocker_email.toLowerCase(),
        blocked_email: b.blocked_email.toLowerCase()
      }])
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/blocks/:email', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('blocked_users')
      .select('*')
      .eq('blocker_email', req.params.email.toLowerCase());
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ADMIN CLEANUP ====================
// Delete free users inactive 30+ days
app.post('/admin/cleanup-inactive', async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('users')
      .delete()
      .lt('last_active', thirtyDaysAgo)
      .or('subscription.is.null,subscription_until.lt.' + new Date().toISOString())
      .select();
    if (error) throw error;
    res.json({ deleted: data?.length || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log('🚀 Lenidi backend running on port ' + PORT);
  console.log('🔗 Supabase:', SUPABASE_URL);
});
