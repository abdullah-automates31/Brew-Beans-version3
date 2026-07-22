const STATUS_FLOW = ['placed', 'preparing', 'out_for_delivery', 'delivered'];
const STATUS_LABELS = {
    placed: 'Placed',
    preparing: 'Preparing',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
};

let staffPin = sessionStorage.getItem('bbStaffPin') || null;
let allOrders = [];
let knownOrderNumbers = new Set();
let currentFilter = 'active';
let pollTimer = null;
let notifyEnabled = false;

function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function staffToast(message, type = 'info') {
    const icons = { success: 'bi-check-circle-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill', danger: 'bi-x-circle-fill' };
    const toast = $(`<div class="toast-notification"><i class="bi ${icons[type] || icons.info}"></i><span>${escapeHtml(message)}</span></div>`);
    $('.toast-container').remove();
    const container = $('<div class="toast-container"></div>').append(toast);
    $('body').append(container);
    setTimeout(() => {
        toast.fadeOut(400, function () { $(this).closest('.toast-container').remove(); });
    }, 3500);
}

function beep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
    } catch (e) { /* audio not available */ }
}

function notifyNewOrder(order) {
    staffToast(`New order ${order.order_number} from ${order.customer_name}`, 'success');
    beep();
    if (notifyEnabled && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('New order — Brew Beans', { body: `${order.order_number} — ${order.customer_name} — Rs. ${order.total}` });
    }
}

function renderNotifyBtn() {
    $('#notifyBtn')
        .toggleClass('is-on', notifyEnabled)
        .attr('title', notifyEnabled ? 'New-order alerts are on — click to mute' : 'Enable new-order alerts')
        .html(notifyEnabled
            ? '<i class="bi bi-bell-fill me-1"></i>Alerts: On'
            : '<i class="bi bi-bell me-1"></i>Alerts: Off');
}

// The browser keeps the notification permission across reloads but
// notifyEnabled did not, so alerts silently went off every time staff
// refreshed the dashboard and the button always read "Off".
if ('Notification' in window && Notification.permission === 'granted') {
    notifyEnabled = true;
}
renderNotifyBtn();

$('#notifyBtn').on('click', async function () {
    if (!('Notification' in window)) {
        staffToast('Browser notifications are not supported here.', 'warning');
        return;
    }

    // Already armed: clicking mutes. Re-requesting an already-granted
    // permission resolves instantly, so without this the button could
    // never be turned back off.
    if (notifyEnabled) {
        notifyEnabled = false;
        renderNotifyBtn();
        staffToast('New-order alerts muted.', 'warning');
        return;
    }

    const perm = await Notification.requestPermission();
    notifyEnabled = perm === 'granted';
    renderNotifyBtn();
    if (!notifyEnabled) {
        staffToast('Alerts stay off until notifications are allowed for this site.', 'warning');
    }
});

$('#statusFilter button').on('click', function () {
    $('#statusFilter button').removeClass('active');
    $(this).addClass('active');
    currentFilter = $(this).data('filter');
    renderOrders();
});

$('#searchInput').on('input', function () { renderOrders(); });

function showOrdersView(initialData) {
    $('#loginView').hide();
    $('#ordersView').show();
    if (window.Motion) {
        Motion.animate('#ordersView', { opacity: [0, 1], y: [16, 0] }, { duration: 0.4, easing: [0.22, 1, 0.36, 1] });
    }
    if (initialData !== undefined) {
        allOrders = initialData || [];
        knownOrderNumbers = new Set(allOrders.map(o => o.order_number));
        renderOrders('all');
    } else {
        loadOrders(true);
    }
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => loadOrders(false), 15000);
}

function animateLoginCardIn() {
    if (window.Motion) {
        Motion.animate('.staff-login-card', { opacity: [0, 1], y: [16, 0] }, { duration: 0.4, easing: [0.22, 1, 0.36, 1] });
    } else {
        $('.staff-login-card').css('opacity', 1);
    }
}

function showLoginView(message) {
    staffPin = null;
    sessionStorage.removeItem('bbStaffPin');
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    $('#ordersView').hide();
    $('#loginView').show();
    animateLoginCardIn();
    if (message) {
        $('#loginError').text(message).show();
    }
}

async function verifyAndEnter(pin) {
    const { data, error } = await supabaseClient.rpc('staff_list_orders', { p_pin: pin });
    if (error) {
        throw new Error('Incorrect PIN');
    }
    staffPin = pin;
    sessionStorage.setItem('bbStaffPin', pin);
    showOrdersView(data);
}

$('#pinForm').on('submit', async function (e) {
    e.preventDefault();
    $('#loginError').hide();
    const pin = $('#pinInput').val().trim();
    $('#loginBtn').prop('disabled', true).text('Checking...');
    try {
        await verifyAndEnter(pin);
    } catch (err) {
        $('#loginError').text(err.message).show();
    }
    $('#loginBtn').prop('disabled', false).text('Login');
});

$('#logoutBtn').on('click', function () {
    showLoginView();
});

$('#refreshBtn').on('click', function () {
    loadOrders(true);
});

function matchesFilter(order) {
    if (currentFilter === 'active') return ['placed', 'preparing', 'out_for_delivery'].includes(order.status);
    if (currentFilter === 'completed') return order.status === 'delivered';
    if (currentFilter === 'cancelled') return order.status === 'cancelled';
    return true;
}

function matchesSearch(order, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return order.order_number.toLowerCase().includes(q)
        || order.customer_name.toLowerCase().includes(q)
        || order.phone.toLowerCase().includes(q);
}

