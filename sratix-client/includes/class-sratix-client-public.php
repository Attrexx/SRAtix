<?php
/**
 * Public-facing functionality — shortcodes & asset loading.
 *
 * Embeds registration forms rendered by the SRAtix Server via JS widget
 * injection (similar to sra-member-badges embed pattern).
 *
 * @package SRAtix_Client
 */
class SRAtix_Client_Public {

	/**
	 * Register shortcodes.
	 */
	public function register_shortcodes() {
		add_shortcode( 'sratix_tickets',    array( $this, 'render_tickets' ) );
		add_shortcode( 'sratix_my_tickets', array( $this, 'render_my_tickets' ) );
		add_shortcode( 'sratix_schedule',   array( $this, 'render_schedule' ) );
		add_shortcode( 'sratix_register',   array( $this, 'render_register' ) );
		add_shortcode( 'sratix_exhibitor_portal', array( $this, 'render_exhibitor_portal' ) );
	}

	/**
	 * Enqueue frontend assets only on pages using our shortcodes.
	 */
	public function enqueue_assets() {
		global $post;
		if ( ! $post || ! is_a( $post, 'WP_Post' ) ) {
			return;
		}

		$has_shortcode = has_shortcode( $post->post_content, 'sratix_tickets' )
			|| has_shortcode( $post->post_content, 'sratix_my_tickets' )
			|| has_shortcode( $post->post_content, 'sratix_schedule' )
			|| has_shortcode( $post->post_content, 'sratix_register' )
			|| has_shortcode( $post->post_content, 'sratix_exhibitor_portal' );

		if ( ! $has_shortcode ) {
			return;
		}

		wp_enqueue_style(
			'sratix-client-public',
			SRATIX_CLIENT_URL . 'public/css/sratix-client.css',
			array(),
			SRATIX_CLIENT_VERSION
		);

		wp_enqueue_script(
			'sratix-client-i18n',
			SRATIX_CLIENT_URL . 'public/js/sratix-i18n.js',
			array(),
			SRATIX_CLIENT_VERSION,
			true
		);

		wp_enqueue_script(
			'sratix-client-embed',
			SRATIX_CLIENT_URL . 'public/js/sratix-embed.js',
			array( 'sratix-client-i18n' ),
			SRATIX_CLIENT_VERSION,
			true
		);

		// Pass config to JS
		$api_url  = get_option( 'sratix_client_api_url', '' );
		$event_id = get_option( 'sratix_client_event_id', '' );
		$config   = json_decode( get_option( 'sratix_client_embed_config', '{}' ), true );

		$localize_data = array(
			'apiUrl'           => esc_url( $api_url ),
			'eventId'          => sanitize_text_field( $event_id ),
			'theme'            => $config['theme'] ?? 'light',
			'primaryColor'     => $config['primaryColor'] ?? '#0073aa',
			'nonce'            => wp_create_nonce( 'sratix_client_nonce' ),
			'isLoggedIn'       => is_user_logged_in(),
			'locale'           => $this->detect_locale(),
			'memberGateEnabled' => (bool) get_option( 'sratix_client_member_gate_enabled', false ),
			'sraLogoUrl'       => esc_url( get_option( 'sratix_client_sra_logo_url', '' ) ),
			'robotxLogoUrl'    => esc_url( get_option( 'sratix_client_robotx_logo_url', '' ) ),
			'membershipPrices' => $this->get_membership_product_prices(),
			'logoutUrl'        => is_user_logged_in() ? wp_logout_url( home_url() ) : '',
		);

		// For logged-in users, provide identity + HMAC token so the JS widget
		// can call authenticated Server endpoints (My Tickets, prefill, etc.).
		if ( is_user_logged_in() ) {
			$user   = wp_get_current_user();
			$secret = get_option( 'sratix_client_api_secret', '' );
			$source = wp_parse_url( home_url(), PHP_URL_HOST );

			// Build HMAC payload identical to sratix-control: userId:roles:sourceSite
			$roles = (array) $user->roles;
			sort( $roles );
			$payload   = $user->ID . ':' . implode( ',', $roles ) . ':' . $source;
			$signature = $secret ? hash_hmac( 'sha256', $payload, $secret ) : '';

			$localize_data['user'] = array(
				'wpUserId'   => $user->ID,
				'email'      => $user->user_email,
				'firstName'  => $user->first_name,
				'lastName'   => $user->last_name,
				'roles'      => $roles,
				'signature'  => $signature,
				'sourceSite' => $source,
			);
		}

		wp_localize_script( 'sratix-client-embed', 'sratixConfig', $localize_data );
	}

