(() => {
  const fabric = window.fabric;
  if (!fabric?.IText) {
    throw new Error(
      'Fabric.js must be loaded before rtl-contextual-geometry-patch.js',
    );
  }

  const proto = fabric.IText.prototype;
  const geometryCache = new WeakMap();

  const getCache = (target) => {
    let cache = geometryCache.get(target);
    if (!cache) {
      cache = new Map();
      geometryCache.set(target, cache);
    }
    return cache;
  };

  proto._getRtlCursorOffsets = function (lineIndex) {
    if (
      this.direction !== 'rtl' ||
      this.path ||
      this.charSpacing !== 0 ||
      this.textAlign.includes('justify') ||
      !this.isEmptyStyles(lineIndex)
    ) {
      return undefined;
    }

    const line = this._textLines[lineIndex];
    if (!line?.length) {
      return [0];
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
    const font = this._getFontDeclaration(
      this.getCompleteStyleDeclaration(lineIndex, 0),
    );
    const cache = getCache(this);
    const cached = cache.get(lineIndex);
    if (
      cached &&
      cached.document === doc &&
      cached.text === text &&
      cached.font === font
    ) {
      return cached.offsets;
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
          return undefined;
        }
        offsets[i] = Math.max(0, Math.min(lineRect.width, offset));
      }

      for (let i = 1; i < offsets.length; i++) {
        if (offsets[i] + 0.5 < offsets[i - 1]) {
          return undefined;
        }
        offsets[i] = Math.max(offsets[i], offsets[i - 1]);
      }

      if (!doc.fonts || doc.fonts.status !== 'loading') {
        cache.set(lineIndex, { document: doc, text, font, offsets });
      }

      return offsets;
    } finally {
      span.remove();
    }
  };

  const originalClearCache = proto._clearCache;
  proto._clearCache = function (...args) {
    geometryCache.get(this)?.clear();
    return originalClearCache.apply(this, args);
  };

  const originalCursorOffsets = proto.__getCursorBoundariesOffsets;
  proto.__getCursorBoundariesOffsets = function (index) {
    let topOffset = 0;
    let leftOffset = 0;
    const { charIndex, lineIndex } = this.get2DCursorLocation(index);
    const { textAlign, direction } = this;

    for (let i = 0; i < lineIndex; i++) {
      topOffset += this.getHeightOfLine(i);
    }

    const lineLeftOffset = this._getLineLeftOffset(lineIndex);
    const rtlOffsets =
      direction === 'rtl' ? this._getRtlCursorOffsets(lineIndex) : undefined;

    if (!rtlOffsets) {
      return originalCursorOffsets.call(this, index);
    }

    leftOffset = rtlOffsets[charIndex] ?? 0;
    let left = lineLeftOffset + (leftOffset > 0 ? leftOffset : 0);

    if (
      textAlign === 'right' ||
      textAlign === 'justify' ||
      textAlign === 'justify-right'
    ) {
      left *= -1;
    } else if (
      textAlign === 'left' ||
      textAlign === 'justify-left' ||
      textAlign === 'center' ||
      textAlign === 'justify-center'
    ) {
      left = lineLeftOffset - (leftOffset > 0 ? leftOffset : 0);
    }

    return { top: topOffset, left };
  };

  const originalSelection = proto._renderSelection;
  proto._renderSelection = function (ctx, selection, boundaries) {
    if (this.direction !== 'rtl') {
      return originalSelection.call(this, ctx, selection, boundaries);
    }

    const { textAlign, direction } = this;
    const selectionStart = selection.selectionStart;
    const selectionEnd = selection.selectionEnd;
    const isJustify = textAlign.includes('justify');
    const start = this.get2DCursorLocation(selectionStart);
    const end = this.get2DCursorLocation(selectionEnd);
    const startLine = start.lineIndex;
    const endLine = end.lineIndex;
    const startChar = start.charIndex < 0 ? 0 : start.charIndex;
    const endChar = end.charIndex < 0 ? 0 : end.charIndex;

    for (let i = startLine; i <= endLine; i++) {
      const lineOffset = this._getLineLeftOffset(i) || 0;
      const rtlOffsets = this._getRtlCursorOffsets(i);

      if (!rtlOffsets) {
        return originalSelection.call(this, ctx, selection, boundaries);
      }

      let lineHeight = this.getHeightOfLine(i);
      let boxStart = 0;
      let boxEnd = 0;

      if (i === startLine) {
        boxStart = rtlOffsets[startChar] ?? 0;
      }
      if (i >= startLine && i < endLine) {
        boxEnd =
          isJustify && !this.isEndOfWrapping(i)
            ? this.width
            : (rtlOffsets[this._textLines[i].length] ??
              (this.getLineWidth(i) || 5));
      } else if (i === endLine) {
        boxEnd = rtlOffsets[endChar] ?? 0;
      }

      const realLineHeight = lineHeight;
      if (this.lineHeight < 1 || (i === endLine && this.lineHeight > 1)) {
        lineHeight /= this.lineHeight;
      }

      let drawStart = boundaries.left + lineOffset + boxStart;
      let drawHeight = lineHeight;
      let extraTop = 0;
      const drawWidth = boxEnd - boxStart;

      if (this.inCompositionMode) {
        ctx.fillStyle = this.compositionColor || 'black';
        drawHeight = 1;
        extraTop = lineHeight;
      } else {
        ctx.fillStyle = this.selectionColor;
      }

      if (direction === 'rtl') {
        if (
          textAlign === 'right' ||
          textAlign === 'justify' ||
          textAlign === 'justify-right'
        ) {
          drawStart = this.width - drawStart - drawWidth;
        } else if (
          textAlign === 'left' ||
          textAlign === 'justify-left' ||
          textAlign === 'center' ||
          textAlign === 'justify-center'
        ) {
          drawStart = boundaries.left + lineOffset - boxEnd;
        }
      }

      ctx.fillRect(
        drawStart,
        boundaries.top + boundaries.topOffset + extraTop,
        drawWidth,
        drawHeight,
      );
      boundaries.topOffset += realLineHeight;
    }
  };

  proto.getSelectionStartFromPointer = function (e) {
    const mouseOffset = this.canvas
      .getScenePoint(e)
      .transform(fabric.util.invertTransform(this.calcTransformMatrix()))
      .add(new fabric.Point(-this._getLeftOffset(), -this._getTopOffset()));

    let height = 0;
    let charIndex = 0;
    let lineIndex = 0;

    for (let i = 0; i < this._textLines.length; i++) {
      if (height <= mouseOffset.y) {
        height += this.getHeightOfLine(i);
        lineIndex = i;
        if (i > 0) {
          charIndex +=
            this._textLines[i - 1].length +
            this.missingNewlineOffset(i - 1);
        }
      } else {
        break;
      }
    }

    const charLength = this._textLines[lineIndex].length;
    const lineLeftOffset = this._getLineLeftOffset(lineIndex);
    const chars = this.__charBounds[lineIndex];
    const isRtl = this.direction === 'rtl';
    const effectiveX = isRtl ? lineLeftOffset - mouseOffset.x : mouseOffset.x;
    const rtlOffsets = isRtl
      ? this._getRtlCursorOffsets(lineIndex)
      : undefined;

    let width = rtlOffsets?.[0] ?? (isRtl ? 0 : Math.abs(lineLeftOffset));

    for (let j = 0; j < charLength; j++) {
      const widthAfter = rtlOffsets
        ? rtlOffsets[j + 1]
        : width + chars[j].kernedWidth;

      if (effectiveX <= widthAfter) {
        if (
          Math.abs(effectiveX - widthAfter) <=
          Math.abs(effectiveX - width)
        ) {
          charIndex++;
        }
        break;
      }

      width = widthAfter;
      charIndex++;
    }

    return Math.min(
      this.flipX ? charLength - charIndex : charIndex,
      this._text.length,
    );
  };


  // Preserve sparse styles when a selection is moved inside the same IText.
  // Fabric's drag payload intentionally stores complete styles for cross-object
  // drops, but reusing those complete declarations on the same object turns
  // defaults into per-character styles and breaks contextual shaping.
  const probe = new fabric.IText('');
  const dragDelegateProto = Object.getPrototypeOf(probe.draggableTextDelegate);
  probe.dispose();

  const originalDropHandler = dragDelegateProto.dropHandler;
  dragDelegateProto.dropHandler = function (ev) {
    const selection = this.__dragStartSelection;
    if (!selection) {
      return originalDropHandler.call(this, ev);
    }

    const target = this.target;
    const sparseStyles = target
      .getSelectionStyles(selection.selectionStart, selection.selectionEnd)
      .map((style) => ({ ...style }));
    const originalInsertChars = target.insertChars;

    target.insertChars = function (text, _styles, start, end) {
      return originalInsertChars.call(this, text, sparseStyles, start, end);
    };

    try {
      return originalDropHandler.call(this, ev);
    } finally {
      target.insertChars = originalInsertChars;
    }
  };


  window.__fabricRtlContextualGeometryPatch = {
    commit: 'f5e6a2ce15e40aea9ccca4526589cf06d15cbb4c',
    applied: true,
    preservesSparseStylesOnInternalDrop: true,
  };
})();
