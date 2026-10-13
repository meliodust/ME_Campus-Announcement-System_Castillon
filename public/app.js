const form = document.querySelector('#announcement-form');
const list = document.querySelector('#announcement-list');
const statusFilter = document.querySelector('#status-filter');
const searchForm = document.querySelector('#id-search-form');
const searchInput = document.querySelector('#id-search-input');
const clearSearchButton = document.querySelector('#clear-search');
const activeCount = document.querySelector('#active-count');
const feedback = document.querySelector('#message');
const submitButton = document.querySelector('#submit-button');
const datePosted = document.querySelector('#date-posted');
const expiryDate = document.querySelector('#expiry-date');
let announcements = [];
let searchMode = false;
let searchedAnnouncement = null;

const today = new Date();
const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60_000)
  .toISOString()
  .slice(0, 10);
datePosted.value = localToday;
expiryDate.value = localToday;

function showFeedback(text, type) {
  feedback.textContent = text;
  feedback.className = `message visible ${type}`;
}

function clearFeedback() {
  feedback.textContent = '';
  feedback.className = 'message';
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Something went wrong.');
  return body;
}

function createEmptyState(title, description) {
  const state = document.createElement('div');
  state.className = 'empty-state';
  const icon = document.createElement('span');
  icon.className = 'empty-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '✳';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const copy = document.createElement('p');
  copy.textContent = description;
  state.append(icon, heading, copy);
  return state;
}

function createAnnouncementCard(announcement) {
  const card = document.createElement('article');
  card.className = 'announcement-card';

  const accent = document.createElement('span');
  accent.className = 'card-accent';
  accent.setAttribute('aria-hidden', 'true');

  const content = document.createElement('div');
  content.className = 'card-content';
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const category = document.createElement('span');
  category.className = 'category';
  category.textContent = announcement.category;
  const separator = document.createElement('span');
  separator.className = 'meta-separator';
  separator.textContent = '·';
  const announcementId = document.createElement('span');
  announcementId.className = 'announcement-id';
  announcementId.textContent = `ID ${announcement.id}`;
  const secondSeparator = document.createElement('span');
  secondSeparator.className = 'meta-separator';
  secondSeparator.textContent = '·';
  const posted = document.createElement('span');
  posted.textContent = formatDate(announcement.date_posted);
  const status = document.createElement('span');
  status.className = `status status-${announcement.status.toLowerCase()}`;
  status.textContent = announcement.status;
  meta.append(category, separator, announcementId, secondSeparator, posted, status);

  const title = document.createElement('h3');
  title.className = 'card-title';
  title.textContent = announcement.title;
  const message = document.createElement('p');
  message.className = 'card-message';
  message.textContent = announcement.message;

  const bottom = document.createElement('div');
  bottom.className = 'card-bottom';
  const expiry = document.createElement('span');
  expiry.textContent = `Expires ${formatDate(announcement.expiry_date)}`;
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'delete-button';
  deleteButton.textContent = 'Delete';
  deleteButton.setAttribute('aria-label', `Delete ${announcement.title}`);
  deleteButton.addEventListener('click', () => deleteAnnouncement(announcement));
  bottom.append(expiry, deleteButton);

  content.append(meta, title, message, bottom);
  card.append(accent, content);
  return card;
}

function renderAnnouncements() {
  list.replaceChildren();
  const active = announcements.filter((item) => item.status === 'ACTIVE').length;
  activeCount.textContent = `${active} active ${active === 1 ? 'announcement' : 'announcements'}`;

  const filter = statusFilter.value;
  const visible = searchMode
    ? (searchedAnnouncement ? [searchedAnnouncement] : [])
    : announcements
      .filter((item) => filter === 'all' || item.status === filter)
      .sort((a, b) => b.date_posted.localeCompare(a.date_posted));

  if (visible.length === 0) {
    if (searchMode) {
      list.append(createEmptyState('No announcement found', 'Check the ID and try searching again.'));
      return;
    }
    const isFiltered = filter !== 'all' && announcements.length > 0;
    list.append(createEmptyState(
      isFiltered ? `No ${filter.toLowerCase()} announcements` : 'It’s quiet for now',
      isFiltered ? 'Try another status filter.' : 'New announcements will show up here.',
    ));
    return;
  }
  list.append(...visible.map(createAnnouncementCard));
}

async function loadAnnouncements() {
  try {
    announcements = await request('/api/announcements');
    renderAnnouncements();
  } catch (error) {
    activeCount.textContent = 'Unable to load';
    showFeedback(error.message, 'error');
  }
}

async function deleteAnnouncement(announcement) {
  if (!window.confirm(`Delete “${announcement.title}”?`)) return;
  clearFeedback();
  try {
    await request(`/api/announcements/${encodeURIComponent(announcement.id)}`, { method: 'DELETE' });
    announcements = announcements.filter((item) => item.id !== announcement.id);
    if (searchMode) searchedAnnouncement = null;
    renderAnnouncements();
    showFeedback('Announcement deleted.', 'success');
  } catch (error) {
    showFeedback(error.message, 'error');
  }
}

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = searchInput.value.trim();
  if (!id) {
    showFeedback('Enter an announcement ID to search.', 'error');
    searchInput.focus();
    return;
  }

  clearFeedback();
  searchMode = true;
  searchedAnnouncement = null;
  clearSearchButton.hidden = false;
  renderAnnouncements();
  try {
    searchedAnnouncement = await request(`/api/announcements/${encodeURIComponent(id)}`);
    renderAnnouncements();
  } catch (error) {
    renderAnnouncements();
    showFeedback(error.message, 'error');
  }
});

clearSearchButton.addEventListener('click', () => {
  searchMode = false;
  searchedAnnouncement = null;
  searchInput.value = '';
  clearSearchButton.hidden = true;
  clearFeedback();
  renderAnnouncements();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFeedback();
  if (expiryDate.value < datePosted.value) {
    showFeedback('Expiry date cannot be earlier than the posting date.', 'error');
    expiryDate.focus();
    return;
  }

  const data = new FormData(form);
  const announcement = Object.fromEntries(data.entries());
  submitButton.disabled = true;
  try {
    const created = await request('/api/announcements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(announcement),
    });
    form.reset();
    datePosted.value = localToday;
    expiryDate.value = localToday;
    searchMode = false;
    searchedAnnouncement = null;
    searchInput.value = '';
    clearSearchButton.hidden = true;
    await loadAnnouncements();
    showFeedback(`Announcement published. ID: ${created.id}`, 'success');
  } catch (error) {
    showFeedback(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
});

statusFilter.addEventListener('change', renderAnnouncements);
loadAnnouncements();
