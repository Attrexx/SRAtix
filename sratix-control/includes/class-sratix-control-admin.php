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

		$access_token  = $result['accessToken'] ?? '';
		$refresh_token = $result['refreshToken'] ?? '';
		if ( ! $access_token ) {
			wp_die( __( 'No access token received from server.', 'sratix-control' ), 500 );
		}

		// Redirect to Dashboard with both tokens — Dashboard auto-detects and logs in
		$api_url       = get_option( 'sratix_api_url', '' );
		$dashboard_url = str_replace( '/api', '/login', $api_url );
		$redirect_url  = add_query_arg( array(
			'token'   => $access_token,
			'refresh' => $refresh_token,
		), $dashboard_url );

		wp_redirect( $redirect_url );
		exit;
	}

	/**
	 * AJAX: generate a shareable login URL with a refresh token (7-day expiry).
	 */
	public function handle_generate_token() {
		check_ajax_referer( 'sratix_generate_token' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'Unauthorized', 403 );
		}

		$api  = new SRAtix_Control_API();
		$user = wp_get_current_user();

		$result = $api->exchange_token( $user->ID, (array) $user->roles );
		if ( is_wp_error( $result ) ) {
			wp_send_json_error( $result->get_error_message() );
		}

		$access_token  = $result['accessToken'] ?? '';
		$refresh_token = $result['refreshToken'] ?? '';

		$api_url       = get_option( 'sratix_api_url', '' );
		$dashboard_url = str_replace( '/api', '/login', $api_url );
		$login_url     = add_query_arg( array(
			'token'   => $access_token,
			'refresh' => $refresh_token,
		), $dashboard_url );

		wp_send_json_success( array( 'loginUrl' => $login_url ) );
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

					<hr style="margin:16px 0">

					<h3 style="margin-top:0"><?php esc_html_e( 'Shareable Login Token', 'sratix-control' ); ?></h3>
					<p class="description" style="margin-bottom:8px">
						<?php esc_html_e( 'Generate a token you can give to someone without WordPress access so they can sign into the Dashboard.', 'sratix-control' ); ?>
					</p>
					<p>
						<button type="button" id="sratix-generate-token" class="button">
							<?php esc_html_e( 'Generate Token', 'sratix-control' ); ?>
						</button>
					</p>
					<div id="sratix-token-output" style="display:none;margin-top:12px">
						<label style="display:block;margin-bottom:4px;font-weight:600;font-size:13px">
							<?php esc_html_e( 'Dashboard URL (valid for 7 days):', 'sratix-control' ); ?>
						</label>
						<div style="display:flex;gap:6px">
							<input type="text" id="sratix-token-url" readonly class="regular-text" style="flex:1;font-family:monospace;font-size:12px" />
							<button type="button" id="sratix-copy-url" class="button"><?php esc_html_e( 'Copy URL', 'sratix-control' ); ?></button>
						</div>
						<p class="description" style="margin-top:6px">
							<?php esc_html_e( 'Send this URL to the person — they will be signed in automatically when they open it.', 'sratix-control' ); ?>
						</p>
					</div>

					<script>
					(function(){
						var btn = document.getElementById('sratix-generate-token');
						var output = document.getElementById('sratix-token-output');
						var urlInput = document.getElementById('sratix-token-url');
						var copyBtn = document.getElementById('sratix-copy-url');

						btn.addEventListener('click', function() {
							btn.disabled = true;
							btn.textContent = '<?php echo esc_js( __( 'Generating…', 'sratix-control' ) ); ?>';

							fetch(ajaxurl + '?action=sratix_generate_token&_wpnonce=<?php echo wp_create_nonce( 'sratix_generate_token' ); ?>')
								.then(function(r){ return r.json(); })
								.then(function(data) {
									if (data.success) {
										urlInput.value = data.data.loginUrl;
										output.style.display = 'block';
									} else {
										alert(data.data || 'Failed to generate token');
									}
									btn.disabled = false;
									btn.textContent = '<?php echo esc_js( __( 'Generate Token', 'sratix-control' ) ); ?>';
								})
								.catch(function() {
									alert('Request failed');
									btn.disabled = false;
									btn.textContent = '<?php echo esc_js( __( 'Generate Token', 'sratix-control' ) ); ?>';
								});
						});

						copyBtn.addEventListener('click', function() {
							urlInput.select();
							navigator.clipboard.writeText(urlInput.value).then(function() {
								copyBtn.textContent = '<?php echo esc_js( __( 'Copied!', 'sratix-control' ) ); ?>';
								setTimeout(function(){ copyBtn.textContent = '<?php echo esc_js( __( 'Copy URL', 'sratix-control' ) ); ?>'; }, 2000);
							});
						});
					})();
					</script>
				</div>
				<?php endif; ?>
			</div>
		</div>
		<?php
	}
}
