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
const GROQ_MODEL = 'openai/gpt-oss-20b';

if (!PAYSTACK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing environment variables!');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const payments = {};
const adminAiMemory = { conversations: [] };

// ================= HEALTH =================
app.get('/', (req, res) => { res.json({ status: 'ok', app: 'Lenidi Backend', v: 8 }); });
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

// ================= DM =================
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

app.get('/dm/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase().trim();
    const result = await supabase.from('dm_messages').select('*').eq('user_email', email).order('created_at', { ascending: true }).limit(500);
    if (result.error) throw result.error;
    res.json(result.data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

app.post('/admin/delete-all-broadcasts', async (req, res) => {
  try {
    await supabase.from('broadcasts').delete().neq('id', 0);
    res.json({ success: true });
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

app.post('/admin/delete-product', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    await supabase.from('products').delete().eq('id', id);
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
    const list = Object.keys(payments).map(ref => ({
      reference: ref, email: payments[ref].email, amount: payments[ref].amount,
      type: payments[ref].type, plan: payments[ref].plan, status: payments[ref].status,
      created_at: new Date(payments[ref].createdAt).toISOString()
    })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/admin/clear-data', async (req, res) => {
  try {
    Object.keys(payments).forEach(k => delete payments[k]);
    adminAiMemory.conversations = [];
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================= ADMIN AI (SMART CHAT) =================
app.post('/admin/ai', async (req, res) => {
  try {
    const { message, clearHistory } = req.body;
    if (clearHistory) {
      adminAiMemory.conversations = [];
      return res.json({ success: true, cleared: true });
    }
    if (!message) return res.status(400).json({ error: 'message required' });

    // Build system prompt with app context
    const [usersRes, productsRes, reportsRes, broadcastsRes, dmsRes] = await Promise.all([
      supabase.from('users').select('email, name, phone, plan, status, boosts, referrals_count, last_active').limit(500),
      supabase.from('products').select('id, title, price, seller_email, seller_name, category, is_boosted, is_vip').limit(500),
      supabase.from('reports').select('reporter_email, reported_email, reason').limit(200),
      supabase.from('broadcasts').select('id, title, body, created_at').limit(200),
      supabase.from('dm_messages').select('user_email, body, sender, created_at').order('created_at', { ascending: false }).limit(100)
    ]);

    const users = usersRes.data || [];
    const products = productsRes.data || [];
    const reports = reportsRes.data || [];
    const broadcasts = broadcastsRes.data || [];
    const dms = dmsRes.data || [];

    const totalUsers = users.length;
    const bannedUsers = users.filter(u => u.status === 'banned').length;
    const suspendedUsers = users.filter(u => u.status === 'suspended').length;
    const activeUsers = users.filter(u => (u.status || 'active') === 'active').length;
    const totalProducts = products.length;
    const boostedProducts = products.filter(p => p.is_boosted).length;
    const vipProducts = products.filter(p => p.is_vip).length;
    const totalReports = reports.length;
    const totalBroadcasts = broadcasts.length;

    const planCounts = { free: 0, plus: 0, pro: 0, premium: 0, vip: 0 };
    users.forEach(u => { const p = (u.plan || 'free').toLowerCase(); if (planCounts[p] !== undefined) planCounts[p]++; });

    const topSellers = {};
    products.forEach(p => { if (p.seller_email) topSellers[p.seller_email] = (topSellers[p.seller_email] || 0) + 1; });
    const topSellersList = Object.entries(topSellers).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([email, count]) => `${email} (${count} ads)`).join(', ');

    const systemPrompt = `You are Lenidi Admin AI — the assistant inside the Lenidi marketplace admin panel. You help the owner manage the app.

LIVE APP STATS RIGHT NOW:
- Total users: ${totalUsers}
- Active: ${activeUsers} | Banned: ${bannedUsers} | Suspended: ${suspendedUsers}
- Plans: ${JSON.stringify(planCounts)}
- Total products: ${totalProducts} (${boostedProducts} boosted, ${vipProducts} VIP)
- Total reports: ${totalReports}
- Total broadcasts: ${totalBroadcasts}
- Top sellers: ${topSellersList || 'None yet'}

USER LIST (emails only): ${users.slice(0, 100).map(u => u.email).join(', ')}

RECENT REPORTS: ${reports.slice(0, 10).map(r => `${r.reporter_email} reported ${r.reported_email}: ${r.reason}`).join(' | ') || 'None'}

YOU CAN DO THESE ACTIONS. When the admin asks you to do something, respond with a JSON action block wrapped in [ACTION]...[/ACTION] tags AFTER your normal reply text.

Available actions:
- {"action":"ban","email":"..."} — permanently ban a user
- {"action":"suspend","email":"...","days":7} — suspend for N days
- {"action":"unban","email":"..."} — remove ban/suspension
- {"action":"delete_user","email":"..."} — move user to Deleted tab
- {"action":"wipe_user","email":"..."} — permanently delete user
- {"action":"gift_plan","email":"...","plan":"plus|pro|premium|vip"} — give a plan
- {"action":"gift_boosts","email":"...","amount":100} — add boosts
- {"action":"broadcast","title":"...","body":"..."} — send broadcast to all users
- {"action":"delete_product","id":123} — delete a product
- {"action":"delete_broadcast","id":123} — delete a broadcast
- {"action":"clear_broadcasts"} — delete ALL broadcasts

Rules:
- ALWAYS confirm the action in your reply text (e.g. "Done! Banned sam@gmail.com ✅")
- ONLY include [ACTION] block if the user actually requested an action
- If the user just asks a question, reply normally without [ACTION]
- Keep replies short, friendly, use emojis
- If asked to do something with an email, use the EXACT email
- If the user says "ban sam" without an email, ask which email
- You remember all previous conversations — the admin's name, past actions, etc.`;

    // Add to memory
    adminAiMemory.conversations.push({ role: 'user', content: message });
    if (adminAiMemory.conversations.length > 40) {
      adminAiMemory.conversations = adminAiMemory.conversations.slice(-40);
    }

    // Call Groq
    const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...adminAiMemory.conversations
      ],
      temperature: 0.6,
      max_tokens: 800
    }, {
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_API_KEY }
    });

    const aiReply = groqRes.data?.choices?.[0]?.message?.content?.trim() || 'No response.';

    // Add AI reply to memory
    adminAiMemory.conversations.push({ role: 'assistant', content: aiReply });

    // Parse actions
    const actionMatches = [...aiReply.matchAll(/\[ACTION\]([\s\S]*?)\[\/ACTION\]/g)];
    const actions = [];
    const actionResults = [];

    for (const match of actionMatches) {
      try {
        const act = JSON.parse(match[1].trim());
        actions.push(act);

        if (act.action === 'ban') {
          await supabase.from('users').upsert([{ email: act.email.toLowerCase(), status: 'banned' }], { onConflict: 'email' });
          actionResults.push(`✅ Banned ${act.email}`);
        } else if (act.action === 'suspend') {
          await supabase.from('users').upsert([{ email: act.email.toLowerCase(), status: 'suspended', suspend_days: act.days || 7 }], { onConflict: 'email' });
          actionResults.push(`⏸️ Suspended ${act.email} for ${act.days || 7} days`);
        } else if (act.action === 'unban') {
          await supabase.from('users').upsert([{ email: act.email.toLowerCase(), status: 'active' }], { onConflict: 'email' });
          actionResults.push(`✅ Unbanned ${act.email}`);
        } else if (act.action === 'delete_user') {
          const { data: u } = await supabase.from('users').select('*').eq('email', act.email.toLowerCase()).single();
          if (u) {
            await supabase.from('deleted_users').insert([{ ...u, original_deleted_at: new Date().toISOString() }]);
            await supabase.from('products').delete().eq('seller_email', act.email.toLowerCase());
            await supabase.from('users').delete().eq('email', act.email.toLowerCase());
            actionResults.push(`🗑️ Deleted ${act.email} → Deleted tab`);
          } else actionResults.push(`❌ User ${act.email} not found`);
        } else if (act.action === 'wipe_user') {
          const lower = act.email.toLowerCase();
          await supabase.from('products').delete().eq('seller_email', lower);
          await supabase.from('reports').delete().eq('reporter_email', lower);
          await supabase.from('reports').delete().eq('reported_email', lower);
          await supabase.from('blocked_users').delete().eq('blocker_email', lower);
          await supabase.from('blocked_users').delete().eq('blocked_email', lower);
          await supabase.from('dm_messages').delete().eq('user_email', lower);
          await supabase.from('deleted_users').delete().eq('email', lower);
          await supabase.from('users').delete().eq('email', lower);
          actionResults.push(`💀 Wiped ${act.email} forever`);
        } else if (act.action === 'gift_plan') {
          const planMap = {
            plus:    { verify: 'verify-yellow', boosts: 50 },
            pro:     { verify: 'verify-orange', boosts: 80 },
            premium: { verify: 'verify-purple', boosts: 100 },
            vip:     { verify: 'verify-blue',   boosts: 200 }
          };
          const p = planMap[act.plan.toLowerCase()];
          if (p) {
            const lower = act.email.toLowerCase();
            const { data: u } = await supabase.from('users').select('*').eq('email', lower).single();
            const newBoosts = (u?.boosts || 0) + p.boosts;
            const until = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
            await supabase.from('users').upsert([{ email: lower, plan: act.plan.toLowerCase(), verify: p.verify, boosts: newBoosts, subscription: act.plan.toLowerCase(), subscription_until: until, status: 'active' }], { onConflict: 'email' });
            actionResults.push(`👑 Gifted ${act.plan.toUpperCase()} to ${act.email}`);
          } else actionResults.push(`❌ Unknown plan ${act.plan}`);
        } else if (act.action === 'gift_boosts') {
          const lower = act.email.toLowerCase();
          const { data: u } = await supabase.from('users').select('*').eq('email', lower).single();
          const newBoosts = (u?.boosts || 0) + parseInt(act.amount);
          await supabase.from('users').upsert([{ email: lower, boosts: newBoosts, plan: u?.plan || 'free' }], { onConflict: 'email' });
          actionResults.push(`⚡ Gifted ${act.amount} boosts to ${act.email}`);
        } else if (act.action === 'broadcast') {
          await supabase.from('broadcasts').insert([{ title: act.title || 'Broadcast', body: act.body }]);
          actionResults.push(`📢 Broadcast sent`);
        } else if (act.action === 'delete_product') {
          await supabase.from('products').delete().eq('id', act.id);
          actionResults.push(`🗑️ Product ${act.id} deleted`);
        } else if (act.action === 'delete_broadcast') {
          await supabase.from('broadcasts').delete().eq('id', act.id);
          actionResults.push(`🗑️ Broadcast ${act.id} deleted`);
        } else if (act.action === 'clear_broadcasts') {
          await supabase.from('broadcasts').delete().neq('id', 0);
          actionResults.push(`🗑️ All broadcasts cleared`);
        }
      } catch (parseErr) {
        console.warn('Action parse error:', parseErr.message);
      }
    }

    // Clean reply (remove ACTION tags)
    const cleanReply = aiReply.replace(/\[ACTION\][\s\S]*?\[\/ACTION\]/g, '').trim();

    res.json({
      reply: cleanReply,
      actions: actions,
      actionResults: actionResults,
      hasAction: actions.length > 0
    });
  } catch (err) {
    console.error('Admin AI error:', err.message);
    res.status(500).json({ error: err.message, reply: '⚠️ AI error: ' + err.message });
  }
});

// ================= START =================
app.listen(PORT, () => {
  console.log('Lenidi backend running on port ' + PORT);
  console.log('Version: v8');
});
