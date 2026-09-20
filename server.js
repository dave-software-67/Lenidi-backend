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

app.get('/', (req, res) => { res.json({ status: 'ok', app: 'Lenidi Backend', v: 3 }); });
app.get('/public-key', (req, res) => { res.json({ publicKey: PAYSTACK_PUBLIC }); });

// ============================================================
// PAYSTACK
// ============================================================
app.post('/create-payment', async (req, res) => {
  try {
    const { email, plan, amount, type } = req.body;
    if (!email || !amount) return res.status(400).json({ error: 'Email and amount required' });
    const reference = 'LENIDI_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    payments[reference] = { email: email.toLowerCase(), plan: plan || null, amount: amount, type: type || 'boost', status: 'pending', createdAt: Date.now() };
    const paystackRes = await axios.post('https://api.paystack.co/transaction/initialize',
      { email: email, amount: Math.round(amount * 100), currency: 'GHS', reference: reference, callback_url: 'https://lenidi-backend.onrender.com/payment-success' },
      { headers: { Authorization: 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' } });
    if (!paystackRes.data || !paystackRes.data.status) return res.status(500).json({ error: 'Paystack initialization failed' });
    res.json({ reference: reference, publicKey: PAYSTACK_PUBLIC, email: email, authorization_url: paystackRes.data.data.authorization_url, access_code: paystackRes.data.data.access_code });
  } catch (err) {
    console.error('Create-payment error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

app.get('/payment-success', (req, res) => {
  res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Payment Successful</title><style>body{font-family:sans-serif;background:#f5f7fa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px;}.card{background:#fff;border-radius:20px;padding:32px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.08);}.icon{width:72px;height:72px;border-radius:50%;background:#dcfce7;color:#16a34a;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:36px;}h1{font-size:22px;color:#1e2a3a;margin-bottom:8px;}p{font-size:14px;color:#5e6f7e;line-height:1.6;margin-bottom:20px;}.brand{font-size:24px;font-weight:800;color:#ff6b00;margin-bottom:16px;}</style></head><body><div class="card"><div class="brand">Lenidi</div><div class="icon">✓</div><h1>Payment Successful!</h1><p>Please return to the Lenidi app.</p></div></body></html>');
});

app.post('/webhook/paystack', (req, res) => {
  try {
    const event = req.body;
    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      if (payments[reference]) { payments[reference].status = 'paid'; payments[reference].paidAt = Date.now(); }
    }
    res.sendStatus(200);
  } catch (err) { res.sendStatus(200); }
});

app.get('/check-payment/:reference', async (req, res) => {
  const ref = req.params.reference;
  try {
    const payment = payments[ref];
    if (payment && payment.status === 'paid') return res.json({ status: 'paid', plan: payment.plan, amount: payment.amount, type: payment.type, email: payment.email });
    const verifyRes = await axios.get('https://api.paystack.co/transaction/verify/' + ref, { headers: { Authorization: 'Bearer ' + PAYSTACK_SECRET } });
    if (verifyRes.data && verifyRes.data.data && verifyRes.data.data.status === 'success') {
      if (payments[ref]) payments[ref].status = 'paid';
      return res.json({ status: 'paid', plan: payment ? payment.plan : null, amount: payment ? payment.amount : verifyRes.data.data.amount / 100, type: payment ? payment.type : 'boost', email: payment ? payment.email : verifyRes.data.data.customer.email });
    }
    if (!payment) return res.json({ status: 'not_found' });
    res.json({ status: payment.status, plan: payment.plan, amount: payment.amount, type: payment.type, email: payment.email });
  } catch (err) {
    if (payments[ref]) return res.json({ status: payments[ref].status, plan: payments[ref].plan, amount: payments[ref].amount, type: payments[ref].type, email: payments[ref].email });
    res.json({ status: 'not_found' });
  }
});

app.get('/all-payments', (req, res) => { res.json(payments); });

// ============================================================
// PRODUCTS
// ============================================================
app.get('/products', async (req, res) => {
  try {
    const result = await supabase.from('products').select('*').order('created_at', { ascending: false }).limit(200);
    if (result.error) throw result.error;
    res.json(result.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/products', async (req, res) => {
  try {
    const p = req.body;
    if (!p.title || !p.price || !p.seller_email) return res.status(400).json({ error: 'Title, price, and seller_email required' });
    const insertData = {
      title: p.title, price: p.price, price_raw: p.price_raw || 0,
      category: p.category, location: p.location, description: p.description,
      seller_email: p.seller_email, seller_name: p.seller_name, seller_phone: p.seller_phone, whatsapp: p.whatsapp,
      brand: p.brand, model: p.model, condition: p.condition, color: p.color,
      storage: p.storage, ram: p.ram, network: p.network,
      rear_cam: p.rear_cam, front_cam: p.front_cam, screen_size: p.screen_size,
      battery: p.battery, year: p.year, mileage: p.mileage, transmission: p.transmission,
      fuel: p.fuel, bedrooms: p.bedrooms, bathrooms: p.bathrooms, size: p.size,
      processor: p.processor, material: p.material, company: p.company,
      job_type: p.job_type, salary: p.salary, service_type: p.service_type,
      experience: p.experience, gender: p.gender,
      photos: p.photos || [], badge: p.badge || 'NEW',
      is_boosted: p.is_boosted || false, is_vip: p.is_vip || false,
      posted_at: p.posted_at || Date.now(), boosted_at: p.boosted_at || 0
    };
    const result = await supabase.from('products').insert([insertData]).select().single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/products/:id', async (req, res) => {
  try {
    const result = await supabase.from('products').delete().eq('id', req.params.id);
    if (result.error) throw result.error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/boost-product', async (req, res) => {
  try {
    const { id, is_boosted, boosted_at } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const result = await supabase.from('products').update({ is_boosted: is_boosted, boosted_at: boosted_at || Date.now() }).eq('id', id);
    if (result.error) throw result.error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// USERS
// ============================================================
app.post('/users', async (req, res) => {
  try {
    const u = req.body;
    if (!u.email) return res.status(400).json({ error: 'email required' });
    const lower = u.email.toLowerCase();

    // ✅ FIX: only update provided fields — don't overwrite boosts/plan/verify with defaults
    const update = { last_active: new Date().toISOString() };
    if (u.name !== undefined) update.name = u.name;
    if (u.phone !== undefined) update.phone = u.phone;
    if (u.pfp !== undefined) update.pfp = u.pfp;
    if (u.boosts !== undefined) update.boosts = u.boosts;
    if (u.verify !== undefined) update.verify = u.verify;
    if (u.subscription !== undefined) update.subscription = u.subscription;
    if (u.subscription_until !== undefined) update.subscription_until = u.subscription_until;

    const result = await supabase.from('users').upsert([{ email: lower, ...update }], { onConflict: 'email' }).select().single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/users/:email', async (req, res) => {
  try {
    const result = await supabase.from('users').select('*').eq('email', req.params.email.toLowerCase()).single();
    if (result.error && result.error.code !== 'PGRST116') throw result.error;
    res.json(result.data || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/user-sync/:email', async (req, res) => {
  try {
    const result = await supabase.from('users').select('*').eq('email', req.params.email.toLowerCase()).single();
    if (result.error && result.error.code !== 'PGRST116') throw result.error;
    if (!result.data) return res.json({ plan: 'free', boosts: 0, verify: '', status: 'active', subscription: null, referrals_count: 0, referral_code: null, deleted: false });
    res.json(result.data);
  } catch (err) {
    res.json({ plan: 'free', boosts: 0, verify: '', status: 'active' });
  }
});

app.post('/change-email', async (req, res) => {
  try {
    const { old_email, new_email } = req.body;
    if (!old_email || !new_email) return res.status(400).json({ error: 'old and new email required' });
    const oldE = old_email.toLowerCase();
    const newE = new_email.toLowerCase();
    await supabase.from('users').update({ email: newE }).eq('email', oldE);
    await supabase.from('products').update({ seller_email: newE }).eq('seller_email', oldE);
    await supabase.from('reports').update({ reporter_email: newE }).eq('reporter_email', oldE);
    await supabase.from('reports').update({ reported_email: newE }).eq('reported_email', oldE);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/update-my-products', async (req, res) => {
  try {
    const { seller_email, seller_name, seller_phone, whatsapp } = req.body;
    if (!seller_email) return res.status(400).json({ error: 'seller_email required' });
    const result = await supabase.from('products').update({ seller_name, seller_phone, whatsapp }).eq('seller_email', seller_email.toLowerCase());
    if (result.error) throw result.error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// REFERRAL
// ============================================================
app.post('/referral/set-code', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'email and code required' });
    const cleanCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    if (cleanCode.length < 3) return res.status(400).json({ error: 'Code must be at least 3 characters' });
    const lower = email.toLowerCase();

    // Check if code is taken by another user
    const { data: existing } = await supabase.from('users').select('email').eq('referral_code', cleanCode).maybeSingle();
    if (existing && existing.email !== lower) return res.json({ success: false, taken: true, error: 'TAKEN' });

    // ✅ FIX: use upsert so it works even if user row missing
    const result = await supabase.from('users').upsert([{ email: lower, referral_code: cleanCode }], { onConflict: 'email' }).select().single();
    if (result.error) throw result.error;
    res.json({ success: true, code: cleanCode });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/referral/info/:email', async (req, res) => {
  try {
    const result = await supabase.from('users').select('referral_code, referrals_count, claimed_vip_reward, referred_by').eq('email', req.params.email.toLowerCase()).single();
    if (result.error && result.error.code !== 'PGRST116') throw result.error;
    if (!result.data) return res.json({ referral_code: null, referrals_count: 0, claimed_vip_reward: false, referred_by: null });
    res.json(result.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/referral/redeem', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'email and code required' });
    const cleanCode = String(code).trim().toUpperCase();
    const lowerEmail = email.toLowerCase();
    const { data: owner } = await supabase.from('users').select('*').eq('referral_code', cleanCode).single();
    if (!owner) return res.json({ success: false, error: 'Invalid code' });
    if (owner.email === lowerEmail) return res.json({ success: false, error: "Can't use your own code" });
    const { data: me } = await supabase.from('users').select('*').eq('email', lowerEmail).single();
    if (me && me.referred_by) return res.json({ success: false, error: 'You already used a referral code' });
    const newCount = (owner.referrals_count || 0) + 1;
    await supabase.from('users').update({ referrals_count: newCount }).eq('email', owner.email);
    await supabase.from('users').upsert([{ email: lowerEmail, referred_by: cleanCode }], { onConflict: 'email' });
    res.json({ success: true, owner_email: owner.email, count: newCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/referral/claim-vip', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const lowerEmail = email.toLowerCase();
    const { data: user } = await supabase.from('users').select('*').eq('email', lowerEmail).single();
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.claimed_vip_reward) return res.json({ success: false, error: 'Already claimed' });
    if ((user.referrals_count || 0) < 100) return res.json({ success: false, error: 'Need 100 referrals first' });
    const until = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
    const newBoosts = (user.boosts || 0) + 200;
    await supabase.from('users').update({ plan: 'vip', verify: 'verify-blue', boosts: newBoosts, subscription: 'vip', subscription_until: until, claimed_vip_reward: true, last_active: new Date().toISOString() }).eq('email', lowerEmail);
    res.json({ success: true, boosts: newBoosts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// REPORTS & BLOCKS
// ============================================================
app.post('/reports', async (req, res) => {
  try {
    const result = await supabase.from('reports').insert([req.body]).select().single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/blocks', async (req, res) => {
  try {
    const result = await supabase.from('blocked_users').insert([req.body]).select().single();
    if (result.error) throw result.error;
    res.json(result.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// ADMIN
// ============================================================
app.get('/admin/users', async (req, res) => {
  try {
    const result = await supabase.from('users').select('*').order('last_active', { ascending: false }).limit(500);
    if (result.error) throw result.error;
    res.json(result.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/deleted-users', async (req, res) => {
  try {
    const result = await supabase.from('users').select('*').eq('deleted', true).order('last_active', { ascending: false }).limit(500);
    if (result.error) throw result.error;
    res.json(result.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/gift-plan', async (req, res) => {
  try {
    const { email, plan } = req.body;
    if (!email || !plan) return res.status(400).json({ error: 'email and plan required' });
    const planMap = {
      plus:    { verify: 'verify-yellow', boosts: 50,  days: 31 },
      pro:     { verify: 'verify-orange', boosts: 80,  days: 31 },
      premium: { verify: 'verify-purple', boosts: 100, days: 31 },
      vip:     { verify: 'verify-blue',   boosts: 200, days: 31 }
    };
    const p = planMap[plan.toLowerCase()];
    if (!p) return res.status(400).json({ error: 'Unknown plan' });
    const lower = email.toLowerCase();
    const { data: user } = await supabase.from('users').select('*').eq('email', lower).single();
    const newBoosts = (user?.boosts || 0) + p.boosts;
    const until = new Date(Date.now() + p.days * 24 * 60 * 60 * 1000).toISOString();
    const payload = { email: lower, plan: plan.toLowerCase(), verify: p.verify, boosts: newBoosts, subscription: plan.toLowerCase(), subscription_until: until, status: 'active', last_active: new Date().toISOString() };
    const result = await supabase.from('users').upsert([payload], { onConflict: 'email' }).select().single();
    if (result.error) throw result.error;
    res.json({ success: true, user: result.data, boosts: newBoosts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/add-boosts', async (req, res) => {
  try {
    const { email, amount } = req.body;
    if (!email || !amount) return res.status(400).json({ error: 'email and amount required' });
    const lower = email.toLowerCase();
    const { data: user } = await supabase.from('users').select('*').eq('email', lower).single();
    const newBoosts = (user?.boosts || 0) + parseInt(amount);
    const result = await supabase.from('users').upsert([{ email: lower, boosts: newBoosts, plan: user?.plan || 'free', last_active: new Date().toISOString() }], { onConflict: 'email' }).select().single();
    if (result.error) throw result.error;
    res.json({ success: true, boosts: newBoosts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/ban-user', async (req, res) => {
  try {
    const { email, status, days } = req.body;
    if (!email || !status) return res.status(400).json({ error: 'email and status required' });
    const lower = email.toLowerCase();
    const payload = { email: lower, status: status, suspend_days: days || null, last_active: new Date().toISOString() };
    const result = await supabase.from('users').upsert([payload], { onConflict: 'email' }).select().single();
    if (result.error) throw result.error;
    res.json({ success: true, user: result.data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/delete-user', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const lower = email.toLowerCase();
    await supabase.from('users').update({ deleted: true, deleted_at: new Date().toISOString(), status: 'deleted' }).eq('email', lower);
    await supabase.from('products').delete().eq('seller_email', lower);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/restore-user', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const lower = email.toLowerCase();
    const result = await supabase.from('users').update({ deleted: false, deleted_at: null, status: 'active', last_active: new Date().toISOString() }).eq('email', lower);
    if (result.error) throw result.error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/clear-data', async (req, res) => {
  try {
    Object.keys(payments).forEach(k => delete payments[k]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/reports', async (req, res) => {
  try {
    const result = await supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(200);
    if (result.error) throw result.error;
    res.json(result.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/payments', async (req, res) => {
  try {
    const list = Object.keys(payments).map(ref => ({ reference: ref, email: payments[ref].email, amount: payments[ref].amount, type: payments[ref].type, plan: payments[ref].plan, status: payments[ref].status, created_at: new Date(payments[ref].createdAt).toISOString() })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
  console.log('Lenidi backend running on port ' + PORT);
  console.log('Supabase:', SUPABASE_URL);
  console.log('Paystack mode:', PAYSTACK_SECRET && PAYSTACK_SECRET.startsWith('sk_live_') ? 'LIVE' : 'TEST');
});
