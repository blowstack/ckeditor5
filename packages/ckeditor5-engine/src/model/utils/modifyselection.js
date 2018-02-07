/**
 * @license Copyright (c) 2003-2018, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

/**
 * @module engine/model/utils/modifyselection
 */

import Position from '../position';
import TreeWalker from '../treewalker';
import Range from '../range';
import { isInsideSurrogatePair, isInsideCombinedSymbol } from '@ckeditor/ckeditor5-utils/src/unicode';
import DocumentSelection from '../documentselection';

const wordBoundaryCharacters = ' ,.-():\'"';

/**
 * Modifies the selection. Currently, the supported modifications are:
 *
 * * Extending. The selection focus is moved in the specified `options.direction` with a step specified in `options.unit`.
 * Possible values for `unit` are:
 *  * `'character'` (default) - moves selection by one user-perceived character. In most cases this means moving by one
 *  character in `String` sense. However, unicode also defines "combing marks". These are special symbols, that combines
 *  with a symbol before it ("base character") to create one user-perceived character. For example, `q̣̇` is a normal
 *  letter `q` with two "combining marks": upper dot (`Ux0307`) and lower dot (`Ux0323`). For most actions, i.e. extending
 *  selection by one position, it is correct to include both "base character" and all of it's "combining marks". That is
 *  why `'character'` value is most natural and common method of modifying selection.
 *  * `'codePoint'` - moves selection by one unicode code point. In contrary to, `'character'` unit, this will insert
 *  selection between "base character" and "combining mark", because "combining marks" have their own unicode code points.
 *  However, for technical reasons, unicode code points with values above `UxFFFF` are represented in native `String` by
 *  two characters, called "surrogate pairs". Halves of "surrogate pairs" have a meaning only when placed next to each other.
 *  For example `𨭎` is represented in `String` by `\uD862\uDF4E`. Both `\uD862` and `\uDF4E` do not have any meaning
 *  outside the pair (are rendered as ? when alone). Position between them would be incorrect. In this case, selection
 *  extension will include whole "surrogate pair".
 *  * `'word'` - moves selection by whole word.
 *
 * **Note:** if you extend a forward selection in a backward direction you will in fact shrink it.
 *
 * @param {module:engine/model/model~Model} model The model in context of which
 * the selection modification should be performed.
 * @param {module:engine/model/selection~Selection} selection The selection to modify.
 * @param {Object} [options]
 * @param {'forward'|'backward'} [options.direction='forward'] The direction in which the selection should be modified.
 * @param {'character'|'codePoint'|'word'} [options.unit='character'] The unit by which selection should be modified.
 */
export default function modifySelection( model, selection, options = {} ) {
	const schema = model.schema;
	const isForward = options.direction != 'backward';
	const unit = options.unit ? options.unit : 'character';

	const focus = selection.focus;
	const walker = new TreeWalker( {
		boundaries: getSearchRange( focus, isForward ),
		singleCharacters: true,
		direction: isForward ? 'forward' : 'backward'
	} );

	const data = { walker, schema, isForward, unit };

	let next;

	while ( ( next = walker.next() ) ) {
		if ( next.done ) {
			return;
		}

		const position = tryExtendingTo( data, next.value );

		if ( position ) {
			if ( selection instanceof DocumentSelection ) {
				model.change( writer => {
					writer.setSelectionFocus( position );
				} );
			} else {
				selection.setFocus( position );
			}

			return;
		}
	}
}

// Checks whether the selection can be extended to the the walker's next value (next position).
// @param {{ walker, unit, isForward, schema }} data
// @param {{ item, nextPosition, type}} value
function tryExtendingTo( data, value ) {
	// If found text, we can certainly put the focus in it. Let's just find a correct position
	// based on the unit.
	if ( value.type == 'text' ) {
		return getCorrectPosition( data.walker, data.unit, data.isForward );
	}

	// Entering an element.
	if ( value.type == ( data.isForward ? 'elementStart' : 'elementEnd' ) ) {
		// If it's an object, we can select it now.
		if ( data.schema.isObject( value.item ) ) {
			return Position.createAt( value.item, data.isForward ? 'after' : 'before' );
		}

		// If text allowed on this position, extend to this place.
		if ( data.schema.checkChild( value.nextPosition, '$text' ) ) {
			return value.nextPosition;
		}
	}
	// Leaving an element.
	else {
		// If leaving a limit element, stop.
		if ( data.schema.isLimit( value.item ) ) {
			// NOTE: Fast-forward the walker until the end.
			data.walker.skip( () => true );

			return;
		}

		// If text allowed on this position, extend to this place.
		if ( data.schema.checkChild( value.nextPosition, '$text' ) ) {
			return value.nextPosition;
		}
	}
}

// Finds a correct position by walking in a text node and checking whether selection can be extended to given position
// or should be extended further.
//
// @param {module:engine/model/treewalker~TreeWalker} walker
// @param {String} unit The unit by which selection should be modified.
// @param {Boolean} isForward Is the direction in which the selection should be modified is forward.
function getCorrectPosition( walker, unit, isForward ) {
	const textNode = walker.position.textNode;

	if ( textNode ) {
		const data = textNode.data;
		let offset = walker.position.offset - textNode.startOffset;

		while (
			isInsideSurrogatePair( data, offset ) ||
			( unit == 'character' && isInsideCombinedSymbol( data, offset ) ) ||
			( unit == 'word' && !isAtWordBoundary( data, offset, isForward, textNode ) )
		) {
			walker.next();

			offset = walker.position.offset - textNode.startOffset;
		}
	}

	return walker.position;
}

function getSearchRange( start, isForward ) {
	const root = start.root;
	const searchEnd = Position.createAt( root, isForward ? 'end' : 0 );

	if ( isForward ) {
		return new Range( start, searchEnd );
	} else {
		return new Range( searchEnd, start );
	}
}

// Checks if selection is on word boundary.
//
// @param {String} data TextNode contents.
// @param {Number} offset Position offset.
// @param {Boolean} isForward Is the direction in which the selection should be modified is forward.
function isAtWordBoundary( data, offset, isForward, textNode ) {
	const textBoundaryOffset = isForward ? textNode.endOffset : 0;

	// If the position as at the end of a textNode it is also a word boundary.
	if ( offset === textBoundaryOffset ) {
		return true;
	}

	// The offset to check depends on direction.
	const offsetToCheck = offset + ( isForward ? 0 : -1 );

	return wordBoundaryCharacters.includes( data.charAt( offsetToCheck ) );
}