	/*──────────────────────────────────────────────────────────
	 * Membership product prices (for hybrid ticket display)
	 *────────────────────────────────────────────────────────*/

	/**
	 * Get prices for SRA membership WooCommerce products.
	 *
	 * Returns productId → priceCents map for the 3 individual-type
	 * membership products used in hybrid ticket bundles.
	 *
	 * @return array<int, int>
	 */
	private function get_membership_product_prices() {
		$product_ids = array( 4601, 4603, 4605 ); // individual, student, retired
		$prices      = array();

		if ( ! function_exists( 'wc_get_product' ) ) {
			return $prices;
		}

		foreach ( $product_ids as $pid ) {
			$product = wc_get_product( $pid );
			if ( $product ) {
				$prices[ $pid ] = intval( round( floatval( $product->get_price() ) * 100 ) );
			}
		}

		return $prices;
	}

	/*──────────────────────────────────────────────────────────
	 * Shortcode renderers
	 *────────────────────────────────────────────────────────*/

	/**
	 * Check if maintenance mode is active (set by webhook).
	 * Falls back to a server check if the option has never been set.
	 *
	 * @return array{active: bool, message: string}
	 */
	private function get_maintenance_status() {
		$active  = get_option( 'sratix_client_maintenance_active', '' );
		$message = get_option( 'sratix_client_maintenance_message', '' );

		// If the option was never set, try a one-time server check.
		if ( '' === $active ) {
			$event_id = get_option( 'sratix_client_event_id', '' );
			$api_url  = get_option( 'sratix_client_api_url', '' );
			if ( $event_id && $api_url ) {
				$resp = wp_remote_get(
					trailingslashit( $api_url ) . 'events/' . urlencode( $event_id ) . '/maintenance-status',
					array( 'timeout' => 5 )
				);
				if ( ! is_wp_error( $resp ) && 200 === wp_remote_retrieve_response_code( $resp ) ) {
					$body = json_decode( wp_remote_retrieve_body( $resp ), true );
					if ( is_array( $body ) ) {
						$active  = ! empty( $body['active'] ) ? '1' : '0';
						$message = sanitize_text_field( $body['message'] ?? '' );
						update_option( 'sratix_client_maintenance_active', $active );
						update_option( 'sratix_client_maintenance_message', $message );
					}
				}
			}
		}

		return array(
			'active'  => '1' === $active,
			'message' => $message,
		);
	}

	/**
	 * Render the maintenance screen HTML.
	 *
	 * @param string $message Custom message from the admin.
	 * @return string
	 */
	private function render_maintenance_screen( $message ) {
		$default = __( 'We are performing scheduled maintenance. Please check back soon.', 'sratix-client' );
		$text    = $message ? $message : $default;

		return '<div class="sratix-page-wrap">'
			. '<div class="sratix-page-inner">'
			. '<div class="sratix-maintenance">'
			. '<div class="sratix-maintenance__icon">'
			. '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
			. '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'
			. '</svg>'
			. '</div>'
			. '<h2 class="sratix-maintenance__title">'
			. esc_html__( 'Under Maintenance', 'sratix-client' )
			. '</h2>'
			. '<p class="sratix-maintenance__text">'
			. esc_html( $text )
			. '</p>'
			. '</div>'
			. '</div>'
			. '</div>';
	}

	/**
	 * [sratix_tickets] — Ticket selection & registration form.
	 * The actual form is rendered by the Server and injected via JS.
	 */
	public function render_tickets( $atts ) {
		$maint = $this->get_maintenance_status();
		if ( $maint['active'] ) {
			return $this->render_maintenance_screen( $maint['message'] );
		}

		$atts = shortcode_atts( array(
			'event_id' => get_option( 'sratix_client_event_id', '' ),
			'layout'   => 'cards', // cards | list | compact
		), $atts, 'sratix_tickets' );

		if ( empty( $atts['event_id'] ) ) {
			return '<div class="sratix-page-wrap"><div class="sratix-page-inner">'
				. '<p class="sratix-error">' . esc_html__( 'No event configured. Please set the Event ID in SRAtix settings.', 'sratix-client' ) . '</p>'
				. '</div></div>';
		}

		return sprintf(
			'<div class="sratix-page-wrap"><div class="sratix-page-inner">'
			. '<div id="sratix-tickets-widget" data-event-id="%s" data-layout="%s"></div>'
			. '</div></div>',
			esc_attr( $atts['event_id'] ),
			esc_attr( $atts['layout'] )
		);
	}

