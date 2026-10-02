import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isJSDOM } from '../../../../../vitest.extend';
import { Canvas } from '../../canvas/Canvas';
import type { TPointerEvent } from '../../EventTypeDefs';
import { getFabricDocument } from '../../env';
import { Point } from '../../Point';
import { CENTER, LEFT, RIGHT, RTL } from '../../constants';
import { IText } from './IText';
import { measureRtlEditingBoundaries } from './measureRtlEditingBoundaries';

const ARABIC = 'المهنة';

class TestIText extends IText {
  getTextLine(lineIndex: number) {
    return this._textLines[lineIndex];
  }

  getRtlEditingBoundaries(lineIndex: number) {
    return this._getRtlEditingBoundaries(lineIndex);
  }
}

const measureBrowserCaretBoundaries = (
  text: TestIText,
  lineIndex = 0,
) => {
  const doc = getFabricDocument();
  const line = text.getTextLine(lineIndex);
  const style = text.getCompleteStyleDeclaration(lineIndex, 0);

  const span = doc.createElement('span');
  span.dir = RTL;
  span.style.cssText = [
    'all: initial',
    'position: fixed',
    'left: -100000px',
    'top: 0',
    'display: inline-block',
    'margin: 0',
    'padding: 0',
    'border: 0',
    'white-space: pre',
    'direction: rtl',
    'unicode-bidi: isolate',
    'font-kerning: normal',
    'font-variant-ligatures: normal',
    'letter-spacing: 0px',
  ].join(';');
  span.style.font = text._getFontDeclaration(style);
  span.textContent = line.join('');
  doc.body.appendChild(span);

  try {
    const node = span.firstChild;
    if (!node) {
      throw new Error('Arabic measurement span has no text node');
    }

    const lineRect = span.getBoundingClientRect();
    const range = doc.createRange();
    const codeUnitOffsets = [0];
    let codeUnitOffset = 0;

    for (const grapheme of line) {
      codeUnitOffset += grapheme.length;
      codeUnitOffsets.push(codeUnitOffset);
    }

    return codeUnitOffsets.map((offset, index) => {
      if (index === 0) {
        return 0;
      }
      if (index === codeUnitOffsets.length - 1) {
        return lineRect.width;
      }

      range.setStart(node, offset);
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      return lineRect.right - rect.left;
    });
  } finally {
    span.remove();
  }
};

const expectBoundariesClose = (
  actual: readonly number[] | undefined,
  expected: readonly number[],
) => {
  expect(actual).toBeDefined();
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(actual![index]).toBeCloseTo(value, 1);
  });
};

