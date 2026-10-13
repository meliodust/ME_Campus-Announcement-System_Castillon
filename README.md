# Announcements API

A persistent announcements REST API built with Node.js and Express (Node.js 18 or newer). The API reads and writes records in the root `data.json` file.

The app includes a minimalist web interface at the server's root URL. Use it to browse and filter announcements, search by ID, publish a new announcement, or delete an existing one.

## Run

```sh
npm install
npm start
```

The app (frontend and API) listens on port `3000` by default. Open `http://localhost:3000` in a browser. Set the `PORT` environment variable to use another port.

## Endpoints

- `GET /api/announcements` — returns all announcements as an array.
- `GET /api/announcements/:id` — returns one announcement, or `404` if it does not exist.
- `POST /api/announcements` — validates and creates an announcement; returns `201` and the created record.
- `DELETE /api/announcements/:id` — deletes an announcement and returns `204`, or `404` if it does not exist.

Only insert, retrieve, and delete are implemented; there are no update, PUT, or PATCH routes.

Dates must be valid `YYYY-MM-DD` values. The POST body requires `title`, `message`, `date_posted`, `expiry_date`, and `category`; `id` is generated as an integer by the API and shown on the announcement card and in the publish confirmation. Existing non-integer IDs in `data.json` are migrated to integers when the server starts. A separate `data/announcement-sequence.json` counter ensures IDs keep increasing after a record is deleted or the server restarts. A request with `expiry_date` earlier than `date_posted` receives `400 Bad Request`. Every returned record includes a computed `status`: `ACTIVE` through and including its expiry date, otherwise `EXPIRED`.

Example POST body:

```json
{
  "title": "Campus update",
  "message": "The library will close early on Friday.",
  "date_posted": "2026-10-13",
  "expiry_date": "2026-10-20",
  "category": "Facilities"
}
```

Run `npm test` for the API integration suite. It covers successful CRUD operations plus twelve error cases, including missing/blank fields, invalid dates, malformed/oversized JSON, unknown IDs and routes, and unsupported update methods.
