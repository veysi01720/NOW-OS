#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const srcRoot = join(root, "src");
const outputPath = join(root, "outputs", "CODE_HYGIENE_REPORT.md");

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });
}

const files = walk(srcRoot);
const source = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
const sourceText = [...source.values()].join("\n");
const rel = (file) => relative(root, file).replaceAll("\\", "/");
const isTest = (file) => /(?:^|[\\/])tests?[\\/]|\.test\./.test(file);

const imported = new Set();
for (const [file, text] of source) {
  for (const match of text.matchAll(/(?:from|import\s*\(|require\s*\()\s*["'](\.?\.?\/[^"']+)["']/g)) {
    const raw = match[1];
    const base = resolve(dirname(file), raw.replace(/\.(?:js|mjs|cjs|jsx|tsx)$/, ""));
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}.cjs`, join(base, "index.ts")]) {
      if (source.has(candidate)) imported.add(candidate);
    }
  }
}

const entryLike = files.filter((file) => /(?:server|workspace_preflight|index)\.(?:ts|js|mjs)$/.test(file));
const deadFiles = files.filter((file) => !isTest(file) && !imported.has(file) && !entryLike.includes(file));

const functionCandidates = [];
for (const [file, text] of source) {
  if (isTest(file)) continue;
  for (const match of text.matchAll(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g)) {
    const name = match[1] ?? match[2];
    const occurrences = (sourceText.match(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")) ?? []).length;
    if (occurrences <= 1 && !/^main$/.test(name)) functionCandidates.push({ file, name });
  }
}

const guardFiles = files.filter((file) => /(?:guard|validator|fallback|safety|repeat|repair)/i.test(file));
const guardNames = [];
for (const file of guardFiles) {
  const text = source.get(file);
  for (const match of text.matchAll(/(?:function|const)\s+([A-Za-z_$][\w$]*(?:Guard|Validator|Fallback|Safety|Repeat|Repair)[A-Za-z_$\d]*)/g)) {
    guardNames.push(`${rel(file)}:${match[1]}`);
  }
}

const unreachable = [];
for (const [file, text] of source) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/^\s*(?:return|throw)\b/.test(line) && /^\s*\S/.test(lines[index + 1] ?? "") && !/^\s*[}\]);,]/.test(lines[index + 1])) {
      unreachable.push(`${rel(file)}:${index + 1}`);
    }
  });
}

const untested = [];
for (const [file, text] of source) {
  if (isTest(file)) continue;
  for (const match of text.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
    const name = match[1];
    if (!files.filter(isTest).some((test) => source.get(test).includes(name))) untested.push(`${rel(file)}:${name}`);
  }
}

const markers = [];
for (const [file, text] of source) {
  text.split(/\r?\n/).forEach((line, index) => {
    if (/\b(?:TODO|FIXME|TEMP|HACK)\b/i.test(line)) markers.push(`${rel(file)}:${index + 1}: ${line.trim()}`);
  });
}

function bullets(items, empty = "- None detected.") {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : empty;
}

mkdirSync(join(root, "outputs"), { recursive: true });
const report = `# Code Hygiene Report\n\nGenerated: ${new Date().toISOString()}\n\nThis is a heuristic review aid. It does not delete code and every finding requires owner review before removal.\n\n## Dead or Unreferenced Candidates\n\n${bullets(deadFiles.map(rel))}\n\nWhy suspicious: no static import/reference from another source file.\nBefore removal: check dynamic imports, compose entrypoints, scripts, reflection, and deployment packaging.\n\n## Low-Reference Functions\n\n${bullets(functionCandidates.map(({ file, name }) => `${rel(file)}:${name}`))}\n\nWhy suspicious: declaration was found without another static source reference.\nBefore removal: check public exports, runtime dependency injection, tests, and string-based dispatch.\n\n## Overlapping Guard/Validator Surface\n\n${bullets(guardNames)}\n\nWhy suspicious: multiple guard/fallback/validator-like components exist and may enforce adjacent contracts.\nBefore removal: compare reason-code ownership, ordering, fail-closed behavior, and security history.\n\n## Possible Unreachable Statements\n\n${bullets(unreachable)}\n\nWhy suspicious: a non-closing statement follows return/throw.\nBefore removal: inspect braces, intentional logging, and generated/transpiled source.\n\n## Exported Functions Without Nearby Test References\n\n${bullets(untested)}\n\nWhy suspicious: exported function name was not found in test sources.\nBefore removal or change: add focused coverage, especially for security, state, outbound, and persistence behavior.\n\n## TODO/FIXME/Temporary Markers\n\n${bullets(markers)}\n\nWhy suspicious: marker may represent unfinished or temporary behavior.\nBefore removal: link each marker to an issue or explicitly close it with evidence.\n`;

writeFileSync(outputPath, report, "utf8");
console.log(`CODE_HYGIENE_REPORT_WRITTEN=${rel(outputPath)}`);
console.log(`FILES_SCANNED=${files.length}`);
console.log(`DEAD_FILE_CANDIDATES=${deadFiles.length}`);
console.log(`LOW_REFERENCE_FUNCTIONS=${functionCandidates.length}`);
console.log(`UNTESTED_EXPORTS=${untested.length}`);
console.log(`MARKERS=${markers.length}`);