describe('IText Arabic RTL editing geometry', () => {
  let canvas: Canvas;

  beforeEach(() => {
    canvas = new Canvas(undefined, {
      enableRetinaScaling: false,
      width: 800,
      height: 300,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    canvas.dispose();
  });

  const createArabicText = (
    value = ARABIC,
    textAlign: IText['textAlign'] = RIGHT,
    flipX = false,
  ) => {
    const text = new TestIText(value, {
      direction: RTL,
      textAlign,
      fontFamily: 'Arial',
      fontSize: 64,
      flipX,
      canvas,
    });

    text.positionByLeftTop(new Point(100, 40));
    canvas.add(text);
    return text;
  };

  it('falls back safely when browser range geometry is unavailable', (context) => {
    context.skip(!isJSDOM());

    const text = createArabicText();
    const cursor = text._getCursorBoundaries(2, true);

    expect(Number.isFinite(cursor.leftOffset)).toBe(true);
  });

  it.each(['سنة 2026', 'سنة ٢٠٢٦', 'Fabric محرر'])(
    'falls back for mixed-direction content: %s',
    (value) => {
      const text = createArabicText(value);

      expect(text.getRtlEditingBoundaries(0)).toBeUndefined();
    },
  );

  it('falls back when the text object is horizontally flipped', () => {
    const text = createArabicText(ARABIC, RIGHT, true);

    expect(text.getRtlEditingBoundaries(0)).toBeUndefined();
  });

  it('measures a pure Arabic run directly against collapsed browser carets', (context) => {
    context.skip(isJSDOM());

    const text = createArabicText();
    const line = text.getTextLine(0);
    const style = text.getCompleteStyleDeclaration(0, 0);
    const expected = measureBrowserCaretBoundaries(text);

    const actual = measureRtlEditingBoundaries({
      document: getFabricDocument(),
      graphemes: line,
      font: text._getFontDeclaration(style),
    });

    expectBoundariesClose(actual, expected);
  });

  it.each([RIGHT, LEFT, CENTER])(
    'matches browser-shaped caret boundaries with %s alignment',
    (textAlign, context) => {
      context.skip(isJSDOM());

      const text = createArabicText(ARABIC, textAlign);
      const browserBoundaries = measureBrowserCaretBoundaries(text);
      const lineLeftOffset = text._getLineLeftOffset(0);

      browserBoundaries.forEach((boundary, index) => {
        const cursor = text._getCursorBoundaries(index, true);
        const expectedLeft =
          textAlign === RIGHT
            ? -(lineLeftOffset + boundary)
            : lineLeftOffset - boundary;

        expect(cursor.leftOffset).toBeCloseTo(expectedLeft, 1);
      });
    },
  );

  it.each(['المهنة', 'لا', 'هذه تجربة'])(
    'matches browser shaping for joined Arabic text: %s',
    (value, context) => {
      context.skip(isJSDOM());

      const text = createArabicText(value);
      const browserBoundaries = measureBrowserCaretBoundaries(text);
      const boundaries = text.getRtlEditingBoundaries(0);

      expectBoundariesClose(boundaries, browserBoundaries);
    },
  );

  it('matches browser shaping on each line of multi-line Arabic text', (context) => {
    context.skip(isJSDOM());

    const text = createArabicText('المهنة\nلا تجربة');

    expectBoundariesClose(
      text.getRtlEditingBoundaries(0),
      measureBrowserCaretBoundaries(text, 0),
    );
    expectBoundariesClose(
      text.getRtlEditingBoundaries(1),
      measureBrowserCaretBoundaries(text, 1),
    );
  });

  it('renders selection from the same X boundaries as the corresponding carets', (context) => {
    context.skip(isJSDOM());

    const text = createArabicText();
    const selectionStart = 2;
    const selectionEnd = 5;
    const startCursor = text._getCursorBoundaries(selectionStart, true);
    const endCursor = text._getCursorBoundaries(selectionEnd, true);

    const fillRect = vi.fn();
    const ctx = {
      fillStyle: '',
      fillRect,
    } as unknown as CanvasRenderingContext2D;

    text._renderSelection(
      ctx,
      { selectionStart, selectionEnd },
      { ...startCursor },
    );

    expect(fillRect).toHaveBeenCalledOnce();

    const [selectionLeft, , selectionWidth] = fillRect.mock.calls[0];
    const startX = startCursor.left + startCursor.leftOffset;
    const endX = endCursor.left + endCursor.leftOffset;

    expect(selectionLeft).toBeCloseTo(Math.min(startX, endX), 8);
    expect(selectionWidth).toBeCloseTo(Math.abs(endX - startX), 8);
  });

  it('hit-tests each Arabic insertion boundary to the same logical index', (context) => {
    context.skip(isJSDOM());

    const text = createArabicText();
    const browserBoundaries = measureBrowserCaretBoundaries(text);
    const lineLeftOffset = text._getLineLeftOffset(0);
    const getScenePoint = vi.spyOn(canvas, 'getScenePoint');

    browserBoundaries.forEach((boundary, expectedIndex) => {
      const localPoint = new Point(
        text._getLeftOffset() + lineLeftOffset - boundary,
        text._getTopOffset() + 1,
      ).transform(text.calcTransformMatrix());

      getScenePoint.mockReturnValue(localPoint);

      expect(
        text.getSelectionStartFromPointer({} as TPointerEvent),
      ).toBe(expectedIndex);
    });
  });
});
