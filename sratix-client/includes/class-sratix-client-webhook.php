<?php
/**
 * Webhook receiver — processes incoming webhooks from SRAtix Server.
 * Registered at /wp-json/sratix-client/v1/webhook.
 *
 * @package SRAtix_Client
 */
class SRAtix_Client_Webhook {

	const NAMESPACE = 'sratix-client/v1';
	const ROUTE     = '/webhook';

	public function register_routes() {
		register_rest_route( self::NAMESPACE, self::ROUTE, array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'handle_webhook' ),
			'permission_callback' => array( $this, 'verify_signature' ),
		) );
	}

	/**
	 * Verify HMAC signature.
	 */
	public function verify_signature( $request ) {
		$secret    = get_option( 'sratix_client_webhook_secret', '' );
		$signature = $request->get_header( 'X-SRAtix-Signature' );

		if ( ! $secret || ! $signature ) {
			return new \WP_Error( 'unauthorized', 'Missing signature', array( 'status' => 401 ) );
		}

		$expected = hash_hmac( 'sha256', $request->get_body(), $secret );
		if ( ! hash_equals( $expected, $signature ) ) {
			return new \WP_Error( 'forbidden', 'Invalid signature', array( 'status' => 403 ) );
		}

		return true;
	}

	/**
	 * Handle incoming webhook.
	 */
	public function handle_webhook( $request ) {
		$payload = $request->get_json_params();
		$event   = $payload['event'] ?? '';
		$data    = $payload['data'] ?? array();

		switch ( $event ) {
			case 'exhibitor.updated':
				$result = $this->upsert_exhibitor_from_data( $data );
				$post_id = is_int( $result ) && $result > 0 ? $result : 0;
				return new \WP_REST_Response( array(
					'received' => true,
					'synced'   => $post_id > 0,
					'wpPostId' => $post_id ?: null,
				), 200 );

			case 'event.updated':
				// Handle maintenance toggle sub-type.
				if ( isset( $data['type'] ) && 'maintenance.toggled' === $data['type'] && isset( $data['maintenance'] ) ) {
					$maint  = $data['maintenance'];
					$active = ! empty( $maint['active'] );
					update_option( 'sratix_client_maintenance_active', $active ? '1' : '0' );
					update_option( 'sratix_client_maintenance_message', sanitize_text_field( $maint['message'] ?? '' ) );
				}

				// Handle legal-document edits: purge the cached [sratix_legal]
				// shortcode output so the new text appears on the next page view.
				if ( isset( $data['type'] ) && 'legal.updated' === $data['type'] ) {
					$this->clear_legal_cache( $data['eventId'] ?? '' );
				}

				// Clear any cached event data
				delete_transient( 'sratix_event_data' );
				break;

			case 'tickets.sold_out':
				// Could display a notice on the site
				delete_transient( 'sratix_event_data' );
				break;

			default:
				break;
		}

		return new \WP_REST_Response( array( 'received' => true ), 200 );
	}

	/**
	 * Purge cached [sratix_legal] shortcode output for an event.
	 *
	 * The shortcode caches each rendered legal document in a transient keyed by
	 * md5( event_id . dash-slug ). Legal edits are infrequent, so we clear all
	 * four known documents for the event rather than rely on the exact edited
	 * slug — this sidesteps dash/underscore form mismatches between the API and
	 * the shortcode cache key.
	 *
	 * @param string $event_id SRAtix event ID from the webhook payload.
	 * @return void
	 */
	private function clear_legal_cache( $event_id ) {
		$event_id = sanitize_text_field( (string) $event_id );
		if ( '' === $event_id ) {
			// Fall back to the site's configured event when the payload omits it.
			$event_id = (string) get_option( 'sratix_client_event_id', '' );
		}
		if ( '' === $event_id ) {
			return;
		}

		$slugs = array(
			'terms-conditions',
			'privacy-policy',
			'code-of-conduct',
			'photography-consent',
		);
		foreach ( $slugs as $slug ) {
			delete_transient( 'sratix_legal_' . md5( $event_id . $slug ) );
		}
	}

	/**
	 * Create or update a single exhibitor WP post from webhook-format data.
	 * Called by the webhook receiver (live sync) and the admin bulk-sync action.
	 *
	 * @param array $data  Keys: eventExhibitorId, eventId, wpPostId, status,
	 *   profile { companyName, legalName, website, description, contactEmail,
	 *             contactPhone, socialLinks, logoUrl, mediaGallery, videoLinks },
	 *   event   { boothNumber, expoArea, exhibitorCategory, exhibitorType,
	 *             demoTitle, demoDescription, demoMediaGallery, demoVideoLinks }
	 * @return int|WP_Error  Post ID on success, WP_Error on failure, 0 if skipped.
	 */
	public function upsert_exhibitor_from_data( array $data ) {
		$profile = $data['profile'] ?? array();
		$event   = $data['event']   ?? array();

		$company_name = sanitize_text_field( $profile['companyName'] ?? '' );
		if ( empty( $company_name ) ) {
			return 0;
		}

		$wp_post_id         = ! empty( $data['wpPostId'] ) ? intval( $data['wpPostId'] ) : 0;
		$event_exhibitor_id = sanitize_text_field( $data['eventExhibitorId'] ?? '' );
		$sratix_event_id    = sanitize_text_field( $data['eventId'] ?? '' );
		$exhibitor_status   = sanitize_text_field( $data['status'] ?? 'draft' );
		$post_status        = ( $exhibitor_status === 'published' ) ? 'publish' : 'draft';

		$post_data = array(
			'post_type'    => 'exhibitor',
			'post_title'   => $company_name,
			'post_content' => wp_kses_post( $profile['description'] ?? '' ),
			'post_status'  => $post_status,
		);

		// Find existing post
		$existing_id = 0;
		if ( $wp_post_id && get_post_type( $wp_post_id ) === 'exhibitor' ) {
			$existing_id = $wp_post_id;
		}
		if ( ! $existing_id && $event_exhibitor_id ) {
			$found = get_posts( array(
				'post_type'      => 'exhibitor',
				'post_status'    => 'any',
				'meta_key'       => '_sratix_event_exhibitor_id',
				'meta_value'     => $event_exhibitor_id,
				'posts_per_page' => 1,
				'fields'         => 'ids',
			) );
			if ( ! empty( $found ) ) {
				$existing_id = $found[0];
			}
		}

		if ( $existing_id ) {
			$post_data['ID'] = $existing_id;
			wp_update_post( $post_data );
			$post_id = $existing_id;
		} else {
			$post_id = wp_insert_post( $post_data );
			if ( is_wp_error( $post_id ) ) {
				return $post_id;
			}
		}

		// ── Meta ──
		update_post_meta( $post_id, '_sratix_event_exhibitor_id', $event_exhibitor_id );
		update_post_meta( $post_id, '_sratix_event_id',           $sratix_event_id );
		update_post_meta( $post_id, '_sratix_synced_at',          current_time( 'mysql' ) );

		$meta_map = array(
			'legal_name'    => sanitize_text_field( $profile['legalName']     ?? '' ),
			'website'       => esc_url_raw(          $profile['website']       ?? '' ),
			'contact_email' => sanitize_email(       $profile['contactEmail']  ?? '' ),
			'contact_phone' => sanitize_text_field( $profile['contactPhone']  ?? '' ),
			'social_links'  => wp_json_encode(      $profile['socialLinks']   ?? array() ),
			'logo_url'      => esc_url_raw(          $profile['logoUrl']       ?? '' ),
			'booth_number'  => sanitize_text_field( $event['boothNumber']     ?? '' ),
			'expo_area'     => sanitize_text_field( $event['expoArea']        ?? '' ),
			'demo_title'    => sanitize_text_field( $event['demoTitle']       ?? '' ),
			'demo_description' => wp_kses_post(     $event['demoDescription'] ?? '' ),
		);

		if ( isset( $profile['mediaGallery'] ) )      { $meta_map['media_gallery']      = wp_json_encode( $profile['mediaGallery'] ); }
		if ( isset( $profile['videoLinks'] ) )         { $meta_map['video_links']         = wp_json_encode( $profile['videoLinks'] ); }
		if ( isset( $event['demoMediaGallery'] ) )     { $meta_map['demo_media_gallery']  = wp_json_encode( $event['demoMediaGallery'] ); }
		if ( isset( $event['demoVideoLinks'] ) )       { $meta_map['demo_video_links']    = wp_json_encode( $event['demoVideoLinks'] ); }

		foreach ( $meta_map as $key => $value ) {
			update_post_meta( $post_id, $key, $value );
		}

		// ── Taxonomies ──
		$category = sanitize_text_field( $event['exhibitorCategory'] ?? '' );
		if ( $category && taxonomy_exists( 'exhibitor-category' ) ) {
			wp_set_object_terms( $post_id, $category, 'exhibitor-category' );
		}
		$type = sanitize_text_field( $event['exhibitorType'] ?? '' );
		if ( $type && taxonomy_exists( 'exhibitor-type' ) ) {
			wp_set_object_terms( $post_id, $type, 'exhibitor-type' );
		}

		// ── Featured image ──
		$logo_url = $profile['logoUrl'] ?? '';
		if ( $logo_url && function_exists( 'media_sideload_image' ) && ! has_post_thumbnail( $post_id ) ) {
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';

			$tmp = download_url( $logo_url );
			if ( ! is_wp_error( $tmp ) ) {
				$file_array = array(
					'name'     => basename( wp_parse_url( $logo_url, PHP_URL_PATH ) ),
					'tmp_name' => $tmp,
				);
				$att_id = media_handle_sideload( $file_array, $post_id );
				if ( is_wp_error( $att_id ) ) {
					@unlink( $tmp ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
				} else {
					set_post_thumbnail( $post_id, $att_id );
				}
			}
		}

		return $post_id;
	}
}
