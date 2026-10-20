const DeadlineService = require('./deadlineService');
const SettingsRepo = require('../database/repositories/settingsRepo');

/**
 * Helper to pad strings for monospace WhatsApp display
 */
function pad(str, len, align = 'left') {
  const s = String(str);
  if (s.length >= len) return s.slice(0, len);
  const spaces = ' '.repeat(len - s.length);
  return align === 'right' ? spaces + s : s + spaces;
}

const MessageFormatter = {
  /**
   * Formats the league table in a clean monospace block
   */
  formatTable(standings, currentWeek) {
    const leagueName = SettingsRepo.get('league_name', 'EFOOTBALL LEAGUE');
    if (!standings || standings.length === 0) {
      return `📋 *${leagueName.toUpperCase()} TABLE*\n\n_No players registered in the league yet._\nUse \`!addplayer <name>\` to register players.`;
    }

    let header = `🏆 *${leagueName.toUpperCase()} STANDINGS* (Week ${currentWeek})\n`;
    header += '```\n';
    header += '#  Player       P  W  D  L  GD PTS\n';
    header += '──────────────────────────────────\n';

    let rows = '';
    standings.forEach((entry, idx) => {
      const pos = pad(idx + 1, 2, 'right');
      const name = pad(entry.name, 11, 'left');
      const p = pad(entry.played, 2, 'right');
      const w = pad(entry.won, 2, 'right');
      const d = pad(entry.drawn, 2, 'right');
      const l = pad(entry.lost, 2, 'right');
      const gdVal = entry.goal_diff > 0 ? `+${entry.goal_diff}` : `${entry.goal_diff}`;
      const gd = pad(gdVal, 3, 'right');
      const pts = pad(entry.points, 3, 'right');

      rows += `${pos} ${name} ${p} ${w} ${d} ${l} ${gd} ${pts}\n`;
    });

    const footer = '```\n_Tiebreakers: Pts > GD > GF > H2H > Wins_';
    return header + rows + footer;
  },

  /**
   * Formats a list of fixtures
   */
  formatFixtures(fixtures, title = null) {
    const leagueName = SettingsRepo.get('league_name', 'LEAGUE');
    const displayTitle = title || `${leagueName.toUpperCase()} FIXTURES`;
    if (!fixtures || fixtures.length === 0) {
      return `📅 *${displayTitle}*\n\n_No fixtures found._\nUse \`!generatefixtures\` to generate the league schedule.`;
    }

    let out = `📅 *${displayTitle}*\n`;
    out += '────────────────────────────\n';

    let currentWk = null;
    for (const f of fixtures) {
      if (f.week !== currentWk) {
        currentWk = f.week;
        out += `\n*── WEEK ${currentWk} ──*\n`;
      }

      const matchId = `[#${f.id}]`;
      if (f.status === 'played') {
        out += `${matchId} *${f.home_name}* ${f.score_home} - ${f.score_away} *${f.away_name}* ✅\n`;
      } else if (f.status === 'forfeited') {
        out += `${matchId} *${f.home_name}* ${f.score_home} - ${f.score_away} *${f.away_name}* (Forfeit ❌)\n`;
      } else {
        const deadlineText = DeadlineService.formatDeadline(f.deadline);
        out += `${matchId} ${f.home_name} vs ${f.away_name}\n`;
        out += `     ⏳ ${deadlineText}\n`;
      }
    }

    out += '\n_Submit score: `!result <id> <home>-<away>` or `!result <Player1> 3-1 <Player2>`_';
    return out;
  },

  /**
   * Formats personal fixtures for a specific player
   */
  formatMyFixtures(playerName, fixtures) {
    if (!fixtures || fixtures.length === 0) {
      return `👤 *Fixtures for ${playerName}*\n\n_No matches found for ${playerName}._`;
    }

    let out = `👤 *FIXTURES FOR ${playerName.toUpperCase()}*\n`;
    out += '────────────────────────────\n';

    const pending = fixtures.filter(f => f.status === 'pending');
    const completed = fixtures.filter(f => f.status !== 'pending');

    if (pending.length > 0) {
      out += '\n*⏳ Upcoming Matches:*\n';
      for (const f of pending) {
        const deadlineText = DeadlineService.formatDeadline(f.deadline);
        out += `• [#${f.id}] Week ${f.week}: ${f.home_name} vs ${f.away_name}\n`;
        out += `   └ Deadline: ${deadlineText}\n`;
      }
    } else {
      out += '\n_All scheduled matches have been completed!_\n';
    }

    if (completed.length > 0) {
      out += '\n*✅ Completed Matches:*\n';
      for (const f of completed) {
        const statusBadge = f.status === 'forfeited' ? '(Forfeit)' : '';
        out += `• [#${f.id}] Week ${f.week}: ${f.home_name} ${f.score_home} - ${f.score_away} ${f.away_name} ${statusBadge}\n`;
      }
    }

    return out;
  },

  /**
   * Formats result confirmation
   */
  formatResultSaved(fixture) {
    return `✅ *Match Result Recorded!*\n\n` +
           `*Match:* [#${fixture.id}] Week ${fixture.week}\n` +
           `*Score:* ${fixture.home_name} *${fixture.score_home} - ${fixture.score_away}* ${fixture.away_name}\n` +
           `*Status:* ${fixture.status.toUpperCase()}\n\n` +
           `Check updated standings with \`!table\`.`;
  },

  /**
   * Formats late player addition summary
   */
  formatLatePlayerAdded(result) {
    return `🎉 *Late Player Joined!*\n\n` +
           `*Player:* ${result.player.name}\n` +
           `*Joined In:* Week ${result.currentWeek}\n` +
           `*New Fixtures Scheduled:* ${result.createdFixturesCount}\n\n` +
           `_All prior results & existing matchups remain 100% intact._\n` +
           `Check your new matchups with \`!myfixtures ${result.player.name}\`.`;
  },

  /**
   * Help manual
   */
  formatHelp(isAdmin = false) {
    let help = `⚽ *eLeagueBot Command Guide*\n\n` +
      `*Public Commands:*\n` +
      `• \`!table\` or \`!standings\` - Show current league standings\n` +
      `• \`!fixtures\` - List all upcoming and past fixtures\n` +
      `• \`!fixtures <week>\` - View fixtures for a specific week (e.g. \`!fixtures 2\`)\n` +
      `• \`!myfixtures [name]\` - View personal upcoming matches and deadlines\n` +
      `• \`!result <id> <score>\` - Submit score by ID (e.g. \`!result 5 3-1\`)\n` +
      `• \`!result <P1> <score> <P2>\` - Submit score by names (e.g. \`!result Messi 3-1 Ronaldo\`)\n` +
      `• \`!rules\` or \`!help\` - Display this help guide\n`;

    if (isAdmin) {
      help += `\n*👑 Admin Commands:*\n` +
        `• \`!addplayer <name> [@phone]\` - Register player before kickoff\n` +
        `• \`!addlateplayer <name> [@phone]\` - Safely integrate mid-season player\n` +
        `• \`!generatefixtures [rounds]\` - Generate round-robin schedule\n` +
        `• \`!setdeadline <days>\` - Set default match deadline duration\n` +
        `• \`!extenddeadline <id> <days>\` - Extend deadline for postponed fixture\n` +
        `• \`!forfeit <id> <winner>\` - Record 3-0 walkover win\n` +
        `• \`!editresult <id> <score>\` - Correct an entered score\n` +
        `• \`!revertresult <id>\` - Revert a played match back to pending\n` +
        `• \`!setweek <num>\` - Advance active league week\n` +
        `• \`!setleaguename <name>\` - Customize league display name\n` +
        `• \`!setgroup\` - Lock bot to current WhatsApp group\n` +
        `• \`!unbindgroup\` - Unlock bot to switch to another group\n` +
        `• \`!groupinfo\` - View current group binding status\n` +
        `• \`!linkplayer <name> <phone>\` - Link WhatsApp number to player\n` +
        `• \`!addadmin <phone>\` - Grant admin permissions\n` +
        `• \`!removeplayer <name>\` - Deactivate a player\n\n` +
        `*📥 Ongoing League Onboarding:*\n` +
        `• \`!setbaseline <name> <P> <W> <D> <L> <GF> <GA> [PTS]\` - Import existing player stats\n` +
        `• \`!importtable\` (multiline) - Bulk import entire existing table\n` +
        `• \`!backfill <week> <P1> <score> <P2>\` - Backfill historical played match\n` +
        `• \`!importfixtures <week>\` (multiline) - Import upcoming fixtures\n`;
    }

    return help;
  }
};

module.exports = MessageFormatter;
