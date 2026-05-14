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

		register_setting( self::OPTION_GROUP, 'sratix_client_member_gate_enabled', array(
			'type'              => 'boolean',
			'sanitize_callback' => 'rest_sanitize_boolean',
			'default'           => false,
		) );

		register_setting( self::OPTION_GROUP, 'sratix_client_sra_logo_url', array(
			'type'              => 'string',
			'sanitize_callback' => 'esc_url_raw',
			'default'           => '',
		) );

		register_setting( self::OPTION_GROUP, 'sratix_client_robotx_logo_url', array(
			'type'              => 'string',
			'sanitize_callback' => 'esc_url_raw',
			'default'           => '',
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

		// Member gate section
		add_settings_section(
			'sratix_client_member_gate',
			__( 'Member Type Gate', 'sratix-client' ),
			function () {
				echo '<p>' . esc_html__( 'Show a member-type selection screen before ticket listing. Members can authenticate for discounted pricing.', 'sratix-client' ) . '</p>';
			},
			self::PAGE_SLUG
		);

		add_settings_field( 'sratix_client_member_gate_enabled', __( 'Enable Member Gate', 'sratix-client' ), function () {
			$val = get_option( 'sratix_client_member_gate_enabled', false );
			echo '<label><input type="checkbox" name="sratix_client_member_gate_enabled" value="1" ' . checked( $val, true, false ) . ' /> ';
			echo esc_html__( 'Show member-type selection before ticket purchase', 'sratix-client' ) . '</label>';
		}, self::PAGE_SLUG, 'sratix_client_member_gate' );

		add_settings_field( 'sratix_client_sra_logo_url', __( 'SRA Logo URL', 'sratix-client' ), function () {
			$val = get_option( 'sratix_client_sra_logo_url', '' );
			echo '<input type="url" name="sratix_client_sra_logo_url" value="' . esc_attr( $val ) . '" class="regular-text" />';
			echo '<p class="description">' . esc_html__( 'Optional. URL to SRA logo image for the member gate button.', 'sratix-client' ) . '</p>';
		}, self::PAGE_SLUG, 'sratix_client_member_gate' );

		add_settings_field( 'sratix_client_robotx_logo_url', __( 'RobotX Logo URL', 'sratix-client' ), function () {
			$val = get_option( 'sratix_client_robotx_logo_url', '' );
			echo '<input type="url" name="sratix_client_robotx_logo_url" value="' . esc_attr( $val ) . '" class="regular-text" />';
			echo '<p class="description">' . esc_html__( 'Optional. URL to RobotX logo image for the member gate button.', 'sratix-client' ) . '</p>';
		}, self::PAGE_SLUG, 'sratix_client_member_gate' );
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
					<tr><td><code>[sratix_register]</code></td><td><?php esc_html_e( 'Token-based registration — ticket recipients complete their details', 'sratix-client' ); ?></td></tr>
					<tr><td><code>[sratix_schedule]</code></td><td><?php esc_html_e( 'Event schedule / sessions grid', 'sratix-client' ); ?></td></tr>
					<tr><td><code>[sratix_exhibitor_portal]</code></td><td><?php esc_html_e( 'Exhibitor self-service portal — company profile, staff, media, analytics & logistics', 'sratix-client' ); ?></td></tr>
					<tr><td><code>[sratix_set_password]</code></td><td><?php esc_html_e( 'Password setup page for exhibitors — link from provisioning email', 'sratix-client' ); ?></td></tr>
				</tbody>
			</table>

			<h2 style="margin-top:30px"><?php esc_html_e( 'Exhibitor Sync', 'sratix-client' ); ?></h2>
			<p class="description" style="margin-bottom:12px">
				<?php esc_html_e( 'Pull all exhibitors for the configured event from SRAtix and create or update their WordPress posts for the exhibitor grid.', 'sratix-client' ); ?>
			</p>
			<p>
				<button type="button" id="sratix-client-sync-exhibitors" class="button button-primary">
					<?php esc_html_e( 'Sync Exhibitors to WordPress', 'sratix-client' ); ?>
				</button>
				<span id="sratix-client-sync-result" style="margin-left:10px;font-style:italic"></span>
			</p>
			<script>
			(function(){
				var btn    = document.getElementById('sratix-client-sync-exhibitors');
				var result = document.getElementById('sratix-client-sync-result');
				var nonce  = <?php echo wp_json_encode( wp_create_nonce( 'sratix_client_sync_exhibitors_nonce' ) ); ?>;

				btn.addEventListener('click', function(){
					btn.disabled    = true;
					btn.textContent = <?php echo wp_json_encode( __( 'Syncing…', 'sratix-client' ) ); ?>;
					result.textContent = '';

					var fd = new FormData();
					fd.append('action', 'sratix_client_sync_exhibitors');
					fd.append('nonce', nonce);

					fetch(ajaxurl, { method: 'POST', body: fd })
						.then(function(r){ return r.json(); })
						.then(function(res){
							btn.disabled    = false;
							btn.textContent = <?php echo wp_json_encode( __( 'Sync Exhibitors to WordPress', 'sratix-client' ) ); ?>;
							if (!res.success) {
								result.style.color = '#cc0000';
								result.textContent = res.data && res.data.message ? res.data.message : <?php echo wp_json_encode( __( 'Sync failed.', 'sratix-client' ) ); ?>;
							} else {
								result.style.color = '#007c00';
								result.textContent = res.data.synced + ' ' + <?php echo wp_json_encode( __( 'exhibitor(s) synced.', 'sratix-client' ) ); ?>
									+ (res.data.errors ? ' ' + res.data.errors + ' ' + <?php echo wp_json_encode( __( 'error(s).', 'sratix-client' ) ); ?> : '');
							}
						})
						.catch(function(){
							btn.disabled    = false;
							btn.textContent = <?php echo wp_json_encode( __( 'Sync Exhibitors to WordPress', 'sratix-client' ) ); ?>;
							result.style.color = '#cc0000';
							result.textContent = <?php echo wp_json_encode( __( 'Request failed.', 'sratix-client' ) ); ?>;
						});
				});
			})();
			</script>

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

	/**
	 * AJAX: bulk-sync exhibitors from SRAtix Server to WordPress.
	 * Authenticates via HMAC token exchange using sratix_client_api credentials,
	 * fetches the wp-payload endpoint, and upserts each exhibitor post.
	 */
	public function handle_sync_exhibitors() {
		check_ajax_referer( 'sratix_client_sync_exhibitors_nonce', 'nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => __( 'Unauthorized.', 'sratix-client' ) ), 403 );
		}

		$event_id = sanitize_text_field( get_option( 'sratix_client_event_id', '' ) );
		if ( empty( $event_id ) ) {
			wp_send_json_error( array( 'message' => __( 'No event ID configured. Set it in SRAtix Tickets settings.', 'sratix-client' ) ) );
		}

		$endpoint = 'admin/exhibitor-portal/events/' . rawurlencode( $event_id ) . '/exhibitors/wp-payload';
		$payloads = $this->authenticated_api_get( $endpoint );

		if ( is_wp_error( $payloads ) ) {
			wp_send_json_error( array( 'message' => $payloads->get_error_message() ) );
		}

		if ( ! is_array( $payloads ) ) {
			wp_send_json_error( array( 'message' => __( 'Unexpected response from SRAtix Server.', 'sratix-client' ) ) );
		}

		$webhook = new SRAtix_Client_Webhook();
		$synced  = 0;
		$errors  = 0;

		foreach ( $payloads as $data ) {
			$result = $webhook->upsert_exhibitor_from_data( (array) $data );
			if ( $result > 0 ) {
				$synced++;
			} else {
				$errors++;
			}
		}

		wp_send_json_success( array(
			'synced' => $synced,
			'errors' => $errors,
			'total'  => count( $payloads ),
		) );
	}

	/**
	 * Exchange the current admin user's WP credentials for a JWT and make
	 * an authenticated GET request to the SRAtix Server.
	 *
	 * @param string $endpoint  Relative endpoint path (no leading slash required).
	 * @return array|WP_Error
	 */
	private function authenticated_api_get( $endpoint ) {
		$api_url = rtrim( get_option( 'sratix_client_api_url', '' ), '/' );
		$secret  = get_option( 'sratix_client_api_secret', '' );

		if ( ! $api_url || ! $secret ) {
			return new \WP_Error( 'sratix_not_configured', __( 'SRAtix API URL or secret is not configured.', 'sratix-client' ) );
		}

		$user = wp_get_current_user();
		if ( ! $user || ! $user->ID ) {
			return new \WP_Error( 'sratix_no_user', __( 'No authenticated WordPress user.', 'sratix-client' ) );
		}

		// HMAC token exchange (mirrors sratix-control logic)
		$roles       = (array) $user->roles;
		sort( $roles );
		$source_site = wp_parse_url( home_url(), PHP_URL_HOST );
		$timestamp   = (string) time();
		$nonce       = wp_generate_password( 16, false );
		$payload     = $user->ID . ':' . implode( ',', $roles ) . ':' . $source_site . ':' . $timestamp . ':' . $nonce;
		$signature   = hash_hmac( 'sha256', $payload, $secret );

		$token_response = wp_remote_post( $api_url . '/auth/token', array(
			'timeout' => 10,
			'headers' => array( 'Content-Type' => 'application/json' ),
			'body'    => wp_json_encode( array(
				'wpUserId'   => $user->ID,
				'wpRoles'    => $roles,
				'signature'  => $signature,
				'sourceSite' => $source_site,
				'timestamp'  => $timestamp,
				'nonce'      => $nonce,
			) ),
		) );

		if ( is_wp_error( $token_response ) ) {
			return $token_response;
		}

		$token_code = wp_remote_retrieve_response_code( $token_response );
		$token_body = json_decode( wp_remote_retrieve_body( $token_response ), true );

		if ( $token_code !== 200 || empty( $token_body['accessToken'] ) ) {
			return new \WP_Error(
				'sratix_token_exchange_failed',
				$token_body['message'] ?? 'Token exchange failed',
				array( 'status' => $token_code )
			);
		}

		$access_token = $token_body['accessToken'];

		// Authenticated GET
		$response = wp_remote_get( $api_url . '/' . ltrim( $endpoint, '/' ), array(
			'timeout' => 20,
			'headers' => array(
				'Content-Type'  => 'application/json',
				'Authorization' => 'Bearer ' . $access_token,
			),
		) );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( $code >= 400 ) {
			return new \WP_Error(
				'sratix_api_error',
				$body['message'] ?? "HTTP {$code}",
				array( 'status' => $code )
			);
		}

		return $body;
	}
}
