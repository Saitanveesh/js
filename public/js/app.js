(() => {
  const state = { isAdmin: false, publicListings: [], adminListings: [] };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

  async function api(url, options = {}) {
    const response = await fetch(url, options);
    let result = {};
    try { result = await response.json(); } catch { result = {}; }
    if (!response.ok) throw new Error(result.message || `Request failed (${response.status}).`);
    return result;
  }

  function toast(message, type = '') {
    const node = $('#toast');
    node.textContent = message;
    node.className = `toast ${type}`;
    node.classList.remove('hidden');
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => node.classList.add('hidden'), 3500);
  }

  function showPage(page) {
    $$('.page').forEach((node) => node.classList.remove('active'));
    $(`#${page}-page`)?.classList.add('active');
    if (page === 'admin' && !state.isAdmin) {
      $('#login-dialog').showModal();
      $('#home-page').classList.add('active');
      return;
    }
    if (page === 'browse') renderBrowse();
    if (page === 'admin') loadAdminListings();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateStats() {
    const listings = state.publicListings;
    $('#total-listings').textContent = listings.length;
    $('#total-books').textContent = listings.filter((item) => item.type === 'BOOK').length;
    $('#total-notes').textContent = listings.filter((item) => item.type === 'NOTES').length;
  }

  function card(item, admin = false) {
    const tags = (item.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
    const actions = admin
      ? `<div class="card-actions"><button data-action="toggle" data-id="${escapeHtml(item.id)}" data-status="${escapeHtml(item.status)}">${item.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}</button><button data-action="delete" data-id="${escapeHtml(item.id)}">Delete</button></div>`
      : `<div class="card-actions"><button data-action="view" data-id="${escapeHtml(item.id)}">View details</button></div>`;
    return `<article class="card"><span class="pill">${escapeHtml(item.type)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><div class="meta"><span>${escapeHtml(item.author_subject)}</span><span>•</span><span>${escapeHtml(item.location)}</span><span>•</span><span>${escapeHtml(item.condition)}</span>${admin ? `<span>•</span><strong>${escapeHtml(item.status)}</strong>` : ''}</div><div class="tags">${tags}</div>${actions}</article>`;
  }

  function renderBrowse() {
    const query = $('#search-input').value.trim().toLowerCase();
    const type = $('#type-filter').value;
    const condition = $('#condition-filter').value;
    const listings = state.publicListings.filter((item) => {
      if (type && item.type !== type) return false;
      if (condition && item.condition !== condition) return false;
      const haystack = [item.title, item.author_subject, item.description, item.location, ...(item.tags || [])].join(' ').toLowerCase();
      return !query || haystack.includes(query);
    });
    $('#listing-grid').innerHTML = listings.map((item) => card(item)).join('');
    $('#empty-state').classList.toggle('hidden', listings.length > 0);
  }

  function renderAdmin() {
    $('#admin-grid').innerHTML = state.adminListings.map((item) => card(item, true)).join('') || '<p class="empty">No listings.</p>';
  }

  async function loadPublicListings() {
    try {
      const result = await api('/api/resources');
      state.publicListings = result.resources || [];
      updateStats();
      renderBrowse();
    } catch (error) {
      state.publicListings = [];
      updateStats();
      renderBrowse();
      toast(error.message, 'error');
    }
  }

  async function loadAdminListings() {
    if (!state.isAdmin) return;
    try {
      const result = await api('/api/resources?all=1');
      state.adminListings = result.resources || [];
      renderAdmin();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function findListing(id) {
    return [...state.publicListings, ...state.adminListings].find((item) => item.id === id);
  }

  function openListing(id) {
    const item = findListing(id);
    if (!item) return;
    const images = (item.images || []).map((src) => `<img class="detail-image" src="${escapeHtml(src)}" alt="${escapeHtml(item.title)}">`).join('');
    $('#listing-detail').innerHTML = `<span class="pill">${escapeHtml(item.type)}</span><h2>${escapeHtml(item.title)}</h2><p class="meta">${escapeHtml(item.author_subject)} · ${escapeHtml(item.location)} · ${escapeHtml(item.condition)}</p>${images}<p>${escapeHtml(item.description)}</p><button class="primary" data-contact="${escapeHtml(item.id)}">Contact owner</button>`;
    $('#listing-dialog').showModal();
  }

  async function submitListing(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    try {
      await api('/api/resources', { method: 'POST', body: new FormData(form) });
      form.reset();
      await loadPublicListings();
      showPage('browse');
      toast('Resource submitted for admin review.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function lookupIsbn() {
    const isbn = $('#isbn').value.trim();
    if (!isbn) return toast('Enter an ISBN first.', 'error');
    try {
      const result = await api(`/api/isbn/${encodeURIComponent(isbn)}`);
      $('#title').value = result.book.title || '';
      $('#author_subject').value = (result.book.authors || []).join(', ');
      $('#description').value = result.book.description || '';
      toast('Book details added.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function login(event) {
    event.preventDefault();
    try {
      await api('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))
      });
      state.isAdmin = true;
      $('#login-dialog').close();
      showPage('admin');
      toast('Logged in.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function logout() {
    try { await api('/admin/logout', { method: 'POST' }); } catch {}
    state.isAdmin = false;
    state.adminListings = [];
    showPage('home');
    toast('Logged out.');
  }

  async function sendRequest(event) {
    event.preventDefault();
    try {
      await api('/api/send-request-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))
      });
      $('#contact-dialog').close();
      event.currentTarget.reset();
      toast('Request sent.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function updateStatus(id, currentStatus) {
    const nextStatus = currentStatus === 'PUBLISHED' ? 'PENDING' : 'PUBLISHED';
    try {
      await api(`/api/admin/resources/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      await Promise.all([loadAdminListings(), loadPublicListings()]);
      toast(`Listing ${nextStatus === 'PUBLISHED' ? 'published' : 'unpublished'}.`, 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function deleteListing(id) {
    if (!window.confirm('Delete this listing and its images?')) return;
    try {
      await api(`/api/admin/resources/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await Promise.all([loadAdminListings(), loadPublicListings()]);
      toast('Listing deleted.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  document.addEventListener('click', (event) => {
    const page = event.target.closest('[data-page]')?.dataset.page;
    if (page) showPage(page);

    const actionNode = event.target.closest('[data-action]');
    if (actionNode?.dataset.action === 'view') openListing(actionNode.dataset.id);
    if (actionNode?.dataset.action === 'toggle') updateStatus(actionNode.dataset.id, actionNode.dataset.status);
    if (actionNode?.dataset.action === 'delete') deleteListing(actionNode.dataset.id);

    const contactId = event.target.closest('[data-contact]')?.dataset.contact;
    if (contactId) {
      const item = findListing(contactId);
      if (!item) return;
      $('#listing-dialog').close();
      const form = $('#request-form');
      form.elements.listing_id.value = item.id;
      form.elements.message.value = `Hi, I am interested in "${item.title}".`;
      $('#contact-dialog').showModal();
    }

    if (event.target.matches('[data-close]')) event.target.closest('dialog')?.close();
  });

  $('#search-input').addEventListener('input', renderBrowse);
  $('#type-filter').addEventListener('change', renderBrowse);
  $('#condition-filter').addEventListener('change', renderBrowse);
  $('#listing-form').addEventListener('submit', submitListing);
  $('#isbn-button').addEventListener('click', lookupIsbn);
  $('#login-form').addEventListener('submit', login);
  $('#request-form').addEventListener('submit', sendRequest);
  $('#admin-button').addEventListener('click', () => state.isAdmin ? showPage('admin') : $('#login-dialog').showModal());
  $('#logout-button').addEventListener('click', logout);

  async function init() {
    try {
      const status = await api('/api/admin/status');
      state.isAdmin = Boolean(status.isAdmin);
    } catch {
      state.isAdmin = false;
    }
    await loadPublicListings();
  }

  init();
})();
