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

  proto._getRtlEditingBoundaries = function (lineIndex) {
    if (
      this.direction !== 'rtl' ||
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
    const body = doc?.body;
    if (!body || typeof doc.createRange !== 'function') {
      return undefined;
    }

    const text = line.join('');
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
        return undefined;
      }

      const lineRect = span.getBoundingClientRect();
      if (!Number.isFinite(lineRect.width) || lineRect.width <= 0) {
        return undefined;
      }

      const range = doc.createRange();
      if (typeof range.getBoundingClientRect !== 'function') {
        return undefined;
      }

      const codeUnitOffsets = [0];
      let codeUnitOffset = 0;
      for (const grapheme of line) {
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

        return Math.max(
          0,
          Math.min(lineRect.width, boundary),
        );
      });

      for (let i = 1; i < boundaries.length; i++) {
        if (
          !Number.isFinite(boundaries[i]) ||
          boundaries[i] + 0.5 < boundaries[i - 1]
        ) {
          return undefined;
        }
      }

      if (!doc.fonts || doc.fonts.status !== 'loading') {
        cache.set(lineIndex, {
          document: doc,
          signature,
          boundaries,
        });
      }

      return boundaries;
    } finally {
      span.remove();
    }
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

    if (
      this.textAlign === 'right' ||
      this.textAlign === 'justify' ||
      this.textAlign === 'justify-right'
    ) {
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
    if (this.direction === 'rtl') {
      const selectionStart = Math.min(
        selection.selectionStart,
        selection.selectionEnd,
      );
      const selectionEnd = Math.max(
        selection.selectionStart,
        selection.selectionEnd,
      );

      if (selectionStart !== selectionEnd) {
        const start =
          this.get2DCursorLocation(selectionStart);
        const end =
          this.get2DCursorLocation(selectionEnd);

        let canUseShapedGeometry = true;

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
            this._getRtlEditingCursorX(
              lineIndex,
              startChar,
            ) === undefined ||
            this._getRtlEditingCursorX(
              lineIndex,
              endChar,
            ) === undefined
          ) {
            canUseShapedGeometry = false;
            break;
          }
        }

        if (canUseShapedGeometry) {
          let lineTop = this._getTopOffset();

          for (let i = 0; i < start.lineIndex; i++) {
            lineTop += this.getHeightOfLine(i);
          }

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

            const startX =
              this._getRtlEditingCursorX(
                lineIndex,
                startChar,
              );
            const endX =
              this._getRtlEditingCursorX(
                lineIndex,
                endChar,
              );

            let lineHeight =
              this.getHeightOfLine(lineIndex);
            const realLineHeight = lineHeight;
            let drawHeight = lineHeight;
            let extraTop = 0;

            if (
              this.lineHeight < 1 ||
              (lineIndex === end.lineIndex &&
                this.lineHeight > 1)
            ) {
              lineHeight /= this.lineHeight;
              drawHeight = lineHeight;
            }

            if (this.inCompositionMode) {
              ctx.fillStyle =
                this.compositionColor || 'black';
              drawHeight = 1;
              extraTop = lineHeight;
            } else {
              ctx.fillStyle = this.selectionColor;
            }

            ctx.fillRect(
              Math.min(startX, endX),
              lineTop + extraTop,
              Math.abs(endX - startX),
              drawHeight,
            );

            lineTop += realLineHeight;
          }

          return;
        }
      }
    }

    return originalSelection.call(
      this,
      ctx,
      selection,
      boundaries,
    );
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
      const boundaries =
        this._getRtlEditingBoundaries(lineIndex);

      if (boundaries) {
        let localIndex = 0;
        let nearestDistance =
          Number.POSITIVE_INFINITY;

        for (let i = 0; i <= charLength; i++) {
          const distance = Math.abs(
            effectiveX - boundaries[i],
          );

          if (distance < nearestDistance) {
            nearestDistance = distance;
            localIndex = i;
          }
        }

        const resolvedLocalIndex = this.flipX
          ? charLength - localIndex
          : localIndex;

        return Math.min(
          lineStart + resolvedLocalIndex,
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
      '13fefe8ffd70f5a4f64e59100c69807366b7bd14',
    applied: true,
    usesPrefixRanges: true,
    modifiesRenderer: false,
    modifiesCharBounds: false,
    modifiesDragDrop: false,
  };
})();
