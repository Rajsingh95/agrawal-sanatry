require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, pool } = require('./db');
const auth = require('./auth');
const { sendWhatsAppOrder, appendOrderToSheet } = require('./integrations');

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || true }));
app.use(express.json({ limit: '1mb' }));

// In production the same Render service serves both the API and React storefront.
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.get('/api/health', (_,res) => res.json({ ok:true, service:'Agrawal Store API' }));
app.get('/api/products', async (req,res) => {
  try {
    const { rows } = await query('SELECT id,name,category,description,sku,price,mrp,stock,image_url FROM products WHERE active=true ORDER BY created_at DESC');
    res.json(rows);
  } catch(e) { res.status(500).json({error:'Could not load products'}); }
});
app.get('/api/settings', async (_,res) => {
  try { const { rows } = await query("SELECT key,value FROM settings WHERE key IN ('store','homepage')");
    res.json(Object.fromEntries(rows.map(r=>[r.key,r.value])));
  } catch(e) { res.status(500).json({error:'Could not load settings'}); }
});
app.post('/api/orders', async (req,res) => {
  const { customer, items, paymentMethod='COD' } = req.body;
  if (!customer?.name || !customer?.phone || !customer?.address || !Array.isArray(items) || !items.length)
    return res.status(400).json({error:'Name, phone, address and cart items are required'});
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let subtotal = 0, clean = [];
    for (const item of items) {
      const { rows } = await client.query('SELECT id,name,price,stock FROM products WHERE id=$1 AND active=true FOR UPDATE',[item.productId]);
      if (!rows.length) throw new Error('A selected product is unavailable');
      const p=rows[0], qty=Math.max(1,Math.min(99,Number(item.quantity)||1));
      if (p.stock < qty) throw new Error(`${p.name}: insufficient stock`);
      subtotal += Number(p.price)*qty;
      clean.push({product_id:p.id,product_name:p.name,quantity:qty,unit_price:p.price});
      await client.query('UPDATE products SET stock=stock-$1,updated_at=NOW() WHERE id=$2',[qty,p.id]);
    }
    const code = `ASE-${Date.now().toString().slice(-8)}`;
    const inserted = await client.query(
      `INSERT INTO orders(order_code,customer_name,phone,address,subtotal,payment_method)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [code,customer.name,customer.phone,customer.address,subtotal,paymentMethod]
    );
    const order=inserted.rows[0];
    for(const i of clean) await client.query(
      'INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price) VALUES($1,$2,$3,$4,$5)',
      [order.id,i.product_id,i.product_name,i.quantity,i.unit_price]);
    await client.query('COMMIT');
    let wa={sent:false}, sheet={synced:false};
    try { wa=await sendWhatsAppOrder(order,clean); await query('UPDATE orders SET whatsapp_status=$1 WHERE id=$2',[wa.sent?'Sent':'Pending',order.id]); } catch(e) { wa={sent:false,reason:e.message}; }
    try { sheet=await appendOrderToSheet(order,clean); await query('UPDATE orders SET sheet_status=$1 WHERE id=$2',[sheet.synced?'Synced':'Pending',order.id]); } catch(e) { sheet={synced:false,reason:e.message}; }
    res.status(201).json({orderCode:code,subtotal,whatsapp:wa.sent,sheets:sheet.synced,notice:'Order saved'});
  } catch(e) { await client.query('ROLLBACK'); res.status(400).json({error:e.message}); }
  finally { client.release(); }
});
app.post('/api/admin/login', async (req,res) => {
  const {email,password}=req.body;
  if(email!==process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD_HASH ||
     !(await bcrypt.compare(password||'',process.env.ADMIN_PASSWORD_HASH)))
    return res.status(401).json({error:'Invalid email or password'});
  const token=jwt.sign({email},process.env.JWT_SECRET,{expiresIn:'8h'});
  res.json({token,email});
});
app.get('/api/admin/summary',auth,async(_,res)=>{
  try {
    const [orders,sales,products,pending]=await Promise.all([
      query('SELECT COUNT(*)::int count FROM orders'),
      query("SELECT COALESCE(SUM(subtotal),0) total FROM orders WHERE status <> 'Cancelled'"),
      query('SELECT COUNT(*)::int count FROM products WHERE active=true'),
      query("SELECT COUNT(*)::int count FROM orders WHERE status='Pending'")
    ]);
    res.json({orders:orders.rows[0].count,sales:sales.rows[0].total,products:products.rows[0].count,pending:pending.rows[0].count});
  } catch(e){res.status(500).json({error:'Summary unavailable'});}
});
app.get('/api/admin/orders',auth,async(_,res)=>{
  const {rows}=await query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 300'); res.json(rows);
});
app.patch('/api/admin/orders/:id',auth,async(req,res)=>{
  const {status,paymentStatus}=req.body;
  const {rows}=await query(`UPDATE orders SET status=COALESCE($1,status),payment_status=COALESCE($2,payment_status),updated_at=NOW() WHERE id=$3 RETURNING *`,
    [status||null,paymentStatus||null,req.params.id]);
  if(!rows.length)return res.status(404).json({error:'Order not found'});
  await query('INSERT INTO activity_logs(admin_email,action,details) VALUES($1,$2,$3)',[req.admin.email,'order.updated',{id:req.params.id,status,paymentStatus}]);
  res.json(rows[0]);
});
app.post('/api/admin/products',auth,async(req,res)=>{
  const p=req.body;
  const {rows}=await query(`INSERT INTO products(name,category,description,sku,price,mrp,stock,image_url)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
  [p.name,p.category,p.description||'',p.sku||null,p.price,p.mrp||null,p.stock||0,p.image_url||'']);
  res.status(201).json(rows[0]);
});
app.put('/api/admin/products/:id',auth,async(req,res)=>{
  const p=req.body;
  const {rows}=await query(`UPDATE products SET name=$1,category=$2,description=$3,sku=$4,price=$5,mrp=$6,stock=$7,image_url=$8,updated_at=NOW()
  WHERE id=$9 RETURNING *`,[p.name,p.category,p.description||'',p.sku||null,p.price,p.mrp||null,p.stock||0,p.image_url||'',req.params.id]);
  if(!rows.length)return res.status(404).json({error:'Product not found'}); res.json(rows[0]);
});
app.delete('/api/admin/products/:id',auth,async(req,res)=>{
  await query('UPDATE products SET active=false WHERE id=$1',[req.params.id]); res.json({ok:true});
});
app.put('/api/admin/settings/:key',auth,async(req,res)=>{
  const allowed=['store','homepage'];
  if(!allowed.includes(req.params.key))return res.status(400).json({error:'Setting not allowed'});
  const {rows}=await query(`INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW() RETURNING *`,
    [req.params.key,JSON.stringify(req.body)]);
  await query('INSERT INTO activity_logs(admin_email,action,details) VALUES($1,$2,$3)',[req.admin.email,'settings.updated',{key:req.params.key}]);
  res.json(rows[0]);
});
const port=process.env.PORT||5000;
app.listen(port,()=>console.log(`Agrawal Store API running on ${port}`));
