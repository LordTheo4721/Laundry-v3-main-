<div align="center">
<img width="1200" height="475" alt="Laundry Management System Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Laundry Management System

A full-stack laundry shop management application built with React, TypeScript, Express, and a dual-database layer (MySQL primary, SQLite fallback).

## Features

- **Customer Booking**: Online laundry service booking with pickup/delivery options
- **Machine Management**: Track washers, dryers, and all-in-one machines with real-time status
- **Order Tracking**: Track laundry orders through various stages (pending → washing → drying → ready → completed)
- **Admin Dashboard**: Manage orders, view sales reports, and handle customer accounts
- **Receipt Generation**: Generate and print receipts for completed transactions
- **Sales Reports**: View daily sales, service breakdowns, and business analytics

## Tech Stack

- **Frontend**: React 19, TypeScript, TailwindCSS, Motion
- **Backend**: Express.js, dual-database (MySQL primary, SQLite fallback)
- **Authentication**: JWT (JSON Web Tokens)
- **Build Tool**: Vite

## Prerequisites

- Node.js (v18 or higher)
- npm

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   Copy `.env.example` to `.env` and update the values:
   ```bash
   cp .env.example .env
   ```

3. Run the application:
   ```bash
   npm run dev
   ```

4. Open your browser at `http://localhost:8080`

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 8080 |
| DB_NAME | SQLite database file | laundry.db |
| ADMIN_PASSWORD | Admin login password | admin123 |
| JWT_SECRET | Secret key for JWT | auto-generated |
| MACHINE_DEFAULT_TIME | Default machine timer (seconds) | 2700 |

## Project Structure

```
├── src/
│   ├── components/
│   │   ├── admin/          # Admin dashboard components
│   │   ├── AdminLogin.tsx  # Admin authentication
│   │   ├── Receipt.tsx     # Receipt generation
│   │   └── App.tsx         # Main application
│   ├── types/
│   │   └── index.ts        # TypeScript interfaces
│   └── main.tsx            # React entry point
├── server.ts               # Express server & API routes
├── scripts/
│   └── backup.ts           # Database backup script
└── package.json
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run backup` | Backup the database |

## Database

The application supports two engines selected via `DB_ENGINE`:

- `sqlite` (default) — zero-config, file-based, fully supported fallback.
- `mysql` — recommended for production.

See `.env.example` for all variables and `docs/MIGRATION_PLAN.md` for migration steps.

### Prerequisites (MySQL)
- MySQL 8.0+ server
- A database user with CREATE/ALTER/INSERT/UPDATE/DELETE privileges

### Migration Commands
- Backup SQLite: `npm run backup`
- Run tests: `npm test`
- Type check: `npm run lint`

### Rollback
Set `DB_ENGINE=sqlite` (or `DB_FALLBACK_TO_SQLITE=true`) and restart.

## License
MIT
