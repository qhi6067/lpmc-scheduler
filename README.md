# LPMC Scheduler

A responsive schedule portal for Las Palmas Medical Center with:

- Public schedule viewing for `Techs` and `Pharmacists`
- Admin-only Excel uploads
- Cleaner online schedule rendering plus Excel download links
- Public PTO request submission without user login
- Admin approval and denial workflow with a PTO history log
- Three visual themes: `Day`, `Night`, and `Midnight`

## Storage

This app is now built for Vercel-hosted durability:

- Excel uploads are stored in `Vercel Blob`
- Schedule metadata, PTO requests, and the admin password hash are stored in `Postgres`
- The latest upload replaces the previous upload for the same schedule type, and the old blob is deleted after a successful swap

For local development, the app also supports a no-cloud fallback:

- If `DATABASE_URL` / `POSTGRES_URL` are not set, it uses `server/data/state.json`
- If `BLOB_READ_WRITE_TOKEN` is not set, uploaded Excel files are stored in `server/data/uploads`

## Environment

Copy `.env.example` to `.env.local` for local development and fill in:

- `DATABASE_URL` or `POSTGRES_URL` for Postgres-backed storage
- `BLOB_READ_WRITE_TOKEN` for Blob-backed uploads
- `SESSION_SECRET`
- Optional `SYSTEM_USERNAME` and `SYSTEM_PASSWORD` overrides for the emergency reset login

Notes:

- `ADMIN_PASSWORD` is only used to seed the first admin password when the database does not have one yet
- After that, password changes happen through the app and are stored as a hash in Postgres
- The built-in emergency login defaults to `system` / `manager` unless you override it with env vars
- Excel uploads larger than about `4.5 MB` should be reduced in size before upload, which matches Vercel's server upload guidance
- When the database or blob token is missing locally, the app falls back to the checked-in `server/data` files instead of failing to boot

## Run locally

```bash
npm install
npm run dev
```

- Frontend: `http://localhost:5173`
- API / production server: `http://localhost:3001`

For a production build:

```bash
npm run build
npm start
```

## Deploy on Vercel

1. Create a Blob store in Vercel Storage so `BLOB_READ_WRITE_TOKEN` is available.
2. Add a Postgres database and copy its connection string into `DATABASE_URL` or `POSTGRES_URL`.
3. Set `SESSION_SECRET` to a long random value.
4. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` if you want something other than the temporary defaults.
5. Redeploy.

For local development with the same cloud resources, `vercel env pull .env.local` is the easiest path.

## Excel format

The parser is built around the current LPMC layout:

- Facility name near the top
- Schedule title such as `Tech Schedule`
- Date range like `4/12/26 - 5/24/26`
- A `Name/Date` header row
- A `Date:` row with day numbers beneath the weekday headers
- Employee names in the first column
