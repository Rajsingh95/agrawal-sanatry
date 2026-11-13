const { google } = require('googleapis');

async function sendWhatsAppOrder(order, items) {
  const { META_WA_TOKEN, META_WA_PHONE_NUMBER_ID, WHATSAPP_PHONE_NUMBER,
    META_WA_TEMPLATE_NAME, META_WA_TEMPLATE_LANGUAGE } = process.env;
  if (!META_WA_TOKEN || !META_WA_PHONE_NUMBER_ID || !WHATSAPP_PHONE_NUMBER) {
    return { sent: false, reason: 'WhatsApp Cloud API credentials are not configured' };
  }
  const lines = items.map(i => `${i.product_name} x ${i.quantity} = ₹${Number(i.unit_price)*i.quantity}`).join('\\n');
  const payload = {
    messaging_product: 'whatsapp', to: WHATSAPP_PHONE_NUMBER, type: 'template',
    template: {
      name: META_WA_TEMPLATE_NAME || 'order_received',
      language: { code: META_WA_TEMPLATE_LANGUAGE || 'en' },
      components: [{ type: 'body', parameters: [
        { type: 'text', text: order.order_code },
        { type: 'text', text: order.customer_name },
        { type: 'text', text: lines.slice(0, 900) }
      ] }]
    }
  };
  const response = await fetch(`https://graph.facebook.com/v21.0/${META_WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST', headers: { Authorization: `Bearer ${META_WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'WhatsApp API request failed');
  return { sent: true, data };
}

async function appendOrderToSheet(order, items) {
  if (!process.env.GOOGLE_SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return { synced: false, reason: 'Google Sheets credentials are not configured' };
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const rows = items.map(item => [
    order.order_code, new Date(order.created_at).toISOString(), order.customer_name,
    order.phone, order.address, item.product_name, item.quantity, item.unit_price,
    Number(item.quantity) * Number(item.unit_price), order.status, order.payment_method
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Order Items!A:K',
    valueInputOption: 'USER_ENTERED', requestBody: { values: rows }
  });
  return { synced: true };
}
module.exports = { sendWhatsAppOrder, appendOrderToSheet };
