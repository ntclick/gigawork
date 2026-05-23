/**
 * parseEntries — Parse and normalize raw CSV or plain-text input of contestants.
 * Deduplicates entries and handles basic CSV formatting by extracting the first column.
 */
export function parseEntries(input: string): string[] {
  if (!input) return []

  // Split by newline
  const lines = input.split(/\r?\n/)
  const list: string[] = []
  const seen = new Set<string>()

  for (let line of lines) {
    line = line.trim()
    if (!line) continue

    // If line starts with a comment or CSV header (e.g. 'username', 'address', 'name'), skip it
    const lowerLine = line.toLowerCase()
    if (
      lowerLine.startsWith('#') ||
      lowerLine.startsWith('//') ||
      lowerLine === 'username' ||
      lowerLine === 'address' ||
      lowerLine === 'name' ||
      lowerLine === 'username,weight' ||
      lowerLine === 'address,weight'
    ) {
      continue
    }

    // If CSV format, extract the first column (e.g., username or address)
    if (line.includes(',')) {
      const parts = line.split(',')
      const firstCol = parts[0].trim()
      
      // Remove surrounding quotes if present
      const cleaned = firstCol.replace(/^["']|["']$/g, '').trim()
      
      if (cleaned && !seen.has(cleaned)) {
        seen.add(cleaned)
        list.push(cleaned)
      }
    } else {
      // Plain text entry
      const cleaned = line.replace(/^["']|["']$/g, '').trim()
      if (cleaned && !seen.has(cleaned)) {
        seen.add(cleaned)
        list.push(cleaned)
      }
    }
  }

  return list
}
