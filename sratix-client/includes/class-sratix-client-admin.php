<?php
/**
 * Admin settings page — event selection & embed configuration.
 *
 * @package SRAtix_Client
 */
class SRAtix_Client_Admin {

	const OPTION_GROUP = 'sratix_client_settings';
	const PAGE_SLUG    = 'sratix-client';

	public function add_menu_page() {
		add_menu_page(
			__( 'SRAtix Tickets', 'sratix-client' ),
			__( 'SRAtix Tickets', 'sratix-client' ),
			'manage_options',
			self::PAGE_SLUG,
			array( $this, 'render_settings_page' ),
			'dashicons-tickets-alt',
			30
		);
	}

	public function register_settings() {
		register_setting( self::OPTION_GROUP, 'sratix_client_api_url', array(
			'type'              => 'string',
			'sanitize_callback' => 'esc_url_raw',
			'default'           => 'https://tix.swiss-robotics.org/api',
		) );

		register_setting( self::OPTION_GROUP, 'sratix_client_api_secret', array(
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
		) );

		register_setting( self::OPTION_GROUP, 'sratix_client_webhook_secret', array(
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
		) );

		register_setting( self::OPTION_GROUP, 'sratix_client_event_id', array(
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
		) );

		// Section
		add_settings_section(
			'sratix_client_connection',
			__( 'Server Connection', 'sratix-client' ),
			function () {
				echo '<p>' . esc_html__( 'Connect to the SRAtix ticketing server.', 'sratix-client' ) . '</p>';
			},
			self::PAGE_SLUG
		);

		add_settings_field( 'sratix_client_api_url', __( 'API URL', 'sratix-client' ), function () {
			$val = get_option( 'sratix_client_api_url', '' );
			echo '<input type="url" name="sratix_client_api_url" value="' . esc_attr( $val ) . '" class="regular-text" />';
		}, self::PAGE_SLUG, 'sratix_client_connection' );

		add_settings_field( 'sratix_client_api_secret', __( 'API Secret', 'sratix-client' ), function () {
			$val = get_option( 'sratix_client_api_secret', '' );
			echo '<input type="password" name="sratix_client_api_secret" value="' . esc_attr( $val ) . '" class="regular-text" />';
		}, self::PAGE_SLUG, 'sratix_client_connection' );

		add_settings_field( 'sratix_client_webhook_secret', __( 'Webhook Secret', 'sratix-client' ), function () {
			$val = get_option( 'sratix_client_webhook_secret', '' );
			echo '<input type="password" name="sratix_client_webhook_secret" value="' . esc_attr( $val ) . '" class="regular-text" />';
		}, self::PAGE_SLUG, 'sratix_client_connection' );

		// Event section
		add_settings_section(
			'sratix_client_event',
			__( 'Current Event', 'sratix-client' ),
			function () {
				echo '<p>' . esc_html__( 'Select which event this site is currently selling tickets for.', 'sratix-client' ) . '</p>';
			},
			self::PAGE_SLUG
		);

		add_settings_field( 'sratix_client_event_id', __( 'Event ID', 'sratix-client' ), function () {
			$val = get_option( 'sratix_client_event_id', '' );
			echo '<input type="text" name="sratix_client_event_id" value="' . esc_attr( $val ) . '" class="regular-text" />';
			echo '<p class="description">' . esc_html__( 'UUID of the event from the SRAtix Server.', 'sratix-client' ) . '</p>';
		}, self::PAGE_SLUG, 'sratix_client_event' );
	}

	public function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'SRAtix Tickets', 'sratix-client' ); ?></h1>

			<h2><?php esc_html_e( 'Shortcodes', 'sratix-client' ); ?></h2>
			<table class="widefat" style="max-width:700px;margin-bottom:20px">
				<thead><tr><th>Shortcode</th><th>Description</th></tr></thead>
				<tbody>
					<tr><td><code>[sratix_tickets]</code></td><td><?php esc_html_e( 'Ticket selection & registration form', 'sratix-client' ); ?></td></tr>
					<tr><td><code>[sratix_my_tickets]</code></td><td><?php esc_html_e( 'Attendee self-service — view purchased tickets', 'sratix-client' ); ?></td></tr>
					<tr><td><code>[sratix_schedule]</code></td><td><?php esc_html_e( 'Event schedule / sessions grid', 'sratix-client' ); ?></td></tr>
				</tbody>
			</table>

			<form method="post" action="options.php">
				<?php
				settings_fields( self::OPTION_GROUP );
				do_settings_sections( self::PAGE_SLUG );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}
}
