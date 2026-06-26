/* RendScroll parser diagnostics.
   Pure diagnostics and summaries for debug tooling. Browser diagnostics are
   scene-local/campaign-local authoring hints; launch-blocking filesystem
   preflight remains in src/lint.py. */

const RendScrollDiagnostics = (() => {
  const DIRECTIVE_NAMES = new Set(["side", "image", "bg", "closed", "yapışık", "connect", "combine"]);

  function parser() {
    return typeof RendScrollParser !== "undefined" ? RendScrollParser : null;
  }

  function skillRules() {
    return typeof RendScrollSkillChecks !== "undefined" ? RendScrollSkillChecks : null;
  }

  function dispLine(range) {
    return range ? range.startLine + 1 : "?";
  }

  function allCards(doc) {
    if (!doc || !Array.isArray(doc.sections)) return [];
    return doc.sections.flatMap((s) => s.blocks.filter((b) => b.kind === "card"));
  }

  function issue(level, file, line, message, code) {
    return { level, file, line, message, code };
  }

  function parseScene(source, file) {
    const p = parser();
    if (!p) return { file, source, doc: null, error: "RendScrollParser unavailable" };
    try {
      return { file, source, doc: p.parseRendScroll(source || ""), error: null };
    } catch (err) {
      return { file, source, doc: null, error: err && err.message ? err.message : String(err) };
    }
  }

  function keywordLower(text) {
    return String(text || "").replace(/İ/g, "i").replace(/I/g, "i").toLowerCase();
  }

  function directiveLine(raw) {
    const t = String(raw || "").trim();
    if (!t) return null;

    const withColon = t.match(/^([^:]+):\s*(.*)$/);
    if (withColon) {
      const name = keywordLower(withColon[1].trim());
      if (!DIRECTIVE_NAMES.has(name)) return null;
      return {
        name,
        value: withColon[2].trim(),
        malformed: withColon[2].trim() === "",
        reason: "directive missing value",
        raw: t,
      };
    }

    const first = keywordLower(t.split(/\s+/)[0] || "");
    if (DIRECTIVE_NAMES.has(first)) {
      return { name: first, value: "", malformed: true, reason: "directive missing colon", raw: t };
    }
    return null;
  }

  function addMalformedDirectiveDiagnostics(doc, file, issues) {
    const seenMalformed = new Set();

    allCards(doc).forEach((card) => {
      card.unknown.forEach((u) => {
        const line = dispLine(u.range);
        const raw = (u.lines && u.lines[0] ? u.lines[0] : "").trim();
        seenMalformed.add(`${line}:${raw}`);
        const d = directiveLine(raw);
        if (d && (d.name === "image" || d.name === "bg") && d.reason === "directive missing value") {
          issues.push(issue("error", file, line, "empty image path", "empty-asset-path"));
        } else {
          issues.push(issue("warn", file, line, "malformed directive: " + raw, "malformed-directive"));
        }
      });

      for (let i = card.range.startLine + 1; i < card.range.endLine; i++) {
        const raw = RendScrollParser.lineText(doc.lines[i]);
        const d = directiveLine(raw);
        if (!d || !d.malformed) continue;
        const line = i + 1;
        if (seenMalformed.has(`${line}:${raw.trim()}`)) continue;
        if (d.name === "image" || d.name === "bg") {
          issues.push(issue("error", file, line, "empty image path", "empty-asset-path"));
        } else {
          issues.push(issue("warn", file, line, "malformed directive: " + raw.trim(), "malformed-directive"));
        }
      }
    });
  }

  function addDuplicateDirectiveDiagnostics(doc, file, issues) {
    allCards(doc).forEach((card) => {
      const seen = {};
      card.directives.forEach((d) => {
        seen[d.name] = (seen[d.name] || 0) + 1;
      });
      Object.keys(seen).forEach((name) => {
        if (seen[name] <= 1) return;
        const d = card.directives.find((x) => x.name === name);
        issues.push(issue(
          "warn",
          file,
          dispLine(d.range),
          `duplicate directive: ${name} (x${seen[name]})`,
          "duplicate-directive"
        ));
      });
    });
  }

  function addDockingDiagnostics(doc, file, issues) {
    const p = parser();
    doc.sections.forEach((section) => {
      let prevCard = null;
      section.blocks.forEach((block) => {
        if (block.kind !== "card") return;
        if (block.stuck && !(prevCard && p && p.canDock(block, prevCard))) {
          issues.push(issue(
            "warn",
            file,
            dispLine(block.titleRange),
            `"${block.title}" can't dock - no valid host above`,
            "invalid-docking"
          ));
        }
        prevCard = block;
      });
    });
  }

  function addUnknownHeadingDiagnostics(doc, file, issues) {
    const p = parser();
    if (!p) return;

    doc.lines.forEach((rawLine, idx) => {
      const text = p.lineText(rawLine);
      const hm = text.match(p.regexes.HEADING_RE);
      if (!hm || hm[1].length !== 3) return;
      const content = hm[2].trim();
      if (!content.includes(":")) return;
      const normalized = content.replace(/^_\s*/, "");
      if (p.cardType(3, normalized)) return;
      issues.push(issue("warn", file, idx + 1, `unknown section type "### ${content}"`, "unknown-card-heading"));
    });
  }

  function addCheckDiagnostics(doc, file, issues) {
    const rules = skillRules();
    if (!rules) return;

    allCards(doc).forEach((card) => {
      card.checkGroups.forEach((group) => {
        const start = group.range ? group.range.startLine : card.range.startLine;
        const end = group.range ? group.range.endLine : card.range.endLine;
        let current = null;
        let prevDc = null;

        for (let i = start; i < end; i++) {
          const raw = RendScrollParser.lineText(doc.lines[i]);
          const item = raw.trim().match(/^[-*]\s+(.+)$/);
          if (item) {
            current = item[1].trim().replace(/:\s*$/, "");
            prevDc = null;
            if (current && !rules.isStandardCheck(current)) {
              issues.push(issue(
                "warn",
                file,
                i + 1,
                `non-standard check: ${current}`,
                "non-standard-check"
              ));
            }
            continue;
          }

          if (!current || rules.isNoDcCheck(current)) continue;
          const dc = raw.trim().match(/^>\s*(\d+):/);
          if (!dc) continue;
          const value = parseInt(dc[1], 10);
          if (prevDc !== null && value < prevDc) {
            issues.push(issue(
              "warn",
              file,
              i + 1,
              `"${current}": DC out of order (${prevDc} -> ${value})`,
              "dc-order"
            ));
          }
          prevDc = value;
        }
      });
    });
  }

  function computeSceneDiagnostics(doc, options) {
    const file = (options && options.file) || "(none)";
    const issues = [];
    if (!doc) return issues;

    const hasH1 = !!doc.title || doc.sections.some((s) => s.level === 1);
    if (!hasH1) issues.push(issue("warn", file, 1, "no '# title'", "missing-title"));

    addMalformedDirectiveDiagnostics(doc, file, issues);
    addDuplicateDirectiveDiagnostics(doc, file, issues);
    addDockingDiagnostics(doc, file, issues);
    addCheckDiagnostics(doc, file, issues);
    addUnknownHeadingDiagnostics(doc, file, issues);

    return issues.sort((a, b) => {
      if (a.file !== b.file) return String(a.file).localeCompare(String(b.file));
      return Number(a.line || 0) - Number(b.line || 0);
    });
  }

  async function computeCampaignDiagnostics(entries, fetcher) {
    const load = fetcher || (typeof fetchMarkdown === "function" ? fetchMarkdown : null);
    const results = [];
    const issues = [];
    if (!Array.isArray(entries) || !entries.length) return { files: [], issues, errors: 0, warnings: 0 };
    if (!load) {
      return {
        files: entries,
        issues: [issue("warn", "(campaign)", 1, "campaign diagnostics unavailable: no markdown fetcher", "campaign-unavailable")],
        errors: 0,
        warnings: 1,
      };
    }

    for (const entry of entries) {
      const file = entry.path || entry.file || String(entry);
      try {
        const source = entry.source != null ? entry.source : await load(file);
        const parsed = parseScene(source, file);
        results.push(parsed);
        if (parsed.error) {
          issues.push(issue("error", file, 1, "parse error: " + parsed.error, "parse-error"));
        } else {
          issues.push(...computeSceneDiagnostics(parsed.doc, { file }));
        }
      } catch (err) {
        issues.push(issue(
          "warn",
          file,
          1,
          "failed to load campaign diagnostics: " + (err && err.message ? err.message : String(err)),
          "campaign-load-failed"
        ));
      }
    }

    return {
      files: results,
      issues,
      errors: issues.filter((i) => i.level === "error").length,
      warnings: issues.filter((i) => i.level === "warn").length,
    };
  }

  function collectAssetRefs(doc) {
    const refs = [];
    allCards(doc).forEach((card) => {
      card.directives.forEach((d) => {
        if (d.name === "image" || d.name === "bg") {
          refs.push({ name: d.name, value: d.value, line: dispLine(d.range), card: card.title });
        }
      });
    });
    return refs;
  }

  function summarizeRenderInfo(doc, options) {
    const cards = allCards(doc);
    const byType = {};
    cards.forEach((c) => (byType[c.type] = (byType[c.type] || 0) + 1));
    const right = cards.filter((c) => c.column === "right").length;
    const docked = cards.filter((c) => c.stuck).length;
    const blocks = doc.sections.flatMap((s) => s.blocks);
    const narrative = blocks.filter((b) => b.kind === "narrative").length;
    const plain = blocks.filter((b) => b.kind === "plain").length;

    return [
      ["Path", (options && options.file) || "(none)"],
      ["Title", doc.title || "(none)"],
      ["EOL", doc.eol === "\r\n" ? "CRLF" : "LF"],
      ["Sections", String(doc.sections.length) +
        ` (header ${doc.sections.filter((s) => s.kind === "header").length}, ` +
        `event ${doc.sections.filter((s) => s.kind === "event").length})`],
      ["Cards", String(cards.length)],
      ["By type", Object.keys(byType).sort().map((t) => `${t}:${byType[t]}`).join("  ") || "-"],
      ["Columns", `left ${cards.length - right} · right ${right}`],
      ["Docked", String(docked)],
      ["Narrative blocks", String(narrative)],
      ["Plain blocks", String(plain)],
    ];
  }

  return {
    parseScene,
    computeSceneDiagnostics,
    computeCampaignDiagnostics,
    collectAssetRefs,
    summarizeRenderInfo,
    allCards,
    dispLine,
  };
})();

if (typeof window !== "undefined") window.RendScrollDiagnostics = RendScrollDiagnostics;
if (typeof module !== "undefined" && module.exports) module.exports = RendScrollDiagnostics;
