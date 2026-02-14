// Wiki-link utilities for file indexing and link resolution

export interface FileIndexEntry {
  path: string;           // Absolute path
  basename: string;       // Filename without extension (e.g., "notes" from "notes.md")
  filename: string;       // Full filename (e.g., "notes.md")
  relativePath: string;   // Path from folder root
}

export interface FileIndex {
  entries: FileIndexEntry[];
  byBasename: Map<string, FileIndexEntry[]>;  // Lowercase key -> entries
  byFilename: Map<string, FileIndexEntry[]>;  // Lowercase key -> entries
}

export interface ResolveResult {
  status: 'found' | 'not-found' | 'ambiguous';
  path?: string;
  suggestedPath?: string;
  candidates?: FileIndexEntry[];
}

/**
 * Build a file index from a list of absolute file paths and a folder root.
 */
export function buildFileIndex(files: string[], folderRoot: string): FileIndex {
  const entries: FileIndexEntry[] = [];
  const byBasename = new Map<string, FileIndexEntry[]>();
  const byFilename = new Map<string, FileIndexEntry[]>();

  // Normalize folder root (remove trailing slash)
  const normalizedRoot = folderRoot.replace(/[/\\]$/, '');

  for (const filePath of files) {
    // Extract filename from path
    const parts = filePath.split(/[/\\]/);
    const filename = parts[parts.length - 1];

    // Extract basename (without extension)
    const lastDot = filename.lastIndexOf('.');
    const basename = lastDot > 0 ? filename.slice(0, lastDot) : filename;

    // Calculate relative path from folder root
    let relativePath = filePath;
    if (filePath.startsWith(normalizedRoot)) {
      relativePath = filePath.slice(normalizedRoot.length).replace(/^[/\\]/, '');
    }

    const entry: FileIndexEntry = {
      path: filePath,
      basename,
      filename,
      relativePath,
    };

    entries.push(entry);

    // Index by lowercase basename
    const lowerBasename = basename.toLowerCase();
    if (!byBasename.has(lowerBasename)) {
      byBasename.set(lowerBasename, []);
    }
    byBasename.get(lowerBasename)!.push(entry);

    // Index by lowercase filename
    const lowerFilename = filename.toLowerCase();
    if (!byFilename.has(lowerFilename)) {
      byFilename.set(lowerFilename, []);
    }
    byFilename.get(lowerFilename)!.push(entry);
  }

  return { entries, byBasename, byFilename };
}

/**
 * Resolve a wiki-link target to a file path.
 *
 * Resolution strategy:
 * 1. Exact basename match (case-insensitive)
 * 2. Exact filename match (case-insensitive)
 * 3. If not found, suggest a path for creating the file
 */
