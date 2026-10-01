import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Canvas } from '../../canvas/Canvas';
import { getFabricDocument } from '../../env';
import { Point } from '../../Point';
import { RIGHT, RTL } from '../../constants';
import { createPointerEvent } from '../../../../../test/utils';
import { isJSDOM } from '../../../../../vitest.extend';
import { IText } from './IText';

const measureBrowserRtlOffsets = (text: IText) => {
  const doc = getFabricDocument();
  const line = text._textLines[0];
  const span = doc.createElement('span');
  span.dir = RTL;
  span.style.cssText = [
    'all: initial',
    'position: fixed',
    'left: -100000px',
    'top: 0',
    'display: inline-block',
    'white-space: pre',
    'direction: rtl',
    'unicode-bidi: isolate',
    'opacity: 0',
  ].join(';');
  span.style.font = text._getFontDeclaration(
    text.getCompleteStyleDeclaration(0, 0),
  );
  span.textContent = line.join('');
  doc.body.appendChild(span);

  try {
    const node = span.firstChild!;
    const lineRect = span.getBoundingClientRect();
    const range = doc.createRange();
    const offsets = new Array<number>(line.length + 1);
    offsets[0] = 0;
    offsets[line.length] = lineRect.width;

    let utf16Offset = 0;
    for (let i = 1; i < line.length; i++) {
      utf16Offset += line[i - 1].length;
      range.setStart(node, utf16Offset);
      range.collapse(true);
      offsets[i] = lineRect.right - range.getBoundingClientRect().left;
    }
    return offsets;
  } finally {
    span.remove();
  }
};

describe('IText contextual RTL geometry', () => {
  let canvas: Canvas;

  beforeEach(() => {
    canvas = new Canvas(undefined, { enableRetinaScaling: false });
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
    text.positionByLeftTop(new Point(0, 0));
    canvas.add(text);
    return text;
  };

  it('positions every cursor boundary from the fully shaped Arabic run', (context) => {
    context.skip(isJSDOM());

    const text = createArabicText();
    const expected = measureBrowserRtlOffsets(text);

    expected.forEach((offset, index) => {
      const boundaries = text._getCursorBoundaries(index, true);
      expect(-boundaries.leftOffset).toBeCloseTo(offset, 1);
    });
  });

  it('uses the same shaped boundaries for pointer hit testing', (context) => {
    context.skip(isJSDOM());

    const text = createArabicText();
    const offsets = measureBrowserRtlOffsets(text);

    for (let i = 0; i < offsets.length - 1; i++) {
      const midpoint = (offsets[i] + offsets[i + 1]) / 2;
      const localPoint = new Point(
        text._getLeftOffset() - midpoint,
        0,
      ).transform(text.calcTransformMatrix());

      const event = createPointerEvent({
        target: canvas.upperCanvasEl,
        clientX: localPoint.x,
        clientY: localPoint.y,
      });

      // The existing hit-test resolves an exact midpoint to the boundary after
      // the character.
      expect(text.getSelectionStartFromPointer(event)).toBe(i + 1);
    }
  });

  it('renders an Arabic selection between the shaped cursor boundaries', (context) => {
    context.skip(isJSDOM());

    const text = createArabicText();
    const offsets = measureBrowserRtlOffsets(text);
    const selectionStart = 2;
    const selectionEnd = 5;
    const fillRect = vi.fn();
    const ctx = {
      fillStyle: '',
      fillRect,
    } as unknown as CanvasRenderingContext2D;
    const boundaries = text._getCursorBoundaries(selectionStart, true);

    text._renderSelection(
      ctx,
      { selectionStart, selectionEnd },
      { ...boundaries },
    );

    const [left, , width] = fillRect.mock.calls[0];
    expect(width).toBeCloseTo(
      offsets[selectionEnd] - offsets[selectionStart],
      1,
    );
    expect(left).toBeCloseTo(text.width / 2 - offsets[selectionEnd], 1);
  });
});
