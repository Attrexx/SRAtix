<?php
/**
 * Build SRA MAP payloads from SRAtix attendee + form submission data.
 *
 * @package SRAtix_Control
 */

class SRAtix_Control_Map_Entity_Builder {

	private const NAME_KEYS = array(
		'org_display_name',
		'organization_display_name',
		'company_name',
		'institution_company',
		'institution_name',
		'organization',
		'company',
	);

	private const DESCRIPTION_KEYS = array(
		'org_description',
		'organization_description',
		'organization_short_description',
	);

	private const WEBSITE_KEYS = array(
		'org_website',
		'organization_website',
		'company_website',
		'website',
	);

	private const EMAIL_KEYS = array(
		'org_contact_email',
		'org_email',
		'organization_email',
		'organization_contact_email',
		'email',
	);

	private const PHONE_KEYS = array(
		'org_phone',
		'organization_phone',
		'organization_contact_phone',
		'phone',
	);

	private const ADDRESS_KEYS = array(
		'org_address',
		'organization_address',
		'organization_address_swiss_hq_or_swiss_branch',
	);

	private const CITY_KEYS = array(
		'org_city',
		'organization_city',
		'organization_branch_city',
		'organization_branch_city_in_switzerland',
	);

	private const CANTON_KEYS = array(
		'org_canton',
		'swiss_canton',
		'state_canton',
	);

	private const COUNTRY_KEYS = array(
		'org_country',
		'country',
	);

	private const LATITUDE_KEYS = array(
		'org_latitude',
		'org_lat',
		'organization_latitude',
	);

	private const LONGITUDE_KEYS = array(
		'org_longitude',
		'org_lng',
		'organization_longitude',
	);

	private const ROBOTICS_FIELD_KEYS = array(
		'org_robotics_fields',
		'robotics_field',
		'exhibitor_robotics_fields',
		'industry_sector',
	);

	private const ROBOTICS_SUBFIELD_KEYS = array(
		'org_robotics_subfields',
		'robotics_subfield',
		'exhibitor_robotics_subfields',
		'sub_expertise',
	);

	private const IMAGE_KEYS = array(
		'org_logo',
		'organization_logo',
	);

	/**
	 * Whether a submission requested a map listing.
	 *
	 * @param array $form_data Submitted form answers.
	 * @return bool
	 */
	public static function should_create_map_listing( array $form_data ) {
		return self::is_truthy( $form_data['create_map_listing'] ?? null );
	}

	/**
	 * Build an SRA MAP payload from SRAtix data.
	 *
	 * @param array  $attendee        Enriched attendee payload.
	 * @param array  $form_data       Submitted form answers.
	 * @param int    $author_id       WordPress user ID.
	 * @param string $membership_tier Original SRAtix membership tier.
	 * @return array
	 */
	public static function build_entity_payload( array $attendee, array $form_data, $author_id = 0, $membership_tier = '' ) {
		$raw_org_type = self::first_non_empty( array( 'org_type', 'organization_type' ), $form_data );
		$entity_type  = self::normalize_entity_type( $raw_org_type );

		$payload = array(
			'name'             => self::first_non_empty( self::NAME_KEYS, $form_data, $attendee ),
			'description'      => self::first_non_empty( self::DESCRIPTION_KEYS, $form_data ),
			'website'          => self::first_non_empty( self::WEBSITE_KEYS, $form_data, $attendee ),
			'email'            => self::first_non_empty( self::EMAIL_KEYS, $form_data, $attendee ),
			'phone'            => self::first_non_empty( self::PHONE_KEYS, $form_data, $attendee ),
			'address'          => self::first_non_empty( self::ADDRESS_KEYS, $form_data ),
			'city'             => self::first_non_empty( self::CITY_KEYS, $form_data ),
			'canton'           => self::first_non_empty( self::CANTON_KEYS, $form_data ),
			'country'          => self::normalize_country( self::first_non_empty( self::COUNTRY_KEYS, $form_data, $attendee ) ),
			'lat'              => self::normalize_number( self::first_non_empty( self::LATITUDE_KEYS, $form_data ) ),
			'lng'              => self::normalize_number( self::first_non_empty( self::LONGITUDE_KEYS, $form_data ) ),
			'entity_type'      => $entity_type,
			'robotics_field'   => self::normalize_list( self::first_non_empty( self::ROBOTICS_FIELD_KEYS, $form_data ) ),
			'robotics_subfield'=> self::normalize_list( self::first_non_empty( self::ROBOTICS_SUBFIELD_KEYS, $form_data ) ),
			'image_url'        => self::first_non_empty( self::IMAGE_KEYS, $form_data ),
			'post_status'      => self::normalize_post_status( $form_data['org_profile_visibility'] ?? '' ),
			'membership'       => self::normalize_membership( $membership_tier, $entity_type, $raw_org_type ),
		);

		if ( $author_id ) {
			$payload['author_id'] = (int) $author_id;
		}

		return array_filter(
			$payload,
			static function ( $value ) {
				if ( is_array( $value ) ) {
					return ! empty( $value );
				}

				return '' !== $value && null !== $value;
			}
		);
	}

