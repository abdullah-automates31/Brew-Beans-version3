const STEPS = [
    { key: 'placed', label: 'Placed', icon: 'bi-bag-check' },
    { key: 'preparing', label: 'Preparing', icon: 'bi-cup-hot' },
    { key: 'out_for_delivery', label: 'Out for Delivery', icon: 'bi-bicycle' },
    { key: 'delivered', label: 'Delivered', icon: 'bi-house-check' }
];

const STATUS_LABELS = { placed: 'Placed', preparing: 'Preparing', out_for_delivery: 'Out for Delivery', delivered: 'Delivered', cancelled: 'Cancelled' };

// Mirrors CANCELLABLE_STATUSES in supabase/functions/cancel-order/index.ts —
// once the kitchen/rider is committed, cancellation is staff-only.
const CANCELLABLE_STATUSES = ['placed', 'preparing'];

let pollTimer = null;
let lastStatus = null;
let notifyEnabled = false;

// Single source of truth for the notify button's look. Toggling a class
// and swapping the label keeps the markup (icon + text span) intact —
// rewriting innerHTML, as this used to, would drop the structure the CSS
// animations hang off. `pop` plays the one-shot switch-on animation, but
// only when the user just turned it on, not on the silent restore path.
function setNotifyState(on, pop) {
    const $btn = $('#notifyBtn');
    $btn.toggleClass('is-on', on).attr('aria-pressed', String(on));
    $btn.find('.bi').attr('class', on ? 'bi bi-bell-fill' : 'bi bi-bell');
    $btn.find('.btn-notify-text').text(on ? 'Notifying' : 'Notify me');
    if (on && pop) {
        $btn.removeClass('just-on');
        // Reflow so the animation restarts even on a repeat toggle.
        void $btn[0].offsetWidth;
        $btn.addClass('just-on');
    }
}
let currentOrderNumber = null;
let currentPhone = null;
let cancelOrderModal = null;
let cancelling = false;

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

function updateCancelButton(status) {
    $('#cancelOrderWrap').toggle(CANCELLABLE_STATUSES.includes(status));
}

$('#notifyBtn').on('click', async function () {
    if (!('Notification' in window)) {
        $('#trackError').removeClass('alert-success alert-danger').addClass('alert-warning').text('Browser notifications are not supported here.').show();
        return;
    }
    const perm = await Notification.requestPermission();
    notifyEnabled = perm === 'granted';
    setNotifyState(notifyEnabled, true);
});

$('#cancelOrderBtn').on('click', function () {
    if (cancelOrderModal) cancelOrderModal.show();
});

$('#confirmCancelBtn').on('click', async function () {
    if (cancelling || !currentOrderNumber || !currentPhone) return;
    cancelling = true;
    const $btn = $(this).prop('disabled', true).text('Cancelling...');

    const { data, error } = await supabaseClient.functions.invoke('cancel-order', {
        body: { p_order_number: currentOrderNumber, p_phone: currentPhone }
    });

    cancelling = false;
    $btn.prop('disabled', false).text('Yes, Cancel Order');
    if (cancelOrderModal) cancelOrderModal.hide();

    if (error || !data) {
        // A FunctionsHttpError only carries a generic "non-2xx" message —
        // the real reason (already cancelled / status moved on / rate
        // limited) is in the response body on error.context. Same pattern
        // as invokeStaffOrders() in js/staff.js.
        let message = 'This order could not be cancelled. Please try again or contact us.';
        if (error && error.context && typeof error.context.json === 'function') {
            try {
                message = (await error.context.json()).error || message;
            } catch (e) { /* non-JSON body — fall back to the generic message */ }
        }
        $('#trackError').removeClass('alert-success alert-warning').addClass('alert-danger').text(message).show();
        return;
    }

    stopPolling();
    lastStatus = 'cancelled';
    updateCancelButton('cancelled');
    renderSteps('cancelled', true);
    $('#etaText').text('');
    $('#trackError').removeClass('alert-warning alert-danger').addClass('alert-success')
        .text('Your order has been cancelled successfully.').show();
});

function animateStepsIn() {
    if (!window.Motion) return;
    $('#trackingSteps').children().each(function (i, el) {
        Motion.animate(el, { opacity: [0, 1], y: [16, 0], scale: [0.9, 1] }, { duration: 0.4, delay: i * 0.08, easing: [0.22, 1, 0.36, 1] });
    });
}

