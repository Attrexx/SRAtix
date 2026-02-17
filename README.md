# SRAtix

Event ticketing & registration platform for the Swiss Robotics Association.

## Current Phase: Hosting Capability Tester

This repo currently contains a diagnostic tool that probes the hosting environment to verify support for the features SRAtix Server requires (WebSockets, SSE, file I/O, worker threads, outbound HTTPS, Redis, PostgreSQL, Chromium, etc.).

Once testing is complete, this will be replaced with the production SRAtix Server application.

### Running locally

```bash
npm install
npm start
```

Open `http://localhost:3000` to view the capability dashboard.

### Environment Variables (optional)

- `PORT` — HTTP port (default: 3000)
- `DATABASE_URL` — PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/db`)
- `REDIS_URL` — Redis connection string (e.g. `redis://localhost:6379`)
