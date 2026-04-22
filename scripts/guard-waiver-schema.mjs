import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const WAIVER_TABLES = [
  'participants',
  'waivers',
  'audit_trails',
  'emergency_contacts',
  'waiver_medical_histories',
];

// Intentionally strict: block destructive DDL unless explicitly waived.
const FORBIDDEN_PATTERNS = [
  /drop\s+table\s+(if\s+exists\s+)?(?:public\.)?(participants|waivers|audit_trails|emergency_contacts|waiver_medical_histories)\b/i,
  /truncate\s+(table\s+)?(?:public\.)?(participants|waivers|audit_trails|emergency_contacts|waiver_medical_histories)\b/i,
  /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(participants|waivers|audit_trails|emergency_contacts|waiver_medical_histories)\b[\s\S]{0,200}?\bdrop\s+column\b/i,
  /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(participants|waivers|audit_trails|emergency_contacts|waiver_medical_histories)\b[\s\S]{0,200}?\bdrop\s+constraint\b/i,
  /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(participants|waivers|audit_trails|emergency_contacts|waiver_medical_histories)\b[\s\S]{0,200}?\brename\s+column\b/i,
  /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(participants|waivers|audit_trails|emergency_contacts|waiver_medical_histories)\b[\s\S]{0,200}?\balter\s+column\b[\s\S]{0,200}?\btype\b/i,
];

const ALLOW_MARKER = '-- waiver-guard:allow-destructive-change';

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/--.*$/g, ''))
    .join('\n');
}

function collectHits(filePath, rawSql) {
  if (rawSql.includes(ALLOW_MARKER)) return [];
  const sql = stripSqlComments(rawSql);
  const hits = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    const m = sql.match(pattern);
    if (m) {
      const table = m[2] || 'unknown_table';
      hits.push({
        table,
        excerpt: m[0].replace(/\s+/g, ' ').slice(0, 220),
        pattern: pattern.toString(),
        filePath,
      });
    }
  }
  return hits;
}

async function main() {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort();

  const allHits = [];
  for (const fileName of files) {
    const fullPath = path.join(MIGRATIONS_DIR, fileName);
    const sql = await readFile(fullPath, 'utf8');
    const hits = collectHits(fullPath, sql);
    allHits.push(...hits);
  }

  if (!allHits.length) {
    console.log(
      `Waiver schema guard passed. Protected tables: ${WAIVER_TABLES.join(', ')}.`,
    );
    return;
  }

  console.error('Waiver schema guard failed: destructive waiver-table migration detected.');
  for (const hit of allHits) {
    console.error(`- File: ${hit.filePath}`);
    console.error(`  Table: ${hit.table}`);
    console.error(`  Match: ${hit.excerpt}`);
  }
  console.error(
    `If this is intentional and reviewed, add "${ALLOW_MARKER}" to that migration.`,
  );
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('Waiver schema guard crashed:', err);
  process.exitCode = 1;
});