	/**
	 * Pick the first non-empty value from one or more sources.
	 *
	 * @param array ...$sources Source arrays.
	 * @return mixed
	 */
	private static function first_non_empty( array $keys, ...$sources ) {
		foreach ( $sources as $source ) {
			if ( ! is_array( $source ) ) {
				continue;
			}

			foreach ( $keys as $key ) {
				if ( ! array_key_exists( $key, $source ) ) {
					continue;
				}

				$value = self::normalize_value( $source[ $key ] );
				if ( self::has_value( $value ) ) {
					return $value;
				}
			}
		}

		return '';
	}

	/**
	 * Normalize a source value.
	 *
	 * @param mixed $value Raw source value.
	 * @return mixed
	 */
	private static function normalize_value( $value ) {
		if ( is_array( $value ) ) {
			$result = array();
			foreach ( $value as $item ) {
				$normalized = self::normalize_value( $item );
				if ( self::has_value( $normalized ) ) {
					$result[] = $normalized;
				}
			}

			return array_values( array_unique( $result ) );
		}

		if ( is_string( $value ) ) {
			return trim( $value );
		}

		return $value;
	}

	/**
	 * Whether a normalized value is usable.
	 *
	 * @param mixed $value Normalized value.
	 * @return bool
	 */
	private static function has_value( $value ) {
		if ( is_array( $value ) ) {
			return ! empty( $value );
		}

		return null !== $value && '' !== $value;
	}

	/**
	 * Normalize map entity type values to SRA MAP taxonomy slugs.
	 *
	 * @param mixed $value Raw value.
	 * @return string
	 */
	private static function normalize_entity_type( $value ) {
		$key = self::slugify( $value );
		$map = array(
			'research'                         => 'research',
			'research-university'              => 'research',
			'research-university-institute'    => 'research',
			'university'                       => 'research',
			'academic'                         => 'research',
			'academia'                         => 'research',
			'industry-large'                   => 'industry-large',
			'industry-large-company'           => 'industry-large',
			'industry_large'                   => 'industry-large',
			'industry-sme'                     => 'industry-sme',
			'industry_small'                   => 'industry-sme',
			'industry-medium'                  => 'industry-sme',
			'industry_medium'                  => 'industry-sme',
			'sme'                              => 'industry-sme',
			'startup'                          => 'industry-sme',
			'startup-spin-off'                 => 'industry-sme',
			'spin-off'                         => 'industry-sme',
			'ngo'                              => 'infrastructure-funding-providers',
			'non-profit'                       => 'infrastructure-funding-providers',
			'association'                      => 'infrastructure-funding-providers',
			'government'                       => 'infrastructure-funding-providers',
			'public'                           => 'infrastructure-funding-providers',
			'infrastructure'                   => 'infrastructure-funding-providers',
			'infrastructure-funding'           => 'infrastructure-funding-providers',
			'infrastructure-funding-providers' => 'infrastructure-funding-providers',
		);

		return $map[ $key ] ?? '';
	}

