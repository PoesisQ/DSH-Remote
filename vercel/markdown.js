(function (root) {
  "use strict";

  const MAX_TEXT_LENGTH = 200000;

  function normalize(value) {
    return String(value ?? "").replace(/\r\n?/g, "\n").slice(0, MAX_TEXT_LENGTH);
  }

  function splitTableRow(line) {
    return line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
  }

  function isTableDivider(line) {
    const cells = splitTableRow(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function parseBlocks(value) {
    const lines = normalize(value).split("\n");
    const blocks = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index += 1; continue; }

      const fence = line.match(/^\s*```([^`]*)$/);
      if (fence) {
        const body = [];
        index += 1;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) body.push(lines[index++]);
        if (index < lines.length) index += 1;
        blocks.push({ type: "code", language: fence[1].trim().slice(0, 32), text: body.join("\n") });
        continue;
      }

      const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
      if (heading) {
        blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
        index += 1;
        continue;
      }

      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        blocks.push({ type: "hr" });
        index += 1;
        continue;
      }

      if (index + 1 < lines.length && line.includes("|") && isTableDivider(lines[index + 1])) {
        const head = splitTableRow(line);
        const rows = [];
        index += 2;
        while (index < lines.length && lines[index].trim() && lines[index].includes("|")) rows.push(splitTableRow(lines[index++]));
        blocks.push({ type: "table", head, rows: rows.slice(0, 100) });
        continue;
      }

      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) {
        const body = [quote[1]];
        index += 1;
        while (index < lines.length) {
          const next = lines[index].match(/^\s*>\s?(.*)$/);
          if (!next) break;
          body.push(next[1]); index += 1;
        }
        blocks.push({ type: "quote", text: body.join("\n") });
        continue;
      }

      const list = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
      if (list) {
        const ordered = Boolean(list[2]);
        const items = [list[3]];
        index += 1;
        while (index < lines.length) {
          const next = lines[index].match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
          if (!next || Boolean(next[2]) !== ordered) break;
          items.push(next[3]); index += 1;
        }
        blocks.push({ type: "list", ordered, items: items.slice(0, 200) });
        continue;
      }

      const paragraph = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim()) {
        const next = lines[index];
        if (/^\s*```/.test(next) || /^\s*#{1,4}\s+/.test(next) || /^\s*>/.test(next) || /^\s*(?:[-+*]|\d+\.)\s+/.test(next)) break;
        if (index + 1 < lines.length && next.includes("|") && isTableDivider(lines[index + 1])) break;
        paragraph.push(next.trim()); index += 1;
      }
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    }
    return blocks;
  }

  function appendInline(parent, value, doc) {
    const text = String(value ?? "");
    const pattern = /(`+)([^`]+?)\1|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(\*\*|__)(.+?)\5|~~(.+?)~~|(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)/g;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > cursor) parent.appendChild(doc.createTextNode(text.slice(cursor, match.index)));
      let node;
      if (match[1]) {
        node = doc.createElement("code"); node.textContent = match[2];
      } else if (match[3]) {
        node = doc.createElement("a"); node.textContent = match[3]; node.href = match[4]; node.target = "_blank"; node.rel = "noopener noreferrer";
      } else if (match[5]) {
        node = doc.createElement("strong"); appendInline(node, match[6], doc);
      } else if (match[7]) {
        node = doc.createElement("del"); appendInline(node, match[7], doc);
      } else {
        node = doc.createElement("em"); appendInline(node, match[8] ?? match[9], doc);
      }
      parent.appendChild(node);
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) parent.appendChild(doc.createTextNode(text.slice(cursor)));
  }

  function renderInto(container, value) {
    const doc = container.ownerDocument || document;
    const fragment = doc.createDocumentFragment();
    for (const block of parseBlocks(value)) {
      let node;
      if (block.type === "heading") {
        node = doc.createElement(`h${block.level}`); appendInline(node, block.text, doc);
      } else if (block.type === "paragraph") {
        node = doc.createElement("p");
        block.text.split("\n").forEach((line, i) => { if (i) node.appendChild(doc.createElement("br")); appendInline(node, line, doc); });
      } else if (block.type === "quote") {
        node = doc.createElement("blockquote"); appendInline(node, block.text, doc);
      } else if (block.type === "list") {
        node = doc.createElement(block.ordered ? "ol" : "ul");
        for (const item of block.items) { const li = doc.createElement("li"); appendInline(li, item, doc); node.appendChild(li); }
      } else if (block.type === "hr") {
        node = doc.createElement("hr");
      } else if (block.type === "code") {
        node = doc.createElement("div"); node.className = "code-block";
        const bar = doc.createElement("div"); bar.className = "code-bar";
        const language = doc.createElement("span"); language.textContent = block.language || "代码";
        const copy = doc.createElement("button"); copy.type = "button"; copy.className = "copy-code"; copy.textContent = "复制";
        const pre = doc.createElement("pre"); const code = doc.createElement("code"); code.textContent = block.text; pre.appendChild(code);
        copy.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(block.text); copy.textContent = "已复制"; }
          catch { copy.textContent = "复制失败"; }
          setTimeout(() => { copy.textContent = "复制"; }, 1400);
        });
        bar.append(language, copy); node.append(bar, pre);
      } else if (block.type === "table") {
        node = doc.createElement("div"); node.className = "table-scroll";
        const table = doc.createElement("table"), thead = doc.createElement("thead"), tr = doc.createElement("tr");
        for (const cell of block.head) { const th = doc.createElement("th"); appendInline(th, cell, doc); tr.appendChild(th); }
        thead.appendChild(tr); table.appendChild(thead);
        const tbody = doc.createElement("tbody");
        for (const row of block.rows) { const rowNode = doc.createElement("tr"); for (let i = 0; i < block.head.length; i += 1) { const td = doc.createElement("td"); appendInline(td, row[i] || "", doc); rowNode.appendChild(td); } tbody.appendChild(rowNode); }
        table.appendChild(tbody); node.appendChild(table);
      }
      if (node) fragment.appendChild(node);
    }
    container.replaceChildren(fragment);
  }

  root.DSHMarkdown = Object.freeze({ parseBlocks, renderInto, MAX_TEXT_LENGTH });
})(typeof window === "undefined" ? globalThis : window);
