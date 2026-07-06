<?php
/**
 * Tests for SRAtix_Control_Webhook::process_attendee_registration — the scope
 * guard that decides who gets an SRA account from an order.paid webhook.
 *
 * Only a non-opted-out visitor on a membership-bundling ticket should ever
 * reach WP-user creation. Opt-outs, exhibitors, non-membership tickets, and
 * tiers that don't map to a product must be skipped BEFORE `get_user_by()`.
 *
 * We invoke the private method via reflection and assert on whether the very
 * first post-guard WP call, `get_user_by()`, is reached.
 */

use Brain\Monkey;
use Brain\Monkey\Functions;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

class Test_SRAtix_Control_Webhook_Scope_Guard extends TestCase {

	use MockeryPHPUnitIntegration;

	protected function setUp(): void {
		parent::setUp();
		Monkey\setUp();
		// Sanitizers called before the guard — pass the value straight through.
		Functions\when( 'sanitize_email' )->returnArg();
		Functions\when( 'sanitize_text_field' )->returnArg();
	}

	protected function tearDown(): void {
		Monkey\tearDown();
		parent::tearDown();
	}

	/** Invoke the private process_attendee_registration with one attendee. */
	private function process( array $attendee ): void {
		$webhook = new SRAtix_Control_Webhook();
		$method  = new ReflectionMethod( SRAtix_Control_Webhook::class, 'process_attendee_registration' );
		$method->setAccessible( true );
		$method->invoke(
			$webhook,
			$attendee,
			'order-uuid-1',
			'SRD-2026-0001',
			array( 'id' => 'evt-1', 'name' => 'Swiss Robotics Day 2026' ),
			'CHF'
		);
	}

	/** A valid "joining SRA" attendee (Professional / Individual visitor ticket). */
	private function joiner( array $overrides = array() ): array {
		return array_merge(
			array(
				'email'            => 'joiner@example.com',
				'firstName'        => 'Joi',
				'lastName'         => 'Ner',
				'membershipOptOut' => false,
				'ticketType'       => array(
					'category'       => 'individual',
					'membershipTier' => 'professionals',
					'wpProductId'    => 4601,
					'name'           => 'Senior Academics and Professionals >35 y',
				),
				'formSubmission'   => array(),
			),
			$overrides
		);
	}

	public function test_opted_out_attendee_creates_no_account(): void {
		Functions\expect( 'get_user_by' )->never();

		$this->process( $this->joiner( array( 'membershipOptOut' => true ) ) );
	}

	public function test_exhibitor_attendee_creates_no_account(): void {
		Functions\expect( 'get_user_by' )->never();

		$attendee                         = $this->joiner();
		$attendee['ticketType']['category'] = 'exhibitor';

		$this->process( $attendee );
	}

	public function test_non_membership_ticket_creates_no_account(): void {
		Functions\expect( 'get_user_by' )->never();

		$attendee                               = $this->joiner();
		$attendee['ticketType']['membershipTier'] = '';

		$this->process( $attendee );
	}

	public function test_unmappable_tier_creates_no_account(): void {
		Functions\expect( 'get_user_by' )->never();

		$attendee                               = $this->joiner();
		$attendee['ticketType']['membershipTier'] = 'not_a_real_tier'; // maps to product 0

		$this->process( $attendee );
	}

	public function test_joining_visitor_reaches_user_lookup(): void {
		// The guard must let a real joiner through to WP-user creation. We throw
		// a sentinel from get_user_by so we can assert it was reached without
		// having to mock the whole user/role/WC-order cascade.
		Functions\expect( 'get_user_by' )
			->once()
			->andThrow( new RuntimeException( 'reached_user_lookup' ) );

		$this->expectException( RuntimeException::class );
		$this->expectExceptionMessage( 'reached_user_lookup' );

		$this->process( $this->joiner() );
	}
}
