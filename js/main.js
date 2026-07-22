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
    const POPULAR_ITEMS = ['Royal Beans Spanish Latte', 'Lotus Frappe', 'Caramel Rush Brew', 'Chocolate Chip Cookies'];
    const COFFEE_CATS   = ['hot-coffee', 'cold-coffee', 'frappes'];

    let dynamicBadgeMap = {}; // populated from get_menu_badges() RPC — keyed by menu_item_id
    const FOOD_CATS     = ['desserts', 'sandwiches'];

    // Shop coordinates (Gulshan-e-Iqbal, Karachi)
    const SHOP_LAT = 24.9180;
    const SHOP_LNG = 67.0971;

    // Fixed floating navbar's rendered height + a little breathing
    // room, used to offset every anchor-scroll so sections don't land
    // partially hidden behind it.
    const NAV_SCROLL_OFFSET = 110;

    function escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    // Wrap an <img> in a <picture> that offers a same-name .webp sibling
    // to browsers that support it and falls back to the original file
    // otherwise. Only locally hosted img/*.png|jpg get a webp source;
    // externally hosted URLs (e.g. Unsplash) pass through untouched.
    // CSS `picture{display:contents}` keeps the layout identical to a
    // bare <img>, so callers can drop this in with no styling changes.
    function pictureImg(src, alt, attrs) {
        const imgTag = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" ${attrs}>`;
        if (!/^\.?\/?img\/.+\.(png|jpe?g)$/i.test(src)) return imgTag;
        // encodeURI so spaces in filenames (e.g. "brew espresso.webp") don't
        // get parsed as srcset candidate separators, which would silently
        // break the webp source and fall back to the original file.
        const webp = escapeHtml(encodeURI(src.replace(/\.(png|jpe?g)$/i, '.webp')));
        return `<picture><source srcset="${webp}" type="image/webp">${imgTag}</picture>`;
    }

    function sanitizeCartData(storedCart) {
        if (!Array.isArray(storedCart)) return [];
        return storedCart
            .filter(item => item && typeof item.id === 'number' && typeof item.price === 'number' && Number.isFinite(item.quantity) && item.quantity > 0)
            .map(item => {
                const selectedAddons = Array.isArray(item.selectedAddons)
                    ? item.selectedAddons.filter(a => a && typeof a.name === 'string')
                    : [];
                const specialInstructions = typeof item.specialInstructions === 'string'
                    ? item.specialInstructions.slice(0, 100)
                    : '';
                const cartKey = item.cartKey || (selectedAddons.length || specialInstructions
                    ? `${item.id}_${selectedAddons.map(a => a.name).join('|')}_${specialInstructions}`
                    : String(item.id));
                return {
                    id: Number(item.id),
                    cartKey,
                    name: item.name || '',
                    price: Number(item.price),
                    addonPrice: Number(item.addonPrice) || 0,
                    selectedAddons,
                    specialInstructions,
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
    // LOCATION SELECTION MODAL
    // First-visit gate: pick Delivery/Pickup + a Karachi area. Reuses the
    // same 'brewBeansLocation' {lat,lng} key the checkout flow already
    // reads (see userLocation above and renderCheckoutSummary below) so
    // nothing downstream needs to change — this just becomes the primary
    // way that key gets populated now, in addition to raw geolocation.
    // ==========================================
    const LOC_STORAGE_KEY = 'brewBeansDeliveryLocation';
    // Covers every curated area except the three furthest out (DHA Phase 8,
    // Keamari, Do Darya, all 14.5km+) — see the area list's approximate
    // centroids below for the actual distance each one works out to.
    const DELIVERY_RADIUS_KM = 14;

    // Approximate area centroids — good enough for the radius/ETA check
    // below; the real per-order delivery charge still comes from the
    // precise Haversine calculation against the customer's exact
    // geolocation or address at checkout (see calculateDeliveryEstimate).
    const KARACHI_AREAS = [
        { name: 'Clifton', lat: 24.8138, lng: 67.0300 },
        { name: 'DHA Phase 1', lat: 24.8090, lng: 67.0630 },
        { name: 'DHA Phase 2', lat: 24.8000, lng: 67.0550 },
        { name: 'DHA Phase 4', lat: 24.8150, lng: 67.0650 },
        { name: 'DHA Phase 5', lat: 24.8080, lng: 67.0580 },
        { name: 'DHA Phase 6', lat: 24.8020, lng: 67.0680 },
        { name: 'DHA Phase 8', lat: 24.7950, lng: 67.0450 },
        { name: 'Gulshan-e-Iqbal', lat: 24.9180, lng: 67.0971 },
        { name: 'Gulistan-e-Johar', lat: 24.9270, lng: 67.1280 },
        { name: 'PECHS', lat: 24.8720, lng: 67.0640 },
        { name: 'Bahadurabad', lat: 24.8780, lng: 67.0620 },
        { name: 'North Nazimabad', lat: 24.9330, lng: 67.0470 },
        { name: 'Nazimabad', lat: 24.9060, lng: 67.0330 },
        { name: 'Federal B Area', lat: 24.9200, lng: 67.0530 },
        { name: 'Saddar', lat: 24.8560, lng: 67.0180 },
        { name: 'Malir', lat: 24.8930, lng: 67.2050 },
        { name: 'Korangi', lat: 24.8460, lng: 67.1330 },
        { name: 'Defence View', lat: 24.8100, lng: 67.0500 },
        { name: 'Shah Faisal Colony', lat: 24.8650, lng: 67.1850 },
        { name: 'Scheme 33', lat: 24.9420, lng: 67.1720 },
        { name: 'Buffer Zone', lat: 24.9560, lng: 67.0500 },
        { name: 'Landhi', lat: 24.8480, lng: 67.2100 },
        { name: 'Keamari', lat: 24.8330, lng: 66.9800 },
        { name: 'Orangi Town', lat: 24.9450, lng: 66.9800 },
        { name: 'Lyari', lat: 24.8730, lng: 66.9930 },
        { name: 'Tipu Sultan Road', lat: 24.8580, lng: 67.0530 },
        { name: 'University Road', lat: 24.9350, lng: 67.0870 },
        { name: 'Tariq Road', lat: 24.8700, lng: 67.0580 },
        { name: 'Boat Basin', lat: 24.8280, lng: 67.0330 },
        { name: 'Do Darya', lat: 24.7950, lng: 67.0100 }
    ];

    const locationModal = new bootstrap.Modal(document.getElementById('locationModal'));
    const $locModal = $('#locationModal');
    const $areaInput = $('#locAreaInput');
    const $areaDropdown = $('#locAreaDropdown');
    const $orderType = $('.loc-order-type');
    const $continueBtn = $('#locContinueBtn');
    const $availability = $('#locAvailability');
    const $detectStatus = $('#locDetectStatus');
    const $useCurrentBtn = $('#locUseCurrentBtn');

    let locState = safeReadLocalStorage(LOC_STORAGE_KEY) || null;
    let locOrderType = (locState && locState.orderType) || 'delivery';
    let locSelectedArea = (locState && locState.area) || null; // { name, lat, lng }

    // The customer's actual GPS fix, when they used "Use My Current
    // Location". Kept separate from locSelectedArea because that only
    // holds the area's approximate centroid — these precise coords are
    // what we hand to the checkout Haversine so the delivery charge
    // reflects where they really are, not the middle of their suburb.
    // Cleared whenever they pick an area by hand instead.
    let locDetectedCoords = (locState && locState.detectedCoords) || null;
    let locIsDetecting = false;

    // Tag this modal's own backdrop (and only this one) so the CSS blur
    // in style.css doesn't bleed into the cart/checkout/addon modals.
    $locModal.on('show.bs.modal', function () {
        requestAnimationFrame(function () {
            $('.modal-backdrop').addClass('loc-modal-backdrop');
        });
    });

    function distanceKm(lat1, lon1, lat2, lon2) {
        return calculateDistance(lat1, lon1, lat2, lon2);
    }

    function renderAreaDropdown(filterText) {
        const q = (filterText || '').trim().toLowerCase();
        const matches = KARACHI_AREAS.filter(a => a.name.toLowerCase().includes(q));
        $areaDropdown.empty();
        if (!matches.length) {
            $areaDropdown.append('<div class="loc-dropdown-empty">No matching area found</div>');
            return;
        }
        matches.forEach(area => {
            const isSelected = locSelectedArea && locSelectedArea.name === area.name;
            const $item = $(`
                <button type="button" class="loc-dropdown-item${isSelected ? ' is-selected' : ''}" data-name="${escapeHtml(area.name)}">
                    <i class="bi bi-geo-alt-fill"></i><span>${escapeHtml(area.name)}</span>
                </button>
            `);
            $areaDropdown.append($item);
        });
    }

    function openDropdown() {
        $('.loc-search').addClass('is-open');
        $areaInput.attr('aria-expanded', 'true');
    }

    function closeDropdown() {
        $('.loc-search').removeClass('is-open');
        $areaInput.attr('aria-expanded', 'false');
    }

    function updateAvailability() {
        if (!locSelectedArea) {
            $availability.removeClass('is-visible is-available is-unavailable');
            return;
        }

        if (locOrderType === 'pickup') {
            $availability
                .removeClass('is-unavailable')
                .addClass('is-visible is-available')
                .html('<i class="bi bi-shop-window"></i><div><span class="loc-availability-title">Pickup Available</span>Ready in ~15 mins at our Gulshan-e-Iqbal branch.</div>');
            return;
        }

        // Quote against the real GPS fix when we have one; the area centroid
        // is only a stand-in for a hand-picked area.
        const origin = locDetectedCoords || locSelectedArea;
        const dist = distanceKm(SHOP_LAT, SHOP_LNG, origin.lat, origin.lng);
        if (dist <= DELIVERY_RADIUS_KM) {
            const quote = getDeliveryQuote(origin.lat, origin.lng);
            const fee = quote.deliveryCost === 0
                ? 'Free delivery'
                : `Delivery fee: Rs. ${quote.deliveryCost}`;
            $availability
                .removeClass('is-unavailable')
                .addClass('is-visible is-available')
                .html(`<i class="bi bi-check-circle-fill"></i><div><span class="loc-availability-title">Delivery Available</span>Estimated Delivery: ${quote.deliveryTime}–${quote.deliveryTime + 10} mins &middot; ${escapeHtml(fee)}</div>`);
        } else {
            $availability
                .removeClass('is-available')
                .addClass('is-visible is-unavailable')
                .html('<i class="bi bi-exclamation-triangle-fill"></i><div><span class="loc-availability-title">Currently unavailable for delivery</span>Please choose Pickup.</div>');
        }
    }

    function canContinue() {
        if (!locSelectedArea) return false;
        if (locOrderType === 'pickup') return true;
        // Same origin as updateAvailability, so the card and the button can
        // never disagree about whether we deliver there.
        const origin = locDetectedCoords || locSelectedArea;
        return distanceKm(SHOP_LAT, SHOP_LNG, origin.lat, origin.lng) <= DELIVERY_RADIUS_KM;
    }

    function updateContinueState() {
        $continueBtn.prop('disabled', !canContinue());
    }

    function updateNavLocationDisplay() {
        if (locSelectedArea) {
            $('#navLocationLabel').text(locOrderType === 'pickup' ? 'Pickup' : 'Delivery');
            $('#navLocationValue').text(locSelectedArea.name);
        }
    }

    // detectedCoords is only passed by the geolocation path; a manual pick
    // omits it and so clears any stale fix from an earlier detection.
    function selectArea(area, detectedCoords) {
        locSelectedArea = area;
        locDetectedCoords = detectedCoords || null;
        $areaInput.val(area.name);
        closeDropdown();
        updateAvailability();
        updateContinueState();
    }

    function setOrderType(type) {
        locOrderType = type;
        $orderType.attr('data-active', type);
        $orderType.find('.loc-order-btn').each(function () {
            const isActive = $(this).data('order-type') === type;
            $(this).toggleClass('is-active', isActive).attr('aria-selected', isActive ? 'true' : 'false');
        });
        updateAvailability();
        updateContinueState();
    }

    // Pre-fill from a saved selection — both on first render and whenever
    // the modal is reopened via "Change Location" in the header, so
    // returning users can just hit Continue if nothing needs to change.
    function populateFromState() {
        setOrderType(locOrderType);
        if (locSelectedArea) {
            $areaInput.val(locSelectedArea.name);
        }
        // Stale "detected"/"failed" text from a previous visit would be
        // misleading now, so the status line always starts clean.
        setDetectStatus('', '');
        renderAreaDropdown('');
        updateAvailability();
        updateContinueState();
    }

    $orderType.on('click', '.loc-order-btn', function () {
        setOrderType($(this).data('order-type'));
    });

    $areaInput.on('focus', function () {
        renderAreaDropdown($(this).val());
        openDropdown();
    });

    $areaInput.on('input', function () {
        locSelectedArea = null;
        locDetectedCoords = null;
        setDetectStatus('', '');
        updateAvailability();
        updateContinueState();
        renderAreaDropdown($(this).val());
        openDropdown();
    });

    // Delay so the dropdown's own click handler (below) still fires
    // before the input's blur closes it.
    $areaInput.on('blur', function () {
        setTimeout(closeDropdown, 150);
    });

    $areaDropdown.on('click', '.loc-dropdown-item', function () {
        const name = $(this).data('name');
        const area = KARACHI_AREAS.find(a => a.name === name);
        if (area) selectArea(area);
    });

    // OSM almost never spells an area the way our curated list does, so each
    // entry carries the variants that actually turn up in Nominatim results.
    // "FB Area" is the one that matters most: it is how OSM labels Federal B
    // Area, and without it a Federal B Area address matches nothing.
    const AREA_ALIASES = {
        'Federal B Area': ['fb area', 'f.b. area', 'f b area', 'federal b. area'],
        'Gulshan-e-Iqbal': ['gulshan e iqbal', 'gulshan iqbal'],
        'Gulistan-e-Johar': ['gulistan e johar', 'gulshan-e-johar', 'gulshan e johar'],
        'North Nazimabad': ['n. nazimabad', 'north nazimabad town'],
        'PECHS': ['p.e.c.h.s', 'pakistan employees co-operative housing society'],
        'Shah Faisal Colony': ['shah faisal town', 'shah faisal'],
        'Defence View': ['defence view society']
    };

    // Narrowest fields first. A reverse geocode reports both the precise
    // neighbourhood and the broad administrative district it sits inside —
    // e.g. an FB Area Block 15 address also carries city_district
    // "Nazimabad District". Mashing those into one string let the district
    // win, so the whole of Federal B Area was being sold as Nazimabad.
    // Each tier is searched on its own and only falls through if it finds
    // nothing; display_name is last because it contains every level at once.
    function addressFieldTiers(address, displayName) {
        return [
            [address.neighbourhood, address.quarter, address.residential],
            [address.suburb],
            [address.city_district, address.town, address.county],
            [displayName]
        ].map(tier => tier.filter(Boolean).join(' ').toLowerCase()).filter(Boolean);
    }

    // Longest alias first, so "North Nazimabad" is never claimed by the
    // shorter "Nazimabad" that is a substring of it.
    const AREA_MATCHERS = KARACHI_AREAS
        .reduce(function (acc, area) {
            const aliases = [area.name.toLowerCase()].concat(AREA_ALIASES[area.name] || []);
            aliases.forEach(alias => acc.push({ area: area, alias: alias }));
            return acc;
        }, [])
        .sort((a, b) => b.alias.length - a.alias.length);

    // DHA/Defence rarely appears as a clean "DHA Phase N" string, so it gets
    // a pattern of its own once plain alias matching has come up empty.
    function matchDhaFallback(haystack) {
        const phaseMatch = haystack.match(/(?:dha|defence)[^\d]{0,20}(\d)/);
        if (phaseMatch) {
            const byPhase = KARACHI_AREAS.find(a => a.name === `DHA Phase ${phaseMatch[1]}`);
            if (byPhase) return byPhase;
        }
        if (/dha|defence/.test(haystack)) {
            return KARACHI_AREAS.find(a => a.name === 'Defence View') || null;
        }
        return null;
    }

    function matchAreaFromAddress(address, displayName) {
        const tiers = addressFieldTiers(address, displayName);

        for (const haystack of tiers) {
            const hit = AREA_MATCHERS.find(m => haystack.includes(m.alias));
            if (hit) return hit.area;
        }

        return matchDhaFallback(tiers.join(' '));
    }

    function isRoughlyInKarachi(lat, lng) {
        return lat >= 24.75 && lat <= 25.05 && lng >= 66.90 && lng <= 67.25;
    }

    // Keyed by GeolocationPositionError.code (1 PERMISSION_DENIED,
    // 2 POSITION_UNAVAILABLE, 3 TIMEOUT) plus our own non-numeric cases.
    // Every branch names the manual picker as the way out, so a failure is
    // never a dead end.
    const GEO_ERROR_MESSAGES = {
        1: 'Location access was blocked. Allow it in your browser settings, or pick your area below.',
        2: "We couldn't pin down your position. Please pick your area below.",
        3: 'Location detection timed out. Try again, or pick your area below.',
        unsupported: "This browser can't share your location. Please pick your area below.",
        lookup: "We couldn't look up your area just now. Please pick it below.",
        outOfRange: 'You appear to be outside Karachi — we only deliver within the city.',
        unmatched: "We found you, but couldn't match your area exactly — please pick it below."
    };

    function setDetectStatus(state, message) {
        $detectStatus.attr('class', 'loc-detect-status' + (state ? ' is-' + state : ''));
        if (state === 'success') {
            $detectStatus.html('<i class="bi bi-check-circle-fill me-1"></i>' + escapeHtml(message));
        } else {
            $detectStatus.text(message);
        }
    }

    function setDetecting(isBusy) {
        locIsDetecting = isBusy;
        $useCurrentBtn.prop('disabled', isBusy);
        $useCurrentBtn.find('i')
            .toggleClass('bi-crosshair', !isBusy)
            .toggleClass('bi-arrow-repeat spin', isBusy);
    }

    // Promise wrapper around getCurrentPosition. Rejects with an Error whose
    // message is already customer-facing, so the caller has a single catch
    // instead of branching on error codes from two different sources.
    function requestPosition() {
        return new Promise(function (resolve, reject) {
            if (!navigator.geolocation) {
                reject(new Error(GEO_ERROR_MESSAGES.unsupported));
                return;
            }
            navigator.geolocation.getCurrentPosition(resolve, function (err) {
                reject(new Error(GEO_ERROR_MESSAGES[err && err.code] || GEO_ERROR_MESSAGES.unsupported));
            }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
        });
    }

    // Reverse-geocode through Nominatim and match the result to a curated
    // area. Aborted after 8s — their public endpoint is rate-limited and can
    // stall, and a spinner stuck forever is worse than the manual picker.
    function reverseGeocodeArea(lat, lng) {
        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, 8000);
        const url = 'https://nominatim.openstreetmap.org/reverse?format=json' +
            `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}` +
            '&zoom=16&addressdetails=1';

        return fetch(url, { headers: { 'Accept': 'application/json' }, signal: controller.signal })
            .then(function (res) {
                if (!res.ok) throw new Error('reverse geocode failed');
                return res.json();
            })
            .then(function (data) {
                return matchAreaFromAddress(data.address || {}, data.display_name || '');
            })
            .catch(function () {
                // Network failure, abort/timeout, or malformed JSON — all the
                // same to the customer, so they get one message and a way out.
                throw new Error(GEO_ERROR_MESSAGES.lookup);
            })
            .finally(function () {
                clearTimeout(timer);
            });
    }

    // Persist the precise fix under the key the checkout flow already reads,
    // in the same {lat,lng,timestamp} shape, so a customer who detects their
    // location gets an accurate delivery quote even if they never press
    // Continue.
    function persistDetectedLocation(lat, lng) {
        userLocation = { lat: lat, lng: lng, timestamp: new Date().toISOString() };
        safeWriteLocalStorage('brewBeansLocation', userLocation);
    }

    $useCurrentBtn.on('click', function () {
        if (locIsDetecting) return; // ignore double-taps while a fix is pending

        setDetecting(true);
        setDetectStatus('', 'Detecting your location...');

        requestPosition()
            .then(function (position) {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;

                if (!isRoughlyInKarachi(lat, lng)) {
                    throw new Error(GEO_ERROR_MESSAGES.outOfRange);
                }

                return reverseGeocodeArea(lat, lng).then(function (matched) {
                    if (!matched) throw new Error(GEO_ERROR_MESSAGES.unmatched);

                    selectArea(matched, { lat: lat, lng: lng });
                    persistDetectedLocation(lat, lng);
                    setDetectStatus('success', `Location detected — ${matched.name}`);
                });
            })
            .catch(function (err) {
                // Leave whatever the customer had already chosen intact; the
                // availability card and Continue button are untouched here so
                // a failed detection can't strand a valid manual pick.
                setDetectStatus('error', (err && err.message) || GEO_ERROR_MESSAGES.lookup);
            })
            .then(function () {
                setDetecting(false);
            });
    });

    $continueBtn.on('click', function () {
        if (!canContinue()) return;

        locState = {
            orderType: locOrderType,
            area: locSelectedArea,
            detectedCoords: locDetectedCoords
        };
        safeWriteLocalStorage(LOC_STORAGE_KEY, locState);

        // Precise GPS fix wins over the area centroid when we have one.
        const coords = locDetectedCoords || locSelectedArea;
        persistDetectedLocation(coords.lat, coords.lng);

        updateNavLocationDisplay();
        locationModal.hide();
    });

    $('#navLocationCard').on('click', function () {
        populateFromState();
        locationModal.show();
    });

    // First visit (no saved selection yet): show the modal shortly after
    // the loading screen clears. Returning visitors: apply the saved
    // pick silently and skip the modal entirely.
    if (locState && locState.area) {
        updateNavLocationDisplay();
    } else {
        setTimeout(function () {
            populateFromState();
            locationModal.show();
        }, 2800);
    }

    // ==========================================
    // NAVBAR SCROLL EFFECT + HERO PARALLAX
    // Combined into one rAF-throttled listener (instead of two
    // separate scroll handlers) so scroll-driven work is batched to
    // once per frame and only touches transform/class — no layout
    // reads mixed with writes.
    // ==========================================
    (function () {
        const $mainNav = $('#mainNav');
        const $heroBg = $('.hero-bg, .hero-bg-blur');
        let ticking = false;

        function onScrollFrame() {
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            $mainNav.toggleClass('scrolled', scrollTop > 50);
            $heroBg.css('transform', `translateY(${scrollTop * 0.3}px)`);
            ticking = false;
        }

        $(window).on('scroll', function () {
            if (!ticking) {
                requestAnimationFrame(onScrollFrame);
                ticking = true;
            }
        });
    })();

    // ==========================================
    // HERO CAROUSEL
    // ==========================================
    (function () {
        const $slides = $('.hero-slide');
        const $dots = $('.hero-dot');
        const HERO_AUTOPLAY_MS = 4000;

        if (!$slides.length) return;

        let current = $slides.filter('.is-active').data('slide-index') || 0;
        let autoplayTimer = null;

        function goToSlide(index) {
            const next = ((index % $slides.length) + $slides.length) % $slides.length;
            if (next === current) return;
            $slides.eq(current).removeClass('is-active');
            $dots.eq(current).removeClass('is-active');
            current = next;
            $slides.eq(current).addClass('is-active');
            $dots.eq(current).addClass('is-active');
        }

        function startAutoplay() {
            stopAutoplay();
            autoplayTimer = setInterval(function () {
                goToSlide(current + 1);
            }, HERO_AUTOPLAY_MS);
        }

        function stopAutoplay() {
            if (autoplayTimer) {
                clearInterval(autoplayTimer);
                autoplayTimer = null;
            }
        }

        $('#heroNext').on('click', function () {
            goToSlide(current + 1);
            startAutoplay();
        });

        $('#heroPrev').on('click', function () {
            goToSlide(current - 1);
            startAutoplay();
        });

        $dots.on('click', function () {
            goToSlide($(this).index());
            startAutoplay();
        });

        // Swipe navigation — a supplementary control alongside the arrows
        // on touch devices (dots stay desktop/tablet-only, see CSS).
        let heroTouchStartX = 0;
        const $heroFrame = $('#heroFrame');

        $heroFrame.on('touchstart', function (e) {
            heroTouchStartX = e.originalEvent.changedTouches[0].screenX;
        });

        $heroFrame.on('touchend', function (e) {
            const diff = heroTouchStartX - e.originalEvent.changedTouches[0].screenX;
            if (Math.abs(diff) > 50) {
                goToSlide(current + (diff > 0 ? 1 : -1));
                startAutoplay();
            }
        });

        startAutoplay();
    })();

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
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            const y = target.getBoundingClientRect().top + window.scrollY - NAV_SCROLL_OFFSET;
            window.scrollTo({ top: y, behavior: 'smooth' });
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

    // ==========================================
    // MOBILE MENU: scroll lock, tap-outside-to-close, ESC-to-close
    // ==========================================
    (function () {
        const $navbarNav = $('#navbarNav');
        const navbarNavEl = document.getElementById('navbarNav');
        if (!navbarNavEl) return;

        // Bootstrap's collapse height/opacity transition is already
        // handled in CSS — this just locks page scroll for as long as
        // the panel is open, and unlocks it the moment it starts closing
        // (not after, so there's no perceived delay/jank). Padding the
        // scrollbar's own width back in keeps the page from jumping
        // sideways when it disappears.
        navbarNavEl.addEventListener('show.bs.collapse', function () {
            const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
            document.body.style.paddingRight = scrollbarWidth > 0 ? scrollbarWidth + 'px' : '';
            // Locked on both html and body: which element actually
            // scrolls the page is spec-defined and browser-dependent,
            // so covering both is the only reliable way to stop it.
            $('html, body').addClass('mobile-nav-open');
        });
        navbarNavEl.addEventListener('hide.bs.collapse', function () {
            $('html, body').removeClass('mobile-nav-open');
            document.body.style.paddingRight = '';
        });

        $(document).on('click', function (e) {
            if (!$navbarNav.hasClass('show')) return;
            const $target = $(e.target);
            if ($target.closest('#navbarNav').length || $target.closest('.navbar-toggler').length) return;
            const bsCollapse = bootstrap.Collapse.getInstance(navbarNavEl);
            if (bsCollapse) bsCollapse.hide(); else $navbarNav.collapse('hide');
        });

        $(document).on('keydown', function (e) {
            if (e.key === 'Escape' && $navbarNav.hasClass('show')) {
                const bsCollapse = bootstrap.Collapse.getInstance(navbarNavEl);
                if (bsCollapse) bsCollapse.hide(); else $navbarNav.collapse('hide');
            }
        });
    })();

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
        const scrollPos = $(window).scrollTop() + NAV_SCROLL_OFFSET + 20;
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
        offset: 60
    });

    // ==========================================
    // MENU RENDERING
    // ==========================================

    // Spring pop-in for menu cards as they scroll into view, staggered by column.
    // Motion.js vanilla passes the element directly to the callback (not an IntersectionObserverEntry).
    function animateMenuItemsIn() {
        if (!window.Motion) {
            $('#menuGrid .motion-pop').css('opacity', 1);
            return;
        }
        Motion.inView('#menuGrid .motion-pop', (element) => {
            const column = $(element).index();
            Motion.animate(
                element,
                { opacity: [0, 1], scale: [0.85, 1], y: [30, 0] },
                { duration: 0.5, delay: (column % 4) * 0.08, easing: [0.22, 1, 0.36, 1] }
            );
        });
    }

    function renderMenu(filter = 'all') {
        const $grid = $('#menuGrid');

        const q = ($('#menuSearchBar').val() || '').toLowerCase().trim();
        let filteredItems = filter === 'all' ? menuItems : menuItems.filter(item => item.category === filter);
        if (q) filteredItems = filteredItems.filter(item =>
            item.name.toLowerCase().includes(q) || (item.description || '').toLowerCase().includes(q)
        );

        function populateGrid() {
            $grid.empty();

            if (!filteredItems.length) {
                $grid.html('<div class="col-12 text-center py-5 text-muted"><i class="bi bi-search" style="font-size:2rem"></i><p class="mt-3">No items found for "<strong>' + $('<span>').text(q).html() + '</strong>"</p></div>');
                return;
            }

            filteredItems.forEach((item) => {
                const _b = dynamicBadgeMap[item.id];
                const badgeHtml = _b
                    ? `<span class="menu-item-tag ${_b.cls}">${_b.label}</span>`
                    : item.is_popular ? '<span class="menu-item-tag badge-popular">⭐ Popular</span>' : '';
                const html = `
                    <div class="col-6 col-md-6 col-lg-3 motion-pop">
                        <div class="menu-item" data-id="${item.id}">
                            <div class="menu-item-img">
                                ${pictureImg(item.image, item.name, 'loading="lazy" width="600" height="600"')}
                                <span class="menu-item-badge">${escapeHtml(item.category.replace('-', ' '))}</span>
                                ${badgeHtml}
                            </div>
                            <div class="menu-item-content">
                                <h3 class="menu-item-name">${escapeHtml(item.name)}</h3>
                                <p class="menu-item-desc">${escapeHtml(item.description)}</p>
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

            $grid.fadeTo(250, 1);
            animateMenuItemsIn();
        }

        // Crossfade instead of an abrupt swap when switching filters
        if ($grid.children().length) {
            $grid.fadeTo(150, 0, populateGrid);
        } else {
            populateGrid();
        }
    }

    function renderFanFavorites() {
        const $section = $('#fanFavorites');
        if (!$section.length) return;
        const featured = menuItems.filter(item => item.is_popular);
        if (!featured.length) { $section.hide(); return; }
        const html = featured.map(item => `
            <div class="fav-card" data-aos="fade-up">
                <div class="fav-card-img">
                    ${pictureImg(item.image, item.name, 'loading="lazy" width="600" height="600"')}
                    <span class="fav-tag">⭐ Fan Favorite</span>
                </div>
                <div class="fav-card-body">
                    <h4 class="fav-card-name">${escapeHtml(item.name)}</h4>
                    <p class="fav-card-desc">${escapeHtml(item.description)}</p>
                    <div class="fav-card-footer">
                        <span class="fav-card-price">Rs. ${item.price}</span>
                        <button class="btn-fav-order btn-add-cart" data-id="${item.id}">
                            <i class="bi bi-plus-lg"></i> Order
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
        $('#fanFavGrid').html(html);
        $section.show();
        if (window.innerWidth >= 768 && typeof AOS !== 'undefined') AOS.refreshHard();
    }

    // Mouse-reactive 3D tilt on the Fan Favorites product image only
    // (mirrors the addon modal image parallax above) — the card itself
    // stays put, just a plain lift-on-hover.
    $(document).on('mousemove', '.fav-card-img', function (e) {
        if (window.innerWidth < 768) return;
        const img = this.querySelector('img');
        if (!img) return;
        const rect = this.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        img.style.transition = 'transform 0.1s ease-out';
        img.style.transform = `perspective(900px) rotateY(${px * 22}deg) rotateX(${-py * 22}deg) scale(1.12) translateZ(35px)`;
    });

    $(document).on('mouseleave', '.fav-card-img', function () {
        const img = this.querySelector('img');
        if (!img) return;
        img.style.transition = 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)';
        img.style.transform = '';
    });

    function renderUpsell() {
        const $section = $('#upsellSection');
        if (!$section.length || !menuItems.length || cart.length === 0) {
            if ($section.length) $section.empty();
            return;
        }
        const inCartIds = new Set(cart.map(i => i.id));
        const cartCats = new Set(cart.map(i => {
            const found = menuItems.find(m => m.id === i.id);
            return found ? found.category : null;
        }).filter(Boolean));
        const hasCoffee = [...cartCats].some(c => COFFEE_CATS.includes(c));
        const hasFood   = [...cartCats].some(c => FOOD_CATS.includes(c));
        let suggestions = [];
        if (hasCoffee && !hasFood) {
            suggestions = menuItems.filter(m => FOOD_CATS.includes(m.category) && !inCartIds.has(m.id))
                .sort(() => Math.random() - 0.5).slice(0, 2);
        } else if (hasFood && !hasCoffee) {
            suggestions = menuItems.filter(m => COFFEE_CATS.includes(m.category) && !inCartIds.has(m.id))
                .sort(() => Math.random() - 0.5).slice(0, 2);
        } else {
            const rnd = arr => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
            suggestions = [
                rnd(menuItems.filter(m => FOOD_CATS.includes(m.category) && !inCartIds.has(m.id))),
                rnd(menuItems.filter(m => COFFEE_CATS.includes(m.category) && !inCartIds.has(m.id)))
            ].filter(Boolean);
        }
        if (!suggestions.length) { $section.empty(); return; }
        $section.html(`
            <div class="upsell-header">Also try...</div>
            <div class="upsell-cards">
                ${suggestions.map(item => `
                    <div class="upsell-card">
                        ${pictureImg(item.image, item.name, 'class="upsell-img" loading="lazy"')}
                        <div class="upsell-info">
                            <div class="upsell-name">${escapeHtml(item.name)}</div>
                            <div class="upsell-price">Rs. ${item.price}</div>
                        </div>
                        <button class="upsell-add btn-add-cart" data-id="${item.id}" title="Add to cart">
                            <i class="bi bi-plus-lg"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
        `);
    }

    // Initial render — load from Supabase
    async function loadMenuFromDB() {
        const $grid = $('#menuGrid');
        $grid.html('<div class="col-12 text-center py-5"><div class="spinner-border text-success" role="status"></div><p class="mt-3 text-muted">Loading menu...</p></div>');

        const [{ data, error }, { data: badgeRows }] = await Promise.all([
            supabaseClient.from('menu_items').select('*').eq('is_available', true).order('id'),
            supabaseClient.rpc('get_menu_badges')
        ]);

        const BADGE_LABEL = { 'badge-bestseller': '🔥 Best Seller', 'badge-popular': '⭐ Fan Favorite', 'badge-trending': '📈 Trending' };
        dynamicBadgeMap = {};
        (badgeRows || []).forEach(r => {
            if (r.badge_cls) dynamicBadgeMap[r.menu_item_id] = { label: BADGE_LABEL[r.badge_cls] || r.badge, cls: r.badge_cls };
        });

        if (error || !data || !data.length) {
            $grid.html('<div class="col-12 text-center py-5 text-muted">Menu unavailable. Please try again later.</div>');
            return;
        }

        menuItems = data;
        renderMenu();
        renderFanFavorites();
        $('.category-card[data-category]').each(function () {
            const category = $(this).data('category');
            const count = menuItems.filter(item => item.category === category).length;
            $(this).find('.category-count').text(`${count} Item${count === 1 ? '' : 's'}`);
        });
    }

    loadMenuFromDB();

    // ==========================================
    // MENU FILTERS
    // ==========================================
    $('#menuSearchBar').on('input', function () {
        const activeFilter = $('.filter-btn.active').data('filter') || 'all';
        renderMenu(activeFilter);
    });

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
        const menuEl = document.getElementById('menu');
        if (menuEl) window.scrollTo({ top: menuEl.getBoundingClientRect().top + window.scrollY - NAV_SCROLL_OFFSET, behavior: 'smooth' });
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
        const previousCount = $badge.text();
        $badge.text(totalItems || 0);
        if (totalItems > 0) {
            $badge.addClass('show');
            if (previousCount !== String(totalItems) && window.Motion) {
                Motion.animate($badge[0], { scale: [1, 1.5, 1] }, { duration: 0.4, easing: [0.22, 1, 0.36, 1] });
            }
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
            $('#upsellSection').empty();
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
                ? `<div class="cart-item-addons">${item.selectedAddons.map(a => a.price > 0 ? `${escapeHtml(a.name)} +Rs.${a.price}` : escapeHtml(a.name)).join(' · ')}</div>`
                : '';
            const noteHtml = item.specialInstructions
                ? `<div class="cart-item-note"><i class="bi bi-pencil-fill"></i> ${escapeHtml(item.specialInstructions)}</div>`
                : '';
            const html = `
                <div class="cart-item" data-cart-key="${item.cartKey}">
                    <img src="${item.image}" alt="${escapeHtml(item.name)}" class="cart-item-img">
                    <div class="cart-item-info">
                        <div class="cart-item-name">${escapeHtml(item.name)}</div>
                        ${addonHtml}
                        ${noteHtml}
                        <div class="cart-item-price">Rs. ${itemTotal}</div>
                        <div class="cart-item-actions">
                            <button class="cart-qty-btn qty-minus" data-cart-key="${item.cartKey}"><i class="bi bi-dash"></i></button>
                            <span class="cart-qty">${item.quantity}</span>
                            <button class="cart-qty-btn qty-plus" data-cart-key="${item.cartKey}"><i class="bi bi-plus"></i></button>
                            <button class="cart-item-remove" data-cart-key="${item.cartKey}"><i class="bi bi-trash"></i></button>
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
        renderUpsell();
    }

    // ==========================================
    // ADDON SELECTION
    // ==========================================
    let currentAddonItem = null;
    let currentAddonQty = 1;
    let addonPriceAnimFrame = null;

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
            if (window.Motion) {
                Motion.animate($btn[0], { scale: [1, 0.85, 1.08, 1] }, { duration: 0.4, easing: 'ease-out' });
            }
            setTimeout(() => $btn.removeClass('added').html('<i class="bi bi-plus-lg"></i> Add'), 1500);
        }
    }

    // Cold/blended drinks get the ice+condensation treatment; hot
    // drinks (including hot chocolate, which shares the hot-coffee
    // category) get steam. Anything else (desserts, sandwiches) gets
    // neither.
    const HOT_MEDIA_CATS = ['hot-coffee'];
    const COLD_MEDIA_CATS = ['cold-coffee', 'frappes', 'summer-coolers'];

    // Customization catalog, kept entirely on the frontend (no Supabase
    // addon_groups/addons involved) and shown per menu-item category.
    // "required: true" + "multi: false" renders as radio buttons;
    // "multi: true" renders as checkboxes.
    const LOCAL_ADDON_CATALOG = {
        'hot-coffee': [
            { id: 'temp', name: 'Temperature Preference', required: true, multi: false, options: [
                { name: 'Extra Hot', price: 0 }, { name: 'Hot', price: 0 }, { name: 'Warm', price: 0 }, { name: 'Room Temperature', price: 0 }
            ]},
            { id: 'size', name: 'Cup Size', required: false, multi: false, options: [
                { name: 'Small', price: 0 }, { name: 'Medium', price: 0 }, { name: 'Large', price: 0 }
            ]},
            { id: 'milk', name: 'Milk Options', required: false, multi: false, options: [
                { name: 'Full Cream', price: 0 }, { name: 'Low Fat', price: 0 }, { name: 'Oat Milk', price: 70 },
                { name: 'Almond Milk', price: 90 }, { name: 'Soy Milk', price: 80 }
            ]},
            { id: 'blend', name: 'Choose Your Blend', required: false, multi: false, options: [
                { name: 'House Blend', price: 0 }, { name: 'Ethiopian Single Origin', price: 150 }, { name: 'Colombian Supremo', price: 120 }
            ]},
            { id: 'sweetness', name: 'Sweetness', required: false, multi: false, options: [
                { name: 'No Sugar', price: 0 }, { name: 'Less Sugar', price: 0 }, { name: 'Regular', price: 0 }, { name: 'Extra Sweet', price: 0 }
            ]},
            { id: 'extras', name: 'Add Extras', required: false, multi: true, options: [
                { name: 'Extra Espresso Shot', price: 60 }, { name: 'Vanilla Syrup', price: 50 }, { name: 'Caramel Syrup', price: 50 },
                { name: 'Hazelnut Syrup', price: 50 }, { name: 'Chocolate Syrup', price: 50 }, { name: 'Whipped Cream', price: 50 },
                { name: 'Cinnamon Powder', price: 30 }, { name: 'Chocolate Powder', price: 40 }, { name: 'Marshmallows', price: 70 }
            ]}
        ],
        'cold-coffee': [
            { id: 'temp', name: 'Temperature Preference', required: true, multi: false, options: [
                { name: 'Extra Cold', price: 0 }, { name: 'Cold', price: 0 }, { name: 'Room Temperature', price: 0 }
            ]},
            { id: 'blend', name: 'Choose Your Blend', required: false, multi: false, options: [
                { name: 'House Blend', price: 0 }, { name: 'Ethiopian Single Origin', price: 150 }, { name: 'Colombian Supremo', price: 120 }
            ]},
            { id: 'extras', name: 'Add Extras', required: false, multi: true, options: [
                { name: 'Extra Shot', price: 60 }, { name: 'Caramel Syrup', price: 50 }, { name: 'Hazelnut Syrup', price: 50 },
                { name: 'Oat Milk', price: 70 }, { name: 'Whipped Cream', price: 50 }, { name: 'Chocolate Powder', price: 40 }
            ]}
        ]
    };
    LOCAL_ADDON_CATALOG.frappes = LOCAL_ADDON_CATALOG['cold-coffee'];
    LOCAL_ADDON_CATALOG['summer-coolers'] = LOCAL_ADDON_CATALOG['cold-coffee'];

    function addonOptionIcon(groupId, name) {
        if (groupId !== 'temp' && groupId !== 'blend') return '';
        const n = name.toLowerCase();
        if (groupId === 'blend') return 'bi-cup-hot';
        if (n.includes('cold') || n.includes('iced')) return 'bi-snow2';
        if (n.includes('hot')) return 'bi-fire';
        return 'bi-thermometer-half';
    }

    function openAddonModal(menuItem) {
        currentAddonItem = menuItem;
        currentAddonQty = 1;
        $('#addonQtyValue').text('1');
        $('#addonModalItemName').text(menuItem.name);
        $('#addonModalItemDesc').text(menuItem.description || '');
        $('#addonModalBasePrice').text(`Rs. ${menuItem.price}`);
        $('#addonModalImage').attr('src', menuItem.image || '').attr('alt', menuItem.name);
        $('#addonTotalPrice').text(menuItem.price);
        $('#addonPriceBreakdown').removeClass('show collapsed').empty();
        $('#addonPricePillToggle').removeClass('expanded');
        $('#addonSpecialInstructions').val('');
        $('#addonNotesCount').text('0');
        resetAddonParallax();

        const $media = $('#addonMedia').removeClass('is-hot is-cold');
        if (HOT_MEDIA_CATS.includes(menuItem.category)) $media.addClass('is-hot');
        else if (COLD_MEDIA_CATS.includes(menuItem.category)) $media.addClass('is-cold');

        const $container = $('#addonGroupsContainer');
        addonModal.show();

        const groups = LOCAL_ADDON_CATALOG[menuItem.category] || [];

        if (!groups.length) {
            $container.html('<div class="addon-empty-state"><i class="bi bi-check2-circle"></i><p>This item is ready to go — just pick your quantity below.</p></div>');
            updateAddonTotal();
            return;
        }

        let html = '';
        groups.forEach(group => {
            const badge = group.required
                ? '<span class="addon-required-badge">Required</span>'
                : '<span class="addon-optional-badge">Optional</span>';
            const optionsHtml = group.options.map(addon => {
                const icon = addonOptionIcon(group.id, addon.name);
                return `
                <div class="addon-option"
                     data-group-id="${group.id}"
                     data-required="${!group.multi}"
                     data-addon-name="${addon.name.replace(/"/g, '&quot;')}"
                     data-addon-price="${addon.price}">
                    <span class="addon-option-name">${icon ? `<i class="bi ${icon} addon-option-icon"></i>` : ''}${addon.name}</span>
                    ${addon.price > 0 ? `<span class="addon-option-price">+Rs.${addon.price}</span>` : ''}
                </div>`;
            }).join('');
            // data-required drives radio-vs-checkbox selection behaviour
            // and the ::before indicator shape (single-select vs
            // multi-select); data-mandatory is the separate "must pick
            // one before Add to Cart" flag used by the submit handler —
            // a group can be single-select (radio) without being
            // mandatory, e.g. Cup Size or Choose Your Blend here.
            html += `
                <div class="addon-group">
                    <div class="addon-group-title">${group.name} ${badge}</div>
                    <div class="addon-options" data-group-id="${group.id}" data-required="${!group.multi}" data-mandatory="${!!group.required}">
                        ${optionsHtml}
                    </div>
                </div>`;
        });
        $container.html(html);
        updateAddonTotal();
    }

    // Eased rAF count-up/down instead of an instant text swap, so the
    // sticky bar's price visibly reacts to every option/qty change.
    function animateAddonPrice(to) {
        const $el = $('#addonTotalPrice');
        const from = parseInt($el.text(), 10) || 0;
        if (from === to) { $el.text(to); return; }
        if (addonPriceAnimFrame) cancelAnimationFrame(addonPriceAnimFrame);
        const duration = 300;
        const start = performance.now();
        function tick(now) {
            const p = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            $el.text(Math.round(from + (to - from) * eased));
            addonPriceAnimFrame = p < 1 ? requestAnimationFrame(tick) : null;
        }
        addonPriceAnimFrame = requestAnimationFrame(tick);
    }

    function updateAddonTotal() {
        if (!currentAddonItem) return;
        const selectedAddons = [];
        let extra = 0;
        $('.addon-option.selected').each(function () {
            const price = parseInt($(this).data('addon-price')) || 0;
            extra += price;
            selectedAddons.push({ name: $(this).data('addon-name'), price });
        });

        const total = (currentAddonItem.price + extra) * currentAddonQty;
        animateAddonPrice(total);

        const $breakdown = $('#addonPriceBreakdown');
        if (selectedAddons.length || currentAddonQty > 1) {
            let rows = `<div class="addon-breakdown-row"><span>Base Price</span><span>Rs. ${currentAddonItem.price}</span></div>`;
            selectedAddons.forEach(a => {
                if (a.price > 0) rows += `<div class="addon-breakdown-row"><span>${a.name}</span><span>+Rs. ${a.price}</span></div>`;
            });
            if (currentAddonQty > 1) rows += `<div class="addon-breakdown-row addon-breakdown-qty"><span>Quantity</span><span>&times; ${currentAddonQty}</span></div>`;
            $breakdown.html(rows).addClass('show');
        } else {
            $breakdown.removeClass('show').empty();
        }
    }

    // Quantity stepper
    $('#addonQtyMinus').on('click', function () {
        if (currentAddonQty <= 1) return;
        currentAddonQty--;
        $('#addonQtyValue').text(currentAddonQty);
        updateAddonTotal();
    });

    $('#addonQtyPlus').on('click', function () {
        if (currentAddonQty >= 20) return;
        currentAddonQty++;
        $('#addonQtyValue').text(currentAddonQty);
        updateAddonTotal();
    });

    // Special instructions char counter
    $('#addonSpecialInstructions').on('input', function () {
        $('#addonNotesCount').text(this.value.length);
    });

    // Price pill doubles as a collapse/expand toggle for the breakdown
    $('#addonPricePillToggle').on('click', function () {
        $(this).toggleClass('expanded');
        $('#addonPriceBreakdown').toggleClass('collapsed');
    });

    // Mouse-reactive tilt on the product image — layered on top of the
    // stage's own slow auto float/rotate (see addonMediaMotion) rather
    // than fighting it, since it targets the inner img, not the stage.
    function resetAddonParallax() {
        $('#addonModalImage').css('transform', '');
    }

    $('#addonMedia').on('mousemove', function (e) {
        const rect = this.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width - 0.5;
        const py = (e.clientY - rect.top) / rect.height - 0.5;
        $('#addonModalImage').css('transform', `rotateY(${px * 14}deg) rotateX(${-py * 14}deg)`);
    });

    $('#addonMedia').on('mouseleave', resetAddonParallax);

    // Lightweight ripple for the submit + qty buttons — purely visual,
    // doesn't interfere with their real click handlers below.
    $(document).on('click', '.btn-addon-submit, .addon-qty-btn', function (e) {
        const el = this;
        const rect = el.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const $ripple = $('<span class="btn-ripple"></span>').css({
            width: size,
            height: size,
            left: (e.clientX - rect.left - size / 2) + 'px',
            top: (e.clientY - rect.top - size / 2) + 'px'
        });
        $(el).append($ripple);
        setTimeout(() => $ripple.remove(), 650);
    });

    // Reset stale state once the modal is fully hidden (X, backdrop,
    // or Esc — anything that isn't the add-to-cart submit).
    document.getElementById('addonModal').addEventListener('hidden.bs.modal', function () {
        currentAddonItem = null;
        currentAddonQty = 1;
    });

    // Addon option click — radio for required, checkbox for optional.
    // Clicking the already-selected option in a single-select group
    // deselects it (instead of being a no-op), so switching your mind
    // doesn't force picking something first just to clear it.
    $(document).on('click', '.addon-option', function () {
        const $this = $(this);
        const groupId = $this.data('group-id');
        const isRequired = $this.closest('.addon-options').data('required');
        if (isRequired === true || isRequired === 'true') {
            const wasSelected = $this.hasClass('selected');
            $(`.addon-option[data-group-id="${groupId}"]`).removeClass('selected');
            if (!wasSelected) $this.addClass('selected');
        } else {
            $this.toggleClass('selected');
        }
        updateAddonTotal();
    });

    // Add to cart from addon modal
    $('#addonAddToCartBtn').on('click', function () {
        if (!currentAddonItem) return;

        let allRequiredFilled = true;
        $('#addonGroupsContainer .addon-options[data-mandatory="true"]').each(function () {
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

        const qty = currentAddonQty || 1;
        const specialInstructions = ($('#addonSpecialInstructions').val() || '').trim().slice(0, 100);
        const cartKey = selectedAddons.length || specialInstructions
            ? `${currentAddonItem.id}_${selectedAddons.map(a => a.name).join('|')}_${specialInstructions}`
            : String(currentAddonItem.id);

        const existingItem = cart.find(item => item.cartKey === cartKey);
        if (existingItem) {
            existingItem.quantity += qty;
        } else {
            cart.push({
                id: currentAddonItem.id,
                cartKey,
                name: currentAddonItem.name,
                price: currentAddonItem.price,
                addonPrice,
                selectedAddons,
                specialInstructions,
                image: currentAddonItem.image,
                quantity: qty
            });
        }

        const addedName = currentAddonItem.name;
        addonModal.hide();
        updateCart();
        showToast(`${addedName} added to cart!`);
        currentAddonItem = null;
    });

    // Add to cart — every item now opens the customization modal (image,
    // quantity, and any category- or item-configured addon groups)
    // instead of adding straight to the cart. openAddonModal does its
    // own fetching, so this just hands off the item.
    $(document).on('click', '.btn-add-cart', function () {
        const id = parseInt($(this).data('id'));
        const menuItem = menuItems.find(item => item.id === id);
        if (!menuItem) return;
        openAddonModal(menuItem);
    });

    // Cart quantity controls
    $(document).on('click', '.qty-minus', function () {
        const cartKey = $(this).attr('data-cart-key');
        const cartItem = cart.find(item => item.cartKey === cartKey);
        if (cartItem && cartItem.quantity > 1) {
            cartItem.quantity--;
            updateCart();
        }
    });

    $(document).on('click', '.qty-plus', function () {
        const cartKey = $(this).attr('data-cart-key');
        const cartItem = cart.find(item => item.cartKey === cartKey);
        if (cartItem) {
            cartItem.quantity++;
            updateCart();
        }
    });

    $(document).on('click', '.cart-item-remove', function () {
        const cartKey = $(this).attr('data-cart-key');
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

    $('#browseMenuBtn').on('click', function () {
        $('#cartSidebar').removeClass('open');
        $('#cartOverlay').removeClass('show');
        $('body').css('overflow', '');
        const menuEl2 = document.getElementById('menu');
        if (menuEl2) window.scrollTo({ top: menuEl2.getBoundingClientRect().top + window.scrollY - NAV_SCROLL_OFFSET, behavior: 'smooth' });
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
                ? `<span class="checkout-item-addons">${item.selectedAddons.map(a => escapeHtml(a.name)).join(', ')}</span>`
                : '';
            const noteSpan = item.specialInstructions
                ? `<span class="checkout-item-note"><i class="bi bi-pencil-fill"></i> ${escapeHtml(item.specialInstructions)}</span>`
                : '';
            const html = `
                <div class="checkout-item">
                    <span class="checkout-item-name">
                        <span class="checkout-item-qty">${item.quantity}x</span>
                        ${escapeHtml(item.name)}${addonNames}${noteSpan}
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
    // Pure distance/time/fee math, no DOM. Split out of
    // calculateDeliveryEstimate so the location modal can quote the same
    // numbers the checkout will charge instead of keeping its own copy of
    // the tiers — change the pricing here and both surfaces follow.
    function getDeliveryQuote(lat, lng) {
        const distance = calculateDistance(SHOP_LAT, SHOP_LNG, lat, lng);
        return {
            distance: distance,
            deliveryTime: Math.max(15, Math.round(distance * 3)), // ~3 min per km, min 15 min
            deliveryCost: distance > 5 ? Math.round(distance * 20) : (distance > 3 ? 100 : 0)
        };
    }

    function calculateDeliveryEstimate(lat, lng) {
        const quote = getDeliveryQuote(lat, lng);
        const distance = quote.distance;
        const deliveryTime = quote.deliveryTime;
        const deliveryCost = quote.deliveryCost;

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
                    : []
            }));

            // Append addon selections to notes so staff always see them
            const addonSummary = cart
                .filter(ci => ci.selectedAddons && ci.selectedAddons.length > 0)
                .map(ci => `${ci.name}: ${ci.selectedAddons.map(a => a.name).join(', ')}`)
                .join(' | ');
            // Per-item customization notes have no dedicated backend field —
            // folding them into the order-level notes (same as addons above)
            // is what actually gets them in front of staff.
            const instructionsSummary = cart
                .filter(ci => ci.specialInstructions)
                .map(ci => `${ci.name} note: ${ci.specialInstructions}`)
                .join(' | ');
            const fullNotes = [notes, addonSummary, instructionsSummary].filter(Boolean).join('\n');

            const { data: order, error } = await supabaseClient.functions.invoke('submit-order', {
                body: {
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
                }
            });

            if (error) throw error;

            const orderNumber = order.order_number;
            const total = order.total;

            saveCustomerProfile(phone, fullName, email, address, paymentMethod, [...cart]);
            safeWriteLocalStorage('brewBeansLastOrder', { orderNumber, phone });

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
        document.getElementById('trackOrderNavItem').style.display = '';
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
        $('#returningCustomerBanner').hide().empty();
        $('#placeOrderBtn').html('<i class="bi bi-check-circle me-2"></i>Place Order');
        $('#placeOrderBtn').prop('disabled', false);
    });

    // ==========================================
    // RETURNING CUSTOMER RECOGNITION
    // ==========================================

    function saveCustomerProfile(phone, name, email, address, paymentMethod, cartSnapshot) {
        const freq = {};
        cartSnapshot.forEach(item => {
            if (!freq[item.id]) freq[item.id] = { id: item.id, name: item.name, image: item.image || '', count: 0 };
            freq[item.id].count += item.quantity;
        });
        safeWriteLocalStorage('brewBeansLastCustomer', {
            phone,
            name,
            email: email || '',
            address: address || '',
            lastPaymentMethod: paymentMethod,
            lastItems: Object.values(freq).sort((a, b) => b.count - a.count).slice(0, 6),
            savedAt: new Date().toISOString()
        });
    }

    async function checkReturningCustomer(phone) {
        const normalized = phone.replace(/[\s\-()]/g, '');
        const cached = safeReadLocalStorage('brewBeansLastCustomer');
        if (cached && cached.phone.replace(/[\s\-()]/g, '') === normalized) return cached;

        try {
            const { data: orders } = await supabaseClient
                .from('orders')
                .select('id, customer_name, email, payment_method')
                .eq('phone', phone)
                .order('created_at', { ascending: false })
                .limit(5);
            if (!orders || !orders.length) return null;

            const orderIds = orders.map(o => o.id);
            const { data: items } = await supabaseClient
                .from('order_items')
                .select('menu_item_id, menu_item_name, quantity')
                .in('order_id', orderIds);

            const freq = {};
            (items || []).forEach(i => {
                if (!freq[i.menu_item_id]) freq[i.menu_item_id] = { id: i.menu_item_id, name: i.menu_item_name, image: '', count: 0 };
                freq[i.menu_item_id].count += i.quantity;
            });
            Object.values(freq).forEach(fi => {
                const m = menuItems.find(x => x.id === fi.id);
                if (m) fi.image = m.image || '';
            });

            const last = orders[0];
            return {
                phone, name: last.customer_name, email: last.email || '',
                lastPaymentMethod: last.payment_method,
                lastItems: Object.values(freq).sort((a, b) => b.count - a.count).slice(0, 6),
                savedAt: new Date().toISOString()
            };
        } catch (e) { return null; }
    }

    function showReturningCustomerBanner(customer) {
        const banner = document.getElementById('returningCustomerBanner');
        if (!banner) return;

        if (customer.name && !$('#fullName').val()) $('#fullName').val(customer.name);
        if (customer.email && !$('#email').val()) $('#email').val(customer.email);
        if (customer.address && !$('#address').val()) $('#address').val(customer.address);
        if (customer.lastPaymentMethod) {
            $(`input[name="paymentMethod"][value="${customer.lastPaymentMethod}"]`).prop('checked', true);
        }

        const cartIds = new Set(cart.map(c => c.id));
        const suggestions = (customer.lastItems || [])
            .filter(item => menuItems.find(m => m.id === item.id) && !cartIds.has(item.id))
            .slice(0, 2);

        if (!suggestions.length) { banner.style.display = 'none'; return; }

        const firstName = (customer.name || '').split(' ')[0] || 'there';

        banner.innerHTML = '';
        banner.style.display = 'block';

        const wrap = document.createElement('div');
        wrap.className = 'rc-banner';

        const hdr = document.createElement('div');
        hdr.className = 'rc-header';
        hdr.innerHTML = '<i class="bi bi-person-check-fill"></i>';
        const hdrText = document.createElement('span');
        hdrText.appendChild(document.createTextNode('Welcome back, '));
        const strong = document.createElement('strong');
        strong.textContent = firstName;
        hdrText.appendChild(strong);
        hdrText.appendChild(document.createTextNode('! 👋'));
        hdr.appendChild(hdrText);
        wrap.appendChild(hdr);

        const sub = document.createElement('p');
        sub.className = 'rc-subtitle';
        sub.textContent = 'Because you loved these last time — add to your order:';
        wrap.appendChild(sub);

        const sugEl = document.createElement('div');
        sugEl.className = 'rc-suggestions';

        suggestions.forEach(item => {
            const menuItem = menuItems.find(m => m.id === item.id);
            if (!menuItem) return;

            const row = document.createElement('div');
            row.className = 'rc-suggestion-item';

            if (menuItem.image) {
                const img = document.createElement('img');
                img.src = menuItem.image;
                img.alt = menuItem.name;
                img.className = 'rc-item-img';
                img.addEventListener('error', () => { img.style.display = 'none'; });
                row.appendChild(img);
            }

            const info = document.createElement('div');
            info.className = 'rc-item-info';
            const nameEl = document.createElement('div');
            nameEl.className = 'rc-item-name';
            nameEl.textContent = menuItem.name;
            const reason = document.createElement('div');
            reason.className = 'rc-item-reason';
            reason.textContent = 'Because last time you tried this ✓';
            info.appendChild(nameEl);
            info.appendChild(reason);
            row.appendChild(info);

            const addBtn = document.createElement('button');
            addBtn.className = 'rc-add-btn';
            addBtn.innerHTML = '<i class="bi bi-plus"></i> Add';
            addBtn.addEventListener('click', () => {
                addDirectToCart(menuItem, null);
                renderCheckoutSummary();
                showReturningCustomerBanner(customer);
            });
            row.appendChild(addBtn);
            sugEl.appendChild(row);
        });

        wrap.appendChild(sugEl);
        banner.appendChild(wrap);
    }

    function rcDebounce(fn, ms) {
        let t; return function(...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
    }

    $('#checkoutModal').on('shown.bs.modal', function () {
        const cached = safeReadLocalStorage('brewBeansLastCustomer');
        if (cached) {
            showReturningCustomerBanner(cached);
            if (!$('#phoneNumber').val()) $('#phoneNumber').val(cached.phone);
        } else {
            $('#returningCustomerBanner').hide().empty();
        }

        const debouncedLookup = rcDebounce(async function () {
            const phone = $('#phoneNumber').val().trim();
            if (phone.length >= 10) {
                const customer = await checkReturningCustomer(phone);
                if (customer) showReturningCustomerBanner(customer);
                else { document.getElementById('returningCustomerBanner').style.display = 'none'; }
            }
        }, 700);

        $('#phoneNumber').off('input.rc').on('input.rc', debouncedLookup);
    });

    // ==========================================
    // TRACK ORDER
    // ==========================================

    const trackOrderModal = new bootstrap.Modal(document.getElementById('trackOrderModal'));

    // Show Track Order button only if customer has an active (non-delivered, non-cancelled) order
    (async function checkLastOrder() {
        const last = safeReadLocalStorage('brewBeansLastOrder');
        if (!last || !last.orderNumber || !last.phone) return;
        try {
            const { data } = await supabaseClient.rpc('get_order_status', {
                p_order_number: last.orderNumber,
                p_phone: last.phone
            });
            const order = Array.isArray(data) ? data[0] : data;
            if (!order || order.status === 'delivered' || order.status === 'cancelled') {
                localStorage.removeItem('brewBeansLastOrder');
            } else {
                document.getElementById('trackOrderNavItem').style.display = '';
            }
        } catch (e) {
            document.getElementById('trackOrderNavItem').style.display = '';
        }
    })();

    $('#trackOrderNavBtn').on('click', function () {
        // Pre-fill from last order if saved
        const last = safeReadLocalStorage('brewBeansLastOrder');
        if (last) {
            $('#trackOrderNumber').val(last.orderNumber || '');
            $('#trackPhone').val(last.phone || '');
        } else {
            $('#trackOrderNumber').val('');
            $('#trackPhone').val('');
        }
        $('#trackError').hide();
        trackOrderModal.show();
    });

    $('#trackSubmitBtn').on('click', function () {
        const orderNumber = $('#trackOrderNumber').val().trim();
        const phone = $('#trackPhone').val().trim();
        const errEl = document.getElementById('trackError');

        if (!orderNumber || !phone) {
            errEl.textContent = 'Please enter both order number and phone number.';
            errEl.style.display = 'block';
            return;
        }

        errEl.style.display = 'none';
        safeWriteLocalStorage('brewBeansLastOrder', { orderNumber, phone });
        try { sessionStorage.setItem(`bb_phone_${orderNumber}`, phone); } catch(e) {}
        trackOrderModal.hide();
        window.location.href = `order-tracking.html?order=${encodeURIComponent(orderNumber)}`;
    });

    // Allow Enter key in track modal inputs
    $('#trackOrderModal').on('keydown', function (e) {
        if (e.key === 'Enter') $('#trackSubmitBtn').trigger('click');
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
                <span>${escapeHtml(message)}</span>
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
        inner.style.background = isOpen ? 'rgba(134,239,172,0.15)' : 'rgba(252,165,165,0.15)';
        inner.style.borderColor = isOpen ? 'rgba(134,239,172,0.5)' : 'rgba(252,165,165,0.5)';
        dot.style.background = isOpen ? '#86efac' : '#fca5a5';
        label.textContent = text;
    }

    (async function checkShopBanner() {
        try {
            const { data } = await supabaseClient.from('business_hours').select('*').order('day_of_week');
            if (!data) return;
            const now = getShopNow();
            const day = now.getDay();
            const nowMins = now.getHours() * 60 + now.getMinutes();
            const todayHours = data.find(h => h.day_of_week === day);

            // Still inside yesterday's overnight window (close time past midnight)?
            const prevHours = data.find(h => h.day_of_week === (day + 6) % 7);
            if (prevHours && !prevHours.is_closed) {
                const [poh, pom] = prevHours.open_time.split(':').map(Number);
                const [pch, pcm] = prevHours.close_time.split(':').map(Number);
                const pOpenMins  = poh * 60 + pom;
                const pCloseMins = pch * 60 + pcm;
                if (pCloseMins < pOpenMins && nowMins < pCloseMins) {
                    showBanner('Open · Closes at ' + fmt12(prevHours.close_time), true);
                    return;
                }
            }

            if (!todayHours || todayHours.is_closed) {
                const next = data.find(h => h.day_of_week === (day + 1) % 7 && !h.is_closed);
                const txt = next ? `Closed · Opens ${DAY_NAMES[next.day_of_week]} at ${fmt12(next.open_time)}` : 'Closed Today';
                showBanner(txt, false); return;
            }

            const [oh, om] = todayHours.open_time.split(':').map(Number);
            const [ch, cm] = todayHours.close_time.split(':').map(Number);
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