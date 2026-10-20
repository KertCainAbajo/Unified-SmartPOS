# Deploying Unified SmartPOS for free (Supabase + Vercel + Android APK)

Everything here uses free plans. How it fits together:

```
Phone app (APK) ─┐
Browser ─────────┼─►  https://YOUR-NAME.vercel.app     (Vercel, free "Hobby" plan)
                 │     ├─ /            the web app (staff side + online shop)
                 │     └─ /api, /sanctum  the Laravel API (vercel-php)
                 │
                 └──────────────► Supabase (free plan)
                                   ├─ PostgreSQL database
                                   └─ Storage bucket: product photos + applicant documents
```

Free-plan limits to know: Supabase **pauses a project after 7 days without visits** (open the dashboard and
press *Restore*); Vercel Hobby is for personal, non-commercial use; the first request after a quiet period takes a
few seconds while the API starts.

---

## Part 1 — Supabase (database and file storage)

1. Go to **https://supabase.com** → *Start your project* → sign in with GitHub.
2. *New project*
   - Name: `unified-smartpos`
   - **Database password**: press *Generate a password* and save it somewhere safe (you need it twice).
   - Region: **Southeast Asia (Singapore)** (closest to the Philippines).
   - Wait about 2 minutes until the project is ready.
3. **Database address** — press **Connect** (top of the project page) → *Connection string* → choose
   **Session pooler** (not "Direct connection": Vercel cannot reach that one). Note these parts:
   - host, like `aws-0-ap-southeast-1.pooler.supabase.com`
   - port `5432`
   - user, like `postgres.abcdefghijklmnop`
   - database `postgres`
4. **File storage** — *Storage* (left menu) → *New bucket* → name `smartpos-files` → keep **Public bucket OFF** → *Create*.
5. **Storage keys** — *Project Settings* → *Storage* → section **S3 Connection**:
   - copy the **Endpoint** and the **Region**
   - *New access key* → copy the **Access key ID** and **Secret access key** (the secret is shown only once).
6. Open **`.env.supabase`** in the project folder (already created for you, never uploaded) and fill in:
   `DB_HOST`, `DB_USERNAME`, `DB_PASSWORD`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`,
   `AWS_ENDPOINT`. Leave everything else as it is.
7. Create the tables and copy your current data (owner, admin, branches, products, photos…) — in a terminal in the
   project folder:

   ```powershell
   php artisan migrate --env=supabase --force
   php artisan smartpos:copy-data --env=supabase --files-from=public
   ```

   The second command reads your local MySQL (it is not changed) and writes into Supabase. Check: Supabase →
   *Table Editor* → `users` shows your accounts.

## Part 2 — Put the code on GitHub

Vercel deploys from your GitHub repository (`KertCainAbajo/Unified-SmartPOS`). Commit and push the current work
(GitHub Desktop: *Commit to main* → *Push origin*). `.env`, `.env.supabase` and `storage/backups` are ignored and
never uploaded.

## Part 3 — Vercel (web app + API)

1. Go to **https://vercel.com** → *Sign up* → **Hobby** → continue with GitHub.
2. *Add New…* → *Project* → **Import** `Unified-SmartPOS`.
3. Project name: e.g. `alingnena-smartpos` → your address will be **`https://alingnena-smartpos.vercel.app`**
   (use your real one below wherever it says `YOUR-NAME`).
4. *Framework Preset*: **Other**. Root directory: leave `./`. Build settings: leave as they are (they come from `vercel.json`).
5. *Environment Variables* — paste this block (Vercel accepts a whole `.env`-style paste), then fill the values:

   ```
   APP_NAME="Unified SmartPOS"
   APP_ENV=production
   APP_DEBUG=false
   APP_KEY=                      # run:  php artisan key:generate --show   and paste the result
   APP_URL=https://YOUR-NAME.vercel.app
   FRONTEND_URL=https://YOUR-NAME.vercel.app
   SANCTUM_STATEFUL_DOMAINS=YOUR-NAME.vercel.app
   TRUSTED_PROXIES=*
   LOG_CHANNEL=stderr
   BCRYPT_ROUNDS=12

   DB_CONNECTION=pgsql
   DB_HOST=                      # same as in .env.supabase
   DB_PORT=5432
   DB_DATABASE=postgres
   DB_USERNAME=                  # same as in .env.supabase
   DB_PASSWORD=                  # same as in .env.supabase
   DB_SSLMODE=require

   SESSION_DRIVER=database
   SESSION_SECURE_COOKIE=true
   SESSION_ENCRYPT=true
   CACHE_STORE=database
   QUEUE_CONNECTION=sync

   SMARTPOS_FILES_DISK=s3
   SMARTPOS_PRIVATE_FILES_DISK=s3
   AWS_ACCESS_KEY_ID=            # same as in .env.supabase
   AWS_SECRET_ACCESS_KEY=        # same as in .env.supabase
   AWS_DEFAULT_REGION=           # same as in .env.supabase
   AWS_BUCKET=smartpos-files
   AWS_ENDPOINT=                 # same as in .env.supabase
   AWS_USE_PATH_STYLE_ENDPOINT=true

   MAIL_MAILER=smtp
   MAIL_HOST=smtp.gmail.com
   MAIL_PORT=587
   MAIL_USERNAME=                # your Gmail address
   MAIL_PASSWORD=                # a Gmail App Password (make a NEW one for the live site)
   MAIL_FROM_ADDRESS=            # your Gmail address
   MAIL_FROM_NAME="Aling Nena Mini Mart"

   SMARTPOS_NEW_DEVICE_CODES=true
   SMARTPOS_CHECK_BREACHED_PASSWORDS=true
   VITE_DEMO_MODE=true
   ```

6. Press **Deploy** (2–4 minutes).
7. Check it:
   - `https://YOUR-NAME.vercel.app/up` → a green "Application up" page
   - `https://YOUR-NAME.vercel.app/login` → sign in with your owner email. A new browser asks for the emailed code.
   - `https://YOUR-NAME.vercel.app/shop/aling-nena-mini-mart` → the online shop
8. If something fails: Vercel → your project → *Logs* (or *Deployments* → the deployment → *Functions*) shows the
   error. Changed a variable? *Deployments* → ⋯ → **Redeploy**.

Every `git push` to `main` redeploys automatically.

## Part 4 — The Android app

```powershell
cd customer-app
$env:SHOP_URL = "https://YOUR-NAME.vercel.app/shop/aling-nena-mini-mart"
npm run apk
```

This makes `customer-app\AlingNenaShop-test.apk`, which opens your live shop. Share it for free (Google Drive,
Messenger…); on the phone allow *Install unknown apps* for the app you open it with. Publishing on Google Play
costs a one-time USD 25; an iPhone app needs a Mac and Apple's USD 99/year account — iPhone users can open the
shop in Safari and use *Share → Add to Home Screen* instead.

## Part 5 — Before you call it live

```powershell
php artisan smartpos:security-check --env=supabase --production
```

Keep the demo banner on (`VITE_DEMO_MODE=true`) while this is a personal project.
