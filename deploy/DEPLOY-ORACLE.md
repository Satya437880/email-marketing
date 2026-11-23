# Running the API and workers on the Oracle Cloud free server

The website stays on Vercel. This server runs the **API**, the **workers** and **Redis**, so nothing depends on your own computer.
Your data stays in Supabase.

## 1. Create the server (Oracle Cloud, "Always Free")
1. Sign up at oracle.com/cloud/free (a card is needed to verify you; it is not charged for Always Free items).
2. Create a Compute instance: **Ubuntu**, shape **VM.Standard.A1.Flex** (Ampere) with **1 OCPU and 6 GB**. Download the SSH key.
3. In the instance's network ("Security List" or "Network Security Group"), add ingress rules for **TCP 80** and **TCP 443** from `0.0.0.0/0`.
4. Note the **public IP address**.

> **Tip: pick Oracle's Seoul region (ap-seoul-1) when you sign up** if your Supabase project is in Seoul (ap-northeast-2). Every database
> question then takes a few milliseconds instead of about 200 ms, and the whole app feels much faster. The region cannot be changed later.

## 2. An address for the API
- **Own domain in Cloudflare (permanent, no extra cost):** add a DNS record `A  api  ->  PUBLIC-IP` and set it to **DNS only** (grey cloud), so
  the free https certificate can be issued. The address is `api.yourdomain.com`.
- **No domain:** at duckdns.org create `yourname` pointing to the public IP. The address is `yourname.duckdns.org`.

## 3. Put the project on the server
```
ssh -i your-key ubuntu@PUBLIC-IP
git clone https://github.com/Satya437880/email-marketing.git
cd email-marketing
cp deploy/server.env.example .env
nano .env        # fill it in (next section)
bash deploy/oracle-setup.sh api.yourdomain.com      # or yourname.duckdns.org
```

## 4. What goes in `.env` on the server
Copy these values from the `.env` on your computer (never paste them into chats or commit them):
- `DATABASE_URL` (the Supabase Session pooler address), `CREDENTIALS_KEY`, `SESSION_SECRET`
- `GOOGLE_*` and `MICROSOFT_*` client IDs and secrets, if you use the "Connect" buttons

And set these:
- `REDIS_URL=redis://localhost:6379`
- `WEB_ORIGIN`, `PUBLIC_URL`, `TRACKING_BASE_URL` = `https://email-marketings.vercel.app` (your Vercel address)
- `NODE_ENV=production`
- `SYSTEM_SMTP_URL` and `SYSTEM_MAIL_FROM` if people will sign up (otherwise sign-up is switched off in production)

## 5. Point Vercel at the server
In `apps/web/vercel.json` change the three destinations from the tunnel address to your API address (`https://api.yourdomain.com` or `https://yourname.duckdns.org`), commit and push. Vercel redeploys.

## 6. Google and Microsoft sign-in (only if you use the Connect buttons)
Use the Vercel address in the redirect links, for example `https://email-marketings.vercel.app/v1/oauth/google/callback`.

## 7. Switch off the tunnel on your computer
Stop the workers and the Cloudflare tunnel on your computer, so only the server sends emails.

## Everyday commands (on the server)
- `pm2 status` shows what is running; `pm2 logs workers` shows the sending log
- `cd email-marketing && git pull && npm ci && pm2 restart all` updates after you push changes
