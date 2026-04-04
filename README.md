# LPMC Scheduler

A responsive schedule portal for Las Palmas Medical Center with:

- Public schedule viewing for `Techs` and `Pharmacists`
- Admin-only Excel uploads with temporary credentials `admin` / `admin`
- Cleaner online schedule rendering plus Excel download links
- Public PTO request submission without user login
- Admin approval and denial workflow with a PTO history log
- Three visual themes: `Day`, `Night`, and `Midnight`

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

## Excel format

The parser is built around the current LPMC layout:

- Facility name near the top
- Schedule title such as `Tech Schedule`
- Date range like `4/12/26 - 5/24/26`
- A `Name/Date` header row
- A `Date:` row with day numbers beneath the weekday headers
- Employee names in the first column

## Data storage

Uploaded files and PTO history are stored locally in `server/data/`.
