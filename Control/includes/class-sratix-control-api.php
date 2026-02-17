<?php
/**
 * API client — communicates with SRAtix Server.
 * Handles HMAC-signed token exchange and authenticated requests.
 *
 * @package SRAtix_Control
 */
class SRAtix_Control_API {

	/** @var string|null Cached access token */
	private $access_token = null;

	/**
	 * Get the configured API base URL.
	 */
	private function api_url() {
		return rtrim( get_option( 'sratix_api_url', '' ), '/' );
	}

	/**
	 * Get the shared HMAC secret.
	 */
	private function api_secret() {
		return get_option( 'sratix_api_secret', '' );
	}

	/**
	 * Exchange WP credentials for a JWT token pair.
	 * Uses HMAC-SHA256 signature per PRODUCTION-ARCHITECTURE.md §7.
	 *
	 * @param int   $wp_user_id  WordPress user ID.
	 * @param array $wp_roles    User's WP roles.
	 * @return array|WP_Error    Token pair or error.
	 */
	public function exchange_token( $wp_user_id, array $wp_roles ) {
		$secret      = $this->api_secret();
		$source_site = wp_parse_url( home_url(), PHP_URL_HOST );

		// Sort roles for deterministic HMAC
		sort( $wp_roles );
		$payload   = $wp_user_id . ':' . implode( ',', $wp_roles ) . ':' . $source_site;
		$signature = hash_hmac( 'sha256', $payload, $secret );

		$response = wp_remote_post( $this->api_url() . '/auth/token', array(
			'timeout' => 10,
			'headers' => array( 'Content-Type' => 'application/json' ),
			'body'    => wp_json_encode( array(
				'wpUserId'   => $wp_user_id,
				'wpRoles'    => $wp_roles,
				'signature'  => $signature,
				'sourceSite' => $source_site,
			) ),
		) );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( $code !== 200 || empty( $body['accessToken'] ) ) {
			return new \WP_Error(
				'sratix_token_exchange_failed',
				$body['message'] ?? 'Token exchange failed',
				array( 'status' => $code )
			);
		}

		$this->access_token = $body['accessToken'];
		return $body;
	}

	/**
	 * Make an authenticated GET request to the SRAtix Server.
	 *
	 * @param string $endpoint  Relative endpoint (e.g. "/events").
	 * @return array|WP_Error
	 */
	public function get( $endpoint ) {
		return $this->request( 'GET', $endpoint );
	}

	/**
	 * Make an authenticated POST request to the SRAtix Server.
	 *
	 * @param string $endpoint  Relative endpoint.
	 * @param array  $data      Body payload.
	 * @return array|WP_Error
	 */
	public function post( $endpoint, array $data = array() ) {
		return $this->request( 'POST', $endpoint, $data );
	}

	/**
	 * Make an authenticated PATCH request to the SRAtix Server.
	 *
	 * @param string $endpoint  Relative endpoint.
	 * @param array  $data      Body payload.
	 * @return array|WP_Error
	 */
	public function patch( $endpoint, array $data = array() ) {
		return $this->request( 'PATCH', $endpoint, $data );
	}

	/**
	 * Ensure we have a valid access token for the current admin user.
	 *
	 * @return string|WP_Error
	 */
	private function ensure_token() {
		if ( $this->access_token ) {
			return $this->access_token;
		}

		$user = wp_get_current_user();
		if ( ! $user || ! $user->ID ) {
			return new \WP_Error( 'sratix_no_user', 'No authenticated WP user' );
		}

		$result = $this->exchange_token( $user->ID, (array) $user->roles );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return $this->access_token;
	}

	/**
	 * Internal HTTP request with JWT auth header.
	 */
	private function request( $method, $endpoint, array $data = null ) {
		$token = $this->ensure_token();
		if ( is_wp_error( $token ) ) {
			return $token;
		}

		$args = array(
			'method'  => $method,
			'timeout' => 15,
			'headers' => array(
				'Content-Type'  => 'application/json',
				'Authorization' => 'Bearer ' . $token,
			),
		);

		if ( $data !== null ) {
			$args['body'] = wp_json_encode( $data );
		}

		$response = wp_remote_request(
			$this->api_url() . '/' . ltrim( $endpoint, '/' ),
			$args
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code( $response );
		$body = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( $code >= 400 ) {
			return new \WP_Error(
				'sratix_api_error',
				$body['message'] ?? "HTTP {$code}",
				array( 'status' => $code, 'body' => $body )
			);
		}

		return $body;
	}
}
