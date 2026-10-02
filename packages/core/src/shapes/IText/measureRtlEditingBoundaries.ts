type MeasureRtlEditingBoundariesOptions = {
  document: Document;
  graphemes: readonly string[];
  font: string;
};

/**
 * Measures logical insertion boundaries for a fully shaped RTL text run.
 *
 * The complete text stays in one DOM text node so contextual shaping is
 * preserved. Prefix ranges expose the visual edge associated with each logical
 * grapheme boundary without rebuilding or splitting the run.
 *
 * Returns distances from the visual right edge of the line.
 */
export const measureRtlEditingBoundaries = ({
  document: doc,
  graphemes,
  font,
}: MeasureRtlEditingBoundariesOptions): number[] | undefined => {
  const body = doc.body;
  if (!body || typeof doc.createRange !== 'function') {
    return;
  }

  const text = graphemes.join('');
  if (!text) {
    return [0];
  }

  const span = doc.createElement('span');
  span.dir = 'rtl';
  span.setAttribute('aria-hidden', 'true');
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
    'opacity: 0',
    'pointer-events: none',
    'font-kerning: normal',
    'font-variant-ligatures: normal',
    'letter-spacing: 0px',
  ].join(';');
  span.style.font = font;
  span.textContent = text;
  body.appendChild(span);

  try {
    const node = span.firstChild;
    if (!node) {
      return;
    }

    const lineRect = span.getBoundingClientRect();
    if (!Number.isFinite(lineRect.width) || lineRect.width <= 0) {
      return;
    }

    const range = doc.createRange();
    if (typeof range.getBoundingClientRect !== 'function') {
      return;
    }

    const codeUnitOffsets = [0];
    let codeUnitOffset = 0;
    for (const grapheme of graphemes) {
      codeUnitOffset += grapheme.length;
      codeUnitOffsets.push(codeUnitOffset);
    }

    const boundaries = codeUnitOffsets.map((offset, index) => {
      if (index === 0) {
        return 0;
      }
      if (index === codeUnitOffsets.length - 1) {
        return lineRect.width;
      }

      range.setStart(node, 0);
      range.setEnd(node, offset);
      const rect = range.getBoundingClientRect();
      const boundary = lineRect.right - rect.left;

      return Math.max(0, Math.min(lineRect.width, boundary));
    });

    for (let i = 1; i < boundaries.length; i++) {
      if (
        !Number.isFinite(boundaries[i]) ||
        boundaries[i] + 0.5 < boundaries[i - 1]
      ) {
        return;
      }
    }

    return boundaries;
  } finally {
    span.remove();
  }
};
