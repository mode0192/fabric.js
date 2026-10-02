(() => {
  const fabric = window.fabric;
  if (!fabric?.IText) {
    throw new Error(
      'Fabric.js must be loaded before rtl-editing-geometry-clean-patch.js',
    );
  }

  const proto = fabric.IText.prototype;
  const geometryCache = new WeakMap();

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

  const getCache = (target) => {
    let cache = geometryCache.get(target);
    if (!cache) {
      cache = new Map();
      geometryCache.set(target, cache);
    }
    return cache;
  };

  const createMeasurementSpan = (doc, line, font) => {
    const body = doc?.body;
    if (!body || typeof doc.createRange !== 'function') {
      return undefined;
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
    span.textContent = line.join('');
    body.appendChild(span);

    const node = span.firstChild;
    if (!node) {
      span.remove();
      return undefined;
    }

    const lineRect = span.getBoundingClientRect();
    if (!Number.isFinite(lineRect.width) || lineRect.width <= 0) {
      span.remove();
      return undefined;
    }

    const offsets = [0];
    let codeUnitOffset = 0;
    for (const grapheme of line) {
      codeUnitOffset += grapheme.length;
      offsets.push(codeUnitOffset);
    }

    return { span, node, lineRect, offsets };
  };

  const measureRtlEditingBoundaries = (
    doc,
    line,
    font,
  ) => {
    const measurement = createMeasurementSpan(
      doc,
      line,
      font,
    );
    if (!measurement) {
      return undefined;
    }

    const { span, node, lineRect, offsets } =
      measurement;

    try {
      const range = doc.createRange();
      if (typeof range.getBoundingClientRect !== 'function') {
        return undefined;
      }

      const boundaries = offsets.map((offset) => {
        range.setStart(node, offset);
        range.collapse(true);

        const rect = range.getBoundingClientRect();
        const boundary = lineRect.right - rect.left;

        return Math.max(
          0,
          Math.min(lineRect.width, boundary),
        );
      });

      return boundaries.every(Number.isFinite)
        ? boundaries
        : undefined;
    } finally {
      span.remove();
    }
  };

  const measureRtlHitCandidates = (
    doc,
    line,
    font,
    primaryBoundaries,
  ) => {
    const measurement = createMeasurementSpan(
      doc,
      line,
      font,
    );
    if (!measurement) {
      return undefined;
    }

    const { span, node, lineRect, offsets } =
      measurement;

    try {
      const range = doc.createRange();
      if (typeof range.getClientRects !== 'function') {
        return undefined;
      }

      const candidates = Array.from(
        { length: offsets.length },
        () => [],
      );

      const addCandidate = (index, boundary) => {
        if (!Number.isFinite(boundary)) {
          return;
        }

        const values = candidates[index];
        if (
          !values.some(
            (value) =>
              Math.abs(value - boundary) < 0.5,
          )
        ) {
          values.push(boundary);
        }
      };

      primaryBoundaries.forEach((boundary, index) => {
        addCandidate(index, boundary);
      });

      for (let i = 0; i < line.length; i++) {
        range.setStart(node, offsets[i]);
        range.setEnd(node, offsets[i + 1]);

        const rects = Array.from(
          range.getClientRects(),
        ).filter(
          (rect) =>
            Number.isFinite(rect.left) &&
            Number.isFinite(rect.right) &&
            rect.width > 0,
        );

        if (rects.length !== 1) {
          continue;
        }

        const rect = rects[0];
        const leftEdge =
          lineRect.right - rect.left;
        const rightEdge =
          lineRect.right - rect.right;
        const startPrimary =
          primaryBoundaries[i];
        const endPrimary =
          primaryBoundaries[i + 1];

        const costStartLeft =
          Math.abs(startPrimary - leftEdge);
        const costStartRight =
          Math.abs(startPrimary - rightEdge);
        const costEndLeft =
          Math.abs(endPrimary - leftEdge);
        const costEndRight =
          Math.abs(endPrimary - rightEdge);

        // A grapheme's logical start/end must be its two visual
        // edges. At a bidi run boundary a collapsed DOM caret may
        // expose only the primary side, so infer the secondary side
        // from the opposite edge of the grapheme box.
        const normalCost =
          costStartLeft + costEndRight;
        const reversedCost =
          costStartRight + costEndLeft;

        if (normalCost <= reversedCost) {
          addCandidate(i, leftEdge);
          addCandidate(i + 1, rightEdge);
        } else {
          addCandidate(i, rightEdge);
          addCandidate(i + 1, leftEdge);
        }
      }

      return candidates;
    } finally {
      span.remove();
    }
  };

  const measureRtlSelectionRects = (
    doc,
    line,
    font,
    startChar,
    endChar,
  ) => {
    if (startChar === endChar) {
      return [];
    }

    const measurement = createMeasurementSpan(
      doc,
      line,
      font,
    );
    if (!measurement) {
      return undefined;
    }

    const { span, node, lineRect, offsets } =
      measurement;

    try {
      const range = doc.createRange();
      if (typeof range.getClientRects !== 'function') {
        return undefined;
      }

      range.setStart(node, offsets[startChar]);
      range.setEnd(node, offsets[endChar]);

      return Array.from(range.getClientRects())
        .filter(
          (rect) =>
            Number.isFinite(rect.left) &&
            Number.isFinite(rect.right) &&
            rect.width > 0,
        )
        .map((rect) => ({
          leftBoundary:
            lineRect.right - rect.left,
          rightBoundary:
            lineRect.right - rect.right,
        }));
    } finally {
      span.remove();
    }
  };

  const boundaryToLocalX = (
    target,
    lineIndex,
    boundary,
  ) => {
    const lineLeftOffset =
      target._getLineLeftOffset(lineIndex);

    if (target.textAlign === 'right') {
      return (
        target._getLeftOffset() -
        lineLeftOffset -
        boundary
      );
    }

    return (
      target._getLeftOffset() +
      lineLeftOffset -
      boundary
    );
  };


  proto._getRtlEditingBoundaries = function (lineIndex) {
    if (
      this.direction !== 'rtl' ||
      this.flipX ||
      this.path ||
      this.charSpacing !== 0 ||
      this.textAlign.includes('justify')
    ) {
      return undefined;
    }

    const line = this._textLines[lineIndex];
    if (!line?.length) {
      return [0];
    }

    const text = line.join('');
    const style = this.getCompleteStyleDeclaration(lineIndex, 0);
    for (let i = 1; i < line.length; i++) {
      if (
        !sameRenderingStyle(
          style,
          this.getCompleteStyleDeclaration(lineIndex, i),
        )
      ) {
        return undefined;
      }
    }

    const doc =
      this.hiddenTextarea?.ownerDocument ||
      this.canvas?.getElement?.()?.ownerDocument ||
      document;

    const font = this._getFontDeclaration(style);
    const signature = `${text}\u0000${font}\u0000${this.direction}`;
    const cache = getCache(this);
    const cached = cache.get(lineIndex);

    if (
      cached &&
      cached.document === doc &&
      cached.signature === signature
    ) {
      return cached.boundaries;
    }

    const boundaries = measureRtlEditingBoundaries(
      doc,
      line,
      font,
    );
    if (!boundaries) {
      return undefined;
    }

    if (!doc.fonts || doc.fonts.status !== 'loading') {
      cache.set(lineIndex, {
        document: doc,
        signature,
        boundaries,
      });
    }

    return boundaries;
  };

  proto._getRtlEditingHitCandidates = function (
    lineIndex,
  ) {
    if (
      this.direction !== 'rtl' ||
      this.flipX ||
      this.path ||
      this.charSpacing !== 0 ||
      this.textAlign.includes('justify')
    ) {
      return undefined;
    }

    const line = this._textLines[lineIndex];
    if (!line?.length) {
      return [[0]];
    }

    const primaryBoundaries =
      this._getRtlEditingBoundaries(lineIndex);
    if (!primaryBoundaries) {
      return undefined;
    }

    const style =
      this.getCompleteStyleDeclaration(
        lineIndex,
        0,
      );
    for (let i = 1; i < line.length; i++) {
      if (
        !sameRenderingStyle(
          style,
          this.getCompleteStyleDeclaration(
            lineIndex,
            i,
          ),
        )
      ) {
        return undefined;
      }
    }

    const doc =
      this.hiddenTextarea?.ownerDocument ||
      this.canvas?.getElement?.()?.ownerDocument ||
      document;

    return measureRtlHitCandidates(
      doc,
      line,
      this._getFontDeclaration(style),
      primaryBoundaries,
    );
  };

  proto._getRtlEditingCursorLeftOffset = function (
    lineIndex,
    charIndex,
  ) {
    const boundary =
      this._getRtlEditingBoundaries(lineIndex)?.[charIndex];

    if (boundary === undefined) {
      return undefined;
    }

    const lineLeftOffset = this._getLineLeftOffset(lineIndex);

    if (this.textAlign === 'right') {
      return -(lineLeftOffset + boundary);
    }

    return lineLeftOffset - boundary;
  };

  proto._getRtlEditingCursorX = function (
    lineIndex,
    charIndex,
  ) {
    const leftOffset =
      this._getRtlEditingCursorLeftOffset(
        lineIndex,
        charIndex,
      );

    return leftOffset === undefined
      ? undefined
      : this._getLeftOffset() + leftOffset;
  };

  const originalClearCache = proto._clearCache;
  proto._clearCache = function (...args) {
    geometryCache.get(this)?.clear();
    return originalClearCache.apply(this, args);
  };

  const originalCursorOffsets =
    proto.__getCursorBoundariesOffsets;

  proto.__getCursorBoundariesOffsets = function (index) {
    let topOffset = 0;
    const { charIndex, lineIndex } =
      this.get2DCursorLocation(index);

    for (let i = 0; i < lineIndex; i++) {
      topOffset += this.getHeightOfLine(i);
    }

    if (this.direction === 'rtl') {
      const shapedLeftOffset =
        this._getRtlEditingCursorLeftOffset(
          lineIndex,
          charIndex,
        );

      if (shapedLeftOffset !== undefined) {
        return {
          top: topOffset,
          left: shapedLeftOffset,
        };
      }
    }

    return originalCursorOffsets.call(this, index);
  };

  const originalSelection = proto._renderSelection;

  proto._renderSelection = function (
    ctx,
    selection,
    boundaries,
  ) {
    if (this.direction !== 'rtl') {
      return originalSelection.call(
        this,
        ctx,
        selection,
        boundaries,
      );
    }

    const selectionStart = Math.min(
      selection.selectionStart,
      selection.selectionEnd,
    );
    const selectionEnd = Math.max(
      selection.selectionStart,
      selection.selectionEnd,
    );

    if (selectionStart === selectionEnd) {
      return originalSelection.call(
        this,
        ctx,
        selection,
        boundaries,
      );
    }

    const start =
      this.get2DCursorLocation(selectionStart);
    const end =
      this.get2DCursorLocation(selectionEnd);

    const doc =
      this.hiddenTextarea?.ownerDocument ||
      this.canvas?.getElement?.()?.ownerDocument ||
      document;

    const lineSelections = [];

    for (
      let lineIndex = start.lineIndex;
      lineIndex <= end.lineIndex;
      lineIndex++
    ) {
      const line = this._textLines[lineIndex];
      const startChar =
        lineIndex === start.lineIndex
          ? start.charIndex
          : 0;
      const endChar =
        lineIndex === end.lineIndex
          ? end.charIndex
          : line.length;

      if (
        this._getRtlEditingBoundaries(lineIndex) ===
        undefined
      ) {
        return originalSelection.call(
          this,
          ctx,
          selection,
          boundaries,
        );
      }

      const style =
        this.getCompleteStyleDeclaration(
          lineIndex,
          0,
        );
      const font =
        this._getFontDeclaration(style);
      const rects = measureRtlSelectionRects(
        doc,
        line,
        font,
        startChar,
        endChar,
      );

      if (rects === undefined) {
        return originalSelection.call(
          this,
          ctx,
          selection,
          boundaries,
        );
      }

      lineSelections.push({
        lineIndex,
        rects,
      });
    }

    let lineTop = this._getTopOffset();

    for (let i = 0; i < start.lineIndex; i++) {
      lineTop += this.getHeightOfLine(i);
    }

    for (const { lineIndex, rects } of lineSelections) {
      let lineHeight =
        this.getHeightOfLine(lineIndex);
      const realLineHeight = lineHeight;

      if (
        this.lineHeight < 1 ||
        (lineIndex === end.lineIndex &&
          this.lineHeight > 1)
      ) {
        lineHeight /= this.lineHeight;
      }

      let drawHeight = lineHeight;
      let extraTop = 0;

      if (this.inCompositionMode) {
        ctx.fillStyle =
          this.compositionColor || 'black';
        drawHeight = 1;
        extraTop = lineHeight;
      } else {
        ctx.fillStyle = this.selectionColor;
      }

      for (const rect of rects) {
        const x1 = boundaryToLocalX(
          this,
          lineIndex,
          rect.leftBoundary,
        );
        const x2 = boundaryToLocalX(
          this,
          lineIndex,
          rect.rightBoundary,
        );

        ctx.fillRect(
          Math.min(x1, x2),
          lineTop + extraTop,
          Math.abs(x2 - x1),
          drawHeight,
        );
      }

      lineTop += realLineHeight;
    }
  };


  proto.getSelectionStartFromPointer = function (e) {
    const mouseOffset = this.canvas
      .getScenePoint(e)
      .transform(
        fabric.util.invertTransform(
          this.calcTransformMatrix(),
        ),
      )
      .add(
        new fabric.Point(
          -this._getLeftOffset(),
          -this._getTopOffset(),
        ),
      );

    let height = 0;
    let lineStart = 0;
    let lineIndex = 0;

    for (let i = 0; i < this._textLines.length; i++) {
      if (height <= mouseOffset.y) {
        height += this.getHeightOfLine(i);
        lineIndex = i;

        if (i > 0) {
          lineStart +=
            this._textLines[i - 1].length +
            this.missingNewlineOffset(i - 1);
        }
      } else {
        break;
      }
    }

    const charLength =
      this._textLines[lineIndex].length;
    const lineLeftOffset =
      this._getLineLeftOffset(lineIndex);
    const isRtl = this.direction === 'rtl';
    const effectiveX = isRtl
      ? lineLeftOffset - mouseOffset.x
      : mouseOffset.x;

    if (isRtl) {
      const candidates =
        this._getRtlEditingHitCandidates(
          lineIndex,
        );

      if (candidates) {
        let localIndex = 0;
        let nearestDistance =
          Number.POSITIVE_INFINITY;

        for (
          let i = 0;
          i < candidates.length;
          i++
        ) {
          for (const boundary of candidates[i]) {
            const distance = Math.abs(
              effectiveX - boundary,
            );

            if (distance < nearestDistance) {
              nearestDistance = distance;
              localIndex = i;
            }
          }
        }

        return Math.min(
          lineStart + localIndex,
          this._text.length,
        );
      }
    }

    const chars = this.__charBounds[lineIndex];
    let localIndex = 0;
    let width = isRtl
      ? 0
      : Math.abs(lineLeftOffset);

    for (let j = 0; j < charLength; j++) {
      const widthAfter =
        width + chars[j].kernedWidth;

      if (effectiveX <= widthAfter) {
        if (
          Math.abs(effectiveX - widthAfter) <=
          Math.abs(effectiveX - width)
        ) {
          localIndex++;
        }
        break;
      }

      width = widthAfter;
      localIndex++;
    }

    const resolvedLocalIndex = this.flipX
      ? charLength - localIndex
      : localIndex;

    return Math.min(
      lineStart + resolvedLocalIndex,
      this._text.length,
    );
  };

  window.__fabricRtlEditingGeometryCleanPatch = {
    commit:
      'EXPERIMENTAL-MIXED-BIDI-COLLAPSED-RANGE',
    applied: true,
    usesPrefixRanges: false,
    usesCollapsedCaretRanges: true,
    usesVisualSelectionRects: true,
    usesSplitBidiHitCandidates: true,
    modifiesRenderer: false,
    modifiesCharBounds: false,
    modifiesDragDrop: false,
    isolatesDomMeasurement: true,
    mixedDirectionFallback: false,
    experimentalMixedBidi: true,
    flipXFallback: true,
  };
})();
