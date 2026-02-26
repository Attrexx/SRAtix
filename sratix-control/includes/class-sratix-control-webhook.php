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

			case 'entity.search':
				return $this->on_entity_search( $payload );

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
	 *
	 * This is the main Flow C orchestrator. The enriched payload includes
	 * full attendee data, ticket type metadata (category, membershipTier,
	 * wpProductId), pricing variants, form submission answers, and event info.
	 *
	 * Steps:
	 *  1. Extract attendee & ticket data from enriched payload
	 *  2. Find or create WP user by email
	 *  3. Assign WP role (candidate/employer) based on ticket category
	 *  4. Assign ProfileGrid group based on wpProductId
	 *  5. Create WC order with the correct membership product
	 *  6. Mark the WC order as SRAtix-originated (prevents sync loop)
	 *  7. Auto-complete the WC order (triggers SRA Company Profiles + role assigner)
	 *  8. Store SRAtix ↔ WP mappings
	 *  9. Update user meta with ticket info
	 *
	 * @param array $payload Enriched order.paid webhook payload.
	 */
	private function on_order_paid( $payload ) {
		$data = $payload['data'] ?? array();

		// ── 1. Extract data ───────────────────────────────────────
		$order_id_sratix  = $data['orderId'] ?? '';
		$order_number     = $data['orderNumber'] ?? '';
		$total_cents      = $data['totalCents'] ?? 0;
		$currency         = $data['currency'] ?? 'CHF';
		$paid_at          = $data['paidAt'] ?? current_time( 'mysql', true );

		$attendees     = $data['attendees'] ?? array();
		$event         = $data['event'] ?? array();

		if ( empty( $attendees ) ) {
			error_log( 'SRAtix Control [order.paid]: No attendees in payload for order ' . $order_number );
			return;
		}

		// Process each attendee in the order
		foreach ( $attendees as $attendee ) {
			$this->process_attendee_registration( $attendee, $order_id_sratix, $order_number, $event, $currency );
		}
	}

	/**
	 * Process a single attendee from an order.paid webhook.
	 *
	 * @param array  $attendee       Attendee data from enriched payload.
	 * @param string $order_id       SRAtix order UUID.
	 * @param string $order_number   Human-readable order number.
	 * @param array  $event          Event metadata.
	 * @param string $currency       Currency code.
	 */
	private function process_attendee_registration( $attendee, $order_id, $order_number, $event, $currency ) {
		$email       = sanitize_email( $attendee['email'] ?? '' );
		$first_name  = sanitize_text_field( $attendee['firstName'] ?? '' );
		$last_name   = sanitize_text_field( $attendee['lastName'] ?? '' );
		$ticket_type = $attendee['ticketType'] ?? array();
		$form_data   = $attendee['formSubmission'] ?? array();

		if ( empty( $email ) ) {
			error_log( 'SRAtix Control [order.paid]: Attendee has no email, skipping.' );
			return;
		}

		$category       = $ticket_type['category'] ?? 'general';      // general|individual|legal
		$membership_tier = $ticket_type['membershipTier'] ?? '';       // e.g. 'student', 'industry_large'
		$wp_product_id  = intval( $ticket_type['wpProductId'] ?? 0 ); // e.g. 4603
		$ticket_name    = $ticket_type['name'] ?? '';

		// ── 2. Find or create WP user ─────────────────────────────
		$wp_user = get_user_by( 'email', $email );
		$is_new_user = false;

		if ( ! $wp_user ) {
			$user_id = $this->create_wp_user( $email, $first_name, $last_name, $form_data );
			if ( is_wp_error( $user_id ) ) {
				error_log( 'SRAtix Control [order.paid]: Failed to create user for ' . $email . ': ' . $user_id->get_error_message() );
				return;
			}
			$wp_user = get_userdata( $user_id );
			$is_new_user = true;
		} else {
			$user_id = $wp_user->ID;
			// Update name if it was empty
			if ( empty( $wp_user->first_name ) && ! empty( $first_name ) ) {
				update_user_meta( $user_id, 'first_name', $first_name );
			}
			if ( empty( $wp_user->last_name ) && ! empty( $last_name ) ) {
				update_user_meta( $user_id, 'last_name', $last_name );
			}
		}

		// ── 3. Assign WP role ─────────────────────────────────────
		if ( $category !== 'general' && $wp_product_id ) {
			$role = $this->get_wp_role_for_product( $wp_product_id );
			if ( $role && ! in_array( $role, (array) $wp_user->roles, true ) ) {
				$wp_user->set_role( $role );
				error_log( "SRAtix Control [order.paid]: Set user {$user_id} role to {$role}" );
			}
		}

		// ── 4. Assign ProfileGrid group ───────────────────────────
		if ( $wp_product_id ) {
			$this->assign_profilegrid_group( $user_id, $wp_product_id );
		}

		// ── 5-7. Create & complete WC order ───────────────────────
		$wc_order_id = null;
		if ( $wp_product_id && $category !== 'general' ) {
			$wc_order_id = $this->create_membership_order( $user_id, $wp_product_id, $order_id, $order_number, $currency );
		}

		// ── 8. Store mappings ─────────────────────────────────────
		SRAtix_Control_Sync::set_mapping(
			'user',
			$user_id,
			'attendee',
			$attendee['id'] ?? ''
		);

		update_user_meta( $user_id, 'sratix_actor_id', $attendee['actorId'] ?? '' );

		// ── 9. Store ticket meta ──────────────────────────────────
		update_user_meta( $user_id, 'sratix_ticket_type', $ticket_name );
		update_user_meta( $user_id, 'sratix_ticket_category', $category );
		update_user_meta( $user_id, 'sratix_membership_tier', $membership_tier );
		update_user_meta( $user_id, 'sratix_order_number', $order_number );
		update_user_meta( $user_id, 'sratix_order_id', $order_id );
		update_user_meta( $user_id, 'sratix_payment_status', 'paid' );
		update_user_meta( $user_id, 'sratix_paid_at', $paid_at ?? current_time( 'mysql', true ) );
		update_user_meta( $user_id, 'sratix_event_id', $event['id'] ?? '' );
		update_user_meta( $user_id, 'sratix_event_name', $event['name'] ?? '' );

		if ( $wc_order_id ) {
			update_user_meta( $user_id, 'sratix_wc_order_id', $wc_order_id );
		}

		// Store additional form data as user meta
		$this->store_form_data( $user_id, $form_data );

		error_log( sprintf(
			'SRAtix Control [order.paid]: Processed attendee %s (WP user %d, %s, WC order %s)',
			$email,
			$user_id,
			$is_new_user ? 'NEW' : 'existing',
			$wc_order_id ?: 'none'
		) );
	}

	/*──────────────────────────────────────────────────────────
	 * Helper methods for order.paid processing
	 *────────────────────────────────────────────────────────*/

	/**
	 * Create a new WordPress user from SRAtix attendee data.
	 *
	 * @param string $email      User email.
	 * @param string $first_name First name.
	 * @param string $last_name  Last name.
	 * @param array  $form_data  Form submission data (may contain company, phone, etc.).
	 * @return int|WP_Error      User ID or error.
	 */
	private function create_wp_user( $email, $first_name, $last_name, $form_data ) {
		$username = sanitize_user( strstr( $email, '@', true ), true );

		// Ensure unique username
		if ( username_exists( $username ) ) {
			$username = $username . '_' . wp_rand( 100, 999 );
		}
		if ( username_exists( $username ) ) {
			$username = 'sratix_' . wp_rand( 10000, 99999 );
		}

		$password = wp_generate_password( 16, true, true );

		$user_id = wp_insert_user( array(
			'user_login'   => $username,
			'user_email'   => $email,
			'user_pass'    => $password,
			'first_name'   => $first_name,
			'last_name'    => $last_name,
			'display_name' => trim( $first_name . ' ' . $last_name ) ?: $username,
			'role'         => 'subscriber', // Will be upgraded by role assignment step
		) );

		if ( is_wp_error( $user_id ) ) {
			return $user_id;
		}

		// Store company name from form data if available
		$company = $form_data['company_name'] ?? $form_data['institution_company'] ?? '';
		if ( ! empty( $company ) ) {
			update_user_meta( $user_id, 'pm_field_institution_company', sanitize_text_field( $company ) );
		}

		// Mark as SRAtix-created
		update_user_meta( $user_id, '_sratix_created', true );
		update_user_meta( $user_id, '_sratix_created_at', current_time( 'mysql', true ) );

		// Send WP new-user notification so they can set their password
		wp_new_user_notification( $user_id, null, 'user' );

		error_log( "SRAtix Control: Created WP user {$user_id} ({$email})" );

		return $user_id;
	}

	/**
	 * Get the WP role for a given WC product ID.
	 *
	 * Individual tiers → 'candidate', Legal entity tiers → 'employer'.
	 *
	 * @param int $product_id WC product ID.
	 * @return string|null     WP role slug or null.
	 */
	private function get_wp_role_for_product( $product_id ) {
		// Individual membership products → candidate role
		$candidate_products = array( 4601, 4603, 4605, 5335 );
		// Legal entity membership products → employer role
		$employer_products  = array( 4591, 4593, 4595, 4597, 4599 );

		if ( in_array( $product_id, $candidate_products, true ) ) {
			return 'candidate';
		}
		if ( in_array( $product_id, $employer_products, true ) ) {
			return 'employer';
		}

		return null;
	}

	/**
	 * Assign the user to the correct ProfileGrid group based on product ID.
	 *
	 * Uses the same mapping as sra-wprole-assigner.php:
	 *   Group 18 → Academic (4597), 17 → Startup (4599), 16 → Lg (4595),
	 *   15 → Med (4593), 14 → Sm (4591), 13 → Student (4603),
	 *   12 → Retired (4605), 11 → Individual (4601), 19 → Others (5335).
	 *
	 * @param int $user_id    WP user ID.
	 * @param int $product_id WC product ID.
	 */
	private function assign_profilegrid_group( $user_id, $product_id ) {
		// Product ID → ProfileGrid Group ID
		$product_to_group = array(
			4597 => 18, // Academic
			4599 => 17, // Startup
			4595 => 16, // Industry Large
			4593 => 15, // Industry Medium
			4591 => 14, // Industry Small
			5335 => 19, // Others
			4603 => 13, // Student
			4605 => 12, // Retired
			4601 => 11, // Individual
		);

		if ( ! isset( $product_to_group[ $product_id ] ) ) {
			return;
		}

		$group_id = $product_to_group[ $product_id ];

		// Use ProfileGrid's native function if available
		if ( function_exists( 'pm_add_user_to_group' ) ) {
			// Check if already in group
			$current_groups = get_user_meta( $user_id, 'pm_group', true );
			if ( is_array( $current_groups ) && in_array( $group_id, $current_groups ) ) {
				return; // Already assigned
			}

			pm_add_user_to_group( $user_id, $group_id );
			error_log( "SRAtix Control: Assigned user {$user_id} to ProfileGrid group {$group_id}" );
		} else {
			// Fallback: set group via user meta
			$current_groups = get_user_meta( $user_id, 'pm_group', true );
			if ( empty( $current_groups ) || ! is_array( $current_groups ) ) {
				$current_groups = array();
			}
			if ( ! in_array( $group_id, $current_groups ) ) {
				$current_groups[] = $group_id;
				update_user_meta( $user_id, 'pm_group', $current_groups );
			}
			update_user_meta( $user_id, 'gid', $group_id );
			error_log( "SRAtix Control: Assigned user {$user_id} to ProfileGrid group {$group_id} (meta fallback)" );
		}
	}

	/**
	 * Create a WooCommerce order for the membership product.
	 *
	 * The order is auto-completed, which triggers downstream hooks:
	 *  - sra-wprole-assigner assigns WP role + ProfileGrid group (duplicate-safe)
	 *  - SRA Company Profiles creates corporate-member CPT for legal entities
	 *  - Membership emails are sent
	 *
	 * The order is tagged with `_sratix_order_id` meta so the sync handler
	 * (on_order_complete) knows NOT to re-notify SRAtix Server.
	 *
	 * @param int    $user_id       WP user ID.
	 * @param int    $product_id    WC product ID.
	 * @param string $sratix_order  SRAtix order UUID.
	 * @param string $order_number  SRAtix order number.
	 * @param string $currency      Currency code.
	 * @return int|null             WC order ID or null on failure.
	 */
	private function create_membership_order( $user_id, $product_id, $sratix_order, $order_number, $currency ) {
		if ( ! function_exists( 'wc_create_order' ) ) {
			error_log( 'SRAtix Control: WooCommerce not available, cannot create order.' );
			return null;
		}

		// Check if we already created a WC order for this SRAtix order + user combo
		$existing = $this->find_existing_wc_order( $sratix_order, $user_id );
		if ( $existing ) {
			error_log( "SRAtix Control: WC order {$existing} already exists for SRAtix order {$sratix_order}, user {$user_id}" );
			return $existing;
		}

		$product = wc_get_product( $product_id );
		if ( ! $product ) {
			error_log( "SRAtix Control: WC product {$product_id} not found." );
			return null;
		}

		try {
			$order = wc_create_order( array(
				'customer_id' => $user_id,
				'status'      => 'pending',
			) );

			if ( is_wp_error( $order ) ) {
				error_log( 'SRAtix Control: wc_create_order failed: ' . $order->get_error_message() );
				return null;
			}

			// Add the membership product
			$order->add_product( $product, 1 );

			// Set billing details from WP user
			$user = get_userdata( $user_id );
			$order->set_billing_first_name( $user->first_name );
			$order->set_billing_last_name( $user->last_name );
			$order->set_billing_email( $user->user_email );

			$company = get_user_meta( $user_id, 'pm_field_institution_company', true );
			if ( $company ) {
				$order->set_billing_company( $company );
			}

			$order->set_currency( $currency ?: 'CHF' );
			$order->set_payment_method( 'cod' ); // "Cash on Delivery" = manual/external payment
			$order->set_payment_method_title( 'SRAtix (Stripe)' );

			// Tag as SRAtix-originated to prevent sync loops
			$order->update_meta_data( '_sratix_order_id', $sratix_order );
			$order->update_meta_data( '_sratix_order_number', $order_number );
			$order->update_meta_data( '_sratix_created', true );

			$order->add_order_note( sprintf(
				/* translators: 1: SRAtix order number, 2: event name */
				__( 'Auto-created by SRAtix for order %1$s. Payment collected via Stripe on SRAtix.', 'sratix-control' ),
				$order_number
			) );

			$order->calculate_totals();
			$order->save();

			// Auto-complete → triggers woocommerce_order_status_completed hooks
			// This fires: sra-wprole-assigner, SRA Company Profiles, etc.
			$order->update_status( 'completed', __( 'Auto-completed by SRAtix Control.', 'sratix-control' ) );

			error_log( "SRAtix Control: Created and completed WC order {$order->get_id()} for user {$user_id}, product {$product_id}" );

			return $order->get_id();

		} catch ( \Exception $e ) {
			error_log( 'SRAtix Control: Exception creating WC order: ' . $e->getMessage() );
			return null;
		}
	}

	/**
	 * Check if a WC order already exists for a SRAtix order + user combo.
	 *
	 * @param string $sratix_order_id SRAtix order UUID.
	 * @param int    $user_id         WP user ID.
	 * @return int|null               Existing WC order ID or null.
	 */
	private function find_existing_wc_order( $sratix_order_id, $user_id ) {
		if ( ! function_exists( 'wc_get_orders' ) ) {
			return null;
		}

		$orders = wc_get_orders( array(
			'customer_id' => $user_id,
			'meta_key'    => '_sratix_order_id',
			'meta_value'  => $sratix_order_id,
			'limit'       => 1,
			'return'      => 'ids',
		) );

		return ! empty( $orders ) ? $orders[0] : null;
	}

	/**
	 * Store form submission data as WP user meta.
	 *
	 * Maps known SRAtix field slugs to WordPress / ProfileGrid meta keys.
	 *
	 * @param int   $user_id   WP user ID.
	 * @param array $form_data Form submission answers (slug => value).
	 */
	private function store_form_data( $user_id, $form_data ) {
		if ( empty( $form_data ) || ! is_array( $form_data ) ) {
			return;
		}

		// Known field mappings: SRAtix slug → WP user meta key
		$field_map = array(
			// ── Personal & Professional ──────────────────────────
			'company_name'         => 'pm_field_institution_company',
			'institution_company'  => 'pm_field_institution_company',
			'job_title'            => 'pm_field_job_title',
			'phone'                => 'pm_field_phone',
			'website'              => 'pm_field_website',
			'company_website'      => 'pm_field_website',
			'country'              => 'pm_field_country',
			'city'                 => 'pm_field_city',
			'swiss_canton'         => 'pm_field_canton',
			'state_canton'         => 'pm_field_canton',
			'personal_linkedin'    => 'pm_field_linkedin_url',
			'department'           => 'pm_field_department',
			'industry_sector'      => 'pm_field_industry_sector',
			'company_size'         => 'pm_field_company_size',

			// ── Academic ─────────────────────────────────────────
			'institution_name'      => 'pm_field_institution_company',
			'institution_department' => 'pm_field_department',
			'academic_role'         => 'pm_field_academic_role',
			'research_areas'        => 'pm_field_research_areas',

			// ── Student ──────────────────────────────────────────
			'student_institution'   => 'pm_field_institution_company',
			'student_level'         => 'pm_field_student_level',
			'student_field_of_study' => 'pm_field_field_of_study',
			'student_graduation_year' => 'pm_field_graduation_year',
			'student_in_progress'   => 'pm_field_diploma_in_progress',
			'student_supervisor'    => 'pm_field_supervisor',
			'student_seeking'       => 'pm_field_student_seeking',

			// ── Resume / SRA Profile ─────────────────────────────
			'professional_title'    => '_candidate_title',
			'short_bio_resume'      => '_candidate_about',
			'work_permit'           => '_candidate_work_permit',
			'expertise_area'        => '_candidate_expertise_area',
			'skills_tools'          => '_candidate_skills_tools',
			'education_level'       => '_candidate_education_level',
			'diploma_specialization' => '_candidate_diploma_specialization',
			'diploma_year'          => '_candidate_diploma_year',
			'diploma_in_progress'   => '_candidate_diploma_in_progress',
			'languages_proficiency' => '_candidate_languages',
			'position_type_sought'  => '_candidate_position_type',
			'remote_preference'     => '_candidate_remote_preference',
			'availability_date'     => '_candidate_available_from',
			'portfolio_url'         => '_candidate_portfolio_url',
			'scholar_github_url'    => '_candidate_scholar_github',

			// ── SRA Membership ───────────────────────────────────
			'create_sra_profile'    => 'sratix_create_sra_profile',
			'publish_resume'        => 'sratix_publish_resume',
			'profile_visibility_resume' => 'sratix_profile_visibility',
			'allow_employer_contact' => 'sratix_allow_employer_contact',

			// ── Event preferences ────────────────────────────────
			'dietary_requirements' => 'sratix_dietary_requirements',
			'accessibility_needs'  => 'sratix_accessibility_needs',
			'tshirt_size'          => 'sratix_tshirt_size',

			// ── Startup ──────────────────────────────────────────
			'startup_incorporated_recently' => 'sratix_startup_incorporated',
			'startup_incorporation_year'    => 'sratix_startup_inc_year',
			'startup_pitch_deck_url'        => 'sratix_startup_pitch_deck',
			'startup_team_size'             => 'sratix_startup_team_size',
			'startup_looking_for'           => 'sratix_startup_looking_for',

			// ── Reduced ──────────────────────────────────────────
			'reduced_status'        => 'sratix_reduced_status',
			'reduced_note'          => 'sratix_reduced_note',

			// ── Exhibitor / Org ──────────────────────────────────
			'exhibitor_vat_uid'             => 'sratix_exhibitor_vat_uid',
			'exhibitor_billing_address'     => 'sratix_exhibitor_billing_address',
			'exhibitor_billing_email'       => 'sratix_exhibitor_billing_email',
			'exhibitor_po_number'           => 'sratix_exhibitor_po_number',
			'exhibitor_onsite_contact_name' => 'sratix_exhibitor_onsite_name',
			'exhibitor_onsite_contact_phone' => 'sratix_exhibitor_onsite_phone',
			'exhibitor_company_description' => 'sratix_exhibitor_description',
			'exhibitor_member_id'           => 'sratix_exhibitor_member_id',
			'exhibitor_staff_company'       => 'sratix_exhibitor_company',
			'exhibitor_booth_role'          => 'sratix_exhibitor_booth_role',
			'exhibitor_setup_access'        => 'sratix_exhibitor_setup_access',
		);

		foreach ( $form_data as $slug => $value ) {
			$meta_key = $field_map[ $slug ] ?? 'sratix_field_' . sanitize_key( $slug );
			if ( is_array( $value ) ) {
				$value = wp_json_encode( $value );
			}
			update_user_meta( $user_id, $meta_key, sanitize_text_field( $value ) );
		}

		// ── Auto-create WP Job Manager resume if opted in ────
		if ( ! empty( $form_data['publish_resume'] )
			&& ( 'yes' === $form_data['publish_resume'] || true === $form_data['publish_resume'] )
		) {
			$this->maybe_create_resume( $user_id, $form_data );
		}
	}

	/**
	 * Create a WP Job Manager resume for the user from form data.
	 *
	 * @param int   $user_id   WP user ID.
	 * @param array $form_data Form submission answers.
	 */
	private function maybe_create_resume( $user_id, $form_data ) {
		if ( ! post_type_exists( 'resume' ) ) {
			error_log( 'SRAtix Control: Resume post type not registered — skipping resume creation for user ' . $user_id );
			return;
		}

		// Check if user already has a resume
		$existing = get_posts( array(
			'post_type'   => 'resume',
			'author'      => $user_id,
			'post_status' => array( 'publish', 'pending', 'hidden' ),
			'numberposts' => 1,
			'fields'      => 'ids',
		) );

		if ( ! empty( $existing ) ) {
			error_log( 'SRAtix Control: User ' . $user_id . ' already has resume #' . $existing[0] . ' — skipping' );
			return;
		}

		$user        = get_userdata( $user_id );
		$title       = ! empty( $form_data['professional_title'] ) ? sanitize_text_field( $form_data['professional_title'] ) : '';
		$post_title  = trim( $user->first_name . ' ' . $user->last_name );

		$resume_id = wp_insert_post( array(
			'post_type'    => 'resume',
			'post_title'   => $post_title ?: $user->user_email,
			'post_status'  => 'publish',
			'post_author'  => $user_id,
			'post_content' => sanitize_textarea_field( $form_data['short_bio_resume'] ?? '' ),
		) );

		if ( is_wp_error( $resume_id ) ) {
			error_log( 'SRAtix Control: Failed to create resume for user ' . $user_id . ': ' . $resume_id->get_error_message() );
			return;
		}

		// Store Resume Manager meta
		update_post_meta( $resume_id, '_candidate_title', $title );
		update_post_meta( $resume_id, '_candidate_email', $user->user_email );
		update_post_meta( $resume_id, '_candidate_location', sanitize_text_field( $form_data['city'] ?? '' ) );

		// Map form fields → resume meta
		$resume_meta_fields = array(
			'work_permit'           => '_candidate_work_permit',
			'education_level'       => '_candidate_education_level',
			'diploma_specialization' => '_candidate_diploma_specialization',
			'diploma_year'          => '_candidate_diploma_year',
			'diploma_in_progress'   => '_candidate_diploma_in_progress',
			'languages_proficiency' => '_candidate_languages',
			'position_type_sought'  => '_candidate_position_type',
			'remote_preference'     => '_candidate_remote_preference',
			'availability_date'     => '_candidate_available_from',
			'portfolio_url'         => '_candidate_portfolio_url',
			'scholar_github_url'    => '_candidate_scholar_github',
		);

		foreach ( $resume_meta_fields as $form_slug => $meta_key ) {
			if ( isset( $form_data[ $form_slug ] ) ) {
				$val = $form_data[ $form_slug ];
				if ( is_array( $val ) ) {
					$val = wp_json_encode( $val );
				}
				update_post_meta( $resume_id, $meta_key, sanitize_text_field( $val ) );
			}
		}

		// Store multi-select taxonomy-like fields as JSON post meta
		$multi_fields = array(
			'expertise_area' => '_candidate_expertise_area',
			'skills_tools'   => '_candidate_skills_tools',
		);

		foreach ( $multi_fields as $form_slug => $meta_key ) {
			if ( ! empty( $form_data[ $form_slug ] ) && is_array( $form_data[ $form_slug ] ) ) {
				update_post_meta( $resume_id, $meta_key, wp_json_encode( $form_data[ $form_slug ] ) );
			}
		}

		// Assign resume_skill taxonomy terms if available
		if ( ! empty( $form_data['skills_tools'] ) && taxonomy_exists( 'resume_skill' ) ) {
			$skills = is_array( $form_data['skills_tools'] ) ? $form_data['skills_tools'] : array( $form_data['skills_tools'] );
			wp_set_object_terms( $resume_id, $skills, 'resume_skill', false );
		}

		// Visibility
		$visibility = $form_data['profile_visibility_resume'] ?? 'members';
		update_post_meta( $resume_id, '_sra_visibility', sanitize_text_field( $visibility ) );

		// Mark as SRAtix-created
		update_post_meta( $resume_id, '_sratix_created', true );

		error_log( sprintf(
			'SRAtix Control: Created resume #%d for user %d (%s)',
			$resume_id,
			$user_id,
			$user->user_email
		) );
	}

	/**
	 * entity.search — Server requests a fuzzy search for existing SRA MAP entities.
	 *
	 * Called by the Dashboard admin UI to find entity matches before creating new ones.
	 * Returns an array of matches with similarity scores for admin validation.
	 *
	 * @param array $payload Webhook payload with data.name, data.limit, data.threshold.
	 * @return WP_REST_Response
	 */
	private function on_entity_search( $payload ) {
		$name      = $payload['data']['name'] ?? '';
		$limit     = intval( $payload['data']['limit'] ?? 5 );
		$threshold = floatval( $payload['data']['threshold'] ?? 60 );

		if ( empty( $name ) ) {
			return new \WP_REST_Response( array(
				'received' => true,
				'matches'  => array(),
				'reason'   => 'No search name provided',
			), 200 );
		}

		$matches = array();

		if ( function_exists( 'sra_map_search_entities' ) ) {
			$matches = sra_map_search_entities( $name, $limit, $threshold );
		}

		return new \WP_REST_Response( array(
			'received' => true,
			'matches'  => $matches,
			'count'    => count( $matches ),
		), 200 );
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
