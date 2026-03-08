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
			$has_val = ! empty( $val );
			?>
			<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
				<input type="password" id="sratix-webhook-secret" name="sratix_webhook_secret"
				       value="<?php echo esc_attr( $val ); ?>" class="regular-text" />
				<button type="button" id="sratix-whs-toggle" class="button"><?php esc_html_e( 'Show', 'sratix-control' ); ?></button>
				<?php if ( $has_val ) : ?>
				<button type="button" id="sratix-whs-copy" class="button"><?php esc_html_e( 'Copy', 'sratix-control' ); ?></button>
				<?php endif; ?>
				<button type="button" id="sratix-whs-roll" class="button"><?php esc_html_e( 'Generate New', 'sratix-control' ); ?></button>
			</div>
			<p class="description">
				<?php esc_html_e( 'Secret for Server → WP HMAC verification. Must match WEBHOOK_SIGNING_SECRET on the SRAtix Server.', 'sratix-control' ); ?>
			</p>
			<script>
			(function(){
				var inp = document.getElementById('sratix-webhook-secret');
				var toggleBtn = document.getElementById('sratix-whs-toggle');
				var copyBtn = document.getElementById('sratix-whs-copy');
				var rollBtn = document.getElementById('sratix-whs-roll');

				toggleBtn.addEventListener('click', function(){
					var show = inp.type === 'password';
					inp.type = show ? 'text' : 'password';
					toggleBtn.textContent = show ? '<?php echo esc_js( __( 'Hide', 'sratix-control' ) ); ?>' : '<?php echo esc_js( __( 'Show', 'sratix-control' ) ); ?>';
				});

				if (copyBtn) {
					copyBtn.addEventListener('click', function(){
						navigator.clipboard.writeText(inp.value).then(function(){
							copyBtn.textContent = '<?php echo esc_js( __( 'Copied!', 'sratix-control' ) ); ?>';
							setTimeout(function(){ copyBtn.textContent = '<?php echo esc_js( __( 'Copy', 'sratix-control' ) ); ?>'; }, 2000);
						});
					});
				}

				rollBtn.addEventListener('click', function(){
					if (!confirm('<?php echo esc_js( __( 'Generate a new secret? You will need to update WEBHOOK_SIGNING_SECRET on the SRAtix Server .env and restart.', 'sratix-control' ) ); ?>')) return;
					var arr = new Uint8Array(32);
					crypto.getRandomValues(arr);
					var hex = Array.from(arr).map(function(b){ return b.toString(16).padStart(2,'0'); }).join('');
					inp.value = hex;
					inp.type = 'text';
					toggleBtn.textContent = '<?php echo esc_js( __( 'Hide', 'sratix-control' ) ); ?>';
				});
			})();
			</script>
			<?php
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
	 * AJAX: fetch events list from SRAtix Server.
	 */
	public function handle_fetch_events() {
		check_ajax_referer( 'sratix_maintenance_nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'Unauthorized', 403 );
		}

		$api    = new SRAtix_Control_API();
		$events = $api->get( '/events' );

		if ( is_wp_error( $events ) ) {
			wp_send_json_error( $events->get_error_message() );
		}

		// Also fetch maintenance status for each event (public endpoint, no auth needed)
		$api_url = get_option( 'sratix_api_url', '' );
		foreach ( $events as &$event ) {
			$status_url = rtrim( $api_url, '/' ) . '/events/' . $event['id'] . '/maintenance-status';
			$response   = wp_remote_get( $status_url, array( 'timeout' => 5 ) );
			if ( ! is_wp_error( $response ) && 200 === wp_remote_retrieve_response_code( $response ) ) {
				$event['maintenance'] = json_decode( wp_remote_retrieve_body( $response ), true );
			} else {
				$event['maintenance'] = array( 'active' => false, 'message' => '' );
			}
		}
		unset( $event );

		wp_send_json_success( $events );
	}

	/**
	 * AJAX: toggle maintenance mode on an event.
	 */
	public function handle_toggle_maintenance() {
		check_ajax_referer( 'sratix_maintenance_nonce' );

		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( 'Unauthorized', 403 );
		}

		$event_id = isset( $_POST['event_id'] ) ? sanitize_text_field( wp_unslash( $_POST['event_id'] ) ) : '';
		$active   = isset( $_POST['active'] ) && $_POST['active'] === '1';
		$message  = isset( $_POST['message'] ) ? sanitize_textarea_field( wp_unslash( $_POST['message'] ) ) : '';

		if ( ! $event_id || ! preg_match( '/^[0-9a-f\-]{36}$/i', $event_id ) ) {
			wp_send_json_error( 'Invalid event ID' );
		}

		$api    = new SRAtix_Control_API();
		$result = $api->patch( "/events/{$event_id}/maintenance", array(
			'active'  => $active,
			'message' => $message,
		) );

		if ( is_wp_error( $result ) ) {
			wp_send_json_error( $result->get_error_message() );
		}

		wp_send_json_success( $result );
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
				<?php // ── Maintenance Mode Panel ── ?>
				<h3 style="margin-top:0"><?php esc_html_e( 'Maintenance Mode', 'sratix-control' ); ?></h3>
				<p class="description" style="margin-bottom:12px">
					<?php esc_html_e( 'Enable maintenance mode to show a "temporarily unavailable" screen on event websites. The SRAtix Server and Dashboard remain accessible.', 'sratix-control' ); ?>
				</p>

				<div id="sratix-maintenance-panel">
					<p><button type="button" id="sratix-maint-load" class="button"><?php esc_html_e( 'Load Events', 'sratix-control' ); ?></button></p>
					<div id="sratix-maint-events" style="display:none"></div>
				</div>

				<script>
				(function(){
					var loadBtn = document.getElementById('sratix-maint-load');
					var container = document.getElementById('sratix-maint-events');
					var nonce = <?php echo wp_json_encode( wp_create_nonce( 'sratix_maintenance_nonce' ) ); ?>;

					loadBtn.addEventListener('click', function(){
						loadBtn.disabled = true;
						loadBtn.textContent = <?php echo wp_json_encode( __( 'Loading…', 'sratix-control' ) ); ?>;

						var fd = new FormData();
						fd.append('action', 'sratix_fetch_events');
						fd.append('_wpnonce', nonce);

						fetch(ajaxurl, { method: 'POST', body: fd })
							.then(function(r){ return r.json(); })
							.then(function(res){
								if (!res.success) {
									alert(res.data || 'Failed to load events');
									loadBtn.disabled = false;
									loadBtn.textContent = <?php echo wp_json_encode( __( 'Load Events', 'sratix-control' ) ); ?>;
									return;
								}
								loadBtn.style.display = 'none';
								renderEvents(res.data);
							})
							.catch(function(){
								alert('Request failed');
								loadBtn.disabled = false;
								loadBtn.textContent = <?php echo wp_json_encode( __( 'Load Events', 'sratix-control' ) ); ?>;
							});
					});

					function renderEvents(events) {
						if (!events.length) {
							container.innerHTML = '<p style="color:#666">' + <?php echo wp_json_encode( __( 'No events found.', 'sratix-control' ) ); ?> + '</p>';
							container.style.display = 'block';
							return;
						}

						var html = '';
						events.forEach(function(ev){
							var isActive = ev.maintenance && ev.maintenance.active;
							var msg = (ev.maintenance && ev.maintenance.message) || '';
							html += '<div class="sratix-maint-event" data-event-id="' + ev.id + '" style="border:1px solid ' + (isActive ? '#dc3232' : '#c3c4c7') + ';padding:14px;border-radius:6px;margin-bottom:12px;background:' + (isActive ? '#fff5f5' : '#fff') + '">';
							html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">';
							html += '<div><strong>' + escHtml(ev.name) + '</strong>';
							html += ' <span class="sratix-status sratix-status--' + (isActive ? 'error' : 'ok') + '" style="margin-left:8px">' + (isActive ? <?php echo wp_json_encode( __( 'Maintenance ON', 'sratix-control' ) ); ?> : <?php echo wp_json_encode( __( 'Live', 'sratix-control' ) ); ?>) + '</span>';
							html += '</div>';
							html += '<button type="button" class="button sratix-maint-toggle' + (isActive ? '' : ' button-primary') + '" data-event-id="' + ev.id + '" data-active="' + (isActive ? '0' : '1') + '">';
							html += isActive ? <?php echo wp_json_encode( __( 'Disable Maintenance', 'sratix-control' ) ); ?> : <?php echo wp_json_encode( __( 'Enable Maintenance', 'sratix-control' ) ); ?>;
							html += '</button>';
							html += '</div>';
							html += '<div class="sratix-maint-msg-row" style="margin-top:10px' + (isActive ? '' : ';display:none') + '">';
							html += '<label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px">' + <?php echo wp_json_encode( __( 'Message to visitors', 'sratix-control' ) ); ?> + '</label>';
							html += '<input type="text" class="regular-text sratix-maint-msg" value="' + escAttr(msg) + '" placeholder="' + <?php echo wp_json_encode( __( 'We are performing scheduled maintenance. Please check back soon.', 'sratix-control' ) ); ?> + '" style="width:100%" />';
							html += '</div>';
							html += '</div>';
						});
						container.innerHTML = html;
						container.style.display = 'block';

						// Bind toggle buttons
						container.querySelectorAll('.sratix-maint-toggle').forEach(function(btn){
							btn.addEventListener('click', function(){
								var eventId = this.dataset.eventId;
								var active  = this.dataset.active;
								var row     = this.closest('.sratix-maint-event');
								var msgInput = row.querySelector('.sratix-maint-msg');
								var message  = msgInput ? msgInput.value : '';

								if (active === '1' && !confirm(<?php echo wp_json_encode( __( 'Enable maintenance mode? Visitors will see a maintenance screen instead of ticket forms.', 'sratix-control' ) ); ?>)) return;

								this.disabled = true;
								this.textContent = <?php echo wp_json_encode( __( 'Saving…', 'sratix-control' ) ); ?>;

								var fd = new FormData();
								fd.append('action', 'sratix_toggle_maintenance');
								fd.append('_wpnonce', nonce);
								fd.append('event_id', eventId);
								fd.append('active', active);
								fd.append('message', message);

								var self = this;
								fetch(ajaxurl, { method: 'POST', body: fd })
									.then(function(r){ return r.json(); })
									.then(function(res){
										if (!res.success) {
											alert(res.data || 'Failed');
											self.disabled = false;
											return;
										}
										// Reload the events list for fresh state
										loadBtn.style.display = 'inline-block';
										loadBtn.disabled = false;
										loadBtn.textContent = <?php echo wp_json_encode( __( 'Load Events', 'sratix-control' ) ); ?>;
										loadBtn.click();
									})
									.catch(function(){
										alert('Request failed');
										self.disabled = false;
									});
							});
						});

						// Show/hide message field based on toggle direction
						container.querySelectorAll('.sratix-maint-toggle').forEach(function(btn){
							btn.addEventListener('mouseenter', function(){
								var row = this.closest('.sratix-maint-event').querySelector('.sratix-maint-msg-row');
								if (this.dataset.active === '1') row.style.display = 'block';
							});
						});
					}

					function escHtml(s) {
						var d = document.createElement('div');
						d.textContent = s;
						return d.innerHTML;
					}
					function escAttr(s) {
						return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
					}
				})();
				</script>

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
