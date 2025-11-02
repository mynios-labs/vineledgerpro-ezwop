// Privacy enforcement utilities
const FORBIDDEN_WORDS = [
  "vine",
  "amazon vine",
  "received for review",
  "promo unit",
  "promotional",
  "free product",
  "review copy",
  "sample",
];

export function checkForbiddenWords(text: string): string[] {
  const lowerText = text.toLowerCase();
  const violations: string[] = [];

  for (const word of FORBIDDEN_WORDS) {
    if (lowerText.includes(word.toLowerCase())) {
      violations.push(word);
    }
  }

  return violations;
}

export function checkAsinInText(text: string, asin: string): boolean {
  return text.toLowerCase().includes(asin.toLowerCase());
}

// Simple cosine similarity for text comparison
export function calculateSimilarity(text1: string, text2: string): number {
  const words1 = text1.toLowerCase().split(/\W+/);
  const words2 = text2.toLowerCase().split(/\W+/);

  const allWords = Array.from(new Set([...words1, ...words2]));
  const vector1 = allWords.map((word) => words1.filter((w) => w === word).length);
  const vector2 = allWords.map((word) => words2.filter((w) => w === word).length);

  const dotProduct = vector1.reduce((sum, val, i) => sum + val * vector2[i], 0);
  const magnitude1 = Math.sqrt(vector1.reduce((sum, val) => sum + val * val, 0));
  const magnitude2 = Math.sqrt(vector2.reduce((sum, val) => sum + val * val, 0));

  return dotProduct / (magnitude1 * magnitude2) || 0;
}