function renderSteps(status, animateIn) {
    const $steps = $('#trackingSteps');
    $steps.empty();

    if (status === 'cancelled') {
        $steps.append(`
            <div class="tracking-step cancelled">
                <div class="tracking-step-icon"><i class="bi bi-x-lg"></i></div>
                <div class="tracking-step-label">Order Cancelled</div>
            </div>
        `);
        if (animateIn) animateStepsIn();
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

    if (animateIn) animateStepsIn();
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

    const statusChanged = Boolean(lastStatus && lastStatus !== order.status);

    if (statusChanged) {
        if (order.status === 'cancelled') {
            $('#trackError').removeClass('alert-warning alert-success').addClass('alert-danger')
                .html('<strong>Order Cancelled</strong> — Your order has been cancelled. Please contact us for help.').show();
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Brew Beans — Order Cancelled', {
                    body: `Your order ${orderNumber} has been cancelled. Please contact us for assistance.`
                });
            }
        } else {
            const label = STATUS_LABELS[order.status] || order.status;
            $('#trackError').removeClass('alert-warning alert-danger').addClass('alert-success').text(`Order status updated: ${label}`).show();
            if (notifyEnabled && 'Notification' in window && Notification.permission === 'granted') {
                new Notification('Brew Beans order update', { body: `${orderNumber} is now ${label}` });
            }
        }
    }
    lastStatus = order.status;
    updateCancelButton(order.status);

    // Animate on fresh lookup or when status advances — not on every silent background poll.
    renderSteps(order.status, !silent || statusChanged);
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
                <span>Rs. ${item.total_price ?? (item.unit_price ?? 0) * item.quantity}</span>
            </div>
        `);
    });

    $('#trackSubtotal').text(`Rs. ${order.subtotal}`);
    $('#trackDelivery').text(order.delivery_charge === 0 ? 'FREE' : `Rs. ${order.delivery_charge}`);
    $('#trackTotal').text(`Rs. ${order.total}`);

    $('#lastUpdated').text(`Live — last checked ${new Date().toLocaleTimeString()}`);
    const $result = $('#trackResult');
    const wasHidden = $result.is(':hidden');
    $result.show();
    if (wasHidden && window.Motion) {
        Motion.animate('#trackResult', { opacity: [0, 1], y: [16, 0] }, { duration: 0.4, easing: [0.22, 1, 0.36, 1] });
    }

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

    const cancelModalEl = document.getElementById('cancelOrderModal');
    if (cancelModalEl && window.bootstrap) cancelOrderModal = new bootstrap.Modal(cancelModalEl);

    if (window.Motion) {
        Motion.animate('.tracking-card', { opacity: [0, 1], y: [24, 0] }, { duration: 0.5, easing: [0.22, 1, 0.36, 1] });
    } else {
        $('.tracking-card').css('opacity', 1);
    }

    const params = new URLSearchParams(window.location.search);
    const order = params.get('order');
    const payment = params.get('payment');

    // Phone is handed off via sessionStorage (set at checkout) rather than a
    // URL query param, so it never ends up in browser history or server logs.
    // Fall back to a legacy ?phone= param for any old links still in the wild.
    let phone = params.get('phone');
    if (order) {
        try {
            const stored = sessionStorage.getItem(`bb_phone_${order}`);
            if (stored) {
                phone = stored;
                sessionStorage.removeItem(`bb_phone_${order}`);
            }
        } catch (e) { /* sessionStorage unavailable */ }
    }

    if (order) $('#orderNumberInput').val(order);
    if (phone) $('#phoneInput').val(phone);

    if (payment === 'success') {
        $('#trackError').removeClass('alert-warning').addClass('alert-success').text('Payment successful! Here is your order status.').show();
    } else if (payment === 'failed') {
        $('#trackError').removeClass('alert-warning').addClass('alert-danger').text('Payment could not be completed. Please contact us or try again.').show();
    }

    if (order && phone) {
        trackOrder(order, phone);

        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                notifyEnabled = true;
                // Silent restore of an already-granted permission — no pop.
                setNotifyState(true, false);
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(perm => {
                    notifyEnabled = perm === 'granted';
                    if (notifyEnabled) setNotifyState(true, true);
                });
            }
        }
    }
});
