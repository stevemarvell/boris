const $ = (id) => document.getElementById(id);

const els = {
  form: $('add-form'),
  url: $('url'),
  title: $('title'),
  tags: $('tags'),
  search: $('search'),
  unread: $('unread'),
  list: $('links'),
  empty: $('empty'),
  error: $('error'),
};

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = message === '';
}

async function api(path, init) {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`);
  return body;
}

function render(links) {
  els.list.replaceChildren();
  els.empty.hidden = links.length > 0;

  for (const link of links) {
    const li = document.createElement('li');
    li.className = link.read ? 'is-read' : '';
    li.dataset.id = link.id;

    const toggle = document.createElement('button');
    toggle.className = 'icon';
    toggle.type = 'button';
    toggle.dataset.action = 'toggle';
    toggle.title = link.read ? 'Mark unread' : 'Mark read';
    toggle.textContent = link.read ? '✓' : '○';

    const body = document.createElement('div');
    body.className = 'grow';

    const anchor = document.createElement('a');
    anchor.href = link.url;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer noopener';
    anchor.textContent = link.title;

    const meta = document.createElement('span');
    meta.className = 'meta';
    for (const tag of link.tags) {
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.textContent = tag;
      meta.append(chip);
    }
    meta.append(link.url);

    body.append(anchor, meta);

    const remove = document.createElement('button');
    remove.className = 'icon';
    remove.type = 'button';
    remove.dataset.action = 'delete';
    remove.title = 'Delete';
    remove.textContent = '✕';

    li.append(toggle, body, remove);
    els.list.append(li);
  }
}

async function refresh() {
  const params = new URLSearchParams();
  if (els.search.value.trim() !== '') params.set('q', els.search.value.trim());
  if (els.unread.checked) params.set('unread', 'true');
  try {
    const { links } = await api(`/api/links?${params}`);
    render(links);
    showError('');
  } catch (err) {
    showError(err.message);
  }
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tags = els.tags.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  try {
    await api('/api/links', {
      method: 'POST',
      body: JSON.stringify({ url: els.url.value, title: els.title.value, tags }),
    });
    els.form.reset();
    showError('');
    await refresh();
  } catch (err) {
    showError(err.message);
  }
});

els.list.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (button === null) return;
  const li = button.closest('li');
  try {
    if (button.dataset.action === 'delete') {
      await api(`/api/links/${li.dataset.id}`, { method: 'DELETE' });
    } else {
      await api(`/api/links/${li.dataset.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ read: !li.classList.contains('is-read') }),
      });
    }
    await refresh();
  } catch (err) {
    showError(err.message);
  }
});

let debounce;
els.search.addEventListener('input', () => {
  clearTimeout(debounce);
  debounce = setTimeout(refresh, 150);
});
els.unread.addEventListener('change', refresh);

refresh();
