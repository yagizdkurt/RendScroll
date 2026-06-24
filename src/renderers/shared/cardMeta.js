/* Shared helpers for simple "Label: value" card metadata paragraphs. */

function parseMetaLines(node, nonMetaLabels) {
  if (node.tagName !== "P") return [];

  const lines = node.textContent.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const meta = [];
  for (const line of lines) {
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (!m) return [];

    const label = m[1].trim();
    const value = m[2].trim();
    if (nonMetaLabels.has(rsLower(label))) return [];
    meta.push({ label, value });
  }

  return meta;
}

function extractImageMeta(rows) {
  const kept = [];
  let value = "";
  rows.forEach((row) => {
    if (/^image$/i.test(row.label.trim())) {
      if (row.value.trim()) value = row.value.trim();
    } else {
      kept.push(row);
    }
  });
  return { value, rows: kept };
}

function extractSideMeta(rows) {
  const kept = [];
  let value = "";
  rows.forEach((row) => {
    if (/^side$/i.test(row.label.trim())) {
      value = row.value;
    } else {
      kept.push(row);
    }
  });
  return { value, rows: kept };
}

function extractStuckMeta(rows, stuckLabels, truthyValues) {
  const kept = [];
  let stuck = false;
  rows.forEach((row) => {
    if (stuckLabels.has(rsLower(row.label.trim()))) {
      if (truthyValues.has(rsLower(row.value.trim()))) stuck = true;
    } else {
      kept.push(row);
    }
  });
  return { stuck, rows: kept };
}
