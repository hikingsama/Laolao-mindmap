/* Markdown source is the data; rendered HTML is a disposable view. */
(function (root) {
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const md = root.markdownit({ html: false, breaks: true, linkify: true, typographer: false });
  function math(tex, display) {
    try {
      return root.katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 20 });
    } catch (e) {
      return `<code class="mm-math-error" title="${escape(e.message)}">${escape(tex)}</code>`;
    }
  }
  md.inline.ruler.before('escape', 'node_math', (state, silent) => {
    const pos = state.pos, src = state.src;
    const open = src.startsWith('$$', pos) ? '$$' : src.startsWith('\\(', pos) ? '\\(' : src[pos] === '$' ? '$' : null;
    if (!open) return false;
    const close = open === '\\(' ? '\\)' : open;
    if (open === '$' && /\s|\$/.test(src[pos + 1] || ' ')) return false;
    let end = pos + open.length;
    while ((end = src.indexOf(close, end)) >= 0) {
      let slashes = 0; for (let i = end - 1; i >= 0 && src[i] === '\\'; i--) slashes++;
      if (!(slashes % 2) && (open !== '$' || (!/\s/.test(src[end - 1]) && !/\d/.test(src[end + 1] || '')))) break;
      end += close.length;
    }
    if (end < 0 || (open === '$' && src.slice(pos + 1, end).includes('\n'))) return false;
    if (!silent) { const token = state.push('node_math', '', 0); token.content = src.slice(pos + open.length, end); token.meta = { display: open === '$$' }; }
    state.pos = end + close.length; return true;
  });
  md.block.ruler.before('fence', 'node_math_block', (state, start, end, silent) => {
    const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const open = line.startsWith('$$') ? '$$' : line.startsWith('\\[') ? '\\[' : null;
    if (!open) return false;
    const close = open === '$$' ? '$$' : '\\]';
    const parts = []; let rest = line.slice(open.length), last = start, closed = false;
    for (; last < end; last++) {
      const at = rest.indexOf(close);
      if (at >= 0) { if (rest.slice(at + close.length).trim()) return false; parts.push(rest.slice(0, at)); closed = true; break; }
      parts.push(rest);
      if (last + 1 < end) rest = state.src.slice(state.bMarks[last + 1] + state.tShift[last + 1], state.eMarks[last + 1]);
    }
    if (!closed) return false;
    if (silent) return true;
    const token = state.push('node_math_block', '', 0); token.block = true; token.content = parts.join('\n').trim(); token.map = [start, last + 1];
    state.line = last + 1; return true;
  }, { alt: ['paragraph', 'blockquote', 'list'] });
  md.renderer.rules.node_math = (tokens, i) => `<span class="mm-math${tokens[i].meta.display ? ' mm-math-block' : ''}">${math(tokens[i].content, tokens[i].meta.display)}</span>`;
  md.renderer.rules.node_math_block = (tokens, i) => `<div class="mm-math mm-math-block">${math(tokens[i].content, true)}</div>\n`;
  md.renderer.rules.image = (tokens, i) => `<span class="mm-image-alt">🖼 ${escape(tokens[i].content || '图片')}</span>`;
  const originalLink = md.renderer.rules.link_open || ((tokens, i, opts, env, self) => self.renderToken(tokens, i, opts));
  md.renderer.rules.link_open = (tokens, i, opts, env, self) => {
    tokens[i].attrSet('target', '_blank'); tokens[i].attrSet('rel', 'noopener noreferrer'); return originalLink(tokens, i, opts, env, self);
  };
  md.core.ruler.after('inline', 'node_tasks', state => {
    for (const token of state.tokens) if (token.type === 'inline' && token.children && token.children[0]?.type === 'text') {
      const first = token.children[0], match = /^\[([ xX])\]\s+/.exec(first.content);
      if (!match) continue;
      first.content = first.content.slice(match[0].length);
      const checkbox = new state.Token('html_inline', '', 0); checkbox.content = `<span class="mm-task">${match[1] === ' ' ? '☐' : '☑'}</span> `;
      token.children.unshift(checkbox);
    }
  });
  const cache = new Map();
  function render(source) {
    source = String(source || '');
    if (cache.has(source)) return cache.get(source);
    const html = md.render(source);
    if (cache.size >= 300) cache.delete(cache.keys().next().value);
    cache.set(source, html); return html;
  }
  const isRich = text => /[$\\`*_[\]#>|~]|^\s*[-+\d]+[.)]?\s|\n|https?:\/\//m.test(text || '');
  let probe;
  const measurements = new Map();
  function measure(source, font, width) {
    const key = JSON.stringify([source, font, width]); if (measurements.has(key)) return measurements.get(key);
    if (!probe) { probe = document.createElement('div'); probe.className = 'mm-rich mm-content-measure'; document.body.appendChild(probe); }
    probe.style.cssText = `position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;width:${width}px;font:${font};line-height:1.5;`;
    probe.innerHTML = render(source);
    const result = { w: width, h: Math.ceil(probe.getBoundingClientRect().height) };
    if (measurements.size >= 300) measurements.clear(); measurements.set(key, result); return result;
  }
  // Deliberately manual: only Tab expands known snippets inside a math delimiter.
  function inMath(source, position) {
    const before = source.slice(0, position);
    // Code spans/fences and escaped delimiters are never mathematical contexts.
    const prefix = before.replace(/```[\s\S]*?```|`[^`\n]*`|\\\$/g, '');
    if ((prefix.match(/```/g) || []).length % 2 || (prefix.match(/`/g) || []).length % 2) return false;
    let open = null;
    for (const match of prefix.matchAll(/\$\$|\$|\\\(|\\\)|\\\[|\\\]/g)) {
      if (match[0] === '\\)' || match[0] === '\\]') open = null;
      else if (open === match[0]) open = null; else if (!open) open = match[0];
    }
    return !!open;
  }
  function expand(ta) {
    return root.MMCompletion.expand(ta,inMath);
  }
  root.MMContent = { render, measure, isRich, expand, inMath, escape, snippetHelp:root.MMCompletion.definitions,
    handleTab:(ta,backward)=>root.MMCompletion.handleTab(ta,backward,inMath),completionStatus:root.MMCompletion.status,clearMeasurements: () => measurements.clear() };
  if (document.fonts) document.fonts.addEventListener('loadingdone', () => measurements.clear());
})(window);
