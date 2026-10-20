/**
 * Splits command line string respecting double or single quotes
 * e.g. '!result "John Doe" 3-1 "Alex Smith"' -> ['!result', 'John Doe', '3-1', 'Alex Smith']
 */
function tokenize(text) {
  const tokens = [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(match[1]);
    } else if (match[2] !== undefined) {
      tokens.push(match[2]);
    } else {
      tokens.push(match[0]);
    }
  }
  return tokens;
}

/**
 * Extracts home and away scores from patterns like "3-1", "3:1", "3 - 1"
 */
function parseScore(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (match) {
    return {
      home: parseInt(match[1], 10),
      away: parseInt(match[2], 10),
    };
  }
  return null;
}

/**
 * Extracts fixture ID from text or quoted message
 * Looks for [#12], #12, or raw integer
 */
function extractFixtureId(text) {
  if (!text) return null;
  const bracketMatch = text.match(/\[#(\d+)\]/);
  if (bracketMatch) return parseInt(bracketMatch[1], 10);

  const hashMatch = text.match(/#(\d+)/);
  if (hashMatch) return parseInt(hashMatch[1], 10);

  if (/^\d+$/.test(text.trim())) {
    return parseInt(text.trim(), 10);
  }
  return null;
}

/**
 * Detects quick score submissions like "#1 3-1", "1 3-1", "!1 3-1", "score 1 3-1", "m1 3-1"
 */
function parseQuickScore(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  const match = trimmed.match(/^(?:[!#]|(?:[!#/]?(?:score|result|match|m)\s*))?#?(\d+)[:\s]+(\d+)\s*[-:]\s*(\d+)$/i);
  if (match) {
    const fixtureId = parseInt(match[1], 10);
    const home = parseInt(match[2], 10);
    const away = parseInt(match[3], 10);
    return {
      fixtureId,
      score: { home, away },
    };
  }
  return null;
}

const Parser = {
  tokenize,
  parseScore,
  extractFixtureId,
  parseQuickScore,

  /**
   * Parses incoming message and returns structured command data
   */
  parseMessage(body, quotedBody = null) {
    if (!body || typeof body !== 'string') return null;

    const trimmed = body.trim();

    // 1. Check if user sent a quick score format by Match ID (e.g. "#1 3-1", "1 3-1", "!1 3-1", "score 1 3-1")
    const quickScore = parseQuickScore(trimmed);
    if (quickScore) {
      return {
        command: 'result',
        args: [String(quickScore.fixtureId), `${quickScore.score.home}-${quickScore.score.away}`],
        isReply: false,
        fixtureId: quickScore.fixtureId,
        score: quickScore.score,
      };
    }

    // Check if user replied with score directly (e.g. "3-1" or "3:1") to a quoted fixture
    const directScore = parseScore(trimmed);
    if (directScore && quotedBody) {
      const fixtureId = extractFixtureId(quotedBody);
      if (fixtureId) {
        return {
          command: 'result',
          args: [String(fixtureId), `${directScore.home}-${directScore.away}`],
          isReply: true,
          fixtureId,
          score: directScore,
        };
      }
    }

    // Must start with ! or /
    if (!trimmed.startsWith('!') && !trimmed.startsWith('/')) {
      return null;
    }

    const tokens = tokenize(trimmed);
    if (tokens.length === 0) return null;

    const rawCmd = tokens[0].slice(1).toLowerCase();
    const args = tokens.slice(1);

    // Check if replying with !result <score> to a quoted fixture
    if (rawCmd === 'result' && args.length === 1 && parseScore(args[0]) && quotedBody) {
      const fixtureId = extractFixtureId(quotedBody);
      if (fixtureId) {
        const score = parseScore(args[0]);
        return {
          command: 'result',
          args: [String(fixtureId), args[0]],
          isReply: true,
          fixtureId,
          score,
        };
      }
    }

    return {
      command: rawCmd,
      args,
      isReply: false,
    };
  }
};

module.exports = Parser;
