import express from 'express';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const dataFile = join(directory, 'data.json');
const sequenceFile = join(directory, 'data', 'announcement-sequence.json');
const publicDirectory = join(directory, 'public');
const port = Number(process.env.PORT) || 3000;
const app = express();
let mutationQueue = Promise.resolve();
let nextAnnouncementId = 1;

async function readAnnouncements() {
  return JSON.parse(await readFile(dataFile, 'utf8'));
}

async function writeAnnouncements(announcements) {
  const temporaryFile = `${dataFile}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(announcements, null, 2)}\n`, 'utf8');
  await rename(temporaryFile, dataFile);
}

async function writeNextAnnouncementId(nextId) {
  const temporaryFile = `${sequenceFile}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify({ nextId }, null, 2)}\n`, 'utf8');
  await rename(temporaryFile, sequenceFile);
}

async function readNextAnnouncementId(minimumNextId) {
  try {
    const sequence = JSON.parse(await readFile(sequenceFile, 'utf8'));
    if (!Number.isSafeInteger(sequence.nextId) || sequence.nextId < 1) {
      throw new TypeError('data/announcement-sequence.json must contain a positive integer nextId.');
    }
    return Math.max(sequence.nextId, minimumNextId);
  } catch (error) {
    if (error.code === 'ENOENT') return minimumNextId;
    throw error;
  }
}

function normalizeAnnouncementIds(announcements) {
  const usedIds = new Set();
  const needsId = [];
  let nextId = 1;

  for (const announcement of announcements) {
    if (Number.isSafeInteger(announcement.id) && announcement.id > 0 && !usedIds.has(announcement.id)) {
      usedIds.add(announcement.id);
      nextId = Math.max(nextId, announcement.id + 1);
    } else {
      needsId.push(announcement);
    }
  }

  for (const announcement of needsId) {
    while (usedIds.has(nextId)) nextId += 1;
    announcement.id = nextId;
    usedIds.add(nextId);
    nextId += 1;
  }

  return needsId.length > 0;
}

function mutateAnnouncements(mutator) {
  const operation = mutationQueue.then(async () => {
    const announcements = await readAnnouncements();
    const result = await mutator(announcements);
    if (result.write) await writeAnnouncements(announcements);
    return result.value;
  });
  mutationQueue = operation.catch(() => {});
  return operation;
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function withStatus(announcement) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...announcement,
    status: today <= announcement.expiry_date ? 'ACTIVE' : 'EXPIRED',
  };
}

function validateAnnouncement(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return 'Request body must be a JSON object.';
  }
  for (const field of ['title', 'message', 'category']) {
    if (typeof input[field] !== 'string' || input[field].trim() === '') {
      return `\`${field}\` is required and must be a non-empty string.`;
    }
  }
  for (const field of ['date_posted', 'expiry_date']) {
    if (!isValidDate(input[field])) {
      return `\`${field}\` must be a valid date in YYYY-MM-DD format.`;
    }
  }
  if (input.expiry_date < input.date_posted) {
    return '`expiry_date` cannot be earlier than `date_posted`.';
  }
  return null;
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDirectory));

app.get('/api/announcements', async (request, response, next) => {
  try {
    await mutationQueue;
    const announcements = await readAnnouncements();
    response.json(announcements.map(withStatus));
  } catch (error) {
    next(error);
  }
});

app.get('/api/announcements/:id', async (request, response, next) => {
  try {
    await mutationQueue;
    const announcement = (await readAnnouncements()).find((item) => String(item.id) === request.params.id);
    if (!announcement) return response.status(404).json({ error: 'Announcement not found.' });
    return response.json(withStatus(announcement));
  } catch (error) {
    return next(error);
  }
});

app.post('/api/announcements', async (request, response, next) => {
  const validationError = validateAnnouncement(request.body);
  if (validationError) return response.status(400).json({ error: validationError });

  try {
    const created = await mutateAnnouncements(async (announcements) => {
      const id = nextAnnouncementId;
      await writeNextAnnouncementId(id + 1);
      nextAnnouncementId = id + 1;
      const announcement = {
        id,
        title: request.body.title.trim(),
        message: request.body.message.trim(),
        date_posted: request.body.date_posted,
        expiry_date: request.body.expiry_date,
        category: request.body.category.trim(),
      };
      announcements.push(announcement);
      return { write: true, value: announcement };
    });
    return response.status(201).json(withStatus(created));
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/announcements/:id', async (request, response, next) => {
  try {
    const deleted = await mutateAnnouncements((announcements) => {
      const index = announcements.findIndex((item) => String(item.id) === request.params.id);
      if (index === -1) return { write: false, value: false };
      announcements.splice(index, 1);
      return { write: true, value: true };
    });
    if (!deleted) return response.status(404).json({ error: 'Announcement not found.' });
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.use('/api/announcements', (request, response) => {
  response.status(404).json({ error: 'Route not found.' });
});

app.use((error, request, response, next) => {
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: 'Request body must be valid JSON.' });
  }
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: 'Request body is too large.' });
  }
  console.error(error);
  return response.status(500).json({ error: 'Internal server error.' });
});

await mkdir(join(directory, 'data'), { recursive: true });
let announcements;
try {
  announcements = await readAnnouncements();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  announcements = [];
  await writeAnnouncements(announcements);
}
if (!Array.isArray(announcements)) throw new TypeError('data.json must contain an array of announcements.');
if (normalizeAnnouncementIds(announcements)) await writeAnnouncements(announcements);
const minimumNextId = announcements.reduce((highest, item) => Math.max(highest, item.id), 0) + 1;
nextAnnouncementId = await readNextAnnouncementId(minimumNextId);
await writeNextAnnouncementId(nextAnnouncementId);

app.listen(port, () => {
  console.log(`Announcements app listening on http://localhost:${port}`);
});
