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

		switch ( $event ) {
			case 'event.updated':
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
}
