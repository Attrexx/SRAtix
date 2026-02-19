<?php
/**
 * Admin settings page — API credentials & dashboard link.
 *
 * @package SRAtix_Control
 */
class SRAtix_Control_Admin {

	const OPTION_GROUP = 'sratix_control_settings';
	const PAGE_SLUG    = 'sratix-control';

	/**
	 * Add admin menu page under "SRAtix".
	 */
	public function add_menu_page() {
		add_menu_page(
			__( 'SRAtix Control', 'sratix-control' ),
			__( 'SRAtix', 'sratix-control' ),
			'manage_options',
			self::PAGE_SLUG,
			array( $this, 'render_settings_page' ),
			'dashicons-tickets-alt',
			30
		);
	}

	/**
	 * Register settings fields.
	 */
	public function register_settings() {
		register_setting( self::OPTION_GROUP, 'sratix_api_url', array(
			'type'              => 'string',
			'sanitize_callback' => 'esc_url_raw',
			'default'           => 'https://tix.swiss-robotics.org/api',
		) );

		register_setting( self::OPTION_GROUP, 'sratix_api_secret', array(
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
			'default'           => '',
		) );

		register_setting( self::OPTION_GROUP, 'sratix_webhook_secret', array(
			'type'              => 'string',
			'sanitize_callback' => 'sanitize_text_field',
			'default'           => '',
		) );

		// Settings section
		add_settings_section(
			'sratix_api_section',
			__( 'Server Connection', 'sratix-control' ),
			function () {
				echo '<p>' . esc_html__( 'Configure the connection to the SRAtix ticketing server.', 'sratix-control' ) . '</p>';
			},
			self::PAGE_SLUG
		);

		add_settings_field( 'sratix_api_url', __( 'API URL', 'sratix-control' ), function () {
			$val = get_option( 'sratix_api_url', 'https://tix.swiss-robotics.org/api' );
			echo '<input type="url" name="sratix_api_url" value="' . esc_attr( $val ) . '" class="regular-text" />';
		}, self::PAGE_SLUG, 'sratix_api_section' );

		add_settings_field( 'sratix_api_secret', __( 'API Secret (HMAC)', 'sratix-control' ), function () {
			$val = get_option( 'sratix_api_secret', '' );
			echo '<input type="password" name="sratix_api_secret" value="' . esc_attr( $val ) . '" class="regular-text" />';
			echo '<p class="description">' . esc_html__( 'Shared secret for WP ↔ Server HMAC authentication. Must match WP_API_SECRET on the server.', 'sratix-control' ) . '</p>';
		}, self::PAGE_SLUG, 'sratix_api_section' );

		add_settings_field( 'sratix_webhook_secret', __( 'Webhook Secret', 'sratix-control' ), function () {
			$val = get_option( 'sratix_webhook_secret', '' );
			echo '<input type="password" name="sratix_webhook_secret" value="' . esc_attr( $val ) . '" class="regular-text" />';
			echo '<p class="description">' . esc_html__( 'Secret for verifying incoming webhooks from the Server.', 'sratix-control' ) . '</p>';
		}, self::PAGE_SLUG, 'sratix_api_section' );
	}

	/**
	 * Handle "Open SRAtix Dashboard" — exchange WP creds for JWT, redirect with token.
	 */
	public function handle_launch_dashboard() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( __( 'Unauthorized', 'sratix-control' ), 403 );
		}

		check_admin_referer( 'sratix_launch_dashboard' );

		$api = new SRAtix_Control_API();
		$user = wp_get_current_user();

		$result = $api->exchange_token( $user->ID, (array) $user->roles );

		if ( is_wp_error( $result ) ) {
			wp_die(
				sprintf(
					/* translators: %s: error message */
					__( 'Failed to authenticate with SRAtix Server: %s', 'sratix-control' ),
					$result->get_error_message()
				),
				__( 'Authentication Error', 'sratix-control' ),
				array( 'back_link' => true )
			);
		}

		$access_token = $result['accessToken'] ?? '';
		if ( ! $access_token ) {
			wp_die( __( 'No access token received from server.', 'sratix-control' ), 500 );
		}

		// Redirect to Dashboard with token — Dashboard auto-detects and logs in
		$api_url       = get_option( 'sratix_api_url', '' );
		$dashboard_url = str_replace( '/api', '/login', $api_url );
		$redirect_url  = add_query_arg( 'token', $access_token, $dashboard_url );

		wp_redirect( $redirect_url );
		exit;
	}

	/**
	 * Enqueue admin assets (only on our page).
	 */
	public function enqueue_assets( $hook ) {
		if ( strpos( $hook, self::PAGE_SLUG ) === false ) {
			return;
		}

		wp_enqueue_style(
			'sratix-control-admin',
			SRATIX_CONTROL_URL . 'admin/css/admin.css',
			array(),
			SRATIX_CONTROL_VERSION
		);
	}

	/**
	 * Render the settings page.
	 */
	public function render_settings_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$api_url        = get_option( 'sratix_api_url', '' );
		$connection_ok  = false;

		// Quick connectivity check
		if ( $api_url ) {
			$health_url = str_replace( '/api', '/health', $api_url );
			$response   = wp_remote_get( $health_url, array( 'timeout' => 5 ) );
			if ( ! is_wp_error( $response ) && wp_remote_retrieve_response_code( $response ) === 200 ) {
				$body = json_decode( wp_remote_retrieve_body( $response ), true );
				$connection_ok = ( $body['status'] ?? '' ) === 'ok';
			}
		}

		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'SRAtix Control', 'sratix-control' ); ?></h1>

			<?php if ( $api_url ) : ?>
				<div class="notice notice-<?php echo $connection_ok ? 'success' : 'error'; ?> inline" style="margin-bottom:20px">
					<p>
						<strong><?php esc_html_e( 'Server Status:', 'sratix-control' ); ?></strong>
						<?php echo $connection_ok
							? esc_html__( 'Connected', 'sratix-control' )
							: esc_html__( 'Unreachable — check API URL and server status.', 'sratix-control' ); ?>
					</p>
				</div>
			<?php endif; ?>

			<div style="display:flex;gap:30px;align-items:flex-start">
				<!-- Settings form -->
				<div style="flex:1">
					<form method="post" action="options.php">
						<?php
						settings_fields( self::OPTION_GROUP );
						do_settings_sections( self::PAGE_SLUG );
						submit_button();
						?>
					</form>
				</div>

				<!-- Dashboard link -->
				<?php if ( $connection_ok ) : ?>
				<div style="flex:1;background:#fff;border:1px solid #c3c4c7;padding:20px;border-radius:4px">
					<h2><?php esc_html_e( 'Quick Actions', 'sratix-control' ); ?></h2>
					<p>
						<?php
						$launch_url = admin_url( 'admin-post.php?action=sratix_launch_dashboard&_wpnonce=' . wp_create_nonce( 'sratix_launch_dashboard' ) );
						?>
						<a href="<?php echo esc_url( $launch_url ); ?>"
						   class="button button-primary" target="_blank" rel="noopener">
							<?php esc_html_e( 'Open SRAtix Dashboard →', 'sratix-control' ); ?>
						</a>
					</p>
					<p class="description">
						<?php esc_html_e( 'Exchanges your WordPress credentials and opens the dashboard with automatic sign-in.', 'sratix-control' ); ?>
					</p>
				</div>
				<?php endif; ?>
			</div>
		</div>
		<?php
	}
}
