import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isJSDOM } from '../../../../../vitest.extend';
import { Canvas } from '../../canvas/Canvas';
import { getFabricDocument } from '../../env';
import { Point } from '../../Point';
import { RIGHT, RTL } from '../../constants';
import { IText } from './IText';

const measureBrowserCaretBoundaries = (text: IText) => {
  const doc = getFabricDocument();
  const line = text._textLines[0];
  const style = text.getCompleteStyleDeclaration(0, 0);

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
    const node = span.firstChild!;
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

describe('IText Arabic editing geometry', () => {
  let canvas: Canvas;

  beforeEach(() => {
    canvas = new Canvas(undefined, {
      enableRetinaScaling: false,
      width: 800,
      height: 300,
    });
  });

  afterEach(() => {
    canvas.dispose();
  });

  const createArabicText = () => {
    const text = new IText('المهنة', {
      direction: RTL,
      textAlign: RIGHT,
      fontFamily: 'Arial',
      fontSize: 64,
      canvas,
    });

    text.positionByLeftTop(new Point(0, 20));
    canvas.add(text);
    return text;
  };

  it('caret boundaries match the browser-shaped Arabic run', (context) => {
    context.skip(isJSDOM());

    const text = createArabicText();
    const browser = measureBrowserCaretBoundaries(text);

    browser.forEach((expectedOffset, index) => {
      const cursor = text._getCursorBoundaries(index, true);

      // For right-aligned RTL text, leftOffset is the negative distance from
      // the visual right edge.
      expect(-cursor.leftOffset).toBeCloseTo(expectedOffset, 1);
    });
  });

  it('selection edges are the same geometry as the corresponding caret boundaries', (context) => {
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

    expect(selectionLeft).toBeCloseTo(Math.min(startX, endX), 1);
    expect(selectionWidth).toBeCloseTo(Math.abs(endX - startX), 1);
  });
});