	/**
	 * [sratix_my_tickets] — Attendee self-service portal.
	 *
	 * If SRD Auth is active, shows a branded login prompt with Sign In / Create Account
	 * links instead of a bare "please log in" message.
	 */
	public function render_my_tickets( $atts ) {
		$maint = $this->get_maintenance_status();
		if ( $maint['active'] ) {
			return $this->render_maintenance_screen( $maint['message'] );
		}

		if ( ! is_user_logged_in() ) {
			// Build a redirect URL back to this page after login.
			$current_url = ( is_ssl() ? 'https' : 'http' ) . '://' . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'];

			// If SRD Auth plugin is available, use its URLs.
			if ( class_exists( 'SRD_Auth' ) ) {
				$login_url    = SRD_Auth::login_url( $current_url );
				$register_url = SRD_Auth::register_url();
			} else {
				$login_url    = wp_login_url( $current_url );
				$register_url = wp_registration_url();
			}

			return '<div class="sratix-page-wrap"><div class="sratix-page-inner">'
				. '<div class="sratix-auth-prompt">'
				. '<p class="sratix-auth-prompt__text">'
				. esc_html__( 'Sign in to view and manage your tickets.', 'sratix-client' )
				. '</p>'
				. '<div class="sratix-auth-prompt__buttons">'
				. '<a href="' . esc_url( $login_url ) . '" class="sratix-btn sratix-btn--primary">'
				. esc_html__( 'Sign In', 'sratix-client' ) . '</a>'
				. '<a href="' . esc_url( $register_url ) . '" class="sratix-btn sratix-btn--outline">'
				. esc_html__( 'Create Account', 'sratix-client' ) . '</a>'
				. '</div>'
				. '</div>'
				. '</div></div>';
		}

		$user     = wp_get_current_user();
		$event_id = get_option( 'sratix_client_event_id', '' );

		return sprintf(
			'<div class="sratix-page-wrap"><div class="sratix-page-inner">'
			. '<div id="sratix-my-tickets-widget" data-event-id="%s" data-email="%s"></div>'
			. '</div></div>',
			esc_attr( $event_id ),
			esc_attr( $user->user_email )
		);
	}

	/**
	 * [sratix_schedule] — Event schedule / sessions grid.
	 */
	public function render_schedule( $atts ) {
		$maint = $this->get_maintenance_status();
		if ( $maint['active'] ) {
			return $this->render_maintenance_screen( $maint['message'] );
		}

		$atts = shortcode_atts( array(
			'event_id' => get_option( 'sratix_client_event_id', '' ),
		), $atts, 'sratix_schedule' );

		if ( empty( $atts['event_id'] ) ) {
			return '<div class="sratix-page-wrap"><div class="sratix-page-inner">'
				. '<p class="sratix-error">' . esc_html__( 'No event configured.', 'sratix-client' ) . '</p>'
				. '</div></div>';
		}

		return sprintf(
			'<div class="sratix-page-wrap"><div class="sratix-page-inner">'
			. '<div id="sratix-schedule-widget" data-event-id="%s"></div>'
			. '</div></div>',
			esc_attr( $atts['event_id'] )
		);
	}

	/**
	 * [sratix_register] — Token-based registration page for ticket recipients.
	 *
	 * Reads ?token= from the URL and renders a registration form via the
	 * SRAtix Server's public registration API. Works identically in test
	 * and live modes (no Stripe dependency).
	 */
	public function render_register( $atts ) {
		$api_url = get_option( 'sratix_client_api_url', '' );
		if ( empty( $api_url ) ) {
			return '<div class="sratix-page-wrap"><div class="sratix-page-inner">'
				. '<p class="sratix-error">' . esc_html__( 'SRAtix API not configured.', 'sratix-client' ) . '</p>'
				. '</div></div>';
		}

		return sprintf(
			'<div class="sratix-page-wrap"><div class="sratix-page-inner">'
			. '<div id="sratix-register-widget" data-api-url="%s"></div>'
			. '</div></div>',
			esc_attr( rtrim( $api_url, '/' ) )
		);
	}

