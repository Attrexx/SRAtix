/**
 * SRAtix Control — Admin JS (media-upload logo picker).
 *
 * @package SRAtix_Control
 */
(function( $ ) {
	'use strict';

	$( function() {
		$( '.sratix-logo-field' ).each( function() {
			var $field   = $( this );
			var $input   = $field.find( 'input[type="hidden"]' );
			var $preview = $field.find( '.sratix-logo-preview' );
			var $img     = $preview.find( 'img' );
			var $upload  = $field.find( '.sratix-logo-upload' );
			var $remove  = $field.find( '.sratix-logo-remove' );

			$upload.on( 'click', function( e ) {
				e.preventDefault();

				var frame = wp.media( {
					title:    wp.i18n.__( 'Select Logo', 'sratix-control' ) || 'Select Logo',
					library:  { type: 'image' },
					multiple: false,
					button:   { text: wp.i18n.__( 'Use this image', 'sratix-control' ) || 'Use this image' }
				} );

				frame.on( 'select', function() {
					var attachment = frame.state().get( 'selection' ).first().toJSON();
					var url = ( attachment.sizes && attachment.sizes.medium )
						? attachment.sizes.medium.url
						: attachment.url;

					$input.val( attachment.id );
					$img.attr( 'src', url );
					$preview.show();
					$upload.text( wp.i18n.__( 'Replace', 'sratix-control' ) || 'Replace' );
					$remove.show();
				} );

				frame.open();
			} );

			$remove.on( 'click', function( e ) {
				e.preventDefault();
				$input.val( '0' );
				$img.attr( 'src', '' );
				$preview.hide();
				$upload.text( wp.i18n.__( 'Upload Logo', 'sratix-control' ) || 'Upload Logo' );
				$remove.hide();
			} );
		} );
	} );

})( jQuery );
