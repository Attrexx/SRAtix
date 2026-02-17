<?php
/**
 * Sync handler — pushes WP user/member data changes to SRAtix Server.
 * Event-driven (hook-based), not polling.
 *
 * @package SRAtix_Control
 */
class SRAtix_Control_Sync {

	/** @var SRAtix_Control_API */
	private $api;

	public function __construct( SRAtix_Control_API $api ) {
		$this->api = $api;
	}

	/*──────────────────────────────────────────────────────────
	 * WordPress user hooks
	 *────────────────────────────────────────────────────────*/

	/**
	 * Fires when a user profile is updated.
	 * Pushes display name, email, etc. to SRAtix Server.
	 *
	 * @param int    $user_id        User ID.
	 * @param object $old_user_data  Previous user data.
	 */
	public function on_profile_update( $user_id, $old_user_data ) {
		$user = get_userdata( $user_id );
		if ( ! $user ) {
			return;
		}

		$sratix_id = get_user_meta( $user_id, 'sratix_actor_id', true );
		if ( ! $sratix_id ) {
			// User not yet linked to SRAtix — will be linked on first token exchange
			return;
		}

		$this->api->patch( "/users/{$sratix_id}", array(
			'email'       => $user->user_email,
			'displayName' => $user->display_name,
		) );

		update_user_meta( $user_id, 'sratix_last_sync', current_time( 'mysql', true ) );
	}

	/**
	 * Fires when a user's WP role changes.
	 *
	 * @param int    $user_id   User ID.
	 * @param string $role      New role.
	 * @param array  $old_roles Previous roles.
	 */
	public function on_role_change( $user_id, $role, $old_roles ) {
		$sratix_id = get_user_meta( $user_id, 'sratix_actor_id', true );
		if ( ! $sratix_id ) {
			return;
		}

		$user = get_userdata( $user_id );
		if ( ! $user ) {
			return;
		}

		$this->api->post( "/users/{$sratix_id}/sync-roles", array(
			'wpRoles' => (array) $user->roles,
		) );
	}

	/*──────────────────────────────────────────────────────────
	 * ProfileGrid group hooks
	 *────────────────────────────────────────────────────────*/

	/**
	 * Fires when a user joins a ProfileGrid group.
	 */
	public function on_group_join( $user_id, $group_id ) {
		$sratix_id = get_user_meta( $user_id, 'sratix_actor_id', true );
		if ( ! $sratix_id ) {
			return;
		}

		$this->api->post( "/users/{$sratix_id}/sync-group", array(
			'action'  => 'join',
			'groupId' => $group_id,
		) );
	}

	/**
	 * Fires when a user leaves a ProfileGrid group.
	 */
	public function on_group_leave( $user_id, $group_id ) {
		$sratix_id = get_user_meta( $user_id, 'sratix_actor_id', true );
		if ( ! $sratix_id ) {
			return;
		}

		$this->api->post( "/users/{$sratix_id}/sync-group", array(
			'action'  => 'leave',
			'groupId' => $group_id,
		) );
	}

	/*──────────────────────────────────────────────────────────
	 * WooCommerce hooks
	 *────────────────────────────────────────────────────────*/

	/**
	 * Fires when a WooCommerce order is completed.
	 * Links the purchasing user's org in SRAtix if applicable.
	 *
	 * @param int $order_id WooCommerce order ID.
	 */
	public function on_order_complete( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return;
		}

		$user_id = $order->get_customer_id();
		if ( ! $user_id ) {
			return;
		}

		$sratix_id = get_user_meta( $user_id, 'sratix_actor_id', true );
		if ( ! $sratix_id ) {
			return;
		}

		// Notify Server about the membership purchase
		$this->api->post( "/users/{$sratix_id}/membership-update", array(
			'wpOrderId' => $order_id,
			'products'  => array_map( function ( $item ) {
				return array(
					'productId' => $item->get_product_id(),
					'name'      => $item->get_name(),
					'quantity'  => $item->get_quantity(),
				);
			}, $order->get_items() ),
		) );
	}

	/*──────────────────────────────────────────────────────────
	 * Mapping helpers
	 *────────────────────────────────────────────────────────*/

	/**
	 * Get or create a mapping between a WP entity and a SRAtix entity.
	 */
	public static function get_mapping( $wp_entity_type, $wp_entity_id ) {
		global $wpdb;
		$table = $wpdb->prefix . 'sratix_mappings';

		return $wpdb->get_row( $wpdb->prepare(
			"SELECT * FROM {$table} WHERE wp_entity_type = %s AND wp_entity_id = %d",
			$wp_entity_type,
			$wp_entity_id
		), ARRAY_A );
	}

	/**
	 * Store a WP ↔ SRAtix entity mapping.
	 */
	public static function set_mapping( $wp_entity_type, $wp_entity_id, $sratix_entity_type, $sratix_entity_id, $org_id = null ) {
		global $wpdb;
		$table = $wpdb->prefix . 'sratix_mappings';

		return $wpdb->replace( $table, array(
			'wp_entity_type'     => $wp_entity_type,
			'wp_entity_id'       => $wp_entity_id,
			'sratix_entity_type' => $sratix_entity_type,
			'sratix_entity_id'   => $sratix_entity_id,
			'org_id'             => $org_id,
		) );
	}
}
