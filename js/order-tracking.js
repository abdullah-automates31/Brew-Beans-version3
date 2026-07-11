const STEPS = [
    { key: 'placed', label: 'Placed', icon: 'bi-bag-check' },
    { key: 'preparing', label: 'Preparing', icon: 'bi-cup-hot' },
    { key: 'out_for_delivery', label: 'Out for Delivery', icon: 'bi-bicycle' },
    { key: 'delivered', label: 'Delivered', icon: 'bi-house-check' }
];

const STATUS_LABELS = { placed: 'Placed', preparing: 'Preparing', out_for_delivery: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled' };

let pollTimer = null;
let lastStatus = null;
let notifyEnabled = false;
let currentOrderNumber = null;
let currentPhone = null;

function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function etaEstimate(createdAt, deliveryCharge) {
    const prepMin = 15;
    const legMin = deliveryCharge > 0 ? 25 : 8;
    const eta = new Date(new Date(createdAt).getTime() + (prepMin + legMin) * 60000);
    return eta;
}

$('#notifyBtn').on('click', async function () {
    if (!('Notification' in window)) {
        $('#trackError').removeClass('alert-success alert-danger').addClass('alert-warning').text('Browser notifications are not supported here.').show();
        return;
    }
    const perm = await Notification.requestPermission();
    notifyEnabled = perm === 'granted';
    $(this).html(notifyEnabled ? '<i class="bi bi-bell-fill me-1"></i>Notifying' : '<i class="bi bi-bell me-1"></i>Notify me');
});

function renderSteps(status) {
    const $steps = $('#trackingSteps');
    $steps.empty();

    if (status === 'cancelled') {
        $steps.append(`
            <div class="tracking-step cancelled">
                <div class="tracking-step-icon"><i class="bi bi-x-lg"></i></div>
                <div class="tracking-step-label">Order Cancelled</div>
            </div>
        `);
        return;
    }

    const currentIndex = STEPS.findIndex(s => s.key === status);
    STEPS.forEach((step, i) => {
        let cls = '';
        if (i < currentIndex) cls = 'done';
        else if (i === currentIndex) cls = 'active';
        $steps.append(`
            <div class="tracking-step ${cls}">
                <div class="tracking-step-icon"><i class="bi ${step.icon}"></i></div>
                <div class="tracking-step-label">${step.label}</div>
            </div>
        `);
    });
}

function paymentLabel(method, status) {
    const methodNames = { cod: 'Cash on Delivery', jazzcash: 'JazzCash', easypaisa: 'EasyPaisa' };
    const statusNames = { pending: 'Payment Pending', paid: 'Paid', failed: 'Payment Failed', cod: 'Pay on Delivery' };
    return `${methodNames[method] || method} — ${statusNames[status] || status}`;
}

async function trackOrder(orderNumber, phone, silent) {
    if (!silent) {
        $('#trackError').hide();
        $('#trackResult').hide();
        $('#trackBtn').prop('disabled', true).html('<i class="bi bi-arrow-repeat spin me-2"></i>Searching...');
    }

    const { data, error } = await supabaseClient.rpc('get_order_status', {
        p_order_number: orderNumber,
        p_phone: phone
    });

    if (!silent) $('#trackBtn').prop('disabled', false).html('<i class="bi bi-search me-2"></i>Track Order');

    const order = Array.isArray(data) ? data[0] : data;

    if (error || !order) {
        if (!silent) $('#trackError').removeClass('alert-success alert-danger').addClass('alert-warning').text("We couldn't find an order matching that ID and phone number. Please double-check and try again.").show();
        stopPolling();
        return;
    }

    currentOrderNumber = orderNumber;
    currentPhone = phone;

    if (lastStatus && lastStatus !== order.status) {
        const label = STATUS_LABELS[order.status] || order.status;
        $('#trackError').removeClass('alert-warning alert-danger').addClass('alert-success').text(`Order status updated: ${label}`).show();
        if (notifyEnabled && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('Brew Beans order update', { body: `${orderNumber} is now ${label}` });
        }
    }
    lastStatus = order.status;

    renderSteps(order.status);
    $('#paymentBadge').text(paymentLabel(order.payment_method, order.payment_status));

    if (order.status === 'cancelled') {
        $('#etaText').text('');
    } else if (order.status === 'delivered') {
        $('#etaText').text('Delivered — enjoy!');
    } else {
        const eta = etaEstimate(order.created_at, order.delivery_charge);
        $('#etaText').text(`Estimated ready by ${eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    }

    const $items = $('#trackItems');
    $items.empty();
    (order.items || []).forEach(item => {
        $items.append(`
            <div class="d-flex justify-content-between">
                <span>${item.quantity}x ${escapeHtml(item.name)}</span>
                <span>Rs. ${item.price * item.quantity}</span>
            </div>
        `);
    });

    $('#trackSubtotal').text(`Rs. ${order.subtotal}`);
    $('#trackDelivery').text(order.delivery_charge === 0 ? 'FREE' : `Rs. ${order.delivery_charge}`);
    $('#trackTotal').text(`Rs. ${order.total}`);

    $('#lastUpdated').text(`Live — last checked ${new Date().toLocaleTimeString()}`);
    $('#trackResult').show();

    if (order.status === 'delivered' || order.status === 'cancelled') {
        stopPolling();
    } else {
        startPolling();
    }
}

function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
        if (currentOrderNumber && currentPhone) trackOrder(currentOrderNumber, currentPhone, true);
    }, 10000);
}

function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

$('#trackForm').on('submit', function (e) {
    e.preventDefault();
    const orderNumber = $('#orderNumberInput').val().trim();
    const phone = $('#phoneInput').val().trim();
    if (!orderNumber || !phone) return;
    stopPolling();
    lastStatus = null;
    trackOrder(orderNumber, phone);
});

$(document).ready(function () {
    $('<style>').text('@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}.spin{animation:spin 1s linear infinite;display:inline-block}').appendTo('head');

    const params = new URLSearchParams(window.location.search);
    const order = params.get('order');
    const phone = params.get('phone');
    const payment = params.get('payment');

    if (order) $('#orderNumberInput').val(order);
    if (phone) $('#phoneInput').val(phone);

    if (payment === 'success') {
        $('#trackError').removeClass('alert-warning').addClass('alert-success').text('Payment successful! Here is your order status.').show();
    } else if (payment === 'failed') {
        $('#trackError').removeClass('alert-warning').addClass('alert-danger').text('Payment could not be completed. Please contact us or try again.').show();
    }

    if (order && phone) {
        trackOrder(order, phone);
    }
});