	/**
	 * Normalize membership to SRA MAP membership slugs.
	 *
	 * @param string $membership_tier Original ticket membership tier.
	 * @param string $entity_type     Normalized entity type.
	 * @param string $raw_org_type    Raw organization type.
	 * @return string
	 */
	private static function normalize_membership( $membership_tier, $entity_type, $raw_org_type ) {
		$key = self::slugify( $membership_tier );
		$valid = array(
			'startup',
			'industry_small',
			'industry_medium',
			'industry_large',
			'research',
		);

		if ( in_array( $key, $valid, true ) ) {
			return $key;
		}

		if ( 'research' === $entity_type ) {
			return 'research';
		}

		if ( 'industry-large' === $entity_type ) {
			return 'industry_large';
		}

		if ( 'industry-sme' === $entity_type ) {
			$org_key = self::slugify( $raw_org_type );
			if ( 'startup' === $org_key || 'startup-spin-off' === $org_key || 'spin-off' === $org_key ) {
				return 'startup';
			}

			return 'industry_small';
		}

		return '';
	}

	/**
	 * Normalize a float-ish value.
	 *
	 * @param mixed $value Raw value.
	 * @return float|null
	 */
	private static function normalize_number( $value ) {
		if ( '' === $value || null === $value ) {
			return null;
		}

		return is_numeric( $value ) ? (float) $value : null;
	}

	/**
	 * Normalize a list value from arrays, JSON, or comma-separated strings.
	 *
	 * @param mixed $value Raw value.
	 * @return array
	 */
	private static function normalize_list( $value ) {
		if ( is_array( $value ) ) {
			return array_values( array_unique( array_filter( array_map( 'trim', $value ) ) ) );
		}

		if ( ! is_string( $value ) ) {
			return array();
		}

		$trimmed = trim( $value );
		if ( '' === $trimmed ) {
			return array();
		}

		if ( '[' === substr( $trimmed, 0, 1 ) ) {
			$decoded = json_decode( $trimmed, true );
			if ( is_array( $decoded ) ) {
				return array_values( array_unique( array_filter( array_map( 'trim', $decoded ) ) ) );
			}
		}

		return array_values( array_unique( array_filter( array_map( 'trim', explode( ',', $trimmed ) ) ) ) );
	}

	/**
	 * Normalize status for new entities.
	 *
	 * @param mixed $value Raw value.
	 * @return string
	 */
	private static function normalize_post_status( $value ) {
		$key = self::slugify( $value );
		if ( in_array( $key, array( 'draft', 'pending', 'review', 'pending-review', 'private', 'no', 'false', '0' ), true ) ) {
			return 'draft';
		}

		if ( in_array( $key, array( 'publish', 'published', 'public', 'yes', 'true', '1' ), true ) ) {
			return 'publish';
		}

		return 'publish';
	}

	/**
	 * Normalize a country code.
	 *
	 * @param mixed $value Raw value.
	 * @return string
	 */
	private static function normalize_country( $value ) {
		$key = self::slugify( $value );
		return $key ? substr( $key, 0, 2 ) : 'ch';
	}

	/**
	 * Normalize truthy user input.
	 *
	 * @param mixed $value Raw value.
	 * @return bool
	 */
	private static function is_truthy( $value ) {
		if ( is_bool( $value ) ) {
			return $value;
		}

		$key = self::slugify( $value );
		return in_array( $key, array( '1', 'true', 'yes', 'on', 'publish' ), true );
	}

	/**
	 * Normalize values into lowercase machine slugs.
	 *
	 * @param mixed $value Raw value.
	 * @return string
	 */
	private static function slugify( $value ) {
		if ( ! is_scalar( $value ) ) {
			return '';
		}

		$value = strtolower( trim( (string) $value ) );
		$value = str_replace( array( '/', '_', '&' ), array( '-', '_', 'and' ), $value );
		$value = preg_replace( '/[^a-z0-9_-]+/', '-', $value );
		$value = preg_replace( '/-+/', '-', $value );
		return trim( $value, '-' );
	}
}