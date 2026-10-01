import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isJSDOM } from '../../../../../vitest.extend';
import { createPointerEvent } from '../../../../../test/utils';
import { Canvas } from '../../canvas/Canvas';
import { Point } from '../../Point';
import { RIGHT, RTL } from '../../constants';
import { getFabricDocument } from '../../env';
import { IText } from './IText';

const browserOffsets = (text: IText) => {
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
    'white-space: pre',
    'direction: rtl',
    'unicode-bidi: isolate',
    'visibility: hidden',
  ].join(';');
  span.style.font = text._getFontDeclaration(style);
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

    const lineWidth = text.getLineWidth(0);
    return offsets.map((offset) => (offset * lineWidth) / lineRect.width);
  } finally {
    span.remove();
  }
};

describe('IText contextual RTL char bounds', () => {
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
    });
    text.positionByLeftTop(new Point(0, 0));
    canvas.add(text);
    return text;
  };

  it('uses contextual char bounds for every cursor position', (context) => {
    context.skip(isJSDOM());

    const text = createArabicText();
    const offsets = browserOffsets(text);

    offsets.forEach((offset, index) => {
      const boundaries = text._getCursorBoundaries(index, true);
      expect(-boundaries.leftOffset).toBeCloseTo(offset, 1);
    });
  });

  it('uses contextual char advances for pointer hit testing', (context) => {
    context.skip(isJSDOM());

    const text = createArabicText();
    const offsets = browserOffsets(text);

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

      expect(text.getSelectionStartFromPointer(event)).toBe(i + 1);
    }
  });

  it('keeps contextual geometry after moving text with complete drag styles', (context) => {
    context.skip(isJSDOM());

    const text = createArabicText();
    const movedStart = 2;
    const movedEnd = 3;
    const moved = text._text.slice(movedStart, movedEnd).join('');
    const dragStyles = text.getSelectionStyles(movedStart, movedEnd, true);

    text.removeChars(movedStart, movedEnd);
    text.insertChars(moved, dragStyles, 0);

    expect(text.isEmptyStyles(0)).toBe(false);

    const offsets = browserOffsets(text);
    const bounds = text.__charBounds[0];

    offsets.forEach((offset, index) => {
      expect(bounds[index].left).toBeCloseTo(offset, 1);
      expect(-text._getCursorBoundaries(index, true).leftOffset).toBeCloseTo(
        offset,
        1,
      );
    });
  });

  it('renders selection between contextual char boundaries', (context) => {
    context.skip(isJSDOM());

    const text = createArabicText();
    const offsets = browserOffsets(text);
    const selectionStart = 2;
    const selectionEnd = 5;
    const fillRect = vi.fn();
    const ctx = {
      fillStyle: '',
      fillRect,
    } as unknown as CanvasRenderingContext2D;

    text._renderSelection(
      ctx,
      { selectionStart, selectionEnd },
      text._getCursorBoundaries(selectionStart, true),
    );

    expect(fillRect).toHaveBeenCalledOnce();
    const [, , width] = fillRect.mock.calls[0];
    expect(width).toBeCloseTo(
      offsets[selectionEnd] - offsets[selectionStart],
      1,
    );
  });
});
