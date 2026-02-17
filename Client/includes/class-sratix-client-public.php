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
			|| has_shortcode( $post->post_content, 'sratix_schedule' );

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
			'sratix-client-embed',
			SRATIX_CLIENT_URL . 'public/js/sratix-embed.js',
			array(),
			SRATIX_CLIENT_VERSION,
			true
		);

		// Pass config to JS
		$api_url  = get_option( 'sratix_client_api_url', '' );
		$event_id = get_option( 'sratix_client_event_id', '' );
		$config   = json_decode( get_option( 'sratix_client_embed_config', '{}' ), true );

		wp_localize_script( 'sratix-client-embed', 'sratixConfig', array(
			'apiUrl'   => esc_url( $api_url ),
			'eventId'  => sanitize_text_field( $event_id ),
			'theme'    => $config['theme'] ?? 'light',
			'primaryColor' => $config['primaryColor'] ?? '#0073aa',
			'nonce'    => wp_create_nonce( 'sratix_client_nonce' ),
		) );
	}

	/*──────────────────────────────────────────────────────────
	 * Shortcode renderers
	 *────────────────────────────────────────────────────────*/

	/**
	 * [sratix_tickets] — Ticket selection & registration form.
	 * The actual form is rendered by the Server and injected via JS.
	 */
	public function render_tickets( $atts ) {
		$atts = shortcode_atts( array(
			'event_id' => get_option( 'sratix_client_event_id', '' ),
			'layout'   => 'cards', // cards | list | compact
		), $atts, 'sratix_tickets' );

		if ( empty( $atts['event_id'] ) ) {
			return '<p class="sratix-error">' . esc_html__( 'No event configured. Please set the Event ID in SRAtix settings.', 'sratix-client' ) . '</p>';
		}

		return sprintf(
			'<div id="sratix-tickets-widget" data-event-id="%s" data-layout="%s"></div>',
			esc_attr( $atts['event_id'] ),
			esc_attr( $atts['layout'] )
		);
	}

	/**
	 * [sratix_my_tickets] — Attendee self-service portal.
	 */
	public function render_my_tickets( $atts ) {
		if ( ! is_user_logged_in() ) {
			return '<p class="sratix-info">' . esc_html__( 'Please log in to view your tickets.', 'sratix-client' ) . '</p>';
		}

		$user     = wp_get_current_user();
		$event_id = get_option( 'sratix_client_event_id', '' );

		return sprintf(
			'<div id="sratix-my-tickets-widget" data-event-id="%s" data-email="%s"></div>',
			esc_attr( $event_id ),
			esc_attr( $user->user_email )
		);
	}

	/**
	 * [sratix_schedule] — Event schedule / sessions grid.
	 */
	public function render_schedule( $atts ) {
		$atts = shortcode_atts( array(
			'event_id' => get_option( 'sratix_client_event_id', '' ),
		), $atts, 'sratix_schedule' );

		if ( empty( $atts['event_id'] ) ) {
			return '<p class="sratix-error">' . esc_html__( 'No event configured.', 'sratix-client' ) . '</p>';
		}

		return sprintf(
			'<div id="sratix-schedule-widget" data-event-id="%s"></div>',
			esc_attr( $atts['event_id'] )
		);
	}
}
