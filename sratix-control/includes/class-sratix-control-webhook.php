<?php
/**
 * Webhook receiver — processes incoming webhooks from SRAtix Server.
 * Registered as a WP REST API route at /wp-json/sratix/v1/webhook.
 *
 * @package SRAtix_Control
 */
class SRAtix_Control_Webhook {

	const NAMESPACE  = 'sratix/v1';
	const ROUTE      = '/webhook';

	/**
	 * Register REST routes.
	 */
	public function register_routes() {
		register_rest_route( self::NAMESPACE, self::ROUTE, array(
			'methods'             => 'POST',
			'callback'            => array( $this, 'handle_webhook' ),
			'permission_callback' => array( $this, 'verify_signature' ),
		) );
	}

	/**
	 * Verify the HMAC signature on incoming webhooks.
	 *
	 * @param WP_REST_Request $request
	 * @return bool|WP_Error
	 */
	public function verify_signature( $request ) {
		$secret    = get_option( 'sratix_webhook_secret', '' );
		$signature = $request->get_header( 'X-SRAtix-Signature' );

		if ( ! $secret || ! $signature ) {
			return new \WP_Error(
				'sratix_webhook_unauthorized',
				'Missing webhook signature',
				array( 'status' => 401 )
			);
		}

		$body    = $request->get_body();
		$expected = hash_hmac( 'sha256', $body, $secret );

		if ( ! hash_equals( $expected, $signature ) ) {
			return new \WP_Error(
				'sratix_webhook_invalid_signature',
				'Invalid webhook signature',
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Handle an incoming webhook event.
	 *
	 * @param WP_REST_Request $request
	 * @return WP_REST_Response
	 */
	public function handle_webhook( $request ) {
		$payload = $request->get_json_params();
		$event   = $payload['event'] ?? '';

		switch ( $event ) {
			case 'registration.confirmed':
				$this->on_registration_confirmed( $payload );
				break;

			case 'attendee.updated':
				$this->on_attendee_updated( $payload );
				break;

			case 'order.paid':
				$this->on_order_paid( $payload );
				break;

			case 'entity.create_request':
				return $this->on_entity_create_request( $payload );

			default:
				// Unknown event — acknowledge but ignore
				break;
		}

		return new \WP_REST_Response( array( 'received' => true ), 200 );
	}

	/*──────────────────────────────────────────────────────────
	 * Event handlers
	 *────────────────────────────────────────────────────────*/

	/**
	 * registration.confirmed — Server confirms a new registration.
	 * Update WP user meta with ticket info.
	 */
	private function on_registration_confirmed( $payload ) {
		$wp_user_id   = $payload['data']['wpUserId'] ?? null;
		$ticket_type  = $payload['data']['ticketType'] ?? '';
		$order_number = $payload['data']['orderNumber'] ?? '';

		if ( ! $wp_user_id ) {
			return;
		}

		update_user_meta( $wp_user_id, 'sratix_ticket_type', $ticket_type );
		update_user_meta( $wp_user_id, 'sratix_order_number', $order_number );
		update_user_meta( $wp_user_id, 'sratix_registered_at', current_time( 'mysql', true ) );
	}

	/**
	 * attendee.updated — Server updated attendee data.
	 */
	private function on_attendee_updated( $payload ) {
		$wp_user_id = $payload['data']['wpUserId'] ?? null;
		if ( ! $wp_user_id ) {
			return;
		}

		$meta = $payload['data']['meta'] ?? array();
		foreach ( $meta as $key => $value ) {
			update_user_meta( $wp_user_id, 'sratix_' . sanitize_key( $key ), sanitize_text_field( $value ) );
		}
	}

	/**
	 * order.paid — Server confirms payment for an order.
	 */
	private function on_order_paid( $payload ) {
		$wp_user_id   = $payload['data']['wpUserId'] ?? null;
		$order_number = $payload['data']['orderNumber'] ?? '';

		if ( $wp_user_id ) {
			update_user_meta( $wp_user_id, 'sratix_payment_status', 'paid' );
			update_user_meta( $wp_user_id, 'sratix_paid_at', current_time( 'mysql', true ) );
		}
	}

	/**
	 * entity.create_request — Server requests creation of a WP entity
	 * (e.g. SRA MAP entity for an exhibitor that doesn't have one yet).
	 *
	 * Returns the new entity data so Server can store the mapping.
	 */
	private function on_entity_create_request( $payload ) {
		$entity_type = $payload['data']['entityType'] ?? '';
		$entity_data = $payload['data']['entityData'] ?? array();

		if ( $entity_type === 'sra_entity' && function_exists( 'sra_map_create_entity' ) ) {
			$post_id = sra_map_create_entity( $entity_data );
			if ( $post_id && ! is_wp_error( $post_id ) ) {
				// Store mapping
				SRAtix_Control_Sync::set_mapping(
					'sra_entity',
					$post_id,
					$payload['data']['sratixEntityType'] ?? 'organization',
					$payload['data']['sratixEntityId'] ?? ''
				);

				return new \WP_REST_Response( array(
					'received'   => true,
					'created'    => true,
					'wpEntityId' => $post_id,
				), 201 );
			}
		}

		return new \WP_REST_Response( array(
			'received' => true,
			'created'  => false,
			'reason'   => 'Entity type not supported or creation function unavailable',
		), 200 );
	}
}