	/**
	 * [sratix_exhibitor_portal] — Exhibitor self-service portal.
	 *
	 * Requires login. Provides company-profile editing and per-event
	 * exhibitor details (booth number, demo description, etc.).
	 */
	public function render_exhibitor_portal( $atts ) {
		$maint = $this->get_maintenance_status();
		if ( $maint['active'] ) {
			return $this->render_maintenance_screen( $maint['message'] );
		}

		if ( ! is_user_logged_in() ) {
			$current_url = ( is_ssl() ? 'https' : 'http' ) . '://' . sanitize_text_field( wp_unslash( $_SERVER['HTTP_HOST'] ?? '' ) ) . sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ?? '' ) );

			if ( class_exists( 'SRD_Auth' ) ) {
				$login_url    = SRD_Auth::login_url( $current_url );
				$register_url = SRD_Auth::register_url();
			} else {
				$login_url    = wp_login_url( $current_url );
				$register_url = wp_registration_url();
			}

			return '<div class="sratix-page-wrap"><div class="sratix-page-inner">'
				. '<div class="sratix-auth-prompt">'
				. '<p class="sratix-auth-prompt__text">'
				. esc_html__( 'Sign in to access the Exhibitor Portal.', 'sratix-client' )
				. '</p>'
				. '<div class="sratix-auth-prompt__buttons">'
				. '<a href="' . esc_url( $login_url ) . '" class="sratix-btn sratix-btn--primary">'
				. esc_html__( 'Sign In', 'sratix-client' ) . '</a>'
				. '<a href="' . esc_url( $register_url ) . '" class="sratix-btn sratix-btn--outline">'
				. esc_html__( 'Create Account', 'sratix-client' ) . '</a>'
				. '</div>'
				. '</div>'
				. '</div></div>';
		}

		$event_id = get_option( 'sratix_client_event_id', '' );

		return sprintf(
			'<div class="sratix-page-wrap"><div class="sratix-page-inner">'
			. '<div id="sratix-exhibitor-portal-widget" data-event-id="%s"></div>'
			. '</div></div>',
			esc_attr( $event_id )
		);
	}

	/*──────────────────────────────────────────────────────────
	 * Locale detection
	 *────────────────────────────────────────────────────────*/

	/**
	 * Detect the best locale for the widget.
	 *
	 * Priority: sratix_client_locale option → WP locale → 'en'.
	 * Maps WP locale codes (fr_FR, de_CH, it_IT, zh_TW) to SRAtix short codes.
	 *
	 * @return string One of: en, fr, de, it, zh-TW
	 */
	private function detect_locale() {
		// 1. Plugin-level override
		$override = get_option( 'sratix_client_locale', '' );
		if ( $override && in_array( $override, array( 'en', 'fr', 'de', 'it', 'zh-TW' ), true ) ) {
			return $override;
		}

		// 2. WP locale → SRAtix locale map
		$wp_locale = get_locale(); // e.g. 'fr_FR', 'de_CH', 'zh_TW'
		$map = array(
			'fr'    => 'fr', 'fr_FR' => 'fr', 'fr_CH' => 'fr', 'fr_BE' => 'fr', 'fr_CA' => 'fr',
			'de'    => 'de', 'de_DE' => 'de', 'de_CH' => 'de', 'de_AT' => 'de', 'de_DE_formal' => 'de', 'de_CH_informal' => 'de',
			'it'    => 'it', 'it_IT' => 'it', 'it_CH' => 'it',
			'zh_TW' => 'zh-TW', 'zh_Hant' => 'zh-TW',
		);

		if ( isset( $map[ $wp_locale ] ) ) {
			return $map[ $wp_locale ];
		}

		// 3. Try just the language prefix (e.g. 'fr' from 'fr_BE')
		$prefix = substr( $wp_locale, 0, 2 );
		if ( isset( $map[ $prefix ] ) ) {
			return $map[ $prefix ];
		}

		return 'en';
	}
}