// animateOrderNumbers: 'all' pops in every rendered card (first load / manual
// refresh); a Set pops in only those order numbers (freshly-arrived orders
// during background polling); omitted means no animation (filter/search re-renders).
function renderOrders(animateOrderNumbers) {
    const $list = $('#ordersList');
    $list.empty();

    const q = $('#searchInput').val().trim();
    const orders = allOrders.filter(o => matchesFilter(o) && matchesSearch(o, q));

    if (!orders || orders.length === 0) {
        $('#noOrders').show();
        return;
    }
    $('#noOrders').hide();

    const cardsToAnimate = [];

    orders.forEach((order, index) => {
        const itemsHtml = (order.items || [])
            .map(i => `${i.quantity}x ${escapeHtml(i.name)}`)
            .join(', ');

        const actionsHtml = STATUS_FLOW
            .filter(s => s !== order.status)
            .map(s => `<button class="btn btn-sm btn-outline-primary status-btn" data-order="${escapeHtml(order.order_number)}" data-status="${s}">${STATUS_LABELS[s]}</button>`)
            .join('');

        const $card = $(`
            <div class="staff-order-card" data-order="${escapeHtml(order.order_number)}">
                <div class="staff-order-header">
                    <div>
                        <strong>${escapeHtml(order.order_number)}</strong>
                        <span class="text-muted ms-2">${new Date(order.created_at).toLocaleString()}</span>
                    </div>
                    <span class="staff-status-badge ${order.status}">${STATUS_LABELS[order.status]}</span>
                </div>
                <div><strong>${escapeHtml(order.customer_name)}</strong> — ${escapeHtml(order.phone)}</div>
                <div class="text-muted small mb-2">${escapeHtml(order.address)}</div>
                <div>${itemsHtml}</div>
                ${order.notes ? `<div class="text-muted small mt-1"><i class="bi bi-chat-left-text me-1"></i>${escapeHtml(order.notes)}</div>` : ''}
                <div class="d-flex justify-content-between mt-2">
                    <span>Total: <strong>Rs. ${order.total}</strong></span>
                    <span class="text-muted">${escapeHtml((order.payment_method || '').toUpperCase())} • ${escapeHtml(order.payment_status)}</span>
                </div>
                <div class="staff-status-actions">
                    ${order.status !== 'cancelled' && order.status !== 'delivered' ? actionsHtml : ''}
                    ${order.status !== 'cancelled' && order.status !== 'delivered' ? `<button class="btn btn-sm btn-outline-danger cancel-btn" data-order="${escapeHtml(order.order_number)}">Cancel</button>` : ''}
                </div>
            </div>
        `);
        $list.append($card);

        const shouldAnimate = animateOrderNumbers === 'all'
            || (animateOrderNumbers instanceof Set && animateOrderNumbers.has(order.order_number));
        if (shouldAnimate) cardsToAnimate.push({ el: $card[0], index });
    });

    if (window.Motion && cardsToAnimate.length) {
        cardsToAnimate.forEach(({ el, index }) => {
            Motion.animate(el, { opacity: [0, 1], y: [16, 0], scale: [0.96, 1] }, { duration: 0.4, delay: index * 0.05, easing: [0.22, 1, 0.36, 1] });
        });
    }
}

async function loadOrders(isInitial) {
    if (isInitial) $('#ordersList').html('<p class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Loading orders...</p>');

    let settled = false;
    const timeoutId = setTimeout(() => {
        if (!settled) { settled = true; showLoginView('Connection timed out. Check internet and try again.'); }
    }, 12000);

    const { data, error } = await supabaseClient.rpc('staff_list_orders', { p_pin: staffPin });
    clearTimeout(timeoutId);
    if (settled) return;
    settled = true;

    if (error) {
        showLoginView(error.message && error.message.includes('Too many') ? error.message : 'Session expired. Please log in again.');
        return;
    }

    const newOrderNumbers = new Set();
    if (!isInitial && knownOrderNumbers.size > 0) {
        (data || []).forEach(order => {
            if (!knownOrderNumbers.has(order.order_number)) {
                newOrderNumbers.add(order.order_number);
                notifyNewOrder(order);
            }
        });
    }
    knownOrderNumbers = new Set((data || []).map(o => o.order_number));

    allOrders = data || [];
    renderOrders(isInitial ? 'all' : newOrderNumbers);
}

$(document).on('click', '.cancel-btn', async function () {
    const orderNumber = $(this).data('order');
    if (!confirm(`Cancel order #${orderNumber}? This cannot be undone.`)) return;
    $(this).prop('disabled', true);

    const { error } = await supabaseClient.functions.invoke('update-order-status', {
        body: {
            p_pin: staffPin,
            p_order_number: orderNumber,
            p_new_status: 'cancelled'
        }
    });

    if (error) {
        staffToast('Could not cancel order. Please try again.', 'danger');
        $(this).prop('disabled', false);
        return;
    }
    staffToast(`Order #${orderNumber} cancelled`, 'warning');
    loadOrders(true);
});

$(document).on('click', '.status-btn', async function () {
    const orderNumber = $(this).data('order');
    const newStatus = $(this).data('status');
    $(this).prop('disabled', true);

    const { error } = await supabaseClient.functions.invoke('update-order-status', {
        body: {
            p_pin: staffPin,
            p_order_number: orderNumber,
            p_new_status: newStatus
        }
    });

    if (error) {
        staffToast('Could not update order status. Please try again.', 'danger');
    }
    loadOrders(true);
});

$(document).ready(function () {
    if (staffPin) {
        verifyAndEnter(staffPin).catch(() => showLoginView());
    } else {
        animateLoginCardIn();
    }
});
