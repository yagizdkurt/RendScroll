/* BBCode-style inline formatting for RendScroll markdown.
   Kept deliberately small: tags are registered here, and marked.js handles the
   normal Markdown parsing inside valid tag bodies. */

const RendScrollInlineFormatting = (() => {
  const TAGS = {
    size: {
      requiresValue: true,
      validate(value) {
        return /^\d+(?:\.\d+)?$/.test(value) && Number(value) >= 8 && Number(value) <= 32;
      },
      render(token, parser) {
        const px = Number(token.value);
        return '<span class="rs-inline-size" style="font-size:' + px + 'px">' +
          parser.parseInline(token.tokens) +
          "</span>";
      },
    },
  };

  function tagFor(name) {
    return TAGS[String(name || "").toLowerCase()] || null;
  }

  function findClosingTag(src, tagName, startAt) {
    const tagPattern = /\[(\/?)([a-z][a-z0-9-]*)(?:=[^\]\r\n]+)?\]/ig;
    tagPattern.lastIndex = startAt;
    let depth = 1;
    let match;
    while ((match = tagPattern.exec(src))) {
      const closing = match[1] === "/";
      const name = match[2].toLowerCase();
      if (name !== tagName) continue;
      if (closing) depth--;
      else depth++;
      if (depth === 0) {
        return { start: match.index, end: tagPattern.lastIndex };
      }
    }
    return null;
  }

  function extension() {
    return {
      extensions: [{
        name: "rsInlineFormatting",
        level: "inline",
        start(src) {
          const i = src.indexOf("[");
          return i < 0 ? undefined : i;
        },
        tokenizer(src) {
          const open = src.match(/^\[([a-z][a-z0-9-]*)(?:=([^\]\r\n]+))?\]/i);
          if (!open) return false;

          const name = open[1].toLowerCase();
          const tag = tagFor(name);
          if (!tag) return false;

          const value = open[2] != null ? open[2].trim() : "";
          if (tag.requiresValue && !value) return false;
          if (value && !tag.validate(value)) return false;

          const close = findClosingTag(src, name, open[0].length);
          if (!close) return false;

          const text = src.slice(open[0].length, close.start);
          return {
            type: "rsInlineFormatting",
            raw: src.slice(0, close.end),
            tag: name,
            value,
            text,
            tokens: this.lexer.inlineTokens(text),
          };
        },
        renderer(token) {
          const tag = tagFor(token.tag);
          return tag ? tag.render(token, this.parser) : token.raw;
        },
        childTokens: ["tokens"],
      }],
    };
  }

  return { TAGS, extension };
})();

if (typeof module !== "undefined" && module.exports) module.exports = RendScrollInlineFormatting;
