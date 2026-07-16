/* ============================================
   BREW BEANS - Premium Coffee Shop Website
   JavaScript Application
   Version: 1.0.0
   ============================================ */

$(document).ready(function () {

    // ==========================================
    // MENU DATA
    // ==========================================
    let menuItems = [];

    // Shop coordinates (Gulshan-e-Iqbal, Karachi)
    const SHOP_LAT = 24.9180;
    const SHOP_LNG = 67.0971;

    function sanitizeCartData(storedCart) {
        if (!Array.isArray(storedCart)) return [];
        return storedCart
            .filter(item => item && typeof item.id === 'number' && typeof item.price === 'number' && Number.isFinite(item.quantity) && item.quantity > 0)
            .map(item => {
                const selectedAddons = Array.isArray(item.selectedAddons)
                    ? item.selectedAddons.filter(a => a && typeof a.name === 'string')
                    : [];
                const cartKey = item.cartKey || (selectedAddons.length
                    ? `${item.id}_${selectedAddons.map(a => a.name).join('|')}`
                    : String(item.id));
                return {
                    id: Number(item.id),
                    cartKey,
                    name: item.name || '',
                    price: Number(item.price),
                    addonPrice: Number(item.addonPrice) || 0,
                    selectedAddons,
                    image: item.image || '',
                    quantity: Number(item.quantity)
                };
            });
    }

    // Corrupted localStorage (bad JSON from a browser extension, a previous
    // bug, or manual tampering) must never throw here — a top-level throw
    // would abort the rest of this script and break every feature on the page.
    function safeReadLocalStorage(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            localStorage.removeItem(key);
            return null;
        }
    }

    // Private-browsing modes and full storage quotas throw on setItem —
    // never let that abort whatever the caller was doing next (e.g. rendering).
    function safeWriteLocalStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { /* storage unavailable; app continues without persistence */ }
    }

    // ==========================================
    // STATE MANAGEMENT
    // ==========================================
    let cart = sanitizeCartData(safeReadLocalStorage('brewBeansCart') || []);
    let userLocation = safeReadLocalStorage('brewBeansLocation') || null;

    // ==========================================
    // LOADING SCREEN
    // ==========================================
    setTimeout(function () {
        $('#loading-screen').addClass('hidden');
    }, 2500);

    // ==========================================
    // LOCATION PERMISSION
    // ==========================================
    const locationModal = new bootstrap.Modal(document.getElementById('locationModal'));

    // Show location modal after loading
    setTimeout(function () {
        if (!userLocation) {
            locationModal.show();
        }
    }, 3000);

    $('#allowLocation').on('click', function () {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                function (position) {
                    userLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        timestamp: new Date().toISOString()
                    };
                    safeWriteLocalStorage('brewBeansLocation', userLocation);
                    locationModal.hide();
                    showToast('Location saved successfully!');
                },
                function (error) {
                    console.error('Location error:', error);
                    showToast('Could not access location. Please enter manually.', 'warning');
                    locationModal.hide();
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        } else {
            showToast('Geolocation is not supported by your browser.', 'warning');
            locationModal.hide();
        }
    });

    $('#denyLocation').on('click', function () {
        showToast('You can enable location later from checkout.', 'info');
    });

    // ==========================================
    // NAVBAR SCROLL EFFECT
    // ==========================================
    $(window).on('scroll', function () {
        if ($(window).scrollTop() > 50) {
            $('#mainNav').addClass('scrolled');
        } else {
            $('#mainNav').removeClass('scrolled');
        }
    });

    // // Smooth scrolling for nav links
    // $('a[href^="#"]').on('click', function(e) {
    //     e.preventDefault();
    //     const target = $(this.getAttribute('href'));
    //     if (target.length) {
    //         $('html, body').animate({
    //             scrollTop: target.offset().top - 70
    //         }, 800, 'swing');
    //     }
    //     // Close mobile menu
    //     $('.navbar-collapse').collapse('hide');
    // });
    // Smooth scrolling for nav links - FIXED VERSION
    $('a[href^="#"]').on('click', function (e) {
        // Only handle if it's a nav-link (not dropdown toggles or other anchors)
        if (!$(this).hasClass('nav-link')) return;

        e.preventDefault();
        const target = $(this.getAttribute('href'));
        if (target.length) {
            $('html, body').animate({
                scrollTop: target.offset().top - 70
            }, 800, 'swing');
        }

        // Close mobile menu using Bootstrap's API properly
        const navbarCollapse = document.querySelector('.navbar-collapse');
        if (navbarCollapse && navbarCollapse.classList.contains('show')) {
            const bsCollapse = bootstrap.Collapse.getInstance(navbarCollapse);
            if (bsCollapse) {
                bsCollapse.hide();
            } else {
                $(navbarCollapse).collapse('hide');
            }
        }
    });

    // // Active nav link on scroll
    // $(window).on('scroll', function () {
    //     const scrollPos = $(window).scrollTop() + 100;
    //     $('.nav-link').each(function () {
    //         const section = $($(this).attr('href'));
    //         if (section.length) {
    //             const sectionTop = section.offset().top;
    //             const sectionBottom = sectionTop + section.outerHeight();
    //             if (scrollPos >= sectionTop && scrollPos < sectionBottom) {
    //                 $('.nav-link').removeClass('active');
    //                 $(this).addClass('active');
    //             }
    //         }
    //     });
    // });

    // Active nav link on scroll
    $(window).on('scroll', function () {
        const scrollPos = $(window).scrollTop() + 100;
        $('.nav-link').each(function () {
            const href = $(this).attr('href');
            if (!href || !href.startsWith('#')) return;

            const section = $(href);
            if (section.length) {
                const sectionTop = section.offset().top;
                const sectionBottom = sectionTop + section.outerHeight();
                if (scrollPos >= sectionTop && scrollPos < sectionBottom) {
                    $('.nav-link').removeClass('active');
                    $(this).addClass('active');
                }
            }
        });
    });

    // ==========================================
    // AOS ANIMATIONS
    // ==========================================
    AOS.init({
        duration: 450,
        easing: 'ease-out-cubic',
        once: true,
        offset: 60,
        disable: function () {
            return window.innerWidth < 768;
        }
    });

    // ==========================================
    // MENU RENDERING
    // ==========================================
    function renderMenu(filter = 'all') {
        const $grid = $('#menuGrid');
        $grid.empty();

        const filteredItems = filter === 'all'
            ? menuItems
            : menuItems.filter(item => item.category === filter);

        filteredItems.forEach((item, index) => {
            const aosDirection = index % 2 === 0 ? 'fade-right' : 'fade-left';
            const aosDelay = (index % 4) * 75;
            const html = `
                <div class="col-12 col-md-6 col-lg-3" data-aos="${aosDirection}" data-aos-delay="${aosDelay}">
                    <div class="menu-item" data-id="${item.id}">
                        <div class="menu-item-img">
                            <img src="${item.image}" alt="${item.name}" loading="lazy">
                            <span class="menu-item-badge">${item.category.replace('-', ' ')}</span>
                        </div>
                        <div class="menu-item-content">
                            <h3 class="menu-item-name">${item.name}</h3>
                            <p class="menu-item-desc">${item.description}</p>
                            <div class="menu-item-footer">
                                <span class="menu-item-price">Rs. ${item.price}</span>
                                <button class="btn-add-cart" data-id="${item.id}">
                                    <i class="bi bi-plus-lg"></i> Add
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            $grid.append(html);
        });

        // AOS's mobile "disable" check only runs once, at AOS.init() time, on
        // elements that already exist in the DOM. Menu items are injected here,
        // after that point, so AOS never processes them on mobile — they'd be
        // stuck permanently at opacity:0 with their data-aos attribute doing
        // nothing but hiding them forever. Strip it manually on mobile so menu
        // items are always visible; only let AOS animate them on larger screens.
        if (window.innerWidth < 768) {
            $grid.find('[data-aos]').removeAttr('data-aos').removeAttr('data-aos-delay');
        } else if (typeof AOS !== 'undefined') {
            AOS.refreshHard();
        }
    }

    // Initial render — load from Supabase
    async function loadMenuFromDB() {
        const $grid = $('#menuGrid');
        $grid.html('<div class="col-12 text-center py-5"><div class="spinner-border text-success" role="status"></div><p class="mt-3 text-muted">Loading menu...</p></div>');

        const { data, error } = await supabaseClient
            .from('menu_items')
            .select('*')
            .eq('is_available', true)
            .order('id');

        if (error || !data || !data.length) {
            $grid.html('<div class="col-12 text-center py-5 text-muted">Menu unavailable. Please try again later.</div>');
            return;
        }

        menuItems = data;
        renderMenu();
    }

    loadMenuFromDB();

    // ==========================================
    // MENU FILTERS
    // ==========================================
    $('.filter-btn').on('click', function () {
        $('.filter-btn').removeClass('active');
        $(this).addClass('active');
        const filter = $(this).data('filter');
        renderMenu(filter);
    });

    // Category card click
    $('.category-card').on('click', function () {
        const category = $(this).data('category');
        $('.filter-btn').removeClass('active');
        $(`.filter-btn[data-filter="${category}"]`).addClass('active');
        renderMenu(category);
        $('html, body').animate({
            scrollTop: $('#menu').offset().top - 80
        }, 800);
    });

    // ==========================================
    // CART FUNCTIONALITY
    // ==========================================
    function updateCart() {
        cart = cart.filter(item => item && Number.isFinite(item.quantity) && item.quantity > 0);
        safeWriteLocalStorage('brewBeansCart', cart);
        renderCart();
        updateCartBadge();
    }

    function updateCartBadge() {
        const totalItems = cart.reduce((sum, item) => sum + Math.max(0, Number(item.quantity)), 0);
        const $badge = $('#cartCount');
        $badge.text(totalItems || 0);
        if (totalItems > 0) {
            $badge.addClass('show');
        } else {
            $badge.removeClass('show');
        }
    }

    function renderCart() {
        const $items = $('#cartItems');
        const $empty = $('#emptyCart');
        const $footer = $('#cartFooter');

        if (cart.length === 0) {
            $items.hide();
            $empty.show();
            $footer.hide();
            return;
        }

        $empty.hide();
        $items.show();
        $footer.show();
        $items.empty();

        let subtotal = 0;

        cart.forEach(item => {
            const unitPrice = item.price + (item.addonPrice || 0);
            const itemTotal = unitPrice * item.quantity;
            subtotal += itemTotal;
            const addonHtml = item.selectedAddons && item.selectedAddons.length
                ? `<div class="cart-item-addons">${item.selectedAddons.map(a => a.price > 0 ? `${a.name} +Rs.${a.price}` : a.name).join(' · ')}</div>`
                : '';
            const html = `
                <div class="cart-item" data-cart-key="${item.cartKey}">
                    <img src="${item.image}" alt="${item.name}" class="cart-item-img">
                    <div class="cart-item-info">
                        <div class="cart-item-name">${item.name}</div>
                        ${addonHtml}
                        <div class="cart-item-price">Rs. ${itemTotal}</div>
                        <div class="cart-item-actions">
                            <button class="cart-qty-btn qty-minus"><i class="bi bi-dash"></i></button>
                            <span class="cart-qty">${item.quantity}</span>
                            <button class="cart-qty-btn qty-plus"><i class="bi bi-plus"></i></button>
                            <button class="cart-item-remove"><i class="bi bi-trash"></i></button>
                        </div>
                    </div>
                </div>
            `;
            $items.append(html);
        });

        // Calculate delivery
        const deliveryCharge = subtotal > 1000 ? 0 : 100;
        const grandTotal = subtotal + deliveryCharge;

        $('#subtotal').text(`Rs. ${subtotal}`);
        $('#deliveryCharge').text(deliveryCharge === 0 ? 'FREE' : `Rs. ${deliveryCharge}`);
        $('#grandTotal').text(`Rs. ${grandTotal}`);
    }

    // ==========================================
    // ADDON SELECTION
    // ==========================================
    let currentAddonItem = null;

    function addDirectToCart(menuItem, $btn) {
        const cartKey = String(menuItem.id);
        const existingItem = cart.find(item => item.cartKey === cartKey);
        if (existingItem) {
            existingItem.quantity++;
        } else {
            cart.push({
                id: menuItem.id,
                cartKey,
                name: menuItem.name,
                price: menuItem.price,
                addonPrice: 0,
                selectedAddons: [],
                image: menuItem.image,
                quantity: 1
            });
        }
        updateCart();
        showToast(`${menuItem.name} added to cart!`);
        if ($btn) {
            $btn.addClass('added').html('<i class="bi bi-check-lg"></i> Added');
            setTimeout(() => $btn.removeClass('added').html('<i class="bi bi-plus-lg"></i> Add'), 1500);
        }
    }

    async function openAddonModal(menuItem, groupIds) {
        currentAddonItem = menuItem;
        $('#addonModalItemName').text(menuItem.name);
        $('#addonTotalPrice').text(menuItem.price);

        const $container = $('#addonGroupsContainer');
        $container.html('<div class="text-center py-4"><div class="spinner-border text-success spinner-border-sm"></div><p class="mt-2 text-muted small">Loading options...</p></div>');
        addonModal.show();

        const { data: groups, error } = await supabaseClient
            .from('addon_groups')
            .select('id, name, is_required, addons(id, name, price, is_available)')
            .in('id', groupIds);

        if (error || !groups) {
            $container.html('<p class="text-center text-muted py-3 small">Could not load options.</p>');
            return;
        }

        const validGroups = groups
            .map(g => ({ ...g, addons: (g.addons || []).filter(a => a.is_available) }))
            .filter(g => g.addons.length > 0)
            .sort((a, b) => (a.is_required === b.is_required ? a.name.localeCompare(b.name) : a.is_required ? -1 : 1));

        if (!validGroups.length) {
            addonModal.hide();
            addDirectToCart(menuItem, null);
            return;
        }

        let html = '';
        validGroups.forEach(group => {
            const badge = group.is_required
                ? '<span class="addon-required-badge">Required</span>'
                : '<span class="addon-optional-badge">Optional</span>';
            const optionsHtml = group.addons.map(addon => `
                <div class="addon-option"
                     data-group-id="${group.id}"
                     data-required="${group.is_required}"
                     data-addon-name="${addon.name.replace(/"/g, '&quot;')}"
                     data-addon-price="${addon.price}">
                    <span class="addon-option-name">${addon.name}</span>
                    ${addon.price > 0 ? `<span class="addon-option-price">+Rs.${addon.price}</span>` : ''}
                </div>`).join('');
            html += `
                <div class="addon-group">
                    <div class="addon-group-title">${group.name} ${badge}</div>
                    <div class="addon-options" data-group-id="${group.id}" data-required="${group.is_required}">
                        ${optionsHtml}
                    </div>
                </div>`;
        });
        $container.html(html);
        updateAddonTotal();
    }

    function updateAddonTotal() {
        if (!currentAddonItem) return;
        let extra = 0;
        $('.addon-option.selected').each(function () {
            extra += parseInt($(this).data('addon-price')) || 0;
        });
        $('#addonTotalPrice').text(currentAddonItem.price + extra);
    }

    // Addon option click — radio for required, checkbox for optional
    $(document).on('click', '.addon-option', function () {
        const $this = $(this);
        const groupId = $this.data('group-id');
        const isRequired = $this.closest('.addon-options').data('required');
        if (isRequired === true || isRequired === 'true') {
            $(`.addon-option[data-group-id="${groupId}"]`).removeClass('selected');
            $this.addClass('selected');
        } else {
            $this.toggleClass('selected');
        }
        updateAddonTotal();
    });

    // Add to cart from addon modal
    $('#addonAddToCartBtn').on('click', function () {
        if (!currentAddonItem) return;

        let allRequiredFilled = true;
        $('#addonGroupsContainer .addon-options[data-required="true"]').each(function () {
            const groupId = $(this).data('group-id');
            if ($(`.addon-option.selected[data-group-id="${groupId}"]`).length === 0) {
                allRequiredFilled = false;
                return false;
            }
        });

        if (!allRequiredFilled) {
            showToast('Please select all required options', 'warning');
            return;
        }

        const selectedAddons = [];
        let addonPrice = 0;
        $('.addon-option.selected').each(function () {
            const price = parseInt($(this).data('addon-price')) || 0;
            selectedAddons.push({ name: $(this).data('addon-name'), price });
            addonPrice += price;
        });

        const cartKey = selectedAddons.length
            ? `${currentAddonItem.id}_${selectedAddons.map(a => a.name).join('|')}`
            : String(currentAddonItem.id);

        const existingItem = cart.find(item => item.cartKey === cartKey);
        if (existingItem) {
            existingItem.quantity++;
        } else {
            cart.push({
                id: currentAddonItem.id,
                cartKey,
                name: currentAddonItem.name,
                price: currentAddonItem.price,
                addonPrice,
                selectedAddons,
                image: currentAddonItem.image,
                quantity: 1
            });
        }

        addonModal.hide();
        updateCart();
        showToast(`${currentAddonItem.name} added to cart!`);
        currentAddonItem = null;
    });

    // Add to cart (checks for addon groups first)
    $(document).on('click', '.btn-add-cart', async function () {
        const id = parseInt($(this).data('id'));
        const menuItem = menuItems.find(item => item.id === id);
        if (!menuItem) return;

        const $btn = $(this);
        $btn.prop('disabled', true);

        const { data: groupLinks } = await supabaseClient
            .from('menu_item_addon_groups')
            .select('addon_group_id')
            .eq('menu_item_id', id);

        $btn.prop('disabled', false);

        if (groupLinks && groupLinks.length > 0) {
            openAddonModal(menuItem, groupLinks.map(g => g.addon_group_id));
        } else {
            addDirectToCart(menuItem, $btn);
        }
    });

    // Cart quantity controls
    $(document).on('click', '.qty-minus', function () {
        const cartKey = $(this).closest('.cart-item').data('cart-key');
        const cartItem = cart.find(item => item.cartKey === cartKey);
        if (cartItem && cartItem.quantity > 1) {
            cartItem.quantity--;
            updateCart();
        }
    });

    $(document).on('click', '.qty-plus', function () {
        const cartKey = $(this).closest('.cart-item').data('cart-key');
        const cartItem = cart.find(item => item.cartKey === cartKey);
        if (cartItem) {
            cartItem.quantity++;
            updateCart();
        }
    });

    $(document).on('click', '.cart-item-remove', function () {
        const cartKey = $(this).closest('.cart-item').data('cart-key');
        cart = cart.filter(item => item.cartKey !== cartKey);
        updateCart();
        showToast('Item removed from cart');
    });

    // Cart sidebar toggle
    $('#cartToggle').on('click', function () {
        $('#cartSidebar').addClass('open');
        $('#cartOverlay').addClass('show');
        $('body').css('overflow', 'hidden');
    });

    $('#closeCart, #cartOverlay').on('click', function () {
        $('#cartSidebar').removeClass('open');
        $('#cartOverlay').removeClass('show');
        $('body').css('overflow', '');
    });

    // ==========================================
    // CHECKOUT
    // ==========================================
    const checkoutModal = new bootstrap.Modal(document.getElementById('checkoutModal'));
    const successModal = new bootstrap.Modal(document.getElementById('successModal'));
    const addonModal = new bootstrap.Modal(document.getElementById('addonModal'));
    let checkoutLatLng = null;
    let checkoutDeliveryCharge = 100;

    $('#checkoutBtn').on('click', function () {
        if (cart.length === 0) {
            showToast('Your cart is empty!', 'warning');
            return;
        }

        $('#cartSidebar').removeClass('open');
        $('#cartOverlay').removeClass('show');
        $('body').css('overflow', '');

        renderCheckoutSummary();

        // Pre-fill location if available
        if (userLocation) {
            $('#currentLocation').val(`${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`);
            calculateDeliveryEstimate(userLocation.lat, userLocation.lng);
            checkoutLatLng = { lat: userLocation.lat, lng: userLocation.lng };
        }

        checkoutModal.show();
    });

    function renderCheckoutSummary() {
        const $items = $('#checkoutItems');
        $items.empty();

        let subtotal = 0;
        cart.forEach(item => {
            const unitPrice = item.price + (item.addonPrice || 0);
            const itemTotal = unitPrice * item.quantity;
            subtotal += itemTotal;
            const addonNames = item.selectedAddons && item.selectedAddons.length
                ? `<span class="checkout-item-addons">${item.selectedAddons.map(a => a.name).join(', ')}</span>`
                : '';
            const html = `
                <div class="checkout-item">
                    <span class="checkout-item-name">
                        <span class="checkout-item-qty">${item.quantity}x</span>
                        ${item.name}${addonNames}
                    </span>
                    <span>Rs. ${itemTotal}</span>
                </div>
            `;
            $items.append(html);
        });

        const deliveryCharge = subtotal > 1000 ? 0 : 100;
        checkoutDeliveryCharge = deliveryCharge;
        const total = subtotal + deliveryCharge;

        $('#checkoutSubtotal').text(`Rs. ${subtotal}`);
        $('#checkoutDelivery').text(deliveryCharge === 0 ? 'FREE' : `Rs. ${deliveryCharge}`);
        $('#checkoutTotal').text(`Rs. ${total}`);
    }

    // Detect location button
    $('#detectLocation').on('click', function () {
        if (navigator.geolocation) {
            $(this).html('<i class="bi bi-arrow-repeat spin"></i>');
            navigator.geolocation.getCurrentPosition(
                function (position) {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    $('#currentLocation').val(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
                    calculateDeliveryEstimate(lat, lng);
                    checkoutLatLng = { lat, lng };
                    $('#detectLocation').html('<i class="bi bi-geo-alt"></i>');
                },
                function () {
                    showToast('Could not detect location', 'warning');
                    $('#detectLocation').html('<i class="bi bi-geo-alt"></i>');
                }
            );
        }
    });

    // Calculate delivery estimate
    function calculateDeliveryEstimate(lat, lng) {
        const distance = calculateDistance(SHOP_LAT, SHOP_LNG, lat, lng);
        const deliveryTime = Math.max(15, Math.round(distance * 3)); // ~3 min per km, min 15 min
        const deliveryCost = distance > 5 ? Math.round(distance * 20) : (distance > 3 ? 100 : 0);

        $('#deliveryDistance').text(`${distance.toFixed(1)} km`);
        $('#deliveryTime').text(`${deliveryTime} mins`);
        $('#deliveryCost').text(`Rs. ${deliveryCost}`);
        $('#deliveryEstimate').show();

        // Update checkout delivery
        const subtotal = cart.reduce((sum, item) => sum + ((item.price + (item.addonPrice || 0)) * item.quantity), 0);
        const finalDelivery = subtotal > 1000 ? 0 : deliveryCost;
        checkoutDeliveryCharge = finalDelivery;
        $('#checkoutDelivery').text(finalDelivery === 0 ? 'FREE' : `Rs. ${finalDelivery}`);
        $('#checkoutTotal').text(`Rs. ${subtotal + finalDelivery}`);
    }

    // Haversine formula for distance calculation
    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // Place order
    $('#placeOrderBtn').on('click', async function () {
        const fullName = $('#fullName').val().trim();
        const phone = $('#phoneNumber').val().trim();
        const email = $('#email').val().trim();
        const address = $('#address').val().trim();
        const notes = $('#orderNotes').val().trim();
        const paymentMethod = $('input[name="paymentMethod"]:checked').val();

        if (!fullName || !phone || !address) {
            showToast('Please fill in all required fields', 'warning');
            return;
        }

        if (cart.length === 0) {
            showToast('Your cart is empty!', 'warning');
            return;
        }

        const $btn = $(this);
        $btn.html('<i class="bi bi-arrow-repeat spin me-2"></i>Processing...');
        $btn.prop('disabled', true);

        try {
            const items = cart.map(item => ({
                menu_item_id: item.id,
                quantity: item.quantity,
                addons: item.selectedAddons && item.selectedAddons.length
                    ? item.selectedAddons.map(a => ({ name: a.name, price: a.price }))
                    : null
            }));

            // Append addon selections to notes so staff always see them
            const addonSummary = cart
                .filter(ci => ci.selectedAddons && ci.selectedAddons.length > 0)
                .map(ci => `${ci.name}: ${ci.selectedAddons.map(a => a.name).join(', ')}`)
                .join(' | ');
            const fullNotes = [notes, addonSummary].filter(Boolean).join('\n');

            const { data, error } = await supabaseClient.rpc('create_order', {
                p_customer_name: fullName,
                p_phone: phone,
                p_email: email || null,
                p_address: address,
                p_lat: checkoutLatLng ? checkoutLatLng.lat : null,
                p_lng: checkoutLatLng ? checkoutLatLng.lng : null,
                p_notes: fullNotes || null,
                p_payment_method: paymentMethod,
                p_items: items,
                p_delivery_charge: checkoutDeliveryCharge
            });

            if (error) throw error;

            const order = Array.isArray(data) ? data[0] : data;
            const orderNumber = order.order_number;
            const total = order.total;


            if (paymentMethod === 'cod') {
                completeOrderSuccess(orderNumber, total, phone, order.delivery_charge);
                return;
            }

            // Online wallet payment: ask the edge function to build the gateway redirect
            const callbackUrl = `${SUPABASE_URL}/functions/v1/payment-callback?order=${encodeURIComponent(orderNumber)}&phone=${encodeURIComponent(phone)}`;
            const { data: payData, error: payError } = await supabaseClient.functions.invoke('create-payment', {
                body: {
                    order_number: orderNumber,
                    payment_method: paymentMethod,
                    amount: total,
                    return_url: callbackUrl
                }
            });

            if (payError) throw payError;

            if (!payData.configured) {
                showToast(`${paymentMethod === 'jazzcash' ? 'JazzCash' : 'EasyPaisa'} isn't set up yet — your order was placed for cash on delivery instead.`, 'warning');
                completeOrderSuccess(orderNumber, total, phone, order.delivery_charge);
                return;
            }

            // Redirect the browser to the payment gateway via an auto-submitted form
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = payData.gatewayUrl;
            Object.entries(payData.fields).forEach(([key, value]) => {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = key;
                input.value = value;
                form.appendChild(input);
            });
            document.body.appendChild(form);

            cart = [];
            updateCart();
            form.submit();
        } catch (err) {
            console.error('Order error:', err);
            showToast(err.message || 'Could not place order. Please try again.', 'warning');
            $btn.html('<i class="bi bi-check-circle me-2"></i>Place Order');
            $btn.prop('disabled', false);
        }
    });


    function completeOrderSuccess(orderNumber, total, phone, deliveryCharge) {
        checkoutModal.hide();

        const prepMin = 15;
        const legMin = deliveryCharge > 0 ? 25 : 8;
        const eta = new Date(Date.now() + (prepMin + legMin) * 60000);
        const etaLabel = eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Hand the phone number off via sessionStorage instead of the URL —
        // query params end up in browser history and server logs, which is
        // not where a customer's phone number should live.
        try {
            sessionStorage.setItem(`bb_phone_${orderNumber}`, phone);
        } catch (e) { /* sessionStorage unavailable; tracking page will ask for phone manually */ }

        $('#orderDetails').html(`
            <p class="mb-1"><strong>Order ID:</strong> ${orderNumber}</p>
            <p class="mb-1"><strong>Total:</strong> Rs. ${total}</p>
            <p class="mb-3"><strong>Estimated ready by:</strong> ${etaLabel}</p>
            <a href="order-tracking.html?order=${encodeURIComponent(orderNumber)}" class="btn btn-outline-primary">
                <i class="bi bi-truck me-2"></i>Track Your Order
            </a>
        `);

        successModal.show();

        cart = [];
        updateCart();

        $('#checkoutForm')[0].reset();
        $('#deliveryEstimate').hide();
        checkoutLatLng = null;
        $('#placeOrderBtn').html('<i class="bi bi-check-circle me-2"></i>Place Order');
        $('#placeOrderBtn').prop('disabled', false);
    }

    // Reset checkout modal on hide
    $('#checkoutModal').on('hidden.bs.modal', function () {
        $('#checkoutForm')[0].reset();
        $('#deliveryEstimate').hide();
        $('#placeOrderBtn').html('<i class="bi bi-check-circle me-2"></i>Place Order');
        $('#placeOrderBtn').prop('disabled', false);
    });

    // ==========================================
    // GALLERY LIGHTBOX
    // ==========================================
    $('.gallery-item').on('click', function () {
        const imgSrc = $(this).find('img').attr('src');
        $('#lightboxImg').attr('src', imgSrc);
        $('#lightbox').addClass('show');
        $('body').css('overflow', 'hidden');
    });

    $('#lightboxClose, #lightbox').on('click', function (e) {
        if (e.target === this || $(e.target).closest('#lightboxClose').length) {
            $('#lightbox').removeClass('show');
            $('body').css('overflow', '');
        }
    });

    // ==========================================
    // BACK TO TOP
    // ==========================================
    $(window).on('scroll', function () {
        if ($(window).scrollTop() > 500) {
            $('#backToTop').addClass('show');
        } else {
            $('#backToTop').removeClass('show');
        }
    });

    $('#backToTop').on('click', function () {
        $('html, body').animate({ scrollTop: 0 }, 800);
    });

    // ==========================================
    // NEWSLETTER FORM
    // ==========================================
    $('#newsletterForm').on('submit', function (e) {
        e.preventDefault();
        const email = $(this).find('input[type="email"]').val();
        if (email) {
            showToast('Thank you for subscribing!');
            $(this)[0].reset();
        }
    });

    // ==========================================
    // CONTACT FORM
    // ==========================================
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', function (e) {
            e.preventDefault();
            e.stopPropagation();

            if (!contactForm.checkValidity()) {
                contactForm.classList.add('was-validated');
                return;
            }

            const $btn = $('#contactSubmitBtn');
            const originalHtml = $btn.html();
            $btn.prop('disabled', true).html('<i class="bi bi-arrow-repeat spin me-2"></i>Sending...');

            setTimeout(() => {
                showToast("Thanks for reaching out! We'll get back to you soon.");
                contactForm.reset();
                contactForm.classList.remove('was-validated');
                $btn.prop('disabled', false).html(originalHtml);
            }, 800);
        });
    }

    // ==========================================
    // TOAST NOTIFICATION
    // ==========================================
    function showToast(message, type = 'success') {
        const icons = {
            success: 'bi-check-circle-fill',
            warning: 'bi-exclamation-triangle-fill',
            info: 'bi-info-circle-fill'
        };

        const toast = $(`
            <div class="toast-notification">
                <i class="bi ${icons[type] || icons.success}"></i>
                <span>${message}</span>
            </div>
        `);

        // Remove existing toast container
        $('.toast-container').remove();

        const container = $('<div class="toast-container"></div>').append(toast);
        $('body').append(container);

        setTimeout(() => {
            toast.fadeOut(400, function () {
                $(this).closest('.toast-container').remove();
            });
        }, 3000);
    }

    // ==========================================
    // SPIN ANIMATION CSS (dynamic)
    // ==========================================
    $('<style>')
        .prop('type', 'text/css')
        .html(`
            @keyframes spin { 
                from { transform: rotate(0deg); } 
                to { transform: rotate(360deg); } 
            }
            .spin { 
                animation: spin 1s linear infinite; 
                display: inline-block; 
            }
        `)
        .appendTo('head');

    // ==========================================
    // PARALLAX EFFECT (subtle)
    // ==========================================
    $(window).on('scroll', function () {
        const scrolled = $(window).scrollTop();
        $('.hero-bg').css('transform', `translateY(${scrolled * 0.3}px)`);
    });

    // ==========================================
    // COUNTER ANIMATION
    // ==========================================
    function animateCounter($element, target, duration = 2000) {
        let start = 0;
        const increment = target / (duration / 16);

        function update() {
            start += increment;
            if (start < target) {
                $element.text(Math.floor(start).toLocaleString() + '+');
                requestAnimationFrame(update);
            } else {
                $element.text(target.toLocaleString() + '+');
            }
        }
        update();
    }

    // Trigger counter animation when stats are visible
    let countersAnimated = false;
    $(window).on('scroll', function () {
        if (countersAnimated) return;

        const $stats = $('.hero-stats');
        if ($stats.length && $(window).scrollTop() + $(window).height() > $stats.offset().top) {
            countersAnimated = true;
            // Note: In a real scenario, we'd animate the numbers
            // For now, they display as static values for reliability
        }
    });

    // ==========================================
    // KEYBOARD NAVIGATION
    // ==========================================
    $(document).on('keydown', function (e) {
        if (e.key === 'Escape') {
            $('#cartSidebar').removeClass('open');
            $('#cartOverlay').removeClass('show');
            $('#lightbox').removeClass('show');
            $('body').css('overflow', '');
        }
    });

    // ==========================================
    // TOUCH SWIPE FOR CART (Mobile)
    // ==========================================
    let touchStartX = 0;
    let touchEndX = 0;

    document.addEventListener('touchstart', function (e) {
        touchStartX = e.changedTouches[0].screenX;
    }, false);

    document.addEventListener('touchend', function (e) {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, false);

    function handleSwipe() {
        const swipeThreshold = 100;
        const diff = touchStartX - touchEndX;

        // Swipe left to open cart (from right edge)
        if (touchStartX > window.innerWidth - 50 && diff < -swipeThreshold) {
            $('#cartSidebar').addClass('open');
            $('#cartOverlay').addClass('show');
        }

        // Swipe right to close cart
        if (diff > swipeThreshold && $('#cartSidebar').hasClass('open')) {
            $('#cartSidebar').removeClass('open');
            $('#cartOverlay').removeClass('show');
        }
    }

    // ==========================================
    // PERFORMANCE: Lazy load images
    // ==========================================
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src || img.src;
                    observer.unobserve(img);
                }
            });
        });

        $('img[loading="lazy"]').each(function () {
            imageObserver.observe(this);
        });
    }

    // ==========================================
    // INITIALIZE
    // ==========================================
    renderCart();
    updateCartBadge();
    console.log('%c☕ Brew Beans', 'font-size: 24px; font-weight: bold; color: #0F3D2E;');
    console.log('%cPremium Artisan Coffee Shop', 'font-size: 14px; color: #2E8B57;');
    console.log('%cMade with love in Karachi, Pakistan', 'font-size: 12px; color: #6C757D;');

    // ── BUSINESS HOURS BANNER ──
    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    function fmt12(timeStr) {
        if (!timeStr) return '';
        const [h, m] = timeStr.split(':').map(Number);
        const period = h >= 12 ? 'PM' : 'AM';
        const hour = h % 12 || 12;
        return hour + (m ? ':' + String(m).padStart(2,'0') : '') + ' ' + period;
    }

    function showBanner(text, isOpen) {
        const banner = document.getElementById('shopBanner');
        const inner  = document.getElementById('shopBannerInner');
        const dot    = document.getElementById('shopBannerDot');
        const label  = document.getElementById('shopBannerText');
        if (!banner) return;
        banner.style.display = '';
        inner.style.background = isOpen ? 'rgba(21,128,61,0.85)' : 'rgba(185,28,28,0.85)';
        inner.style.backdropFilter = 'blur(4px)';
        inner.style.color = 'white';
        dot.style.background = isOpen ? '#86efac' : '#fca5a5';
        label.textContent = text;
    }

    (async function checkShopBanner() {
        try {
            const { data } = await supabaseClient.from('business_hours').select('*').order('day_of_week');
            if (!data) return;
            const now = new Date();
            const day = now.getDay();
            const todayHours = data.find(h => h.day_of_week === day);

            if (!todayHours || todayHours.is_closed) {
                const next = data.find(h => h.day_of_week === (day + 1) % 7 && !h.is_closed);
                const txt = next ? `Closed · Opens ${DAY_NAMES[next.day_of_week]} at ${fmt12(next.open_time)}` : 'Closed Today';
                showBanner(txt, false); return;
            }

            const [oh, om] = todayHours.open_time.split(':').map(Number);
            const [ch, cm] = todayHours.close_time.split(':').map(Number);
            const nowMins  = now.getHours() * 60 + now.getMinutes();
            const openMins = oh * 60 + om;
            let closeMins  = ch * 60 + cm;
            if (closeMins < openMins) closeMins += 24 * 60;

            if (nowMins >= openMins && nowMins < closeMins) {
                showBanner('Open · Closes at ' + fmt12(todayHours.close_time), true);
            } else if (nowMins < openMins) {
                showBanner('Closed · Opens today at ' + fmt12(todayHours.open_time), false);
            } else {
                const next = data.find(h => h.day_of_week === (day + 1) % 7 && !h.is_closed);
                const txt = next ? `Closed · Opens ${DAY_NAMES[next.day_of_week]} at ${fmt12(next.open_time)}` : 'Closed';
                showBanner(txt, false);
            }
        } catch (e) {}
    })();

}); // End document ready