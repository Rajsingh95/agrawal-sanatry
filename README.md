# Agrawal Sanitary & Electricals

Starter full-stack commerce application:
- React storefront with category browsing, search, cart and WhatsApp checkout
- Express API with PostgreSQL schema
- Admin login, product/order management and editable store settings
- Google Sheets sync hook and WhatsApp Cloud API integration points

## Requirements
Node.js 20+, PostgreSQL database, Google Cloud service account (Sheets API), Meta WhatsApp Cloud API credentials.

## Run locally
1. Copy `.env.example` to `.env` and fill values.
2. Create a PostgreSQL database and run `db/schema.sql`.
3. `npm install`
4. `npm run dev` (API at :5000, Vite at :5173)

## Important integrations
- WhatsApp Cloud API requires a Meta app, WhatsApp Business phone number ID, permanent access token and an approved message template. Configure these as server environment variables; never expose tokens in browser code.
- WhatsApp outbound business-initiated notifications use approved templates. Free-form messages are restricted by Meta's customer-service window.
- Google Sheets credentials must be a service-account JSON string in `GOOGLE_SERVICE_ACCOUNT_JSON`; share the target spreadsheet with the service-account email.
- The API saves the order in PostgreSQL first. Sheet sync is best-effort and can be retried; the database remains the source of truth.

## Production deployment
Deploy API and frontend separately or serve the built frontend from the API. Use managed PostgreSQL with backups and persistent secrets. Set `CLIENT_ORIGIN`, `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, WhatsApp and Google Sheets environment variables.

## First-time admin setup
Generate a password hash with:
`node scripts/hash-password.js "your-long-admin-password"`
Copy the output into `ADMIN_PASSWORD_HASH` in `.env`. Set `ADMIN_EMAIL` to your admin email. Never commit `.env`.

Run `db/schema.sql` after creating the database. It creates starter catalogue items; you can change them from the admin panel after logging in.

## Render deployment (Blueprint)
1. Push this project to a GitHub repository.
2. In Render, choose **New + → Blueprint**, connect the repository, and select `render.yaml`.
3. Render creates a PostgreSQL database and a Node web service. Enter the secret values Render requests (`ADMIN_PASSWORD_HASH`, WhatsApp credentials and Google Sheets credentials).
4. Generate the admin password hash locally using `node scripts/hash-password.js "your-long-password-at-least-12-chars"` and paste only the resulting hash into Render.
5. After deploy, open `https://agrawal-sanitary-electricals.onrender.com/api/health`; expect `{"ok":true,...}`.
6. Open the website and click the gear icon for admin login.

Important: the starter blueprint uses Render's free plans where available. Free instances may sleep, have usage limits, and are not suitable for guaranteed business uptime or durable production operation. Check current Render plan/database policies before relying on it for live orders. For a real shop, select a paid persistent database/service plan and enable backups.

## Database initialization
After the PostgreSQL database is created, open its Render database page and use its connection details with Render Shell or a trusted SQL client to run `db/schema.sql`. This initializes the tables and demo products. Do not publish database credentials.