export function resolveWikiLink(
  target: string,
  index: FileIndex,
  currentFilePath: string,
  folderRoot: string
): ResolveResult {
  const lowerTarget = target.toLowerCase();

  // Try exact basename match first
  const basenameMatches = index.byBasename.get(lowerTarget);
  if (basenameMatches && basenameMatches.length === 1) {
    return { status: 'found', path: basenameMatches[0].path };
  }
  if (basenameMatches && basenameMatches.length > 1) {
    // Multiple matches - prefer file in same directory
    const currentDir = currentFilePath.substring(0, Math.max(currentFilePath.lastIndexOf('/'), currentFilePath.lastIndexOf('\\')));
    const sameDir = basenameMatches.find(e => e.path.startsWith(currentDir + '/') || e.path.startsWith(currentDir + '\\'));
    if (sameDir) {
      return { status: 'found', path: sameDir.path };
    }
    return { status: 'ambiguous', candidates: basenameMatches };
  }

  // Try filename match (includes extension in target)
  const filenameMatches = index.byFilename.get(lowerTarget);
  if (filenameMatches && filenameMatches.length === 1) {
    return { status: 'found', path: filenameMatches[0].path };
  }
  if (filenameMatches && filenameMatches.length > 1) {
    const currentDir = currentFilePath.substring(0, Math.max(currentFilePath.lastIndexOf('/'), currentFilePath.lastIndexOf('\\')));
    const sameDir = filenameMatches.find(e => e.path.startsWith(currentDir + '/') || e.path.startsWith(currentDir + '\\'));
    if (sameDir) {
      return { status: 'found', path: sameDir.path };
    }
    return { status: 'ambiguous', candidates: filenameMatches };
  }

  // Also try with .md extension appended
  const withMdMatches = index.byFilename.get(lowerTarget + '.md');
  if (withMdMatches && withMdMatches.length === 1) {
    return { status: 'found', path: withMdMatches[0].path };
  }
  if (withMdMatches && withMdMatches.length > 1) {
    const currentDir = currentFilePath.substring(0, Math.max(currentFilePath.lastIndexOf('/'), currentFilePath.lastIndexOf('\\')));
    const sameDir = withMdMatches.find(e => e.path.startsWith(currentDir + '/') || e.path.startsWith(currentDir + '\\'));
    if (sameDir) {
      return { status: 'found', path: sameDir.path };
    }
    return { status: 'ambiguous', candidates: withMdMatches };
  }

  // Not found - suggest creating in the current file's directory or folder root
  const currentDir = currentFilePath
    ? currentFilePath.substring(0, Math.max(currentFilePath.lastIndexOf('/'), currentFilePath.lastIndexOf('\\')))
    : folderRoot;

  // Add .md extension if not present
  const filename = target.includes('.') ? target : `${target}.md`;
  const suggestedPath = currentDir ? `${currentDir}/${filename}` : `${folderRoot}/${filename}`;

  return { status: 'not-found', suggestedPath };
}

/**
 * Fuzzy match a query against file entries.
 * Returns entries sorted by relevance (best match first).
 */
export function fuzzyMatch(query: string, entries: FileIndexEntry[]): FileIndexEntry[] {
  if (!query) {
    // Return all entries sorted alphabetically by basename
    return [...entries].sort((a, b) => a.basename.localeCompare(b.basename));
  }

  const lowerQuery = query.toLowerCase();

  interface ScoredEntry {
    entry: FileIndexEntry;
    score: number;
  }

  const scored: ScoredEntry[] = [];

  for (const entry of entries) {
    const lowerBasename = entry.basename.toLowerCase();
    const lowerFilename = entry.filename.toLowerCase();

    let score = 0;

    // Exact match gets highest score
    if (lowerBasename === lowerQuery) {
      score = 100;
    }
    // Prefix match on basename
    else if (lowerBasename.startsWith(lowerQuery)) {
      score = 80 + (lowerQuery.length / lowerBasename.length) * 10;
    }
    // Contains match on basename
    else if (lowerBasename.includes(lowerQuery)) {
      score = 60 + (lowerQuery.length / lowerBasename.length) * 10;
    }
    // Fuzzy match: check if all characters appear in order
    else if (fuzzyContains(lowerBasename, lowerQuery)) {
      score = 40 + (lowerQuery.length / lowerBasename.length) * 10;
    }
    // Match on filename (includes extension)
    else if (lowerFilename.includes(lowerQuery)) {
      score = 30;
    }
    // Match on relative path
    else if (entry.relativePath.toLowerCase().includes(lowerQuery)) {
      score = 20;
    }

    if (score > 0) {
      scored.push({ entry, score });
    }
  }

  // Sort by score descending, then alphabetically
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.basename.localeCompare(b.entry.basename);
  });

  return scored.map(s => s.entry);
}

/**
 * Check if all characters in needle appear in haystack in order.
 */
function fuzzyContains(haystack: string, needle: string): boolean {
  let hi = 0;
  let ni = 0;

  while (hi < haystack.length && ni < needle.length) {
    if (haystack[hi] === needle[ni]) {
      ni++;
    }
    hi++;
  }

  return ni === needle.length;
}
