<?php
/**
 * Event Logo helper — image-size registration, optimisation, and accessors.
 *
 * @package SRAtix_Control
 */
class SRAtix_Event_Logos {

	/**
	 * Custom image sizes.
	 */
	const SIZE_ICON      = 'sratix-logo-icon';       // 512 × 512 square
	const SIZE_LANDSCAPE = 'sratix-logo-landscape';   // 600 × 200 wide

	/**
	 * Bootstrap — register image sizes and optimization hooks.
	 */
	public static function init() {
		add_action( 'after_setup_theme', array( __CLASS__, 'register_image_sizes' ) );
		add_filter( 'wp_generate_attachment_metadata', array( __CLASS__, 'maybe_generate_webp' ), 10, 2 );
	}

	/**
	 * Register custom image sizes for event logos.
	 */
	public static function register_image_sizes() {
		add_image_size( self::SIZE_ICON, 512, 512, true );
		add_image_size( self::SIZE_LANDSCAPE, 600, 200, true );
	}

	/**
	 * After WordPress generates attachment metadata, create a WebP copy of
	 * each custom logo size (if the server supports it).
	 *
	 * @param array $metadata Attachment metadata.
	 * @param int   $attachment_id Attachment ID.
	 * @return array
	 */
	public static function maybe_generate_webp( $metadata, $attachment_id ) {
		if ( ! function_exists( 'wp_get_image_editor' ) ) {
			return $metadata;
		}

		// Only process images that are actually used as event logos.
		$icon_id      = (int) get_option( 'sratix_event_logo_icon_id', 0 );
		$landscape_id = (int) get_option( 'sratix_event_logo_landscape_id', 0 );

		if ( $attachment_id !== $icon_id && $attachment_id !== $landscape_id ) {
			return $metadata;
		}

		$upload_dir = wp_get_upload_dir();
		$base_dir   = trailingslashit( $upload_dir['basedir'] );
		$sizes      = array( self::SIZE_ICON, self::SIZE_LANDSCAPE );

		foreach ( $sizes as $size_name ) {
			if ( empty( $metadata['sizes'][ $size_name ]['file'] ) ) {
				continue;
			}

			$sub_dir  = dirname( $metadata['file'] );
			$src_path = $base_dir . trailingslashit( $sub_dir ) . $metadata['sizes'][ $size_name ]['file'];

			if ( ! file_exists( $src_path ) ) {
				continue;
			}

			$editor = wp_get_image_editor( $src_path );
			if ( is_wp_error( $editor ) ) {
				continue;
			}

			$editor->set_quality( 82 );

			$webp_path = preg_replace( '/\.[^.]+$/', '.webp', $src_path );
			$saved     = $editor->save( $webp_path, 'image/webp' );

			if ( ! is_wp_error( $saved ) ) {
				$metadata['sizes'][ $size_name . '-webp' ] = array(
					'file'      => basename( $saved['path'] ),
					'width'     => $saved['width'],
					'height'    => $saved['height'],
					'mime-type' => 'image/webp',
				);
			}
		}

		return $metadata;
	}

	/*──────────────────────────────────────────────────────────────
	 * Public accessors
	 *────────────────────────────────────────────────────────────*/

	/**
	 * Get the square / icon logo URL.
	 *
	 * @param string $format 'original' | 'optimized' | 'webp'.
	 * @return string URL or empty string.
	 */
	public static function get_icon_url( $format = 'optimized' ) {
		return self::get_logo_url( 'sratix_event_logo_icon_id', self::SIZE_ICON, $format );
	}

	/**
	 * Get the landscape / banner logo URL.
	 *
	 * @param string $format 'original' | 'optimized' | 'webp'.
	 * @return string URL or empty string.
	 */
	public static function get_landscape_url( $format = 'optimized' ) {
		return self::get_logo_url( 'sratix_event_logo_landscape_id', self::SIZE_LANDSCAPE, $format );
	}

	/**
	 * Get logo attachment ID.
	 *
	 * @param string $type 'icon' | 'landscape'.
	 * @return int Attachment ID or 0.
	 */
	public static function get_attachment_id( $type ) {
		$key = 'icon' === $type ? 'sratix_event_logo_icon_id' : 'sratix_event_logo_landscape_id';
		return (int) get_option( $key, 0 );
	}

	/**
	 * Internal: resolve an option → URL for the requested format.
	 *
	 * @param string $option_key WP option storing the attachment ID.
	 * @param string $size_name  Registered image size name.
	 * @param string $format     'original' | 'optimized' | 'webp'.
	 * @return string
	 */
	private static function get_logo_url( $option_key, $size_name, $format ) {
		$attachment_id = (int) get_option( $option_key, 0 );
		if ( ! $attachment_id ) {
			return '';
		}

		if ( 'original' === $format ) {
			return wp_get_attachment_url( $attachment_id ) ?: '';
		}

		if ( 'webp' === $format ) {
			$metadata = wp_get_attachment_metadata( $attachment_id );
			if ( ! empty( $metadata['sizes'][ $size_name . '-webp' ]['file'] ) ) {
				$upload_dir = wp_get_upload_dir();
				$sub_dir    = dirname( $metadata['file'] );
				return trailingslashit( $upload_dir['baseurl'] ) . trailingslashit( $sub_dir ) . $metadata['sizes'][ $size_name . '-webp' ]['file'];
			}
			// Fall back to optimized PNG/JPG if WebP not available.
		}

		// 'optimized' — use the custom-cropped size.
		$url = wp_get_attachment_image_url( $attachment_id, $size_name );
		return $url ?: ( wp_get_attachment_url( $attachment_id ) ?: '' );
	}

	/**
	 * Regenerate custom sizes for an existing attachment.
	 * Useful when a logo option changes after initial upload.
	 *
	 * @param int $attachment_id Attachment ID.
	 */
	public static function regenerate_sizes( $attachment_id ) {
		$file = get_attached_file( $attachment_id );
		if ( ! $file || ! file_exists( $file ) ) {
			return;
		}

		$metadata = wp_generate_attachment_metadata( $attachment_id, $file );
		wp_update_attachment_metadata( $attachment_id, $metadata );
	}
}
