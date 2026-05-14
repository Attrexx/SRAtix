/**
 * SRAtix Exhibitors Grid — Frontend JS
 *
 * Vanilla ES2017+, no jQuery, no build step.
 * Config: window.sratixExgrid (localized by SRAtix_Client_Public::enqueue_grid_assets)
 *
 * @package SRAtix_Client
 * @version 0.12.0
 */
( function () {
	'use strict';

	const cfg = window.sratixExgrid || {};
	if ( ! cfg.ajaxUrl ) return;

	const i18n = cfg.i18n || {};

	// ─── Init all grids on the page ──────────────────────────────────────────
	document.querySelectorAll( '.sratix-exgrid-root' ).forEach( initGrid );

	function initGrid( root ) {
		const state = readStateFromUrl();
		renderResultsCount( root, null, null );
		bindFilters( root, state );
		bindCards( root );
		bindLoadMore( root, state );
		// Phase C: if ( cfg.liveStatusEnabled ) startLiveStatusPolling( root );
	}

	// ─── URL State ───────────────────────────────────────────────────────────
	function readStateFromUrl() {
		const p = new URLSearchParams( window.location.search );
		return {
			search:   p.get( 'exhibitor_search' )   || '',
			sort:     p.get( 'exhibitor_sort' )      || 'booth',
			area:     p.get( 'exhibitor_expo_area' ) || '',
			category: p.get( 'exhibitor_category' )  || '0',
			type:     p.get( 'exhibitor_type' )       || '0',
			hasDemo:  p.get( 'exhibitor_has_demo' )   === '1',
			page:     parseInt( p.get( 'exhibitor_page' ) || '1', 10 ),
		};
	}

	function pushState( state ) {
		const p = new URLSearchParams( window.location.search );
		const map = {
			exhibitor_search:   state.search   || null,
			exhibitor_sort:     state.sort !== 'booth' ? state.sort : null,
			exhibitor_expo_area: state.area   || null,
			exhibitor_category:  state.category !== '0' ? state.category : null,
			exhibitor_type:      state.type !== '0' ? state.type : null,
			exhibitor_has_demo:  state.hasDemo ? '1' : null,
			exhibitor_page:      state.page > 1 ? String( state.page ) : null,
		};
		Object.entries( map ).forEach( ( [ k, v ] ) => {
			if ( v !== null && v !== '' ) {
				p.set( k, v );
			} else {
				p.delete( k );
			}
		} );
		const qs = p.toString();
		history.replaceState( null, '', qs ? '?' + qs : window.location.pathname );
	}

	// ─── Filter Binding ───────────────────────────────────────────────────────
	function bindFilters( root, state ) {
		const form = root.querySelector( '.sratix-exgrid-filters' );
		if ( ! form ) return;

		let debounceTimer = null;

		const searchInput = form.querySelector( '[name="exhibitor_search"]' );
		if ( searchInput ) {
			searchInput.addEventListener( 'input', () => {
				clearTimeout( debounceTimer );
				debounceTimer = setTimeout( () => {
					state.search = searchInput.value.trim();
					state.page   = 1;
					pushState( state );
					refresh( root, state, false );
				}, 300 );
			} );
		}

		const selects = form.querySelectorAll( 'select' );
		selects.forEach( sel => {
			sel.addEventListener( 'change', () => {
				const name = sel.getAttribute( 'name' );
				if ( name === 'exhibitor_sort' )      state.sort     = sel.value;
				if ( name === 'exhibitor_expo_area' ) state.area     = sel.value;
				if ( name === 'exhibitor_category' )  state.category = sel.value;
				if ( name === 'exhibitor_type' )      state.type     = sel.value;
				state.page = 1;
				pushState( state );
				refresh( root, state, false );
			} );
		} );

		const demoToggle = form.querySelector( '[name="exhibitor_has_demo"]' );
		if ( demoToggle ) {
			demoToggle.addEventListener( 'change', () => {
				state.hasDemo = demoToggle.checked;
				state.page    = 1;
				pushState( state );
				refresh( root, state, false );
			} );
		}

		const resetBtn = form.querySelector( '.sratix-exgrid-filters__reset' );
		if ( resetBtn ) {
			resetBtn.addEventListener( 'click', () => {
				state.search   = '';
				state.sort     = 'booth';
				state.area     = '';
				state.category = '0';
				state.type     = '0';
				state.hasDemo  = false;
				state.page     = 1;

				if ( searchInput ) searchInput.value = '';
				selects.forEach( sel => {
					if ( sel.getAttribute( 'name' ) === 'exhibitor_sort' )      sel.value = 'booth';
					if ( sel.getAttribute( 'name' ) === 'exhibitor_expo_area' ) sel.value = '';
					if ( sel.getAttribute( 'name' ) === 'exhibitor_category' )  sel.value = '0';
					if ( sel.getAttribute( 'name' ) === 'exhibitor_type' )      sel.value = '0';
				} );
				if ( demoToggle ) demoToggle.checked = false;

				pushState( state );
				refresh( root, state, false );
			} );
		}
	}

	// ─── Card Click Delegation ────────────────────────────────────────────────
	function bindCards( root ) {
		root.addEventListener( 'click', e => {
			const card = e.target.closest( '.sratix-exgrid-card' );
			if ( ! card ) return;
			// Don't trap clicks on links inside the card.
			if ( e.target.closest( 'a' ) ) return;
			const postId = parseInt( card.dataset.postId, 10 );
			if ( postId ) openModal( root, postId, card );
		} );

		root.addEventListener( 'keydown', e => {
			if ( e.key !== 'Enter' && e.key !== ' ' ) return;
			const card = e.target.closest( '.sratix-exgrid-card' );
			if ( ! card ) return;
			e.preventDefault();
			const postId = parseInt( card.dataset.postId, 10 );
			if ( postId ) openModal( root, postId, card );
		} );
	}

	// ─── Load More ────────────────────────────────────────────────────────────
	function bindLoadMore( root, state ) {
		const btn = root.querySelector( '.sratix-exgrid-load-more__btn' );
		if ( ! btn ) return;
		btn.addEventListener( 'click', () => {
			state.page++;
			pushState( state );
			refresh( root, state, true );
		} );
	}

	// ─── AJAX Refresh ────────────────────────────────────────────────────────
	function refresh( root, state, append ) {
		root.classList.add( 'is-loading' );
		const cardsContainer = root.querySelector( '.sratix-exgrid-cards' );
		const loadMoreWrap   = root.querySelector( '.sratix-exgrid-load-more' );
		const loadMoreBtn    = loadMoreWrap && loadMoreWrap.querySelector( '.sratix-exgrid-load-more__btn' );

		const body = new FormData();
		body.append( 'action',              'sratix_exgrid_filter' );
		body.append( 'nonce',               cfg.nonce );
		body.append( 'exhibitor_search',    state.search );
		body.append( 'exhibitor_sort',      state.sort );
		body.append( 'exhibitor_expo_area', state.area );
		body.append( 'exhibitor_category',  state.category );
		body.append( 'exhibitor_type',      state.type );
		body.append( 'exhibitor_has_demo',  state.hasDemo ? '1' : '' );
		body.append( 'exhibitor_page',      String( state.page ) );
		// Pass shortcode atts stored on root element.
		body.append( 'edition',   root.dataset.edition   || '' );
		body.append( 'per_page',  root.dataset.perPage   || '24' );
		body.append( 'show_sponsors', root.dataset.showSponsors || '1' );

		fetch( cfg.ajaxUrl, { method: 'POST', body } )
			.then( r => {
				if ( ! r.ok ) throw new Error( 'HTTP ' + r.status );
				return r.json();
			} )
			.then( data => {
				if ( data.success === false ) {
					console.warn( '[sratix-exgrid]', data.data );
					return;
				}
				const d = data.data || data; // handle both WP AJAX response shapes.
				if ( append && cardsContainer ) {
					cardsContainer.insertAdjacentHTML( 'beforeend', d.html );
				} else if ( cardsContainer ) {
					cardsContainer.innerHTML = d.html;
				}
				// Bind new card click listeners via delegation (already on root).
				renderResultsCount( root, d.total, d.per_page * d.page );

				if ( loadMoreWrap ) {
					loadMoreWrap.hidden = ! d.has_more;
				}
				if ( loadMoreBtn ) {
					loadMoreBtn.disabled = false;
				}
			} )
			.catch( err => {
				console.error( '[sratix-exgrid] refresh error', err );
			} )
			.finally( () => {
				root.classList.remove( 'is-loading' );
			} );
	}

	function renderResultsCount( root, total, shown ) {
		const counter = root.querySelector( '.sratix-exgrid-count' );
		if ( ! counter ) return;
		if ( total === null ) return;
		const shownCapped = Math.min( shown, total );
		if ( total === 0 ) {
			counter.textContent = i18n.noResults || 'No exhibitors found.';
		} else if ( i18n.showing ) {
			counter.textContent = i18n.showing
				.replace( '%1$d', shownCapped )
				.replace( '%2$d', total );
		}
	}

	// ─── Modal ───────────────────────────────────────────────────────────────
	let lastTrigger = null;

	function openModal( root, postId, triggerEl ) {
		lastTrigger = triggerEl || null;
		const dialog = root.querySelector( '.sratix-exgrid-modal' );
		const body   = root.querySelector( '.sratix-exgrid-modal__content' );
		if ( ! dialog || ! body ) return;

		body.innerHTML = '<div class="sratix-exgrid-modal__spinner" aria-label="' + ( i18n.loading || 'Loading…' ) + '"></div>';
		dialog.showModal();

		const formData = new FormData();
		formData.append( 'action',   'sratix_exgrid_detail' );
		formData.append( 'nonce',    cfg.nonce );
		formData.append( 'post_id',  postId );

		fetch( cfg.ajaxUrl, { method: 'POST', body: formData } )
			.then( r => {
				if ( ! r.ok ) throw new Error( 'HTTP ' + r.status );
				return r.json();
			} )
			.then( data => {
				const d = data.data || data;
				body.innerHTML = d.html || '';
				trapFocus( dialog );

				// Bind gallery lightbox triggers.
				body.querySelectorAll( '[data-gallery]' ).forEach( btn => {
					btn.addEventListener( 'click', () => {
						const gId     = btn.dataset.gallery;
						const idx     = parseInt( btn.dataset.index, 10 );
						const images  = Array.from( body.querySelectorAll( '[data-gallery="' + gId + '"]' ) )
							.map( b => ( { src: b.dataset.src, alt: b.querySelector( 'img' ) ? b.querySelector( 'img' ).alt : '' } ) );
						openLightbox( images, idx );
					} );
				} );
			} )
			.catch( () => {
				body.innerHTML = '<p class="sratix-exgrid-modal__error">' + ( i18n.errorLoading || 'Could not load exhibitor details.' ) + '</p>';
			} );

		// Close on backdrop click.
		dialog.addEventListener( 'click', onBackdropClick );

		// Expose close button.
		const closeBtn = dialog.querySelector( '.sratix-exgrid-modal__close' );
		if ( closeBtn ) {
			closeBtn.addEventListener( 'click', () => closeModal( root ) );
		}
	}

	function onBackdropClick( e ) {
		// The <dialog> itself is the backdrop area; body content is a child.
		if ( e.target === e.currentTarget ) {
			const root = document.querySelector( '.sratix-exgrid-root' );
			if ( root ) closeModal( root );
		}
	}

	function closeModal( root ) {
		const dialog = root.querySelector( '.sratix-exgrid-modal' );
		if ( ! dialog ) return;
		dialog.removeEventListener( 'click', onBackdropClick );
		dialog.close();
		if ( lastTrigger ) {
			lastTrigger.focus();
			lastTrigger = null;
		}
	}

	// Auto-close on native Esc.
	document.addEventListener( 'keydown', e => {
		if ( e.key === 'Escape' ) {
			const root = document.querySelector( '.sratix-exgrid-root' );
			if ( root ) closeModal( root );
		}
	} );

	// ─── Focus Trap ──────────────────────────────────────────────────────────
	function trapFocus( el ) {
		const focusable = el.querySelectorAll(
			'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		if ( ! focusable.length ) return;
		const first = focusable[ 0 ];
		const last  = focusable[ focusable.length - 1 ];
		first.focus();

		el.addEventListener( 'keydown', function handler( e ) {
			if ( e.key !== 'Tab' ) return;
			if ( e.shiftKey ) {
				if ( document.activeElement === first ) {
					e.preventDefault();
					last.focus();
				}
			} else {
				if ( document.activeElement === last ) {
					e.preventDefault();
					first.focus();
				}
			}
			// Remove handler once modal closes.
			if ( ! el.open ) el.removeEventListener( 'keydown', handler );
		} );
	}

	// ─── Lightbox ────────────────────────────────────────────────────────────
	let lightboxEl      = null;
	let lightboxImages  = [];
	let lightboxIndex   = 0;

	function openLightbox( images, startIndex ) {
		lightboxImages = images;
		lightboxIndex  = startIndex;
		if ( ! lightboxEl ) buildLightbox();
		renderLightboxSlide();
		lightboxEl.hidden = false;
		lightboxEl.focus();
	}

	function buildLightbox() {
		lightboxEl = document.createElement( 'div' );
		lightboxEl.className  = 'sratix-exgrid-lightbox';
		lightboxEl.setAttribute( 'role', 'dialog' );
		lightboxEl.setAttribute( 'aria-modal', 'true' );
		lightboxEl.setAttribute( 'tabindex', '-1' );
		lightboxEl.innerHTML = `
			<div class="sratix-exgrid-lightbox__backdrop"></div>
			<div class="sratix-exgrid-lightbox__inner">
				<button type="button" class="sratix-exgrid-lightbox__close" aria-label="${ i18n.close || 'Close' }">&#x2715;</button>
				<button type="button" class="sratix-exgrid-lightbox__prev"  aria-label="${ i18n.prevImage || 'Previous image' }">&#x2039;</button>
				<div   class="sratix-exgrid-lightbox__img-wrap">
					<img class="sratix-exgrid-lightbox__img" src="" alt="" decoding="async">
				</div>
				<button type="button" class="sratix-exgrid-lightbox__next"  aria-label="${ i18n.nextImage || 'Next image' }">&#x203A;</button>
				<div   class="sratix-exgrid-lightbox__counter"></div>
			</div>
		`;
		document.body.appendChild( lightboxEl );

		lightboxEl.querySelector( '.sratix-exgrid-lightbox__close' ).addEventListener( 'click', closeLightbox );
		lightboxEl.querySelector( '.sratix-exgrid-lightbox__backdrop' ).addEventListener( 'click', closeLightbox );
		lightboxEl.querySelector( '.sratix-exgrid-lightbox__prev' ).addEventListener( 'click', () => {
			lightboxIndex = ( lightboxIndex - 1 + lightboxImages.length ) % lightboxImages.length;
			renderLightboxSlide();
		} );
		lightboxEl.querySelector( '.sratix-exgrid-lightbox__next' ).addEventListener( 'click', () => {
			lightboxIndex = ( lightboxIndex + 1 ) % lightboxImages.length;
			renderLightboxSlide();
		} );

		// Keyboard navigation.
		lightboxEl.addEventListener( 'keydown', e => {
			if ( e.key === 'Escape' )      { closeLightbox(); return; }
			if ( e.key === 'ArrowLeft' )   { lightboxEl.querySelector( '.sratix-exgrid-lightbox__prev' ).click(); }
			if ( e.key === 'ArrowRight' )  { lightboxEl.querySelector( '.sratix-exgrid-lightbox__next' ).click(); }
		} );

		// Pointer/touch swipe.
		let touchStartX = 0;
		lightboxEl.addEventListener( 'pointerdown', e => { touchStartX = e.clientX; } );
		lightboxEl.addEventListener( 'pointerup', e => {
			const delta = e.clientX - touchStartX;
			if ( Math.abs( delta ) < 40 ) return;
			if ( delta < 0 ) {
				lightboxEl.querySelector( '.sratix-exgrid-lightbox__next' ).click();
			} else {
				lightboxEl.querySelector( '.sratix-exgrid-lightbox__prev' ).click();
			}
		} );
	}

	function renderLightboxSlide() {
		const img     = lightboxEl.querySelector( '.sratix-exgrid-lightbox__img' );
		const counter = lightboxEl.querySelector( '.sratix-exgrid-lightbox__counter' );
		const cur     = lightboxImages[ lightboxIndex ];
		img.src = cur.src;
		img.alt = cur.alt || '';
		if ( i18n.imageOf ) {
			counter.textContent = i18n.imageOf
				.replace( '%1$d', lightboxIndex + 1 )
				.replace( '%2$d', lightboxImages.length );
		}
		// Preload neighbours.
		const preloadIdxs = [
			( lightboxIndex + 1 ) % lightboxImages.length,
			( lightboxIndex - 1 + lightboxImages.length ) % lightboxImages.length,
		];
		preloadIdxs.forEach( i => {
			if ( lightboxImages[ i ] ) {
				const pre = new Image();
				pre.src = lightboxImages[ i ].src;
			}
		} );
	}

	function closeLightbox() {
		if ( lightboxEl ) lightboxEl.hidden = true;
	}

	// Phase C (placeholder — disabled in Phase A):
	// function startLiveStatusPolling( root ) {
	//   let visible = ! document.hidden;
	//   document.addEventListener( 'visibilitychange', () => { visible = ! document.hidden; } );
	//   setInterval( () => { if ( visible ) fetchLiveStatus( root ); }, 60000 );
	// }

} )();
