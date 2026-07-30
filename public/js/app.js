(() => {
  const key = 'swapshelf_listings_v2';
  const state = { isAdmin: Boolean(window.SWAPSHELF_ADMIN) };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const uid = () => `listing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  function seed() {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify([
      { id: uid(), type: 'BOOK', title: 'Introduction to Algorithms', author_subject: 'Cormen, Leiserson, Rivest and Stein', description: 'A used algorithms textbook in good condition.', condition: 'Good', location: 'Bengaluru', owner_email: 'student@example.com', tags: ['Algorithms', 'CSE'], images: [], status: 'PUBLISHED', featured: true, created_at: new Date().toISOString() },
      { id: uid(), type: 'NOTES', title: 'Signals and Systems Notes', author_subject: 'ECE, Semester 4', description: 'Organised handwritten notes covering transforms and LTI systems.', condition: 'Excellent', location: 'Bengaluru', owner_email: 'notes@example.com', tags: ['ECE', 'Signals'], images: [], status: 'PUBLISHED', featured: false, created_at: new Date().toISOString() }
    ]));
  }

  function getListings() {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }
  function saveListings(listings) {
    localStorage.setItem(key, JSON.stringify(listings));
    renderAll();
  }
  function findListing(id) { return getListings().find((item) => item.id === id); }

  function toast(message, type = '') {
    const node = $('#toast');
    node.textContent = message;
    node.className = `toast ${type}`;
    setTimeout(() => node.classList.add('hidden'), 3500);
  }

  function showPage(page) {
    $$('.page').forEach((node) => node.classList.remove('active'));
    $(`#${page}-page`)?.classList.add('active');
    if (page === 'admin' && !state.isAdmin) {
      $('#login-dialog').showModal();
      showPage('home');
      return;
    }
    if (page === 'browse') renderBrowse();
    if (page === 'admin') renderAdmin();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateStats() {
    const listings = getListings().filter((item) => item.status === 'PUBLISHED');
    $('#total-listings').textContent = listings.length;
    $('#total-books').textContent = listings.filter((item) => item.type === 'BOOK').length;
    $('#total-notes').textContent = listings.filter((item) => item.type === 'NOTES').length;
  }

  function card(item, admin = false) {
    const tags = (item.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
    const actions = admin
      ? `<div class="card-actions"><button data-action="toggle" data-id="${item.id}">${item.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}</button><button data-action="delete" data-id="${item.id}">Delete</button></div>`
      : `<div class="card-actions"><button data-action="view" data-id="${item.id}">View details</button></div>`;
    return `<article class="card"><span class="pill">${escapeHtml(item.type)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><div class="meta"><span>${escapeHtml(item.author_subject)}</span><span>•</span><span>${escapeHtml(item.location)}</span><span>•</span><span>${escapeHtml(item.condition)}</span></div><div class="tags">${tags}</div>${actions}</article>`;
  }

  function renderBrowse() {
    const query = $('#search-input').value.trim().toLowerCase();
    const type = $('#type-filter').value;
    const condition = $('#condition-filter').value;
    const listings = getListings().filter((item) => {
      if (item.status !== 'PUBLISHED') return false;
      if (type && item.type !== type) return false;
      if (condition && item.condition !== condition) return false;
      const haystack = [item.title, item.author_subject, item.description, item.location, ...(item.tags || [])].join(' ').toLowerCase();
      return !query || haystack.includes(query);
    });
    $('#listing-grid').innerHTML = listings.map((item) => card(item)).join('');
    $('#empty-state').classList.toggle('hidden', listings.length > 0);
  }

  function renderAdmin() {
    $('#admin-grid').innerHTML = getListings().map((item) => card(item, true)).join('') || '<p class="empty">No listings.</p>';
  }

  function renderAll() { updateStats(); renderBrowse(); if (state.isAdmin) renderAdmin(); }

  function openListing(id) {
    const item = findListing(id);
    if (!item) return;
    const images = (item.images || []).map((src) => `<img class="detail-image" src="${escapeHtml(src)}" alt="${escapeHtml(item.title)}">`).join('');
    $('#listing-detail').innerHTML = `<span class="pill">${escapeHtml(item.type)}</span><h2>${escapeHtml(item.title)}</h2><p class="meta">${escapeHtml(item.author_subject)} · ${escapeHtml(item.location)} · ${escapeHtml(item.condition)}</p>${images}<p>${escapeHtml(item.description)}</p><button class="primary" data-contact="${item.id}">Contact owner</button>`;
    $('#listing-dialog').showModal();
  }

  async function submitListing(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    try {
      const response = await fetch('/api/resources', { method: 'POST', body: new FormData(form) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Submission failed.');
      const listings = getListings();
      const resource = result.resource;
      resource.id ||= uid();
      resource.status = 'PENDING';
      listings.push(resource);
      saveListings(listings);
      form.reset();
      showPage('browse');
      toast('Resource submitted for admin review.', 'success');
    } catch (error) {
      toast(error.message, 'error');
    } finally { button.disabled = false; }
  }

  async function lookupIsbn() {
    const isbn = $('#isbn').value.trim();
    if (!isbn) return toast('Enter an ISBN first.', 'error');
    try {
      const response = await fetch(`/api/isbn/${encodeURIComponent(isbn)}`);
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Book not found.');
      $('#title').value = result.book.title;
      $('#author_subject').value = (result.book.authors || []).join(', ');
      $('#description').value = result.book.description || '';
      toast('Book details added.', 'success');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function login(event) {
    event.preventDefault();
    const response = await fetch('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    const result = await response.json();
    if (!response.ok) return toast(result.message || 'Login failed.', 'error');
    state.isAdmin = true;
    $('#login-dialog').close();
    showPage('admin');
    toast('Logged in.', 'success');
  }

  async function logout() {
    await fetch('/admin/logout', { method: 'POST' });
    state.isAdmin = false;
    showPage('home');
    toast('Logged out.');
  }

  async function sendRequest(event) {
    event.preventDefault();
    const response = await fetch('/api/send-request-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    const result = await response.json();
    if (!response.ok) return toast(result.message || 'Request could not be sent.', 'error');
    $('#contact-dialog').close();
    event.currentTarget.reset();
    toast('Request sent.', 'success');
  }

  document.addEventListener('click', (event) => {
    const page = event.target.closest('[data-page]')?.dataset.page;
    if (page) showPage(page);
    const actionNode = event.target.closest('[data-action]');
    if (actionNode?.dataset.action === 'view') openListing(actionNode.dataset.id);
    if (actionNode?.dataset.action === 'toggle') {
      const listings = getListings();
      const item = listings.find((entry) => entry.id === actionNode.dataset.id);
      if (item) item.status = item.status === 'PUBLISHED' ? 'PENDING' : 'PUBLISHED';
      saveListings(listings);
    }
    if (actionNode?.dataset.action === 'delete') saveListings(getListings().filter((entry) => entry.id !== actionNode.dataset.id));
    const contactId = event.target.closest('[data-contact]')?.dataset.contact;
    if (contactId) {
      const item = findListing(contactId);
      $('#listing-dialog').close();
      const form = $('#request-form');
      form.owner_email.value = item.owner_email;
      form.resource_title.value = item.title;
      form.message.value = `Hi, I am interested in "${item.title}".`;
      $('#contact-dialog').showModal();
    }
    if (event.target.matches('[data-close]')) event.target.closest('dialog').close();
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

  seed();
  renderAll();
})();
