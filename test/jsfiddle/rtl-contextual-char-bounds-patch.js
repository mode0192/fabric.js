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

  const styleChanged = (a, b) =>
    styleKeys.some((key) => a[key] !== b[key]);

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

    const runs = [];
    let runStart = 0;
    let runStyle = this.getCompleteStyleDeclaration(lineIndex, 0);

    for (let i = 1; i < line.length; i++) {
      const nextStyle = this.getCompleteStyleDeclaration(lineIndex, i);
      if (styleChanged(runStyle, nextStyle)) {
        runs.push({ start: runStart, end: i, style: runStyle });
        runStart = i;
        runStyle = nextStyle;
      }
    }
    runs.push({ start: runStart, end: line.length, style: runStyle });

    const doc = document;
    const body = doc.body;
    if (!body || typeof doc.createRange !== 'function') {
      return result;
    }

    const measuringCanvas = doc.createElement('canvas');
    const ctx = measuringCanvas.getContext('2d');
    if (!ctx) {
      return result;
    }

    const candidate = new Array(line.length);
    let accumulatedWidth = 0;

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
    body.appendChild(span);

    try {
      for (const run of runs) {
        const runText = line.slice(run.start, run.end).join('');
        span.style.font = this._getFontDeclaration(run.style);
        span.textContent = runText;

        const node = span.firstChild;
        if (!node) {
          return result;
        }

        const runRect = span.getBoundingClientRect();
        if (!Number.isFinite(runRect.width) || runRect.width <= 0) {
          return result;
        }

        const range = doc.createRange();
        if (typeof range.getBoundingClientRect !== 'function') {
          return result;
        }

        const runLength = run.end - run.start;
        const offsets = new Array(runLength + 1);
        offsets[0] = 0;
        offsets[runLength] = runRect.width;

        let utf16Offset = 0;
        for (let i = 1; i < runLength; i++) {
          utf16Offset += line[run.start + i - 1].length;
          range.setStart(node, utf16Offset);
          range.collapse(true);

          const rect = range.getBoundingClientRect();
          const offset = runRect.right - rect.left;
          if (
            !Number.isFinite(offset) ||
            offset < -0.5 ||
            offset > runRect.width + 0.5
          ) {
            return result;
          }
          offsets[i] = Math.max(0, Math.min(runRect.width, offset));
        }

        for (let i = 1; i < offsets.length; i++) {
          if (offsets[i] + 0.5 < offsets[i - 1]) {
            return result;
          }
          offsets[i] = Math.max(offsets[i], offsets[i - 1]);
        }

        ctx.font = this._getFontDeclaration(run.style, true);
        const runWidth =
          ctx.measureText(runText).width *
          (run.style.fontSize / this.CACHE_FONT_SIZE);
        if (!Number.isFinite(runWidth) || runWidth <= 0) {
          return result;
        }

        const scale = runWidth / runRect.width;
        for (let i = 0; i < offsets.length; i++) {
          offsets[i] *= scale;
        }

        for (let i = 0; i < runLength; i++) {
          const left = accumulatedWidth + offsets[i];
          const advance = offsets[i + 1] - offsets[i];
          candidate[run.start + i] = {
            left,
            width: advance,
            kernedWidth: advance,
          };
        }

        accumulatedWidth += runWidth;
      }

      const lineBounds = this.__charBounds[lineIndex];
      for (let i = 0; i < line.length; i++) {
        const geometry = candidate[i];
        if (!geometry) {
          return result;
        }
        lineBounds[i].left = geometry.left;
        lineBounds[i].width = geometry.width;
        lineBounds[i].kernedWidth = geometry.kernedWidth;
      }

      lineBounds[line.length].left = accumulatedWidth;
      result.width = accumulatedWidth;
      return result;
    } finally {
      span.remove();
    }
  };

  window.__fabricRtlContextualCharBoundsPatch = {
    commit: '80d72455b6bee72d6882084e4968cb0a23637ab4',
    applied: true,
    runAware: true,
  };
})();
