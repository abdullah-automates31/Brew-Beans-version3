  const STATUS_FLOW  = { placed: 'preparing', preparing: 'out_for_delivery', out_for_delivery: 'delivered' };
  const STATUS_LABEL = { placed: 'Placed', preparing: 'Preparing', out_for_delivery: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled' };
  const NEXT_LABEL   = { placed: 'Mark Preparing', preparing: 'Mark Out for Delivery', out_for_delivery: 'Mark Delivered' };

  let allOrders    = [];
  let knownIds     = new Set();
  let isFirstLoad  = true;
  let currentFilter = 'active';
  let searchQuery  = '';
  let pollTimer    = null;
  let activeModalOrder = null;

  let dateFrom           = '';
  let dateTo             = '';
  let paymentMethodFilter = '';
  let paymentStatusFilter = '';
  let bulkSelectMode     = false;
  let selectedOrderIds   = new Set();
  let revenueChartInstance = null;

  // ── AUTH CHECK ──
  Promise.race([
    supabaseClient.auth.getSession(),
    new Promise(resolve => setTimeout(() => resolve({ data: { session: null }, _timeout: true }), 8000))
  ]).then(({ data, _timeout }) => {
    if (_timeout || !data.session) {
      setTimeout(() => { window.location.href = 'admin.html'; }, 500);
      return;
    }
    const email = data.session.user.email;
    document.getElementById('userEmail').textContent = email;
    document.getElementById('userAvatar').textContent = email[0].toUpperCase();
    init();
  }).catch(() => {
    setTimeout(() => { window.location.href = 'admin.html'; }, 500);
  });

  async function init() {
    document.getElementById('sidebarLogo')?.addEventListener('error', function () { this.style.display = 'none'; });
    checkShopStatus();
    await loadOrders();
    pollTimer = setInterval(loadOrders, 15000);
    document.getElementById('searchInput').addEventListener('input', e => {
      searchQuery = e.target.value.toLowerCase();
      renderOrders();
    });
    document.getElementById('menuSearchInput')?.addEventListener('input', () => renderMenuGrid());
    if (Notification.permission === 'default') Notification.requestPermission();
  }

  // ── SHOP STATUS ──
  async function checkShopStatus() {
    const { data } = await supabaseClient.from('business_hours').select('*').order('day_of_week');
    if (!data) return;
    const hours = data;
    const now = getShopNow();
    const day = now.getDay();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    // Still inside yesterday's overnight window (close time past midnight)?
    const prevHours = hours.find(h => h.day_of_week === (day + 6) % 7);
    if (prevHours && !prevHours.is_closed) {
        const [poh, pom] = prevHours.open_time.split(':').map(Number);
        const [pch, pcm] = prevHours.close_time.split(':').map(Number);
        const pOpenMins  = poh * 60 + pom;
        const pCloseMins = pch * 60 + pcm;
        if (pCloseMins < pOpenMins && nowMins < pCloseMins) { setShopStatus(true); return; }
    }

    const todayHours = hours.find(h => h.day_of_week === day);
    if (!todayHours || todayHours.is_closed) { setShopStatus(false); return; }
    const [oh, om] = todayHours.open_time.split(':').map(Number);
    const [ch, cm] = todayHours.close_time.split(':').map(Number);
    const openMins = oh * 60 + om;
    let closeMins = ch * 60 + cm;
    if (closeMins < openMins) closeMins += 24 * 60;
    setShopStatus(nowMins >= openMins && nowMins < closeMins);
  }

  function setShopStatus(isOpen) {
    const el = document.getElementById('shopStatus');
    el.className = 'shop-status ' + (isOpen ? 'open' : 'closed');
    document.getElementById('shopStatusText').textContent = isOpen ? 'Open' : 'Closed';
  }

  // ── LOAD ORDERS ──
  async function loadOrders() {
    const list = document.getElementById('ordersList');

    const [ordersRes, itemsRes] = await Promise.all([
      supabaseClient.from('orders').select('*').order('created_at', { ascending: false }),
      supabaseClient.from('order_items').select('*')
    ]);

    if (ordersRes.error) {
      const msg = ordersRes.error.message || JSON.stringify(ordersRes.error);
      list.innerHTML = `<div class="empty-state"><i class="bi bi-exclamation-triangle"></i><p>Could not load orders.<br><small style="color:var(--text-light)">${msg}</small></p></div>`;
      return;
    }

    const orders = ordersRes.data || [];
    const items  = itemsRes.data  || [];

    const fresh = orders.map(o => ({
      ...o,
      order_items: items.filter(i => i.order_id === o.id)
    }));

    if (!isFirstLoad) {
      const newOrders = fresh.filter(o => !knownIds.has(o.id));
      newOrders.forEach(o => notifyNewOrder(o));

      fresh.forEach(freshOrder => {
        const old = allOrders.find(o => o.id === freshOrder.id);
        if (old && old.status !== freshOrder.status) {
          notifyStatusChange(freshOrder, old.status, freshOrder.status);
        }
      });
    }

    knownIds = new Set(fresh.map(o => o.id));
    allOrders = fresh;
    isFirstLoad = false;

    updateStats();
    renderOrders();
  }

  // ── NEW ORDER NOTIFICATION ──
  function notifyNewOrder(order) {
    beep();
    showToast(`New order from ${order.customer_name}!`, 'success');
    if (Notification.permission === 'granted') {
      new Notification('New Order — Brew Beans', {
        body: `#${order.order_number} from ${order.customer_name}`,
        icon: 'img/favicon-192.png'
      });
    }
  }

  function notifyStatusChange(order, oldStatus, newStatus) {
    if (newStatus === 'cancelled') {
      beep();
      showToast(`Order #${order.order_number} was cancelled!`, 'error');
      if (Notification.permission === 'granted') {
        new Notification('Order Cancelled — Brew Beans', {
          body: `#${order.order_number} by ${order.customer_name} was cancelled`,
          icon: 'img/favicon-192.png'
        });
      }
    }
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [880, 1100].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.3);
      });
    } catch(e) {}
  }

  // ── STATS ──
  function updateStats() {
    const today = new Date().toDateString();
    const active = allOrders.filter(o => !['delivered','cancelled'].includes(o.status));
    const deliveredToday = allOrders.filter(o => o.status === 'delivered' && new Date(o.created_at).toDateString() === today);
    const revenueToday = deliveredToday.reduce((s, o) => s + Number(o.total), 0);

    document.getElementById('statActive').textContent = active.length;
    document.getElementById('statDelivered').textContent = deliveredToday.length;
    document.getElementById('statRevenue').textContent = 'Rs.' + revenueToday.toLocaleString();
    document.getElementById('statTotal').textContent = allOrders.length;

    const badge = document.getElementById('newOrdersBadge');
    if (active.length > 0) { badge.textContent = active.length; badge.classList.add('show'); }
    else badge.classList.remove('show');
  }

  // ── RENDER ORDERS ──
  function renderOrders() {
    const list = document.getElementById('ordersList');
    let filtered = allOrders;

    if (currentFilter === 'active')    filtered = allOrders.filter(o => !['delivered','cancelled'].includes(o.status));
    if (currentFilter === 'delivered') filtered = allOrders.filter(o => o.status === 'delivered');
    if (currentFilter === 'cancelled') filtered = allOrders.filter(o => o.status === 'cancelled');

    if (searchQuery) {
      filtered = filtered.filter(o =>
        o.order_number?.toLowerCase().includes(searchQuery) ||
        o.customer_name?.toLowerCase().includes(searchQuery) ||
        o.phone?.toLowerCase().includes(searchQuery) ||
        o.email?.toLowerCase().includes(searchQuery)
      );
    }

    if (dateFrom) {
      filtered = filtered.filter(o => o.created_at.split('T')[0] >= dateFrom);
    }
    if (dateTo) {
      filtered = filtered.filter(o => o.created_at.split('T')[0] <= dateTo);
    }
    if (paymentMethodFilter) {
      filtered = filtered.filter(o => o.payment_method === paymentMethodFilter);
    }
    if (paymentStatusFilter) {
      filtered = filtered.filter(o => o.payment_status === paymentStatusFilter);
    }

    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state"><i class="bi bi-inbox"></i><p>No orders found</p></div>`;
      return;
    }

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;

    list.innerHTML = filtered.map(o => {
      const isNew = new Date(o.created_at).getTime() > fiveMinAgo && o.status === 'placed';
      const items = (o.order_items || []).map(i => `${i.quantity}x ${escHtml(i.menu_item_name)}`).join(', ');
      const nextStatus = STATUS_FLOW[o.status];
      const payClass = o.payment_method === 'cod' ? 'payment-cod' : (o.payment_status === 'paid' ? 'payment-paid' : 'payment-pending');
      const payLabel = o.payment_method === 'cod' ? 'COD' : (o.payment_method || '').toUpperCase();
      const isSelected = selectedOrderIds.has(o.order_number);

      return `
      <div class="order-card${isNew ? ' is-new' : ''}${bulkSelectMode ? ' selectable' : ''}${isSelected ? ' selected-order' : ''}" data-order-id="${o.id}" data-order-number="${o.order_number}" style="cursor:pointer">
        <div class="order-top">
          <div style="display:flex;align-items:center;gap:0.6rem">
            <div class="order-select-cb">
              <input type="checkbox" data-action="bulk-select" data-order-number="${o.order_number}" ${isSelected ? 'checked' : ''}>
            </div>
            <div>
              <div class="order-number">
                #${escHtml(o.order_number)}
                ${isNew ? '<span class="new-order-badge" style="margin-left:0.4rem">NEW</span>' : ''}
              </div>
              <div class="order-time">${new Date(o.created_at).toLocaleString()}</div>
            </div>
          </div>
          <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">
            <span class="status-badge status-${o.status}">${STATUS_LABEL[o.status] || o.status}</span>
            <span class="payment-badge ${payClass}">${payLabel}</span>
          </div>
        </div>

        <div class="order-customer">
          <div class="customer-field"><i class="bi bi-person"></i>${escHtml(o.customer_name)}</div>
          <div class="customer-field"><i class="bi bi-telephone"></i>${escHtml(o.phone)}</div>
          ${o.email ? `<div class="customer-field"><i class="bi bi-envelope"></i>${escHtml(o.email)}</div>` : ''}
          ${o.address ? `<div class="customer-field"><i class="bi bi-geo-alt"></i>${escHtml(o.address)}</div>` : ''}
        </div>

        ${items ? `<div class="order-items-list"><i class="bi bi-bag" style="margin-right:0.4rem"></i>${items}</div>` : ''}
        ${o.notes ? `<div class="order-items-list" style="background:#FFFBEB"><i class="bi bi-sticky" style="margin-right:0.4rem;color:#D97706"></i>${escHtml(o.notes)}</div>` : ''}

        <div class="order-footer">
          <div class="order-total">Rs. ${Number(o.total).toLocaleString()}
            ${o.delivery_charge > 0 ? `<span style="font-size:0.75rem;color:var(--text-light);font-weight:400"> (Delivery: Rs.${Number(o.delivery_charge).toLocaleString()})</span>` : ''}
          </div>
          <div class="order-actions">
            ${!bulkSelectMode && nextStatus ? `<button class="btn-action next" data-order-number="${o.order_number}" data-next-status="${nextStatus}">${NEXT_LABEL[o.status]}</button>` : ''}
            ${!bulkSelectMode && !['delivered','cancelled'].includes(o.status) ? `<button class="btn-action cancel" data-order-number="${o.order_number}" data-customer="${escHtml(o.customer_name)}">Cancel</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // ── BULK SELECT ──
  function toggleBulkMode() {
    bulkSelectMode = !bulkSelectMode;
    selectedOrderIds.clear();
    const btn = document.getElementById('bulkSelectBtn');
    btn.classList.toggle('active', bulkSelectMode);
    btn.innerHTML = bulkSelectMode
      ? '<i class="bi bi-x-lg"></i> Cancel'
      : '<i class="bi bi-check2-square"></i> Select';
    updateBulkBar();
    renderOrders();
  }

  function toggleOrderSelect(orderNumber) {
    if (selectedOrderIds.has(orderNumber)) selectedOrderIds.delete(orderNumber);
    else selectedOrderIds.add(orderNumber);
    updateBulkBar();
    const card = document.querySelector(`.order-card[data-order-number="${orderNumber}"]`);
    if (card) {
      card.classList.toggle('selected-order', selectedOrderIds.has(orderNumber));
      const cb = card.querySelector('input[data-action="bulk-select"]');
      if (cb) cb.checked = selectedOrderIds.has(orderNumber);
    }
  }

  function updateBulkBar() {
    const bar = document.getElementById('bulkActionBar');
    const count = document.getElementById('bulkCount');
    const n = selectedOrderIds.size;
    if (bar) bar.classList.toggle('visible', bulkSelectMode && n > 0);
    if (count) count.textContent = `${n} order${n !== 1 ? 's' : ''} selected`;
  }

  async function bulkUpdateStatus(newStatus) {
    if (!selectedOrderIds.size) return;
    const nums = [...selectedOrderIds];
    const { error } = await supabaseClient
      .from('orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .in('order_number', nums);
    if (error) { showToast('Bulk update failed', 'error'); return; }
    showToast(`${nums.length} order${nums.length > 1 ? 's' : ''} updated to ${STATUS_LABEL[newStatus] || newStatus}`, 'success');
    selectedOrderIds.clear();
    updateBulkBar();
    await loadOrders();
  }

  // ── ORDER DETAIL MODAL ──
  function openModal(orderId) {
    const o = allOrders.find(x => x.id === orderId);
    if (!o) return;
    activeModalOrder = o;

    document.getElementById('modalTitle').textContent = `Order #${o.order_number}`;

    const payClass = o.payment_method === 'cod' ? 'payment-cod' : (o.payment_status === 'paid' ? 'payment-paid' : 'payment-pending');
    const payLabel = o.payment_method === 'cod' ? 'Cash on Delivery' : (o.payment_method || '').toUpperCase();
    const items = o.order_items || [];

    document.getElementById('modalBody').innerHTML = `
      <div class="modal-section">
        <div class="modal-section-title">Status</div>
        <div style="display:flex;gap:0.5rem;align-items:center">
          <span class="status-badge status-${o.status}">${STATUS_LABEL[o.status] || o.status}</span>
          <span class="payment-badge ${payClass}">${payLabel}</span>
        </div>
      </div>

      <div class="modal-section">
        <div class="modal-section-title">Customer Details</div>
        <div class="modal-grid">
          <div class="modal-field"><label>Name</label><span>${escHtml(o.customer_name)}</span></div>
          <div class="modal-field"><label>Phone</label><span>${escHtml(o.phone)}</span></div>
          ${o.email ? `<div class="modal-field"><label>Email</label><span>${escHtml(o.email)}</span></div>` : ''}
          ${o.address ? `<div class="modal-field full"><label>Address</label><span>${escHtml(o.address)}</span></div>` : ''}
          ${o.notes ? `<div class="modal-field full" style="background:#FFFBEB"><label>Notes</label><span>${escHtml(o.notes)}</span></div>` : ''}
        </div>
      </div>

      <div class="modal-section">
        <div class="modal-section-title">Order Items</div>
        <table class="modal-items-table">
          <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
          <tbody>
            ${items.map(i => `
              <tr>
                <td>${escHtml(i.menu_item_name)}</td>
                <td>${i.quantity}</td>
                <td>Rs.${Number(i.unit_price).toLocaleString()}</td>
                <td>Rs.${Number(i.total_price).toLocaleString()}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="modal-section">
        <div class="modal-total-row"><span>Subtotal</span><span>Rs.${Number(o.subtotal).toLocaleString()}</span></div>
        <div class="modal-total-row"><span>Delivery</span><span>Rs.${Number(o.delivery_charge).toLocaleString()}</span></div>
        <div class="modal-total-row grand"><span>Total</span><span>Rs.${Number(o.total).toLocaleString()}</span></div>
      </div>

      <div class="modal-section" style="margin-bottom:0">
        <div class="modal-section-title">Order Info</div>
        <div class="modal-grid">
          <div class="modal-field"><label>Order Number</label><span>${escHtml(o.order_number)}</span></div>
          <div class="modal-field"><label>Placed At</label><span>${new Date(o.created_at).toLocaleString()}</span></div>
        </div>
      </div>
    `;

    const nextStatus = STATUS_FLOW[o.status];
    const actionsEl = document.getElementById('modalActions');
    actionsEl.innerHTML = `
      <button class="btn-modal close" id="modalCloseBtn">Close</button>
      ${!['delivered','cancelled'].includes(o.status) ? `<button class="btn-modal cancel" data-order-number="${o.order_number}" data-name="${escHtml(o.customer_name)}" id="modalCancelBtn">Cancel Order</button>` : ''}
      ${nextStatus ? `<button class="btn-modal next" data-order-number="${o.order_number}" data-next-status="${nextStatus}" id="modalNextBtn">${NEXT_LABEL[o.status]}</button>` : ''}
    `;

    document.getElementById('modalCloseBtn').addEventListener('click', closeModalDirect);
    const cancelBtn = document.getElementById('modalCancelBtn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        closeModalDirect();
        confirmCancel(cancelBtn.dataset.orderNumber, cancelBtn.dataset.name);
      });
    }
    const nextBtn = document.getElementById('modalNextBtn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => updateStatusFromModal(nextBtn.dataset.orderNumber, nextBtn.dataset.nextStatus));
    }

    document.getElementById('orderModal').classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(e) {
    if (e.target === document.getElementById('orderModal')) closeModalDirect();
  }

  function closeModalDirect() {
    document.getElementById('orderModal').classList.remove('show');
    document.body.style.overflow = '';
    activeModalOrder = null;
  }

  async function updateStatusFromModal(orderNumber, newStatus) {
    closeModalDirect();
    await updateStatus(orderNumber, newStatus);
  }

  // ── CANCEL CONFIRM ──
  let pendingCancelOrder = null;

  function confirmCancel(orderNumber, customerName) {
    pendingCancelOrder = orderNumber;
    document.getElementById('confirmMsg').textContent =
      `Cancel order #${orderNumber} for ${customerName}? This cannot be undone.`;
    document.getElementById('confirmYesBtn').onclick = async () => {
      const orderToCancel = pendingCancelOrder;
      closeConfirm();
      await updateStatus(orderToCancel, 'cancelled');
    };
    document.getElementById('confirmOverlay').classList.add('show');
  }

  function closeConfirm() {
    document.getElementById('confirmOverlay').classList.remove('show');
    pendingCancelOrder = null;
  }

  // ── UPDATE STATUS ──
  async function updateStatus(orderNumber, newStatus) {
    const { error } = await supabaseClient
      .from('orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('order_number', orderNumber);

    if (error) { showToast('Failed to update order', 'error'); return; }

    if (newStatus === 'cancelled') {
      beep();
      showToast(`Order #${orderNumber} cancelled`, 'error');
    } else {
      showToast(`#${orderNumber} → ${STATUS_LABEL[newStatus]}`, 'success');
    }
    await loadOrders();
  }

  // ── FILTER ──
  function filterOrders(filter, btn) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderOrders();
  }

  // ── NAVIGATION ──
  const pageTitles = {
    orders: ['Orders', 'Manage incoming orders'],
    menu:   ['Menu', 'Manage your menu items'],
    hours:  ['Business Hours', 'Set your opening hours'],
    addons:    ['Add-ons', 'Manage addon groups and options'],
    staff:     ['Staff PINs', 'Manage staff access'],
    analytics: ['Analytics', 'Sales overview and insights'],
    settings:  ['Settings', 'Shop details shown across the website'],
  };

  function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item[data-page]').forEach(n => {
      n.classList.remove('active');
      if (n.dataset.page === page) n.classList.add('active');
    });
    const pageEl = document.getElementById('page-' + page);
    if (!pageEl) return;
    pageEl.classList.add('active');
    const titleEl = document.getElementById('pageTitle');
    const subEl   = document.getElementById('pageSubtitle');
    if (titleEl) titleEl.textContent = pageTitles[page][0];
    if (subEl)   subEl.textContent   = pageTitles[page][1];
    if (page === 'menu') loadMenu();
    if (page === 'hours') loadHours();
    if (page === 'addons') loadAddonGroups();
    if (page === 'staff') loadStaff();
    if (page === 'analytics') loadAnalytics();
    if (page === 'settings') loadSettings();
  }

  // ── LOGOUT ──
  async function logout() {
    await supabaseClient.auth.signOut();
    window.location.href = 'admin.html';
  }

  // ── HELPERS ──
  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── ADDON MANAGEMENT ──
  let allAddonGroups = [];
  let allAddons      = [];
  let editingGroupId = null;
  let editingAddonId = null;
  let addonTargetGroupId = null;
  let assignTargetItemId = null;

  async function loadAddonGroups() {
    const list = document.getElementById('addonGroupsList');
    list.innerHTML = '<div class="loading-spinner"><div class="spinner-ring"></div><p>Loading...</p></div>';

    const [groupsRes, addonsRes] = await Promise.all([
      supabaseClient.from('addon_groups').select('*').order('id'),
      supabaseClient.from('addons').select('*').order('id')
    ]);

    if (groupsRes.error) { list.innerHTML = '<div style="padding:1.5rem;color:var(--text-light)">Failed to load add-ons.</div>'; return; }
    allAddonGroups = groupsRes.data || [];
    allAddons      = addonsRes.data || [];
    renderAddonGroups();
  }

  function renderAddonGroups() {
    const list = document.getElementById('addonGroupsList');
    if (!allAddonGroups.length) {
      list.innerHTML = '<div class="empty-state"><i class="bi bi-tags"></i><p>No addon groups yet. Click "Add Group" to create one.</p></div>';
      return;
    }
    list.innerHTML = allAddonGroups.map(g => {
      const groupAddons = allAddons.filter(a => a.group_id === g.id);
      return `
        <div class="addon-group-card" id="ag-card-${g.id}">
          <div class="addon-group-header" data-group-id="${g.id}">
            <div class="addon-group-name">${escHtml(g.name)}</div>
            <span class="req-badge ${g.is_required ? 'required' : 'optional'}">${g.is_required ? 'Required' : 'Optional'}</span>
            <div class="menu-item-actions">
              <button class="btn-icon" data-action="edit-group" data-group-id="${g.id}" title="Edit"><i class="bi bi-pencil"></i></button>
              <button class="btn-icon danger" data-action="delete-group" data-group-id="${g.id}" data-name="${escHtml(g.name)}" title="Delete"><i class="bi bi-trash"></i></button>
            </div>
            <i class="bi bi-chevron-down group-chevron"></i>
          </div>
          <div class="addon-group-body">
            ${groupAddons.length ? groupAddons.map(a => `
              <div class="addon-row">
                <span class="addon-row-name">${escHtml(a.name)}</span>
                <span class="addon-row-price">${Number(a.price) > 0 ? '+Rs.' + Number(a.price).toLocaleString() : 'Free'}</span>
                <label class="toggle" title="${a.is_available ? 'Available' : 'Unavailable'}">
                  <input type="checkbox" data-action="toggle-addon" data-addon-id="${a.id}" ${a.is_available ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
                <button class="btn-icon" data-action="edit-addon" data-group-id="${g.id}" data-addon-id="${a.id}" title="Edit"><i class="bi bi-pencil"></i></button>
                <button class="btn-icon danger" data-action="delete-addon" data-addon-id="${a.id}" data-name="${escHtml(a.name)}" title="Delete"><i class="bi bi-trash"></i></button>
              </div>`).join('') : '<div style="padding:0.6rem 1.25rem;font-size:0.82rem;color:var(--text-light)">No options yet.</div>'}
            <button class="btn-add-addon" data-action="add-addon" data-group-id="${g.id}"><i class="bi bi-plus-lg"></i> Add Option</button>
          </div>
        </div>`;
    }).join('');
  }

  function toggleGroup(id) {
    document.getElementById('ag-card-' + id).classList.toggle('expanded');
  }

  // Group modal
  function openGroupModal(groupId) {
    editingGroupId = groupId || null;
    const g = groupId ? allAddonGroups.find(x => x.id == groupId) : null;
    document.getElementById('groupModalTitle').textContent = g ? 'Edit Group' : 'Add Addon Group';
    document.getElementById('groupName').value = g ? g.name : '';
    document.getElementById('groupRequired').checked = g ? !!g.is_required : false;
    document.getElementById('groupFormError').style.display = 'none';
    document.getElementById('groupModal').classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeGroupModal(e) { if (e.target === document.getElementById('groupModal')) closeGroupModalDirect(); }
  function closeGroupModalDirect() { document.getElementById('groupModal').classList.remove('show'); document.body.style.overflow = ''; editingGroupId = null; }

  async function saveGroup() {
    const name = document.getElementById('groupName').value.trim();
    const is_required = document.getElementById('groupRequired').checked;
    const errEl = document.getElementById('groupFormError');
    if (!name) { errEl.textContent = 'Group name is required.'; errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';

    let error;
    if (editingGroupId) {
      ({ error } = await supabaseClient.from('addon_groups').update({ name, is_required }).eq('id', editingGroupId));
    } else {
      ({ error } = await supabaseClient.from('addon_groups').insert({ name, is_required }));
    }
    if (error) { errEl.textContent = 'Error: ' + error.message; errEl.style.display = 'block'; return; }
    closeGroupModalDirect();
    showToast(editingGroupId ? 'Group updated!' : 'Group created!', 'success');
    await loadAddonGroups();
  }

  // Addon modal
  function openAddonModal(groupId, addonId) {
    addonTargetGroupId = groupId;
    editingAddonId = addonId || null;
    const a = addonId ? allAddons.find(x => x.id == addonId) : null;
    document.getElementById('addonModalTitle').textContent = a ? 'Edit Option' : 'Add Option';
    document.getElementById('addonName').value = a ? a.name : '';
    document.getElementById('addonPrice').value = a ? a.price : '0';
    document.getElementById('addonFormError').style.display = 'none';
    document.getElementById('addonModal').classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeAddonModal(e) { if (e.target === document.getElementById('addonModal')) closeAddonModalDirect(); }
  function closeAddonModalDirect() { document.getElementById('addonModal').classList.remove('show'); document.body.style.overflow = ''; editingAddonId = null; }

  async function saveAddon() {
    const name = document.getElementById('addonName').value.trim();
    const price = parseFloat(document.getElementById('addonPrice').value) || 0;
    const errEl = document.getElementById('addonFormError');
    if (!name) { errEl.textContent = 'Option name is required.'; errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';

    let error;
    if (editingAddonId) {
      ({ error } = await supabaseClient.from('addons').update({ name, price }).eq('id', editingAddonId));
    } else {
      ({ error } = await supabaseClient.from('addons').insert({ name, price, group_id: addonTargetGroupId, is_available: true }));
    }
    if (error) { errEl.textContent = 'Error: ' + error.message; errEl.style.display = 'block'; return; }
    closeAddonModalDirect();
    showToast(editingAddonId ? 'Option updated!' : 'Option added!', 'success');
    await loadAddonGroups();
    document.getElementById(`ag-card-${addonTargetGroupId}`)?.classList.add('expanded');
  }

  async function toggleAddonAvailable(id, val) {
    const { error } = await supabaseClient.from('addons').update({ is_available: val }).eq('id', id);
    if (error) { showToast('Failed to update', 'error'); await loadAddonGroups(); }
  }

  function confirmDeleteGroup(id, name) {
    document.getElementById('confirmMsg').textContent = `Delete group "${name}" and all its options? This cannot be undone.`;
    document.getElementById('confirmYesBtn').onclick = async () => {
      closeConfirm();
      const { error } = await supabaseClient.from('addon_groups').delete().eq('id', id);
      if (error) { showToast('Failed to delete group', 'error'); return; }
      showToast(`"${name}" deleted`, 'success');
      await loadAddonGroups();
    };
    document.getElementById('confirmOverlay').classList.add('show');
  }

  function confirmDeleteAddon(id, name) {
    document.getElementById('confirmMsg').textContent = `Delete option "${name}"?`;
    document.getElementById('confirmYesBtn').onclick = async () => {
      closeConfirm();
      const { error } = await supabaseClient.from('addons').delete().eq('id', id);
      if (error) { showToast('Failed to delete option', 'error'); return; }
      showToast(`"${name}" deleted`, 'success');
      await loadAddonGroups();
    };
    document.getElementById('confirmOverlay').classList.add('show');
  }

  // Assign addons to menu item
  async function openAssignModal(itemId, itemName) {
    assignTargetItemId = itemId;
    document.getElementById('assignModalTitle').textContent = `Add-ons for ${itemName}`;
    const listEl = document.getElementById('assignGroupsList');
    listEl.innerHTML = '<div style="text-align:center;padding:1rem"><div class="spinner-ring" style="margin:auto"></div></div>';
    document.getElementById('assignModal').classList.add('show');
    document.body.style.overflow = 'hidden';

    const [groupsRes, assignedRes] = await Promise.all([
      supabaseClient.from('addon_groups').select('*').order('id'),
      supabaseClient.from('menu_item_addon_groups').select('addon_group_id').eq('menu_item_id', itemId)
    ]);

    const groups = groupsRes.data || [];
    const assigned = new Set((assignedRes.data || []).map(r => r.addon_group_id));

    if (!groups.length) {
      listEl.innerHTML = '<p style="color:var(--text-light);font-size:0.85rem">No addon groups yet. Create groups in the Add-ons section first.</p>';
      return;
    }

    listEl.innerHTML = groups.map(g => `
      <div class="assign-group-row">
        <input type="checkbox" id="assign-${g.id}" ${assigned.has(g.id) ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--secondary)">
        <label for="assign-${g.id}">${escHtml(g.name)} <span style="color:var(--text-light);font-size:0.78rem">${g.is_required ? '(Required)' : '(Optional)'}</span></label>
      </div>
    `).join('');
  }

  function closeAssignModal(e) { if (e.target === document.getElementById('assignModal')) closeAssignModalDirect(); }
  function closeAssignModalDirect() { document.getElementById('assignModal').classList.remove('show'); document.body.style.overflow = ''; assignTargetItemId = null; }

  async function saveAssignments() {
    const checkboxes = document.querySelectorAll('#assignGroupsList input[type="checkbox"]');
    const selectedIds = [];
    checkboxes.forEach(cb => { if (cb.checked) selectedIds.push(cb.id.replace('assign-', '')); });

    const { error: delErr } = await supabaseClient.from('menu_item_addon_groups').delete().eq('menu_item_id', assignTargetItemId);
    if (delErr) { showToast('Delete error: ' + delErr.message, 'error'); return; }

    if (selectedIds.length) {
      const rows = selectedIds.map(gid => ({ menu_item_id: assignTargetItemId, addon_group_id: gid }));
      const { error } = await supabaseClient.from('menu_item_addon_groups').insert(rows);
      if (error) { showToast('Insert error: ' + error.message, 'error'); return; }
    }

    closeAssignModalDirect();
    showToast('Add-ons assigned!', 'success');
  }

  // ── BUSINESS HOURS ──
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let hoursData = [];

  async function loadHours() {
    const container = document.getElementById('hoursContainer');
    container.innerHTML = '<div class="loading-spinner"><div class="spinner-ring"></div><p>Loading hours...</p></div>';
    const { data, error } = await supabaseClient.from('business_hours').select('*').order('day_of_week');
    if (error) { container.innerHTML = '<div style="padding:1.5rem;color:var(--text-light)">Failed to load hours.</div>'; return; }
    hoursData = data || [];
    renderHours();
  }

  function renderHours() {
    const container = document.getElementById('hoursContainer');
    container.innerHTML = hoursData.map(h => `
      <div class="hours-row${h.is_closed ? ' is-closed' : ''}" id="hours-row-${h.day_of_week}">
        <div class="hours-day">${DAY_NAMES[h.day_of_week]}</div>
        <div class="hours-time">
          <span>Open</span>
          <input type="time" class="time-input" id="open-${h.day_of_week}" value="${(h.open_time || '09:00').slice(0,5)}">
        </div>
        <div class="hours-time">
          <span>Close</span>
          <input type="time" class="time-input" id="close-${h.day_of_week}" value="${(h.close_time || '22:00').slice(0,5)}">
        </div>
        <div class="hours-closed-wrap">
          <label class="toggle">
            <input type="checkbox" id="closed-${h.day_of_week}" data-day="${h.day_of_week}" ${h.is_closed ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
          <span class="hours-closed-label">Closed</span>
        </div>
      </div>
    `).join('');
  }

  function toggleDayClosed(day, isClosed) {
    const row = document.getElementById('hours-row-' + day);
    if (isClosed) row.classList.add('is-closed');
    else row.classList.remove('is-closed');
  }

  // ── SHOP SETTINGS ──
  // Single row, id = 1 (see shop-settings.sql). Every field maps to one
  // input, so load/save are just two passes over the same map.
  const SETTINGS_FIELDS = {
    shop_name:       'setShopName',
    logo_url:        'setLogoUrl',
    phone:           'setPhone',
    whatsapp:        'setWhatsapp',
    email:           'setEmail',
    address:         'setAddress',
    maps_link:       'setMapsLink',
    facebook_url:    'setFacebook',
    instagram_url:   'setInstagram',
    tiktok_url:      'setTiktok',
    youtube_url:     'setYoutube',
    tax_percent:     'setTax',
    currency_code:   'setCurrencyCode',
    currency_symbol: 'setCurrencySymbol',
  };

  const LOGO_BUCKET = 'shop-assets';
  const LOGO_MAX_BYTES = 2 * 1024 * 1024;

  // What was last loaded or saved. The save bar compares against this so
  // it only appears when something has genuinely been edited, rather than
  // on every keystroke or on a value typed back to what it already was.
  let settingsSnapshot = {};

  function readSettingsForm() {
    const out = {};
    Object.entries(SETTINGS_FIELDS).forEach(([column, inputId]) => {
      const el = document.getElementById(inputId);
      out[column] = el ? el.value.trim() : '';
    });
    return out;
  }

  function writeSettingsForm(values) {
    Object.entries(SETTINGS_FIELDS).forEach(([column, inputId]) => {
      const el = document.getElementById(inputId);
      if (el) el.value = values[column] == null ? '' : values[column];
    });
    updateLogoPreview(values.logo_url);
  }

  function isSettingsDirty() {
    const now = readSettingsForm();
    return Object.keys(now).some(k => now[k] !== (settingsSnapshot[k] ?? ''));
  }

  function refreshSaveBar() {
    document.getElementById('settingsSaveBar')
      ?.classList.toggle('is-visible', isSettingsDirty());
  }

  Object.values(SETTINGS_FIELDS).forEach(inputId => {
    document.getElementById(inputId)?.addEventListener('input', refreshSaveBar);
  });

  document.getElementById('discardSettingsBtn')?.addEventListener('click', () => {
    writeSettingsForm(settingsSnapshot);
    refreshSaveBar();
    showToast('Changes discarded', 'success');
  });

  async function loadSettings() {
    const { data, error } = await supabaseClient
      .from('shop_settings').select('*').eq('id', 1).maybeSingle();

    if (error || !data) {
      showToast('Failed to load settings — has shop-settings.sql been run?', 'error');
      return;
    }

    writeSettingsForm(data);
    settingsSnapshot = readSettingsForm();
    refreshSaveBar();
  }

  const LOGO_FALLBACK = 'img/brewbeans-logo.png';

  function updateLogoPreview(url) {
    const img = document.getElementById('setLogoPreview');
    if (!img) return;
    // The fallback is itself an image that can fail; without this guard a
    // bad path retriggers onerror against the same src forever and the
    // preview just sits broken.
    img.onerror = () => {
      img.onerror = null;
      if (img.getAttribute('src') !== LOGO_FALLBACK) img.src = LOGO_FALLBACK;
    };
    img.src = url || LOGO_FALLBACK;
  }

  document.getElementById('setLogoUrl')?.addEventListener('input', function () {
    updateLogoPreview(this.value.trim());
  });

  async function uploadLogo(file) {
    if (file.size > LOGO_MAX_BYTES) {
      showToast('Logo must be under 2 MB', 'error');
      return null;
    }

    // Timestamped name so the CDN serves the new file instead of a
    // cached copy of the old one under the same path.
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `logo-${Date.now()}.${ext}`;

    const { error } = await supabaseClient.storage
      .from(LOGO_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: false });

    if (error) {
      // Almost always a missing bucket or policy — say which, the
      // generic storage message is not actionable.
      showToast(`Upload failed: ${error.message}. Has shop-settings.sql been run?`, 'error');
      return null;
    }

    const { data } = supabaseClient.storage.from(LOGO_BUCKET).getPublicUrl(path);
    return data ? data.publicUrl : null;
  }

  async function handleLogoFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      showToast('That is not an image file', 'error');
      return;
    }

    const zone = document.getElementById('logoDropzone');
    const label = zone?.querySelector('strong');
    const originalLabel = label ? label.textContent : '';
    zone?.classList.add('is-busy');
    if (label) label.textContent = 'Uploading...';

    const url = await uploadLogo(file);

    zone?.classList.remove('is-busy');
    if (label) label.textContent = originalLabel;
    const input = document.getElementById('setLogoFile');
    if (input) input.value = ''; // let the same file be picked again after a failure

    if (!url) return;
    document.getElementById('setLogoUrl').value = url;
    updateLogoPreview(url);
    refreshSaveBar();
    showToast('Logo uploaded — press Save Changes to apply it', 'success');
  }

  document.getElementById('setLogoFile')?.addEventListener('change', function () {
    handleLogoFile(this.files && this.files[0]);
  });

  (function wireLogoDropzone() {
    const zone = document.getElementById('logoDropzone');
    if (!zone) return;

    // Without preventDefault on both, the browser navigates away to the
    // dropped file instead of handing it over.
    ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, e => {
      e.preventDefault();
      zone.classList.add('is-dragging');
    }));

    ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, e => {
      e.preventDefault();
      zone.classList.remove('is-dragging');
    }));

    zone.addEventListener('drop', e => {
      handleLogoFile(e.dataTransfer && e.dataTransfer.files[0]);
    });
  })();

  async function saveSettings() {
    const payload = {};

    Object.entries(SETTINGS_FIELDS).forEach(([column, inputId]) => {
      const el = document.getElementById(inputId);
      if (!el) return;
      const value = el.value.trim();
      // Empty optional fields go back as null, not '', so the public site
      // can treat "no link" as a single falsy case.
      payload[column] = value === '' ? null : value;
    });

    if (!payload.shop_name) {
      showToast('Shop name cannot be empty', 'error');
      return;
    }

    const tax = parseFloat(payload.tax_percent);
    if (payload.tax_percent !== null && (isNaN(tax) || tax < 0 || tax > 100)) {
      showToast('Tax must be between 0 and 100', 'error');
      return;
    }
    payload.tax_percent = payload.tax_percent === null ? 0 : tax;

    // These have NOT NULL defaults in the table, so an empty box means
    // "keep the default" rather than "write null and fail".
    payload.currency_code = payload.currency_code || 'PKR';
    payload.currency_symbol = payload.currency_symbol || 'Rs.';

    setSaveBtnState('saving');
    const { error } = await supabaseClient.from('shop_settings').update(payload).eq('id', 1);

    if (error) {
      setSaveBtnState('idle');
      showToast('Failed to save settings', 'error');
      return;
    }

    // Reflect the values actually written — a blank currency box was
    // filled with its default above, and leaving the form showing blank
    // would make it disagree with the DB until the next reload.
    writeSettingsForm(payload);

    // The snapshot moves to what was just written, so the bar drops away
    // and re-editing a field brings it straight back.
    settingsSnapshot = readSettingsForm();
    setSaveBtnState('saved');
    showToast('Settings saved!', 'success');
    setTimeout(() => { setSaveBtnState('idle'); refreshSaveBar(); }, 900);
  }

  function setSaveBtnState(state) {
    const btn = document.getElementById('saveSettingsBtn');
    if (!btn) return;
    const icon = btn.querySelector('i, .spinner');
    const text = btn.querySelector('span');

    if (state === 'saving') {
      btn.disabled = true;
      if (icon) icon.outerHTML = '<span class="spinner"></span>';
      if (text) text.textContent = 'Saving...';
    } else if (state === 'saved') {
      btn.disabled = true;
      if (icon) icon.outerHTML = '<i class="bi bi-check-circle-fill"></i>';
      if (text) text.textContent = 'Saved';
    } else {
      btn.disabled = false;
      if (icon) icon.outerHTML = '<i class="bi bi-check-lg"></i>';
      if (text) text.textContent = 'Save Changes';
    }
  }

  async function saveHours() {
    const btn = document.getElementById('saveHoursBtn');
    btn.textContent = 'Saving...';
    btn.disabled = true;
    let hasError = false;

    for (const h of hoursData) {
      const open_time  = document.getElementById('open-'   + h.day_of_week).value;
      const close_time = document.getElementById('close-'  + h.day_of_week).value;
      const is_closed  = document.getElementById('closed-' + h.day_of_week).checked;
      const { error } = await supabaseClient
        .from('business_hours')
        .update({ open_time, close_time, is_closed })
        .eq('day_of_week', h.day_of_week);
      if (error) hasError = true;
    }

    btn.textContent = 'Save Changes';
    btn.disabled = false;
    if (hasError) { showToast('Failed to save some hours', 'error'); return; }
    showToast('Business hours saved!', 'success');
    checkShopStatus();
  }

  async function closeTodayQuick() {
    const today = new Date().getDay();
    const { error } = await supabaseClient
      .from('business_hours')
      .update({ is_closed: true })
      .eq('day_of_week', today);
    if (error) { showToast('Failed to close today', 'error'); return; }
    showToast(`${DAY_NAMES[today]} marked as closed`, 'success');
    checkShopStatus();
    await loadHours();
  }

  async function openAllWeekQuick() {
    const { error } = await supabaseClient
      .from('business_hours')
      .update({ is_closed: false })
      .gte('day_of_week', 0);
    if (error) { showToast('Failed to update hours', 'error'); return; }
    showToast('All days set to open', 'success');
    checkShopStatus();
    await loadHours();
  }

  // ── STAFF PINs ──
  let editingStaffId = null;

  async function loadStaff() {
    const el = document.getElementById('staffList');
    el.innerHTML = '<div class="loading-spinner"><div class="spinner-ring"></div><p>Loading...</p></div>';
    const { data, error } = await supabaseClient.from('staff_pins').select('*').order('created_at');
    if (error) { el.innerHTML = '<div style="padding:1.5rem;color:var(--text-light)">Failed to load staff.</div>'; return; }
    if (!data || !data.length) {
      el.innerHTML = '<div class="empty-state"><i class="bi bi-people"></i><p>No staff members yet</p></div>';
      return;
    }
    el.innerHTML = `
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:1px solid var(--border-light);text-align:left">
            <th style="padding:0.75rem 1.25rem;font-size:0.8rem;color:var(--text-light);font-weight:600">NAME</th>
            <th style="padding:0.75rem 1.25rem;font-size:0.8rem;color:var(--text-light);font-weight:600">PIN</th>
            <th style="padding:0.75rem 1.25rem;font-size:0.8rem;color:var(--text-light);font-weight:600">ADDED</th>
            <th style="padding:0.75rem 1.25rem"></th>
          </tr>
        </thead>
        <tbody>
          ${data.map(s => `
            <tr style="border-bottom:1px solid var(--border-light)">
              <td style="padding:0.85rem 1.25rem;font-weight:500">${escHtml(s.name)}</td>
              <td style="padding:0.85rem 1.25rem">
                <span class="pin-display" data-id="${s.id}" data-pin="${escHtml(s.pin)}" style="font-family:monospace;cursor:pointer" title="Click to reveal">••••</span>
              </td>
              <td style="padding:0.85rem 1.25rem;color:var(--text-light);font-size:0.85rem">${new Date(s.created_at).toLocaleDateString()}</td>
              <td style="padding:0.85rem 1.25rem;text-align:right;white-space:nowrap">
                <button class="btn-icon" data-action="edit-staff" data-id="${s.id}" data-name="${escHtml(s.name)}" data-pin="${escHtml(s.pin)}" title="Edit"><i class="bi bi-pencil"></i></button>
                <button class="btn-icon danger" data-action="delete-staff" data-id="${s.id}" data-name="${escHtml(s.name)}" title="Delete"><i class="bi bi-trash"></i></button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    document.querySelectorAll('.pin-display').forEach(el => {
      el.addEventListener('click', function() {
        this.textContent = this.textContent === '••••' ? this.dataset.pin : '••••';
      });
    });
  }

  function openStaffModal(id, name, pin) {
    id = id || null; name = name || ''; pin = pin || '';
    editingStaffId = id;
    document.getElementById('staffModalTitle').textContent = id ? 'Edit Staff' : 'Add Staff';
    document.getElementById('staffName').value = name;
    document.getElementById('staffPin').value = pin;
    document.getElementById('staffSaveBtn').textContent = id ? 'Update' : 'Save';
    document.getElementById('staffModal').classList.add('show');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('staffName').focus(), 100);
  }

  function closeStaffModal(e) { if (e.target === document.getElementById('staffModal')) closeStaffModalDirect(); }
  function closeStaffModalDirect() {
    document.getElementById('staffModal').classList.remove('show');
    document.body.style.overflow = '';
    editingStaffId = null;
  }

  async function saveStaff() {
    const name = document.getElementById('staffName').value.trim();
    const pin  = document.getElementById('staffPin').value.trim();
    if (!name) { showToast('Name is required', 'error'); return; }
    if (!/^\d{4,6}$/.test(pin)) { showToast('PIN must be 4–6 digits', 'error'); return; }

    const btn = document.getElementById('staffSaveBtn');
    btn.textContent = 'Saving...'; btn.disabled = true;

    let error;
    if (editingStaffId) {
      ({ error } = await supabaseClient.from('staff_pins').update({ name, pin }).eq('id', editingStaffId));
    } else {
      ({ error } = await supabaseClient.from('staff_pins').insert({ name, pin }));
    }

    btn.textContent = editingStaffId ? 'Update' : 'Save'; btn.disabled = false;
    if (error) { showToast(error.message || 'Failed to save', 'error'); return; }
    closeStaffModalDirect();
    showToast(editingStaffId ? 'Staff updated!' : 'Staff added!', 'success');
    await loadStaff();
  }

  async function deleteStaff(id, name) {
    if (!confirm(`Delete "${name}"? They will lose staff access immediately.`)) return;
    const { error } = await supabaseClient.from('staff_pins').delete().eq('id', id);
    if (error) { showToast('Failed to delete', 'error'); return; }
    showToast(`"${name}" removed`, 'success');
    await loadStaff();
  }

  // ── ANALYTICS ──
  async function loadAnalytics() {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [{ data: monthOrders }, { data: allItems }] = await Promise.all([
      supabaseClient.from('orders').select('id, total, status, created_at').gte('created_at', monthStart),
      supabaseClient.from('order_items').select('quantity, menu_item_name')
    ]);

    const orders = monthOrders || [];
    const items  = allItems || [];

    const todayOrders = orders.filter(o => o.created_at.startsWith(todayStr));
    const todayRev    = todayOrders.reduce((s, o) => s + (o.total || 0), 0);

    const monthRev  = orders.reduce((s, o) => s + (o.total || 0), 0);
    const delivered = orders.filter(o => o.status === 'delivered').length;
    const avgOrder  = orders.length ? Math.round(monthRev / orders.length) : 0;
    const rate      = orders.length ? Math.round((delivered / orders.length) * 100) : 0;

    document.getElementById('statTodayOrders').textContent  = todayOrders.length;
    document.getElementById('statTodayRevenue').textContent = 'Rs. ' + todayRev.toLocaleString();
    document.getElementById('statMonthOrders').textContent  = orders.length;
    document.getElementById('statMonthRevenue').textContent = 'Rs. ' + monthRev.toLocaleString();
    document.getElementById('statAvgOrder').textContent     = 'Rs. ' + avgOrder.toLocaleString();
    document.getElementById('statCompletionRate').textContent = rate + '%';

    const STATUS_LABELS = { placed:'Placed', preparing:'Preparing', out_for_delivery:'Out for Delivery', delivered:'Delivered', cancelled:'Cancelled' };
    const statusColors  = { placed:'#0d6efd', preparing:'#f59e0b', out_for_delivery:'#8b5cf6', delivered:'#16a34a', cancelled:'#dc2626' };
    const statusCounts  = {};
    orders.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });
    const maxStatus = Math.max(1, ...Object.values(statusCounts));
    const statusHtml = Object.entries(statusCounts).length
      ? Object.entries(statusCounts).map(([s, n]) => `
          <div style="margin-bottom:0.75rem">
            <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:4px">
              <span style="font-weight:500">${STATUS_LABELS[s] || s}</span>
              <span style="color:var(--text-light)">${n}</span>
            </div>
            <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
              <div style="height:100%;width:${Math.round((n/maxStatus)*100)}%;background:${statusColors[s]||'#64748b'};border-radius:4px;transition:width 0.6s"></div>
            </div>
          </div>`).join('')
      : '<p style="color:var(--text-light);font-size:0.875rem">No orders this month.</p>';
    document.getElementById('statusBreakdown').innerHTML = statusHtml;

    const itemTotals = {};
    items.forEach(i => {
      const name = i.menu_item_name || 'Unknown';
      itemTotals[name] = (itemTotals[name] || 0) + (i.quantity || 1);
    });
    const topSorted = Object.entries(itemTotals).sort((a,b) => b[1]-a[1]).slice(0, 5);
    const maxItem = Math.max(1, topSorted[0]?.[1] || 1);
    const topHtml = topSorted.length
      ? topSorted.map(([name, qty], i) => `
          <div style="margin-bottom:0.75rem">
            <div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:4px">
              <span style="font-weight:500">${escHtml(name)}</span>
              <span style="color:var(--text-light)">${qty} sold</span>
            </div>
            <div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden">
              <div style="height:100%;width:${Math.round((qty/maxItem)*100)}%;background:var(--primary);opacity:${1 - i*0.15};border-radius:4px;transition:width 0.6s"></div>
            </div>
          </div>`).join('')
      : '<p style="color:var(--text-light);font-size:0.875rem">No sales data yet.</p>';
    document.getElementById('topItems').innerHTML = topHtml;

    // ── Last 7 days bar chart ──
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      days.push(d.toISOString().split('T')[0]);
    }
    const dayMap = {};
    orders.forEach(o => {
      const day = o.created_at.split('T')[0];
      if (!dayMap[day]) dayMap[day] = { count: 0, rev: 0 };
      dayMap[day].count++;
      dayMap[day].rev += o.total || 0;
    });
    const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const chartLabels = days.map(d => {
      const date = new Date(d + 'T00:00:00');
      return `${dayLabels[date.getDay()]} ${date.getDate()}/${date.getMonth()+1}`;
    });
    const chartRevData = days.map(d => (dayMap[d] || {}).rev || 0);
    const chartOrderData = days.map(d => (dayMap[d] || {}).count || 0);

    if (revenueChartInstance) revenueChartInstance.destroy();
    const ctx = document.getElementById('revenueChart');
    if (ctx) {
      revenueChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: chartLabels,
          datasets: [
            {
              label: 'Revenue (Rs.)',
              data: chartRevData,
              backgroundColor: 'rgba(46,139,87,0.75)',
              borderRadius: 6,
              yAxisID: 'y',
            },
            {
              label: 'Orders',
              data: chartOrderData,
              type: 'line',
              borderColor: '#f59e0b',
              backgroundColor: 'rgba(245,158,11,0.12)',
              borderWidth: 2,
              pointRadius: 4,
              pointBackgroundColor: '#f59e0b',
              fill: true,
              tension: 0.35,
              yAxisID: 'y2',
            }
          ]
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { font: { family: 'Poppins', size: 12 }, boxWidth: 14 } },
            tooltip: {
              callbacks: {
                label: ctx => ctx.dataset.label === 'Revenue (Rs.)'
                  ? ` Rs. ${ctx.parsed.y.toLocaleString()}`
                  : ` ${ctx.parsed.y} orders`
              }
            }
          },
          scales: {
            y:  { position: 'left',  beginAtZero: true, ticks: { callback: v => 'Rs.' + v.toLocaleString(), font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
            y2: { position: 'right', beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 } }, grid: { drawOnChartArea: false } },
            x:  { ticks: { font: { size: 11 } }, grid: { display: false } }
          }
        }
      });
    }

    // ── Peak hours heatmap ──
    const hourCounts = new Array(24).fill(0);
    orders.forEach(o => {
      const h = new Date(o.created_at).getHours();
      hourCounts[h]++;
    });
    const maxCount = Math.max(1, ...hourCounts);
    const heatWrap = document.getElementById('peakHoursGrid');
    if (heatWrap) {
      const hourLabel = h => h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`;
      const cells = hourCounts.map((count, h) => {
        const opacity = count === 0 ? 0.07 : 0.2 + (count / maxCount) * 0.8;
        const delay   = (h * 18).toFixed(0);
        const hasOrders = count > 0;
        return `<div class="heat-cell${hasOrders ? ' has-orders' : ''}"
          title="${hourLabel(h)}: ${count} order${count !== 1 ? 's' : ''}"
          style="background:rgba(46,139,87,${opacity.toFixed(2)});animation-delay:${delay}ms">
          ${hasOrders ? `<span class="heat-count">${count}</span>` : ''}
        </div>`;
      }).join('');
      const labels = hourCounts.map((_, h) =>
        `<div class="heat-label">${hourLabel(h)}</div>`
      ).join('');
      heatWrap.innerHTML = `<div class="heat-grid">${cells}</div><div class="heat-labels">${labels}</div>`;
    }
  }

  // ── MENU MANAGEMENT ──
  let allMenuItems = [];
  let editingMenuId = null;

  const CATEGORY_LABELS = {
    'hot-coffee': 'Hot Coffee',
    'cold-coffee': 'Cold Coffee',
    'frappes': 'Frappes',
    'summer-coolers': 'Summer Coolers',
    'desserts': 'Desserts'
  };

  async function loadMenu() {
    const grid = document.getElementById('menuGrid');
    grid.innerHTML = '<div class="loading-spinner"><div class="spinner-ring"></div><p>Loading menu...</p></div>';
    const { data, error } = await supabaseClient.from('menu_items').select('*').order('id');
    if (error) {
      grid.innerHTML = '<div class="empty-state"><i class="bi bi-exclamation-circle"></i><p>Failed to load menu</p></div>';
      return;
    }
    allMenuItems = data || [];
    renderMenuGrid();
  }

  function renderMenuGrid() {
    const grid = document.getElementById('menuGrid');
    if (!allMenuItems.length) {
      grid.innerHTML = '<div class="empty-state"><i class="bi bi-cup-hot"></i><p>No menu items yet</p></div>';
      return;
    }
    const q = (document.getElementById('menuSearchInput')?.value || '').toLowerCase().trim();
    const filtered = q
      ? allMenuItems.filter(i => i.name.toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q) || (CATEGORY_LABELS[i.category] || i.category).toLowerCase().includes(q))
      : allMenuItems;
    if (!filtered.length) {
      grid.innerHTML = '<div class="empty-state"><i class="bi bi-search"></i><p>No items match your search</p></div>';
      return;
    }
    const menuHtml = filtered.map(item => `
      <div class="menu-item-card">
        ${item.image
          ? `<img class="menu-item-img" src="${escHtml(item.image)}" alt="${escHtml(item.name)}">`
          : ''}
        <div class="menu-item-img-placeholder" style="${item.image ? 'display:none' : 'display:flex'}"><i class="bi bi-image"></i></div>
        <div class="menu-item-body">
          <div class="menu-item-top">
            <div class="menu-item-name">${escHtml(item.name)}</div>
            <span class="category-badge">${escHtml(CATEGORY_LABELS[item.category] || item.category)}</span>
          </div>
          ${item.description ? `<div class="menu-item-desc">${escHtml(item.description)}</div>` : ''}
          <div class="menu-item-footer">
            <div class="menu-item-price">Rs. ${Number(item.price).toLocaleString()}</div>
            <div class="menu-item-actions">
              <label class="toggle" title="${item.is_available ? 'Available' : 'Unavailable'}">
                <input type="checkbox" data-action="toggle-available" data-item-id="${item.id}" ${item.is_available ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
              <button class="btn-icon ${item.is_popular ? 'popular-active' : ''}" data-action="toggle-popular" data-item-id="${item.id}" data-is-popular="${item.is_popular}" title="${item.is_popular ? 'Remove from Popular' : 'Mark as Popular'}"><i class="bi bi-star${item.is_popular ? '-fill' : ''}"></i></button>
              <button class="btn-icon" data-action="assign-addons" data-item-id="${item.id}" data-item-name="${escHtml(item.name)}" title="Add-ons"><i class="bi bi-tags"></i></button>
              <button class="btn-icon" data-action="edit-item" data-item-id="${item.id}" title="Edit"><i class="bi bi-pencil"></i></button>
              <button class="btn-icon danger" data-action="delete-item" data-item-id="${item.id}" data-item-name="${escHtml(item.name)}" title="Delete"><i class="bi bi-trash"></i></button>
            </div>
          </div>
        </div>
      </div>
    `).join('');
    grid.innerHTML = menuHtml;
    grid.querySelectorAll('.menu-item-img').forEach(img => {
      img.addEventListener('error', function() {
        this.style.display = 'none';
        const placeholder = this.nextElementSibling;
        if (placeholder) placeholder.style.display = 'flex';
      });
    });
  }

  function openMenuModal(itemId) {
    editingMenuId = itemId || null;
    const item = itemId ? allMenuItems.find(i => i.id == itemId) : null;
    document.getElementById('menuModalTitle').textContent = item ? 'Edit Menu Item' : 'Add Menu Item';
    document.getElementById('menuName').value = item ? item.name : '';
    document.getElementById('menuCategory').value = item ? item.category : '';
    document.getElementById('menuDesc').value = item ? (item.description || '') : '';
    document.getElementById('menuPrice').value = item ? item.price : '';
    document.getElementById('menuAvailable').value = item ? String(item.is_available) : 'true';
    document.getElementById('menuImage').value = item ? (item.image || '') : '';
    document.getElementById('menuFormError').style.display = 'none';
    document.getElementById('menuModal').classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeMenuModal(e) {
    if (e.target === document.getElementById('menuModal')) closeMenuModalDirect();
  }

  function closeMenuModalDirect() {
    document.getElementById('menuModal').classList.remove('show');
    document.body.style.overflow = '';
    editingMenuId = null;
  }

  async function saveMenuItem() {
    const name = document.getElementById('menuName').value.trim();
    const category = document.getElementById('menuCategory').value;
    const description = document.getElementById('menuDesc').value.trim();
    const price = parseFloat(document.getElementById('menuPrice').value);
    const is_available = document.getElementById('menuAvailable').value === 'true';
    const image = document.getElementById('menuImage').value.trim() || null;
    const errEl = document.getElementById('menuFormError');

    if (!name || !category || isNaN(price) || price < 0) {
      errEl.textContent = 'Name, category and a valid price are required.';
      errEl.style.display = 'block';
      return;
    }
    errEl.style.display = 'none';

    const btn = document.getElementById('menuSaveBtn');
    btn.textContent = 'Saving...';
    btn.disabled = true;

    const payload = { name, category, description: description || null, price, is_available, image };
    let error;

    if (editingMenuId) {
      ({ error } = await supabaseClient.from('menu_items').update(payload).eq('id', editingMenuId));
    } else {
      ({ error } = await supabaseClient.from('menu_items').insert(payload));
    }

    btn.textContent = 'Save Item';
    btn.disabled = false;

    if (error) { errEl.textContent = 'Error: ' + error.message; errEl.style.display = 'block'; return; }

    closeMenuModalDirect();
    showToast(editingMenuId ? 'Item updated!' : 'Item added!', 'success');
    await loadMenu();
  }

  async function toggleAvailable(id, val) {
    const { error } = await supabaseClient.from('menu_items').update({ is_available: val }).eq('id', id);
    if (error) { showToast('Failed to update', 'error'); await loadMenu(); return; }
    showToast(val ? 'Item marked available' : 'Item marked unavailable', 'success');
  }

  async function togglePopular(id, val) {
    const { error } = await supabaseClient.from('menu_items').update({ is_popular: val }).eq('id', id);
    if (error) { showToast('Failed to update', 'error'); await loadMenu(); return; }
    const item = allMenuItems.find(i => i.id == id);
    if (item) item.is_popular = val;
    renderMenuGrid();
    showToast(val ? '⭐ Marked as Popular' : 'Removed from Popular', 'success');
  }

  function confirmDeleteMenuItem(id, name) {
    document.getElementById('confirmMsg').textContent = `Delete "${name}"? This cannot be undone.`;
    document.getElementById('confirmYesBtn').onclick = async () => {
      closeConfirm();
      const { error } = await supabaseClient.from('menu_items').delete().eq('id', id);
      if (error) { showToast('Failed to delete item', 'error'); return; }
      showToast(`"${name}" deleted`, 'success');
      await loadMenu();
    };
    document.getElementById('confirmOverlay').classList.add('show');
  }

  function showToast(msg, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="bi bi-${type === 'success' ? 'check-circle-fill' : 'exclamation-circle-fill'}"></i> ${escHtml(msg)}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  // ── EVENT DELEGATION + STATIC LISTENERS ──
  document.addEventListener('DOMContentLoaded', setupListeners);

  function setupListeners() {
    // Nav buttons
    document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
      btn.addEventListener('click', () => showPage(btn.dataset.page));
    });

    // Logout
    document.querySelector('.btn-logout')?.addEventListener('click', logout);

    // Order filter buttons
    document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => filterOrders(btn.dataset.filter, btn));
    });

    // Bulk select toggle
    document.getElementById('bulkSelectBtn')?.addEventListener('click', toggleBulkMode);

    // Advanced filters
    document.getElementById('filterDateFrom')?.addEventListener('change', e => { dateFrom = e.target.value; renderOrders(); });
    document.getElementById('filterDateTo')?.addEventListener('change',   e => { dateTo   = e.target.value; renderOrders(); });
    document.getElementById('filterPayMethod')?.addEventListener('change', e => { paymentMethodFilter = e.target.value; renderOrders(); });
    document.getElementById('filterPayStatus')?.addEventListener('change', e => { paymentStatusFilter = e.target.value; renderOrders(); });
    document.getElementById('clearFiltersBtn')?.addEventListener('click', () => {
      dateFrom = dateTo = paymentMethodFilter = paymentStatusFilter = '';
      document.getElementById('filterDateFrom').value = '';
      document.getElementById('filterDateTo').value   = '';
      document.getElementById('filterPayMethod').value = '';
      document.getElementById('filterPayStatus').value = '';
      renderOrders();
    });

    // Menu page "Add Item" button
    document.querySelector('#page-menu .btn-primary')?.addEventListener('click', () => openMenuModal());

    // Save Hours button
    document.getElementById('saveHoursBtn')?.addEventListener('click', saveHours);
    document.getElementById('saveSettingsBtn')?.addEventListener('click', saveSettings);

    // Hours quick toggles
    document.getElementById('closeTodayBtn')?.addEventListener('click', closeTodayQuick);
    document.getElementById('openAllWeekBtn')?.addEventListener('click', openAllWeekQuick);

    // Bulk action bar buttons
    document.getElementById('bulkMarkPreparing')?.addEventListener('click', () => bulkUpdateStatus('preparing'));
    document.getElementById('bulkMarkDelivered')?.addEventListener('click', () => bulkUpdateStatus('delivered'));
    document.getElementById('bulkMarkCancelled')?.addEventListener('click', () => bulkUpdateStatus('cancelled'));

    // Addons page "Add Group" button
    document.querySelector('#page-addons .btn-primary')?.addEventListener('click', () => openGroupModal());

    // Staff page "Add Staff" button
    document.querySelector('#page-staff .btn-add')?.addEventListener('click', () => openStaffModal());

    // Confirm dialog No button
    document.querySelector('.btn-confirm-no')?.addEventListener('click', closeConfirm);

    // Modal overlays — click outside to close
    document.getElementById('orderModal')?.addEventListener('click', closeModal);
    document.getElementById('staffModal')?.addEventListener('click', closeStaffModal);
    document.getElementById('groupModal')?.addEventListener('click', closeGroupModal);
    document.getElementById('addonModal')?.addEventListener('click', closeAddonModal);
    document.getElementById('assignModal')?.addEventListener('click', closeAssignModal);
    document.getElementById('menuModal')?.addEventListener('click', closeMenuModal);

    // Order modal close button
    document.querySelector('#orderModal .modal-close')?.addEventListener('click', closeModalDirect);

    // Staff modal buttons
    document.querySelector('#staffModal .modal-close')?.addEventListener('click', closeStaffModalDirect);
    document.querySelector('#staffModal .btn-modal.close')?.addEventListener('click', closeStaffModalDirect);
    document.getElementById('staffSaveBtn')?.addEventListener('click', saveStaff);

    // Group modal buttons
    document.querySelector('#groupModal .modal-close')?.addEventListener('click', closeGroupModalDirect);
    document.querySelector('#groupModal .btn-modal.close')?.addEventListener('click', closeGroupModalDirect);
    document.querySelector('#groupModal .btn-modal.next')?.addEventListener('click', saveGroup);

    // Addon modal buttons
    document.querySelector('#addonModal .modal-close')?.addEventListener('click', closeAddonModalDirect);
    document.querySelector('#addonModal .btn-modal.close')?.addEventListener('click', closeAddonModalDirect);
    document.querySelector('#addonModal .btn-modal.next')?.addEventListener('click', saveAddon);

    // Assign modal buttons
    document.querySelector('#assignModal .modal-close')?.addEventListener('click', closeAssignModalDirect);
    document.querySelector('#assignModal .btn-modal.close')?.addEventListener('click', closeAssignModalDirect);
    document.querySelector('#assignModal .btn-modal.next')?.addEventListener('click', saveAssignments);

    // Menu modal buttons
    document.querySelector('#menuModal .modal-close')?.addEventListener('click', closeMenuModalDirect);
    document.querySelector('#menuModal .btn-modal.close')?.addEventListener('click', closeMenuModalDirect);
    document.getElementById('menuSaveBtn')?.addEventListener('click', saveMenuItem);

    // Event delegation: ordersList
    document.getElementById('ordersList')?.addEventListener('click', e => {
      // Bulk select checkbox
      const cb = e.target.closest('input[data-action="bulk-select"]');
      if (cb) { e.stopPropagation(); toggleOrderSelect(cb.dataset.orderNumber); return; }

      // In bulk mode, clicking the card itself toggles selection
      if (bulkSelectMode) {
        const card = e.target.closest('.order-card');
        if (card) { toggleOrderSelect(card.dataset.orderNumber); return; }
      }

      const actionBtn = e.target.closest('.btn-action');
      if (actionBtn) {
        e.stopPropagation();
        if (actionBtn.classList.contains('next')) {
          updateStatus(actionBtn.dataset.orderNumber, actionBtn.dataset.nextStatus);
        } else if (actionBtn.classList.contains('cancel')) {
          confirmCancel(actionBtn.dataset.orderNumber, actionBtn.dataset.customer);
        }
        return;
      }
      if (e.target.closest('.order-actions')) { e.stopPropagation(); return; }
      const card = e.target.closest('.order-card');
      if (card) openModal(card.dataset.orderId);
    });

    // Event delegation: menuGrid (clicks)
    document.getElementById('menuGrid')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn || btn.tagName === 'INPUT') return;
      const { action, itemId, itemName, isPopular } = btn.dataset;
      if (action === 'toggle-popular') { togglePopular(Number(itemId), !(isPopular === 'true')); return; }
      if (action === 'assign-addons') { openAssignModal(Number(itemId), itemName); return; }
      if (action === 'edit-item') { openMenuModal(Number(itemId)); return; }
      if (action === 'delete-item') { confirmDeleteMenuItem(Number(itemId), itemName); return; }
    });

    // Event delegation: menuGrid (changes — available toggle)
    document.getElementById('menuGrid')?.addEventListener('change', e => {
      const cb = e.target.closest('input[type="checkbox"][data-action="toggle-available"]');
      if (cb) toggleAvailable(Number(cb.dataset.itemId), cb.checked);
    });

    // Event delegation: addonGroupsList (clicks)
    document.getElementById('addonGroupsList')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (btn && btn.tagName !== 'INPUT') {
        const { action, groupId, addonId, name } = btn.dataset;
        if (action === 'edit-group')   { openGroupModal(groupId); return; }
        if (action === 'delete-group') { confirmDeleteGroup(groupId, name); return; }
        if (action === 'edit-addon')   { openAddonModal(groupId, addonId); return; }
        if (action === 'delete-addon') { confirmDeleteAddon(addonId, name); return; }
        if (action === 'add-addon')    { openAddonModal(groupId); return; }
        return;
      }
      const header = e.target.closest('.addon-group-header');
      if (header && !e.target.closest('.menu-item-actions')) {
        toggleGroup(header.dataset.groupId);
      }
    });

    // Event delegation: addonGroupsList (changes — addon available toggle)
    document.getElementById('addonGroupsList')?.addEventListener('change', e => {
      const cb = e.target.closest('input[type="checkbox"][data-action="toggle-addon"]');
      if (cb) toggleAddonAvailable(cb.dataset.addonId, cb.checked);
    });

    // Event delegation: staffList (clicks)
    document.getElementById('staffList')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id, name, pin } = btn.dataset;
      if (action === 'edit-staff')   openStaffModal(id, name, pin);
      if (action === 'delete-staff') deleteStaff(id, name);
    });

    // Event delegation: hoursContainer (changes — closed toggle)
    document.getElementById('hoursContainer')?.addEventListener('change', e => {
      const cb = e.target.closest('input[type="checkbox"][data-day]');
      if (cb) toggleDayClosed(Number(cb.dataset.day), cb.checked);
    });
  }
