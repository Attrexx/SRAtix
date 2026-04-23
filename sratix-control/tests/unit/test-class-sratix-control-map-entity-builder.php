<?php
/**
 * Tests for SRAtix_Control_Map_Entity_Builder.
 */

use PHPUnit\Framework\TestCase;

class Test_SRAtix_Control_Map_Entity_Builder extends TestCase {

	public function test_should_create_map_listing_accepts_yes_like_values(): void {
		$this->assertTrue( SRAtix_Control_Map_Entity_Builder::should_create_map_listing( array( 'create_map_listing' => 'yes' ) ) );
		$this->assertTrue( SRAtix_Control_Map_Entity_Builder::should_create_map_listing( array( 'create_map_listing' => true ) ) );
		$this->assertFalse( SRAtix_Control_Map_Entity_Builder::should_create_map_listing( array( 'create_map_listing' => 'no' ) ) );
	}

	public function test_build_entity_payload_maps_live_registration_fields(): void {
		$attendee = array(
			'email'   => 'person@example.com',
			'phone'   => '+41 44 123 45 67',
			'company' => 'Robotics Labs AG',
		);

		$form_data = array(
			'create_map_listing'                             => 'yes',
			'org_type'                                       => 'startup',
			'organization_email'                             => 'hello@roboticslabs.ch',
			'organization_phone'                             => '+41 44 999 88 77',
			'organization_short_description'                 => 'Swiss robotics startup',
			'organization_address_swiss_hq_or_swiss_branch'  => 'Technoparkstrasse 1',
			'org_city'                                       => 'zurich',
			'org_canton'                                     => 'zh',
			'org_latitude'                                   => '47.3769',
			'org_longitude'                                  => '8.5417',
			'org_logo'                                       => 'https://example.com/logo.png',
			'org_profile_visibility'                         => 'draft',
		);

		$result = SRAtix_Control_Map_Entity_Builder::build_entity_payload( $attendee, $form_data, 17, 'startup' );

		$this->assertSame( 'Robotics Labs AG', $result['name'] );
		$this->assertSame( 'industry-sme', $result['entity_type'] );
		$this->assertSame( 'startup', $result['membership'] );
		$this->assertSame( 'hello@roboticslabs.ch', $result['email'] );
		$this->assertSame( '+41 44 999 88 77', $result['phone'] );
		$this->assertSame( 'Swiss robotics startup', $result['description'] );
		$this->assertSame( 'Technoparkstrasse 1', $result['address'] );
		$this->assertSame( 'zurich', $result['city'] );
		$this->assertSame( 'zh', $result['canton'] );
		$this->assertSame( 47.3769, $result['lat'] );
		$this->assertSame( 8.5417, $result['lng'] );
		$this->assertSame( 'draft', $result['post_status'] );
		$this->assertSame( 17, $result['author_id'] );
		$this->assertSame( 'https://example.com/logo.png', $result['image_url'] );
	}

	public function test_build_entity_payload_falls_back_to_attendee_contact_and_normalizes_lists(): void {
		$attendee = array(
			'email'   => 'attendee@example.com',
			'phone'   => '+41 21 000 00 00',
			'company' => 'EPFL Robotics',
		);

		$form_data = array(
			'create_map_listing'      => true,
			'org_type'                => 'Research / University',
			'org_robotics_fields'     => array( 'industrial_automation', 'robot_vision' ),
			'org_robotics_subfields'  => '["assembly_robotics","robot_vision"]',
			'org_profile_visibility'  => 'publish',
			'org_lat'                 => '46.5197',
			'org_lng'                 => '6.6323',
		);

		$result = SRAtix_Control_Map_Entity_Builder::build_entity_payload( $attendee, $form_data, 9, '' );

		$this->assertSame( 'EPFL Robotics', $result['name'] );
		$this->assertSame( 'attendee@example.com', $result['email'] );
		$this->assertSame( '+41 21 000 00 00', $result['phone'] );
		$this->assertSame( 'research', $result['entity_type'] );
		$this->assertSame( 'research', $result['membership'] );
		$this->assertSame( array( 'industrial_automation', 'robot_vision' ), $result['robotics_field'] );
		$this->assertSame( array( 'assembly_robotics', 'robot_vision' ), $result['robotics_subfield'] );
		$this->assertSame( 'publish', $result['post_status'] );
	}
}