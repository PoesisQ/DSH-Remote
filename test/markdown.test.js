import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../phone/markdown.js", import.meta.url), "utf8");
const sandbox = {};
new Function("window", source)(sandbox);
const { parseBlocks, MAX_TEXT_LENGTH } = sandbox.DSHMarkdown;

test("safe Markdown parser recognizes the supported block structure", () => {
  const blocks = parseBlocks(`# 标题\n\n- 一\n- 二\n\n> 引用\n\n| 名称 | 状态 |\n| --- | --- |\n| DSH | **正常** |\n\n\`\`\`js\nconst ok = true;\n\`\`\``);
  assert.deepEqual(blocks.map((block) => block.type), ["heading", "list", "quote", "table", "code"]);
  assert.equal(blocks[1].items.length, 2);
  assert.equal(blocks[3].rows[0][0], "DSH");
  assert.equal(blocks[4].language, "js");
});

test("Markdown parser treats raw HTML as inert paragraph text", () => {
  const blocks = parseBlocks(`<img src=x onerror=alert(1)>\n<script>alert(1)</script>`);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "paragraph");
  assert.match(blocks[0].text, /<script>/);
});

test("Markdown input is capped before parsing", () => {
  const blocks = parseBlocks("x".repeat(MAX_TEXT_LENGTH + 1000));
  assert.equal(blocks[0].text.length, MAX_TEXT_LENGTH);
});
