(() => {
  const fabric = window.fabric;
  if (!fabric?.FabricText) {
    throw new Error(
      'Fabric.js must be loaded before rtl-contextual-char-bounds-patch.js',
    );
  }

  const proto = fabric.FabricText.prototype;
  const originalMeasureLine = proto._measureLine;

  const styleKeys = [
    'fill',
    'stroke',
    'strokeWidth',
    'fontSize',
    'fontFamily',
    'fontWeight',
    'fontStyle',
    'textDecorationThickness',
    'textDecorationColor',
    'textBackgroundColor',
    'deltaY',
  ];

  const sameRenderingStyle = (a, b) =>
    styleKeys.every((key) => a[key] === b[key]);

  proto._measureLine = function (lineIndex) {
    const result = originalMeasureLine.call(this, lineIndex);

    if (
      this.direction !== 'rtl' ||
      this.path ||
      this.charSpacing !== 0 ||
      this.textAlign.includes('justify')
    ) {
      return result;
    }

    const line = this._textLines[lineIndex];
    if (!line?.length) {
      return result;
    }

    const style = this.getCompleteStyleDeclaration(lineIndex, 0);
    for (let i = 1; i < line.length; i++) {
      if (
        !sameRenderingStyle(
          style,
          this.getCompleteStyleDeclaration(lineIndex, i),
        )
      ) {
        return result;
      }
    }

    const doc = document;
    const body = doc.body;
    if (!body || typeof doc.createRange !== 'function') {
      return result;
    }

    const value = line.join('');
    const span = doc.createElement('span');
    span.dir = 'rtl';
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
      'visibility: hidden',
      'pointer-events: none',
    ].join(';');
    span.style.font = this._getFontDeclaration(style);
    span.textContent = value;
    body.appendChild(span);

    try {
      const node = span.firstChild;
      if (!node) {
        return result;
      }

      const lineRect = span.getBoundingClientRect();
      if (!Number.isFinite(lineRect.width) || lineRect.width <= 0) {
        return result;
      }

      const range = doc.createRange();
      if (typeof range.getBoundingClientRect !== 'function') {
        return result;
      }

      const offsets = new Array(line.length + 1);
      offsets[0] = 0;
      offsets[line.length] = lineRect.width;

      let utf16Offset = 0;
      for (let i = 1; i < line.length; i++) {
        utf16Offset += line[i - 1].length;
        range.setStart(node, utf16Offset);
        range.collapse(true);

        const rect = range.getBoundingClientRect();
        const offset = lineRect.right - rect.left;
        if (
          !Number.isFinite(offset) ||
          offset < -0.5 ||
          offset > lineRect.width + 0.5
        ) {
          return result;
        }
        offsets[i] = Math.max(0, Math.min(lineRect.width, offset));
      }

      for (let i = 1; i < offsets.length; i++) {
        if (offsets[i] + 0.5 < offsets[i - 1]) {
          return result;
        }
        offsets[i] = Math.max(offsets[i], offsets[i - 1]);
      }

      const measuringCanvas = doc.createElement('canvas');
      const ctx = measuringCanvas.getContext('2d');
      if (!ctx) {
        return result;
      }

      ctx.font = this._getFontDeclaration(style, true);
      const runWidth =
        ctx.measureText(value).width * (style.fontSize / this.CACHE_FONT_SIZE);
      if (!Number.isFinite(runWidth) || runWidth <= 0) {
        return result;
      }

      const scale = runWidth / lineRect.width;
      for (let i = 0; i < offsets.length; i++) {
        offsets[i] *= scale;
      }

      const lineBounds = this.__charBounds[lineIndex];
      for (let i = 0; i < line.length; i++) {
        const left = offsets[i];
        const advance = offsets[i + 1] - left;
        lineBounds[i].left = left;
        lineBounds[i].width = advance;
        lineBounds[i].kernedWidth = advance;
      }

      lineBounds[line.length].left = runWidth;
      result.width = runWidth;

      return result;
    } finally {
      span.remove();
    }
  };

  window.__fabricRtlContextualCharBoundsPatch = {
    commit: '28637abecdfd59248ca613cb33f06d184fc352ea',
    applied: true,
  };
})();
