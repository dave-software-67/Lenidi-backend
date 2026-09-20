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
const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';

if (!PAYSTACK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing environment variables!');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const payments = {};

// ================= HEALTH =================
app.get('/', (req, res) => { res.json({ status: 'ok', app: 'Lenidi Backend', v: 6 }); });
app.get('/public-key', (req, res) => { res.json({ publicKey: PAYSTACK_PUBLIC }); });

// ================= PAYSTACK =================
app.post('/create-payment', async (req, res) => {
  try {
    const { email, plan, amount, type } = req.body;
    if (!email || !amount) return res.status(400).json({ error: 'Email and amount required' });
    const reference = 'LENIDI_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    payments[reference] = { email: email.toLowerCase(), plan: plan || null, amount, type: type || 'boost', status: 'pending', createdAt: Date.now() };
    const paystackRes = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      { email, amount: Math.round(amount * 100), currency: 'GHS', reference, callback_url: 'https://lenidi-backend.onrender.com/payment-success' },
      { headers: { Authorization: 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json' } }
    );
    if (!paystackRes.data || !paystackRes.data.status) return res.status(500).json({ error: 'Paystack init failed' });
    res.json({ reference, publicKey: PAYSTACK_PUBLIC, email, authorization_url: paystackRes.data.data.authorization_url, access_code: paystackRes.data.data.access_code });
  } catch (err) { res.status(500).json({ error: err.response?.data?.message || err.message }); }
});

app.get('/payment-success', (req, res) => {
  res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payment Successful</title><style>body{font-family:sans-serif;background:#f5f7fa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.card{background:#fff;border-radius:20px;padding:32px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.08)}h1{color:#16a34a}</style></head><body><div class="card"><h1>✓ Payment Successful</h1><p>Return to the Lenidi app</p></div></body></html>');
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

// ================= PRODUCTS =================
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
    if (!p.title || !p.price || !p.seller_email) return res.status(400).json({ error: 'title, price, seller_email required' });
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
    const result = await supabase.from('products').update({ is_boosted, boosted_at: boosted_at || Date.now() }).eq('id', id);
    if (result.error) throw result.error;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= USERS =================
app.post('/users', async (req, res) => {
  try {
    const u = req.body;
    if (!u.email) return res.status(400).json({ error: 'email required' });
    const lower = u.email.toLowerCase();
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
  } catch (err) { res.json({ plan: 'free', boosts: 0, verify: '', status: 'active' }); }
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
    await supabase.from('products').update({ seller_name, seller_phone, whatsapp }).eq('seller_email', seller_email.toLowerCase());
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= REFERRAL =================
app.post('/referral/set-code', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'email and code required' });
    const cleanCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    if (cleanCode.length < 3) return res.status(400).json({ error: 'Code must be 3+ chars' });
    const lower = email.toLowerCase();
    const { data: existing } = await supabase.from('users').select('email').eq('referral_code', cleanCode).maybeSingle();
    if (existing && existing.email !== lower) return res.json({ success: false, taken: true, error: 'TAKEN' });
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
    const lower = email.toLowerCase();
    const { data: owner } = await supabase.from('users').select('*').eq('referral_code', cleanCode).single();
    if (!owner) return res.json({ success: false, error: 'Invalid code' });
    if (owner.email === lower) return res.json({ success: false, error: "Can't use your own code" });
    const { data: me } = await supabase.from('users').select('*').eq('email', lower).single();
    if (me && me.referred_by) return res.json({ success: false, error: 'Already used a code' });
    const newCount = (owner.referrals_count || 0) + 1;
    await supabase.from('users').update({ referrals_count: newCount }).eq('email', owner.email);
    await supabase.from('users').upsert([{ email: lower, referred_by: cleanCode }], { onConflict: 'email' });
    res.json({ success: true, owner_email: owner.email, count: newCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/referral/claim-vip', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const lower = email.toLowerCase();
    const { data: user } = await supabase.from('users').select('*').eq('email', lower).single();
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.claimed_vip_reward) return res.json({ success: false, error: 'Already claimed' });
    if ((user.referrals_count || 0) < 100) return res.json({ success: false, error: 'Need 100 referrals' });
    const until = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
    const newBoosts = (user.boosts || 0) + 200;
    await supabase.from('users').update({ plan: 'vip', verify: 'verify-blue', boosts: newBoosts, subscription: 'vip', subscription_until: until, claimed_vip_reward: true }).eq('email', lower);
    res.json({ success: true, boosts: newBoosts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= REPORTS & BLOCKS =================
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

// ================= ADMIN: USERS =================
app.get('/admin/users', async (req, res) => {
  try {
    const result = await supabase.from('users').select('*').order('last_active', { ascending: false }).limit(500);
    if (result.error) throw result.error;
    res.json(result.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/deleted-users', async (req, res) => {
  try {
    const result = await supabase.from('deleted_users').select('*').order('original_deleted_at', { ascending: false }).limit(500);
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
    const result = await supabase.from('users').upsert([{ email: lower, boosts: newBoosts, plan: user?.plan || 'free' }], { onConflict: 'email' }).select().single();
    if (result.error) throw result.error;
    res.json({ success: true, boosts: newBoosts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/ban-user', async (req, res) => {
  try {
    const { email, status, days } = req.body;
    if (!email || !status) return res.status(400).json({ error: 'email and status required' });
    const lower = email.toLowerCase();
    const payload = { email: lower, status, suspend_days: days || null };
    const result = await supabase.from('users').upsert([payload], { onConflict: 'email' }).select().single();
    if (result.error) throw result.error;
    res.json({ success: true, user: result.data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE → MOVE to deleted_users
app.post('/admin/delete-user', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const lower = email.toLowerCase();
    const { data: user } = await supabase.from('users').select('*').eq('email', lower).single();
    if (!user) return res.status(404).json({ error: 'User not found' });
    await supabase.from('deleted_users').insert([{ ...user, original_deleted_at: new Date().toISOString() }]);
    await supabase.from('products').delete().eq('seller_email', lower);
    await supabase.from('users').delete().eq('email', lower);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// RESTORE → MOVE back
app.post('/admin/restore-user', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const lower = email.toLowerCase();
    const { data: user } = await supabase.from('deleted_users').select('*').eq('email', lower).single();
    if (!user) return res.status(404).json({ error: 'Not found' });
    const restored = { ...user, status: 'active' };
    delete restored.original_deleted_at;
    await supabase.from('users').insert([restored]);
    await supabase.from('deleted_users').delete().eq('email', lower);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PERMANENT DELETE
app.post('/admin/permanent-delete-user', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const lower = email.toLowerCase();
    await supabase.from('products').delete().eq('seller_email', lower);
    await supabase.from('reports').delete().eq('reporter_email', lower);
    await supabase.from('reports').delete().eq('reported_email', lower);
    await supabase.from('blocked_users').delete().eq('blocker_email', lower);
    await supabase.from('blocked_users').delete().eq('blocked_email', lower);
    await supabase.from('dm_messages').delete().eq('user_email', lower);
    await supabase.from('deleted_users').delete().eq('email', lower);
    await supabase.from('users').delete().eq('email', lower);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE PRODUCT (admin)
app.post('/admin/delete-product', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await supabase.from('products').delete().eq('id', id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// REPORTS + PAYMENTS
app.get('/admin/reports', async (req, res) => {
  try {
    const result = await supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(200);
    if (result.error) throw result.error;
    res.json(result.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/admin/payments', async (req, res) => {
  try {
    const list = Object.keys(payments).map(ref => ({
      reference: ref, email: payments[ref].email, amount: payments[ref].amount,
      type: payments[ref].type, plan: payments[ref].plan, status: payments[ref].status,
      created_at: new Date(payments[ref].createdAt).toISOString()
    })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= BROADCASTS =================
app.get('/broadcasts', async (req, res) => {
  try {
    const result = await supabase.from('broadcasts').select('*').order('created_at', { ascending: false }).limit(200);
    if (result.error) throw result.error;
    res.json(result.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/send-broadcast', async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!body) return res.status(400).json({ error: 'body required' });
    const result = await supabase.from('broadcasts').insert([{ title: title || 'Broadcast', body }]).select().single();
    if (result.error) throw result.error;
    res.json({ success: true, broadcast: result.data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/delete-broadcast', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await supabase.from('broadcasts').delete().eq('id', id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= DM (user ↔ admin) =================
// List all conversations (for admin)
app.get('/dm/conversations', async (req, res) => {
  try {
    const { data } = await supabase.from('dm_messages').select('user_email, body, sender, created_at').order('created_at', { ascending: false }).limit(500);
    const seen = {};
    const list = [];
    (data || []).forEach(m => {
      if (!seen[m.user_email]) {
        seen[m.user_email] = true;
        list.push({ user_email: m.user_email, last_body: m.body, last_sender: m.sender, last_at: m.created_at });
      }
    });
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get messages for a specific user
app.get('/dm/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase().trim();
    const result = await supabase.from('dm_messages').select('*').eq('user_email', email).order('created_at', { ascending: true }).limit(500);
    if (result.error) throw result.error;
    res.json(result.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send DM (from admin OR user)
app.post('/dm/send', async (req, res) => {
  try {
    const { user_email, sender, body } = req.body;
    if (!user_email || !sender || !body) return res.status(400).json({ error: 'missing fields' });
    const cleanEmail = user_email.toLowerCase().trim();
    const result = await supabase.from('dm_messages').insert([{ user_email: cleanEmail, sender, body }]).select().single();
    if (result.error) throw result.error;
    res.json({ success: true, message: result.data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/delete-dm', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await supabase.from('dm_messages').delete().eq('id', id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN AI =================
app.post('/admin/ai', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const cleanCmd = message.trim();
    if (cleanCmd.startsWith('/')) {
      const cmdResult = await handleAdminCommand(cleanCmd);
      return res.json({ type: 'command', reply: cmdResult });
    }
    // Admin AI ONLY supports commands — no chat
    res.json({ type: 'chat', reply: '⚙️ I only support commands. Try: /ban_email, /unban_email, /delete_email, /undelete_email, /wipe_email, /gift_vip_email, /gift_pro_email, /gift_plus_email, /gift_premium_email, /gift_N_boosts_email' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function handleAdminCommand(cmd) {
  try {
    if (cmd.indexOf('/ban_') === 0) {
      const email = cmd.slice(5).trim().toLowerCase();
      await supabase.from('users').upsert([{ email, status: 'banned' }], { onConflict: 'email' });
      return '⛔ Banned ' + email;
    }
    if (cmd.indexOf('/unban_') === 0) {
      const email = cmd.slice(7).trim().toLowerCase();
      await supabase.from('users').upsert([{ email, status: 'active' }], { onConflict: 'email' });
      return '✅ Unbanned ' + email;
    }
    if (cmd.indexOf('/delete_') === 0) {
      const email = cmd.slice(8).trim().toLowerCase();
      const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
      if (!user) return '❌ User not found';
      await supabase.from('deleted_users').insert([{ ...user, original_deleted_at: new Date().toISOString() }]);
      await supabase.from('products').delete().eq('seller_email', email);
      await supabase.from('users').delete().eq('email', email);
      return '🗑️ Deleted ' + email + ' → Deleted tab';
    }
    if (cmd.indexOf('/undelete_') === 0 || cmd.indexOf('/restore_') === 0) {
      const email = cmd.replace('/undelete_','').replace('/restore_','').trim().toLowerCase();
      const { data: user } = await supabase.from('deleted_users').select('*').eq('email', email).single();
      if (!user) return '❌ Deleted user not found';
      const restored = { ...user, status: 'active' };
      delete restored.original_deleted_at;
      await supabase.from('users').insert([restored]);
      await supabase.from('deleted_users').delete().eq('email', email);
      return '✅ Restored ' + email;
    }
    if (cmd.indexOf('/wipe_') === 0) {
      const email = cmd.slice(6).trim().toLowerCase();
      await supabase.from('products').delete().eq('seller_email', email);
      await supabase.from('reports').delete().eq('reporter_email', email);
      await supabase.from('reports').delete().eq('reported_email', email);
      await supabase.from('deleted_users').delete().eq('email', email);
      await supabase.from('users').delete().eq('email', email);
      return '💀 Wiped ' + email + ' forever';
    }
    const giftMatch = cmd.match(/^\/gift_(plus|pro|premium|vip)_(.+)$/i);
    if (giftMatch) {
      const plan = giftMatch[1].toLowerCase();
      const email = giftMatch[2].trim().toLowerCase();
      const planMap = {
        plus:    { verify: 'verify-yellow', boosts: 50 },
        pro:     { verify: 'verify-orange', boosts: 80 },
        premium: { verify: 'verify-purple', boosts: 100 },
        vip:     { verify: 'verify-blue',   boosts: 200 }
      };
      const p = planMap[plan];
      const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
      const newBoosts = (user?.boosts || 0) + p.boosts;
      await supabase.from('users').upsert([{ email, plan, verify: p.verify, boosts: newBoosts, status: 'active' }], { onConflict: 'email' });
      return '✅ Gifted ' + plan.toUpperCase() + ' to ' + email;
    }
    const boostMatch = cmd.match(/^\/gift_(\d+)_boosts_(.+)$/i);
    if (boostMatch) {
      const amount = parseInt(boostMatch[1]);
      const email = boostMatch[2].trim().toLowerCase();
      const { data: user } = await supabase.from('users').select('*').eq('email', email).single();
      const newBoosts = (user?.boosts || 0) + amount;
      await supabase.from('users').upsert([{ email, boosts: newBoosts, plan: user?.plan || 'free' }], { onConflict: 'email' });
      return '✅ Gifted ' + amount + ' boosts to ' + email;
    }
    return '❓ Unknown command';
  } catch (err) { return '❌ Error: ' + err.message; }
}

// CLEAR DATA
app.post('/admin/clear-data', async (req, res) => {
  try {
    Object.keys(payments).forEach(k => delete payments[k]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= START =================
app.listen(PORT, () => {
  console.log('Lenidi backend running on port ' + PORT);
  console.log('Version: v6');
});
