(function () {
  'use strict';

  const theme = window.theme || {};

  const MONEY_PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/;
  const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

  function group(cents, decimals, thousands, decimal) {
    const parts = (Math.abs(cents) / 100).toFixed(decimals).split('.');
    const whole = parts[0].replace(THOUSANDS, thousands);
    return decimals && parts[1] ? whole + decimal + parts[1] : whole;
  }

  function formatMoney(cents) {
    const format = theme.moneyFormat || '${{amount}}';
    return format.replace(MONEY_PLACEHOLDER, function (_, placeholder) {
      switch (placeholder) {
        case 'amount_no_decimals':
          return group(cents, 0, ',', '.');
        case 'amount_with_comma_separator':
          return group(cents, 2, '.', ',');
        case 'amount_no_decimals_with_comma_separator':
          return group(cents, 0, '.', ',');
        case 'amount_with_apostrophe_separator':
          return group(cents, 2, "'", '.');
        case 'amount_no_decimals_with_space_separator':
          return group(cents, 0, ' ', ',');
        case 'amount_with_space_separator':
          return group(cents, 2, ' ', ',');
        default:
          return group(cents, 2, ',', '.');
      }
    });
  }

  async function cartFetch(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.description || data.message || 'Cart error');
    return data;
  }

  /* ---------------------------------------------
     Cart drawer
     --------------------------------------------- */
  const CartDrawer = {
    el: null,
    overlay: null,
    timerId: null,
    bound: false,

    init() {
      this.el = document.querySelector('[data-cart-drawer]');
      this.overlay = document.querySelector('[data-drawer-overlay]');
      if (!this.el || this.bound) return;
      this.bound = true;

      document.addEventListener('click', (e) => {
        const open = e.target.closest('[data-cart-open]');
        const close = e.target.closest('[data-cart-close]');
        if (open && theme.cartType === 'drawer') {
          e.preventDefault();
          this.open();
        }
        if (close) {
          e.preventDefault();
          this.close();
        }
      });

      document.addEventListener('click', (e) => {
        if (this.overlay && e.target === this.overlay) this.close();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen()) this.close();
      });

      document.addEventListener('click', (e) => {
        if (e.target.closest('[data-cart-drawer]')) this.handleItemAction(e);
      });
      document.addEventListener('change', (e) => {
        const input = e.target.closest('[data-cart-qty-input]');
        if (input) this.changeQty(input.dataset.key, parseInt(input.value, 10));
      });
    },

    isOpen() {
      return this.el && this.el.classList.contains('is-open');
    },

    open() {
      if (!this.el) return;
      this.el.setAttribute('aria-hidden', 'false');
      this.el.classList.add('is-open');
      if (this.overlay) {
        this.overlay.setAttribute('aria-hidden', 'false');
        this.overlay.classList.add('is-open');
      }
      document.body.classList.add('no-scroll');
      this.startTimer();
      const close = this.el.querySelector('[data-cart-close]');
      if (close) close.focus();
    },

    close() {
      if (!this.el) return;
      this.el.setAttribute('aria-hidden', 'true');
      this.el.classList.remove('is-open');
      if (this.overlay) {
        this.overlay.setAttribute('aria-hidden', 'true');
        this.overlay.classList.remove('is-open');
      }
      document.body.classList.remove('no-scroll');
    },

    handleItemAction(e) {
      const remove = e.target.closest('[data-cart-remove]');
      if (remove) {
        e.preventDefault();
        this.changeQty(remove.dataset.key, 0);
        return;
      }
      const step = e.target.closest('[data-cart-qty-step]');
      if (step) {
        e.preventDefault();
        const input = step.parentElement.querySelector('[data-cart-qty-input]');
        if (!input) return;
        const next = parseInt(input.value, 10) + parseInt(step.dataset.cartQtyStep, 10);
        this.changeQty(input.dataset.key, Math.max(0, next));
      }
    },

    async changeQty(key, quantity) {
      if (!key || Number.isNaN(quantity)) return;
      this.el.classList.add('loading');
      try {
        const cart = await cartFetch('/cart/change.js', { id: key, quantity });
        this.render(cart);
      } catch (err) {
        console.error(err);
      } finally {
        this.el.classList.remove('loading');
      }
    },

    async refresh() {
      const cart = await fetch('/cart.js').then((r) => r.json());
      this.render(cart);
      return cart;
    },

    render(cart) {
      updateCartCount(cart.item_count);

      const body = this.el.querySelector('[data-cart-items]');
      const foot = this.el.querySelector('[data-cart-foot]');
      const countEl = this.el.querySelector('[data-cart-drawer-count]');
      if (countEl) countEl.textContent = cart.item_count;

      if (!cart.items.length) {
        if (body) {
          body.innerHTML =
            '<div class="cart-empty"><p class="cart-empty__text">' +
            (this.el.dataset.emptyText || 'Your cart is empty') +
            '</p><a href="/collections/all" class="btn btn--outline">' +
            (this.el.dataset.continueText || 'Continue shopping') +
            '</a></div>';
        }
        if (foot) foot.hidden = true;
        this.stopTimer();
        return;
      }

      if (foot) foot.hidden = false;
      if (body) body.innerHTML = cart.items.map((item) => this.itemHTML(item)).join('');

      const total = this.el.querySelector('[data-cart-total]');
      if (total) total.textContent = formatMoney(cart.total_price);

      this.renderFreeShipping(cart.total_price);
    },

    itemHTML(item) {
      const img = item.image
        ? '<img src="' + item.image.replace(/(\.[^.]*)$/, '_160x$1') + '" alt="" loading="lazy" width="72" height="72">'
        : '';
      const options = item.options_with_values
        ? item.options_with_values
            .filter((o) => o.value !== 'Default Title')
            .map(
              (o) =>
                escapeHTML(translateOption('name', o.name)) +
                ': ' +
                escapeHTML(translateOption('value', o.value))
            )
            .join(' &middot; ')
        : '';
      const compare =
        item.original_line_price > item.final_line_price
          ? '<s class="price__compare">' + formatMoney(item.original_line_price) + '</s> '
          : '';

      return (
        '<div class="cart-item">' +
        '<div class="cart-item__img">' + img + '</div>' +
        '<div class="cart-item__info">' +
        '<a href="' + item.url + '" class="cart-item__title">' + escapeHTML(item.product_title) + '</a>' +
        (options ? '<span class="cart-item__variant">' + options + '</span>' : '') +
        '<div class="price">' + compare +
        '<span class="' + (compare ? 'price__sale' : 'price__regular') + '">' +
        formatMoney(item.final_line_price) + '</span></div>' +
        '<div class="cart-item__foot">' +
        '<div class="qty">' +
        '<button type="button" class="qty__btn" data-cart-qty-step="-1" aria-label="Decrease quantity">&minus;</button>' +
        '<input class="qty__input" type="number" min="0" value="' + item.quantity + '" data-cart-qty-input data-key="' + item.key + '" aria-label="Quantity">' +
        '<button type="button" class="qty__btn" data-cart-qty-step="1" aria-label="Increase quantity">+</button>' +
        '</div>' +
        '<button type="button" class="cart-item__remove" data-cart-remove data-key="' + item.key + '">Remove</button>' +
        '</div></div></div>'
      );
    },

    renderFreeShipping(totalPrice) {
      const wrap = this.el.querySelector('[data-free-shipping]');
      if (!wrap) return;
      const cfg = theme.freeShipping || {};
      if (!cfg.enabled || !cfg.threshold) {
        wrap.hidden = true;
        return;
      }
      wrap.hidden = false;
      const remaining = cfg.threshold - totalPrice;
      const strings = theme.strings || {};
      const text = wrap.querySelector('[data-free-shipping-text]');
      const fill = wrap.querySelector('[data-free-shipping-fill]');
      if (remaining > 0) {
        // The amount is injected as markup so it can be bolded inside the sentence;
        // word order differs by language, so the placeholder has to travel with the string.
        if (text) text.innerHTML = escapeHTML(strings.freeShippingProgress || '')
          .replace('__AMOUNT__', '<strong>' + escapeHTML(formatMoney(remaining)) + '</strong>');
        if (fill) fill.style.width = Math.min(100, (totalPrice / cfg.threshold) * 100) + '%';
      } else {
        if (text) text.innerHTML = '<strong>' + escapeHTML(strings.freeShippingReached || '') + '</strong>';
        if (fill) fill.style.width = '100%';
      }
    },

    startTimer() {
      const cfg = theme.cartTimer || {};
      const el = this.el.querySelector('[data-cart-timer-value]');
      const wrap = this.el.querySelector('[data-cart-timer]');
      if (!cfg.enabled || !el || !wrap) return;

      let expiry = parseInt(sessionStorage.getItem('cartExpiry') || '0', 10);
      if (!expiry || expiry < Date.now()) {
        expiry = Date.now() + cfg.minutes * 60 * 1000;
        try { sessionStorage.setItem('cartExpiry', String(expiry)); } catch (e) {}
      }

      const tick = () => {
        const left = Math.max(0, expiry - Date.now());
        const m = Math.floor(left / 60000);
        const s = Math.floor((left % 60000) / 1000);
        el.textContent = m + ':' + String(s).padStart(2, '0');
        if (left <= 0) this.stopTimer();
      };
      tick();
      wrap.hidden = false;
      this.stopTimer(true);
      this.timerId = setInterval(tick, 1000);
    },

    stopTimer(keepVisible) {
      if (this.timerId) clearInterval(this.timerId);
      this.timerId = null;
      if (!keepVisible) {
        const wrap = this.el && this.el.querySelector('[data-cart-timer]');
        if (wrap) wrap.hidden = true;
      }
    }
  };

  const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  // The cart comes back from /cart.js with the catalogue's raw English
  // option data. Same dictionary as snippets/option-label.liquid, handed
  // over by the layout so there is only one copy to maintain.
  function translateOption(kind, value) {
    const maps = theme.optionLabels || {};
    const dict = kind === 'name' ? maps.names : maps.values;
    if (!dict || value == null) return value;
    return dict[String(value).trim().toLowerCase()] || value;
  }

  function escapeHTML(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
  }

  function updateCartCount(count) {
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = count;
      el.hidden = count === 0;
    });
  }

  /* ---------------------------------------------
     Add to cart forms
     --------------------------------------------- */
  function initAddToCart() {
    document.addEventListener('submit', async (e) => {
      const form = e.target.closest('[data-product-form]');
      if (!form) return;
      e.preventDefault();

      const btn = form.querySelector('[type="submit"]');
      const original = btn ? btn.textContent : '';
      if (btn) {
        btn.disabled = true;
        btn.textContent = theme.strings ? theme.strings.adding : 'Adding...';
      }

      try {
        const formData = new FormData(form);
        const res = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.description || 'Could not add to cart');

        if (theme.cartType === 'drawer' && CartDrawer.el) {
          await CartDrawer.refresh();
          CartDrawer.open();
        } else {
          window.location.href = '/cart';
        }
      } catch (err) {
        const errEl = form.querySelector('[data-form-error]');
        if (errEl) {
          errEl.textContent = err.message;
          errEl.hidden = false;
        } else {
          alert(err.message);
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = original;
        }
      }
    });
  }

  /* ---------------------------------------------
     Variant selection
     --------------------------------------------- */
  function initVariants() {
    document.querySelectorAll('[data-variant-picker]').forEach((picker) => {
      if (picker.dataset.bound) return;
      picker.dataset.bound = '1';
      const dataEl = picker.querySelector('[data-variant-json]');
      if (!dataEl) return;

      let data;
      try {
        data = JSON.parse(dataEl.textContent);
      } catch (e) {
        return;
      }
      const variants = data.variants;
      const media = data.media || {};
      const colourIndex = data.colourIndex;

      // Only some variants of a colour were given an image in the admin, so
      // picking a different size of a colour that does have a photo left the
      // gallery frozen. Borrow the image from a sibling of the same colour.
      function mediaIdForColour(colour) {
        if (colourIndex == null || colour == null) return null;
        const v = variants.find((x) => x.media_id && x.options[colourIndex] === colour);
        return v ? v.media_id : null;
      }

      function mediaIdFor(variant) {
        return variant.media_id || mediaIdForColour(variant.options[colourIndex]);
      }

      const form = picker.closest('[data-product-form]') || document.querySelector('[data-product-form]');
      const idInput = form ? form.querySelector('[name="id"]') : null;

      picker.addEventListener('change', () => {
        const selected = Array.from(picker.querySelectorAll('input:checked')).map((i) => i.value);
        const match = variants.find((v) => v.options.every((opt, i) => opt === selected[i]));

        picker.querySelectorAll('[data-option-label]').forEach((label) => {
          const idx = parseInt(label.dataset.optionLabel, 10);
          // Liquid rendered this translated; writing selected[idx] straight
          // back put the raw English value on screen at the first click.
          if (selected[idx]) label.textContent = translateOption('value', selected[idx]);
        });

        if (!match) {
          // Colours here do not all come in every size, so a shopper clicking
          // a colour often lands on a combination that does not exist. The
          // colour they asked for should still be the one on screen; bailing
          // out left the gallery showing the previous one.
          updateImage(mediaIdForColour(selected[colourIndex]), media);
          updateBuyButton(form, null);
          return;
        }

        if (idInput) idInput.value = match.id;
        updatePrice(picker, match);
        updateBuyButton(form, match);
        updateStockNote(match);
        updateImage(mediaIdFor(match), media);

        const url = new URL(window.location);
        url.searchParams.set('variant', match.id);
        window.history.replaceState({}, '', url);
      });
    });
  }

  function updatePrice(picker, variant) {
    const root = picker.closest('.product__info') || document;
    const priceEl = root.querySelector('[data-product-price]');
    if (!priceEl) return;

    const strings = theme.strings || {};
    const onSale = variant.compare_at_price && variant.compare_at_price > variant.price;

    let inner;
    if (onSale) {
      const pct = Math.round(
        ((variant.compare_at_price - variant.price) / variant.compare_at_price) * 100
      );
      inner =
        '<s class="price__compare">' + escapeHTML(formatMoney(variant.compare_at_price)) + '</s>' +
        '<span class="price__sale">' + escapeHTML(formatMoney(variant.price)) + '</span>' +
        '<span class="price__save">' + escapeHTML(strings.save || 'Save') + ' ' + pct + '%</span>';
    } else {
      inner = '<span class="price__regular">' + escapeHTML(formatMoney(variant.price)) + '</span>';
    }

    // Keep the wrapper snippets/price.liquid rendered: it carries the flex
    // layout and the large sizing, and rebuilding without it reflowed the
    // whole block on every variant change.
    const existing = priceEl.querySelector('.price');
    const cls = existing ? existing.className : 'price price--large';
    priceEl.innerHTML = '<div class="' + cls + '">' + inner + '</div>';
  }

  function updateBuyButton(form, variant) {
    if (!form) return;
    const btn = form.querySelector('[type="submit"]');
    if (!btn) return;
    const strings = theme.strings || {};

    if (!variant) {
      btn.disabled = true;
      btn.textContent = strings.unavailable || 'Unavailable';
    } else if (!variant.available) {
      btn.disabled = true;
      btn.textContent = strings.soldOut || 'Sold out';
    } else {
      btn.disabled = false;
      btn.textContent = strings.addToCart || 'Add to cart';
    }
  }

  function updateStockNote(variant) {
    const note = document.querySelector('[data-stock-note]');
    if (!note) return;
    const strings = theme.strings || {};
    const threshold = parseInt(note.dataset.lowThreshold || '5', 10);
    const qty = variant.inventory_quantity;

    note.classList.remove('stock-note--out', 'stock-note--low', 'stock-note--in');
    let state = 'in';
    let label = strings.inStock || 'In stock';

    if (!variant.available) {
      state = 'out';
      label = strings.soldOut || 'Sold out';
    } else if (variant.tracked && qty > 0 && qty <= threshold) {
      state = 'low';
      label = (strings.lowStock || 'Only __COUNT__ left in stock').replace('__COUNT__', qty);
    }

    note.classList.add('stock-note--' + state);
    note.innerHTML = '<span class="stock-note__dot"></span>' + escapeHTML(label);
  }

  function updateImage(mediaId, media) {
    if (!mediaId) return;
    const thumb = document.querySelector('[data-product-thumb][data-media-id="' + mediaId + '"]');
    if (thumb) {
      thumb.click();
      return;
    }
    const src = media[mediaId];
    const main = document.querySelector('[data-product-main-image]');
    if (!src || !main) return;
    main.src = src;
    main.srcset = '';
  }

  /* ---------------------------------------------
     Product gallery
     --------------------------------------------- */
  function initGallery() {
    document.querySelectorAll('[data-product-gallery]').forEach((gallery) => {
      if (gallery.dataset.bound) return;
      const main = gallery.querySelector('[data-product-main-image]');
      if (!main) return;
      gallery.dataset.bound = '1';

      gallery.addEventListener('click', (e) => {
        const thumb = e.target.closest('[data-product-thumb]');
        if (!thumb) return;
        e.preventDefault();

        main.src = thumb.dataset.full;
        main.srcset = thumb.dataset.srcset || '';
        main.alt = thumb.dataset.alt || '';

        gallery.querySelectorAll('[data-product-thumb]').forEach((t) => t.setAttribute('aria-current', 'false'));
        thumb.setAttribute('aria-current', 'true');
      });
    });
  }

  /* ---------------------------------------------
     Quantity steppers (outside cart)
     --------------------------------------------- */
  function initQty() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-qty-step]');
      if (!btn) return;
      const input = btn.parentElement.querySelector('input');
      if (!input) return;
      const min = parseInt(input.min || '1', 10);
      const next = parseInt(input.value, 10) + parseInt(btn.dataset.qtyStep, 10);
      input.value = Math.max(min, next);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  /* ---------------------------------------------
     Mobile menu
     --------------------------------------------- */
  function initMobileMenu() {
    const menu = document.querySelector('[data-mobile-menu]');
    const overlay = document.querySelector('[data-drawer-overlay]');
    if (!menu) return;

    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-menu-open]')) {
        e.preventDefault();
        menu.setAttribute('aria-hidden', 'false');
        menu.classList.add('is-open');
        if (overlay) {
          overlay.setAttribute('aria-hidden', 'false');
          overlay.classList.add('is-open');
        }
        document.body.classList.add('no-scroll');
      }
      if (e.target.closest('[data-menu-close]')) {
        e.preventDefault();
        closeMenu();
      }
    });

    document.addEventListener('click', (e) => {
      if (overlay && e.target === overlay) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });

    function closeMenu() {
      menu.setAttribute('aria-hidden', 'true');
      menu.classList.remove('is-open');
      if (overlay && !CartDrawer.isOpen()) {
        overlay.setAttribute('aria-hidden', 'true');
        overlay.classList.remove('is-open');
      }
      document.body.classList.remove('no-scroll');
    }
  }

  /* ---------------------------------------------
     Carousels
     --------------------------------------------- */
  function initCarousels() {
    document.querySelectorAll('[data-carousel]').forEach((carousel) => {
      if (carousel.dataset.bound) return;
      carousel.dataset.bound = '1';
      const track = carousel.querySelector('[data-carousel-track]');
      const prev = carousel.querySelector('[data-carousel-prev]');
      const next = carousel.querySelector('[data-carousel-next]');
      if (!track) return;

      const scrollBy = () => track.clientWidth * 0.8;
      if (prev) prev.addEventListener('click', () => track.scrollBy({ left: -scrollBy(), behavior: 'smooth' }));
      if (next) next.addEventListener('click', () => track.scrollBy({ left: scrollBy(), behavior: 'smooth' }));

      const update = () => {
        if (prev) prev.disabled = track.scrollLeft <= 4;
        if (next) next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      };
      track.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update);
      update();
    });
  }


  /* ---------------------------------------------
     Sticky add to cart
     --------------------------------------------- */
  function initStickyATC() {
    const bar = document.querySelector('[data-sticky-atc]');
    const form = document.querySelector('[data-product-form]');
    if (!bar || !form) return;

    const mainBtn = form.querySelector('[type="submit"]');
    const stickyBtn = bar.querySelector('[data-sticky-atc-submit]');
    if (!mainBtn) return;

    // The sticky bar only submits the real form, so variant and quantity
    // selection stay in one place.
    if (stickyBtn) {
      stickyBtn.addEventListener('click', () => {
        if (mainBtn.disabled) return;
        form.requestSubmit ? form.requestSubmit() : mainBtn.click();
      });
    }

    const show = (visible) => {
      bar.classList.toggle('is-visible', visible);
      bar.setAttribute('aria-hidden', visible ? 'false' : 'true');
    };

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(
        ([entry]) => show(!entry.isIntersecting && entry.boundingClientRect.top < 0),
        { threshold: 0 }
      ).observe(mainBtn);
    }

    // Mirror the main button's state whenever a variant changes.
    const sync = () => {
      if (!stickyBtn) return;
      stickyBtn.disabled = mainBtn.disabled;
      stickyBtn.textContent = mainBtn.textContent;
      const price = document.querySelector('[data-product-price]');
      const target = bar.querySelector('[data-sticky-price]');
      if (price && target) target.innerHTML = price.innerHTML;
    };
    new MutationObserver(sync).observe(mainBtn, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
  }


  /* ---------------------------------------------
     Size guide modal
     --------------------------------------------- */
  function initSizeGuide() {
    const modal = document.querySelector('[data-size-guide]');
    if (!modal) return;

    const open = () => {
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('no-scroll');
      const close = modal.querySelector('[data-size-guide-close]');
      if (close) close.focus();
    };
    const close = () => {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('no-scroll');
    };

    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-size-guide-open]')) {
        e.preventDefault();
        open();
      }
      if (e.target.closest('[data-size-guide-close]') || e.target === modal) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) close();
    });
  }


  /* ---------------------------------------------
     Country / currency picker
     --------------------------------------------- */
  function initLocalization() {
    const root = document.querySelector('.localization');
    if (!root) return;

    const toggle = root.querySelector('[data-localization-toggle]');
    const list = root.querySelector('[data-localization-list]');
    const input = root.querySelector('[data-country-input]');
    const form = root.closest('form');
    if (!toggle || !list || !form) return;

    const close = () => {
      list.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    };

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = list.hidden;
      list.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    });

    list.addEventListener('click', (e) => {
      const option = e.target.closest('[data-localization-option]');
      if (!option) return;
      if (input) input.value = option.dataset.value;
      form.submit();
    });

    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  /* ---------------------------------------------
     Boot
     --------------------------------------------- */
  // Document-level listeners must bind once; shopify:section:load re-runs init
  // in the theme editor and would otherwise stack duplicates on every reload.
  let globalsBound = false;

  function init() {
    if (!globalsBound) {
      globalsBound = true;
      CartDrawer.init();
      initAddToCart();
      initQty();
      initMobileMenu();
      initStickyATC();
      initSizeGuide();
      initLocalization();
    }
    initVariants();
    initGallery();
    initCarousels();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  document.addEventListener('shopify:section:load', init);
  window.CartDrawer = CartDrawer;
})();
