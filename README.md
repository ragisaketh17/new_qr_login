# QR Email Login & Loyalty App

A loyalty rewards web application with QR check-in, customer email sign-in, and an administrative dashboard powered by **XAMPP MySQL / MariaDB**.

---

## 🛠️ Prerequisites & Setup

### 1. Start MySQL in XAMPP
1. Open the **XAMPP Control Panel**.
2. Click **Start** next to **MySQL** (and **Apache** if you want to use phpMyAdmin).
3. Verify that MySQL is running on default port `3306`.

### 2. Configure Environment (`.env`)
By default, standard XAMPP requires no password for the `root` user:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=mart_loyalty

# Alternatively, a single connection URL:
DATABASE_URL=mysql://root:@localhost:3306/mart_loyalty
```

> **Note:** You do **not** need to manually create the database! When the server starts, it will automatically create the `mart_loyalty` database and all required tables (`users`, `sessions`, `claims`, `visits`, `settings`, `reviews`) if they do not exist.
> If you prefer to view or import the schema in phpMyAdmin (`http://localhost/phpmyadmin`), you can find the complete SQL script in [`schema.sql`](file:///c:/Users/ragis/OneDrive/Desktop/qr-email-login/schema.sql).

### 3. Run the App
```bash
npm install
npm start
```

Or to run with automatic tunnel generation (for mobile scanning):
```bash
node start.js
```

---

## 📊 Database Tables

- **`users`**: Customer accounts, emails, and total visit counters.
- **`sessions`**: Authentication tokens and sessions for customers.
- **`claims`**: Unlocked reward coupons claimed by customers.
- **`visits`**: Audit log of individual customer visits with timestamps.
- **`settings`**: Dynamic offer configurations, social links, and Google review summaries.
- **`reviews`**: Cached Google Maps reviews.

