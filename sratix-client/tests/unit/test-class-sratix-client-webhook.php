<?php
/**
 * Unit tests for SRAtix_Client_Webhook.
 *
 * Uses Brain Monkey to mock WordPress functions — no WordPress installation needed.
 * Focus: legal-document cache invalidation (event.updated / legal.updated) and
 * HMAC signature verification.
 *
 * @package SRAtix_Client
 */

use PHPUnit\Framework\TestCase;
use Brain\Monkey;
use Brain\Monkey\Functions;

if ( ! class_exists( 'WP_REST_Response' ) ) {
	/** Minimal WP_REST_Response stub capturing data + status. */
	class WP_REST_Response {
		/** @var mixed */
		public $data;
		/** @var int */
		public int $status;

		/**
		 * @param mixed $data   Response payload.
		 * @param int   $status HTTP status code.
		 */
		public function __construct( $data = null, int $status = 200 ) {
			$this->data   = $data;
			$this->status = $status;
		}
	}
}

/**
 * Fake REST request exposing only the accessors the webhook class uses.
 */
class Fake_Webhook_Request {
	/** @var array<string,mixed> */
	private array $json;
	/** @var string */
	private string $body;
	/** @var array<string,string> */
	private array $headers;

	/**
	 * @param array<string,mixed>  $json    JSON params.
	 * @param string               $body    Raw request body.
	 * @param array<string,string> $headers Request headers.
	 */
	public function __construct( array $json = array(), string $body = '', array $headers = array() ) {
		$this->json    = $json;
		$this->body    = $body;
		$this->headers = $headers;
	}

	/** @return array<string,mixed> */
	public function get_json_params(): array {
		return $this->json;
	}

	/** @return string */
	public function get_body(): string {
		return $this->body;
	}

	/**
	 * @param string $name Header name.
	 * @return string|null
	 */
	public function get_header( string $name ) {
		return $this->headers[ $name ] ?? null;
	}
}

/**
 * @covers SRAtix_Client_Webhook
 */
class Test_SRAtix_Client_Webhook extends TestCase {

	protected function setUp(): void {
		parent::setUp();
		Monkey\setUp();

		// Harmless defaults; individual tests override where behaviour matters.
		Functions\when( 'sanitize_text_field' )->returnArg();
		Functions\when( 'update_option' )->justReturn( true );
		Functions\when( 'get_option' )->justReturn( '' );
	}

	protected function tearDown(): void {
		Monkey\tearDown();
		parent::tearDown();
	}

	/**
	 * Capture every delete_transient() key into the given array.
	 *
	 * @param array<int,string> $sink Reference that collects cleared keys.
	 * @return void
	 */
	private function capture_cleared_transients( array &$sink ): void {
		Functions\when( 'delete_transient' )->alias(
			function ( string $key ) use ( &$sink ) {
				$sink[] = $key;
				return true;
			}
		);
	}

	// ── Legal cache invalidation ────────────────────────────────────────────

	public function test_legal_updated_webhook_clears_all_legal_transients(): void {
		$cleared = array();
		$this->capture_cleared_transients( $cleared );

		$event_id = '42';
		$request  = new Fake_Webhook_Request(
			array(
				'event' => 'event.updated',
				'data'  => array(
					'type'    => 'legal.updated',
					'eventId' => $event_id,
				),
			)
		);

		$response = ( new SRAtix_Client_Webhook() )->handle_webhook( $request );

		$expected = array(
			'sratix_legal_' . md5( $event_id . 'terms-conditions' ),
			'sratix_legal_' . md5( $event_id . 'privacy-policy' ),
			'sratix_legal_' . md5( $event_id . 'code-of-conduct' ),
			'sratix_legal_' . md5( $event_id . 'photography-consent' ),
		);

		foreach ( $expected as $key ) {
			$this->assertContains( $key, $cleared, "Expected legal transient {$key} to be cleared" );
		}
		$this->assertInstanceOf( 'WP_REST_Response', $response );
	}

	public function test_legal_cache_falls_back_to_configured_event_when_id_missing(): void {
		Functions\when( 'get_option' )->alias(
			function ( string $name, $default = '' ) {
				return 'sratix_client_event_id' === $name ? '99' : $default;
			}
		);

		$cleared = array();
		$this->capture_cleared_transients( $cleared );

		$request = new Fake_Webhook_Request(
			array(
				'event' => 'event.updated',
				'data'  => array( 'type' => 'legal.updated' ), // No eventId in payload.
			)
		);

		( new SRAtix_Client_Webhook() )->handle_webhook( $request );

		$this->assertContains( 'sratix_legal_' . md5( '99terms-conditions' ), $cleared );
	}

	public function test_non_legal_event_updated_does_not_clear_legal_transients(): void {
		$cleared = array();
		$this->capture_cleared_transients( $cleared );

		$request = new Fake_Webhook_Request(
			array(
				'event' => 'event.updated',
				'data'  => array(
					'type'        => 'maintenance.toggled',
					'maintenance' => array( 'active' => true, 'message' => '' ),
				),
			)
		);

		( new SRAtix_Client_Webhook() )->handle_webhook( $request );

		// Only the generic event-data transient is cleared — no legal documents.
		$this->assertSame( array( 'sratix_event_data' ), $cleared );
	}

	// ── HMAC signature verification ─────────────────────────────────────────

	public function test_verify_signature_accepts_matching_hmac(): void {
		Functions\when( 'get_option' )->justReturn( 'shhh-secret' );

		$body      = '{"event":"event.updated"}';
		$signature = hash_hmac( 'sha256', $body, 'shhh-secret' );
		$request   = new Fake_Webhook_Request( array(), $body, array( 'X-SRAtix-Signature' => $signature ) );

		$result = ( new SRAtix_Client_Webhook() )->verify_signature( $request );

		$this->assertTrue( $result );
	}

	public function test_verify_signature_rejects_bad_hmac(): void {
		Functions\when( 'get_option' )->justReturn( 'shhh-secret' );

		$request = new Fake_Webhook_Request( array(), '{"event":"x"}', array( 'X-SRAtix-Signature' => 'deadbeef' ) );

		$result = ( new SRAtix_Client_Webhook() )->verify_signature( $request );

		$this->assertInstanceOf( 'WP_Error', $result );
	}

	public function test_verify_signature_rejects_missing_signature(): void {
		Functions\when( 'get_option' )->justReturn( 'shhh-secret' );

		$request = new Fake_Webhook_Request( array(), '{}', array() ); // No signature header.

		$result = ( new SRAtix_Client_Webhook() )->verify_signature( $request );

		$this->assertInstanceOf( 'WP_Error', $result );
	}
}
