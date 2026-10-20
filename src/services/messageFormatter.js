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
  formatTable(standings, currentWeek, leagueId = 'default') {
    const leagueName = SettingsRepo.get('league_name', 'EFOOTBALL LEAGUE', leagueId);
    if (!standings || standings.length === 0) {
      return `🏆 *${leagueName.toUpperCase()} STANDINGS*\n\n` +
             `_No players registered in this league yet._\n` +
             `👉 Use \`!addplayer <name>\` to register participants.`;
    }

    let header = `🏆 *${leagueName.toUpperCase()} STANDINGS* (Week ${currentWeek})\n`;
    header += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    header += '```\n';
    header += '#  PLAYER     P  W D L  GD PTS\n';
    header += '──────────────────────────────\n';

    let rows = '';
    standings.forEach((entry, idx) => {
      const pos = pad(idx + 1, 2, 'right');
      const displayName = entry.name.length > 10 ? entry.name.slice(0, 9) + '…' : entry.name;
      const name = pad(displayName, 10, 'left');
      const p = pad(entry.played, 2, 'right');
      const w = pad(entry.won, 2, 'right');
      const d = pad(entry.drawn, 1, 'right');
      const l = pad(entry.lost, 1, 'right');
      const gdVal = entry.goal_diff > 0 ? `+${entry.goal_diff}` : `${entry.goal_diff}`;
      const gd = pad(gdVal, 3, 'right');
      const pts = pad(entry.points, 3, 'right');

      rows += `${pos} ${name} ${p} ${w} ${d} ${l} ${gd} ${pts}\n`;
    });

    let footer = '──────────────────────────────\n';
    footer += '```\n';

    // Highlight leader if any matches played or points earned
    if (standings.length > 0) {
      const leader = standings[0];
      const ptsLabel = leader.points === 1 ? '1 pt' : `${leader.points} pts`;
      footer += `🥇 *Leader:* ${leader.name} (${ptsLabel})\n`;
    }

    footer += `💡 _Tiebreakers: PTS > GD > GF > H2H_`;
    return header + rows + footer;
  },

  /**
   * Formats a list of fixtures
   */
  formatFixtures(fixtures, title = null, leagueId = 'default') {
    const leagueName = SettingsRepo.get('league_name', 'LEAGUE', leagueId);
    const displayTitle = title || `${leagueName.toUpperCase()} FIXTURES`;
    if (!fixtures || fixtures.length === 0) {
      return `📅 *${displayTitle}*\n\n` +
             `_No fixtures found._\n` +
             `👉 Use \`!generatefixtures\` to generate the league schedule.`;
    }

    let out = `⚽ *${displayTitle}*\n`;
    out += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

    let currentWk = null;
    for (const f of fixtures) {
      if (f.week !== currentWk) {
        currentWk = f.week;
        out += `\n🗓️ *WEEK ${currentWk}*\n`;
      }

      const matchId = `*[#${f.id}]*`;
      if (f.status === 'played') {
        out += `✅ ${matchId} *${f.home_name}*  ${f.score_home} ━ ${f.score_away}  *${f.away_name}*\n`;
      } else if (f.status === 'forfeited') {
        out += `❌ ${matchId} *${f.home_name}*  ${f.score_home} ━ ${f.score_away}  *${f.away_name}* _(Forfeit)_\n`;
      } else {
        const deadlineText = DeadlineService.formatDeadline(f.deadline);
        out += `⏳ ${matchId} *${f.home_name}* vs *${f.away_name}*\n`;
        out += `   └ ⏰ ${deadlineText}\n`;
      }
    }

    out += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    out += '⚡ *Instant Score Submission:*\n';
    out += '👉 Send `#<ID> <Score>` (e.g. `#1 3-1` or `1 3-1`)';
    return out;
  },

  /**
   * Formats personal fixtures for a specific player
   */
  formatMyFixtures(playerName, fixtures) {
    if (!fixtures || fixtures.length === 0) {
      return `👤 *FIXTURES • ${playerName.toUpperCase()}*\n\n_No matches found for ${playerName}._`;
    }

    let out = `👤 *FIXTURES • ${playerName.toUpperCase()}*\n`;
    out += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

    const pending = fixtures.filter(f => f.status === 'pending');
    const completed = fixtures.filter(f => f.status !== 'pending');

    if (pending.length > 0) {
      out += '\n⏳ *UPCOMING MATCHES*\n';
      for (const f of pending) {
        const deadlineText = DeadlineService.formatDeadline(f.deadline);
        out += `▸ *[#${f.id}] Week ${f.week}* vs *${f.home_name === playerName ? f.away_name : f.home_name}*\n`;
        out += `   └ ⏰ ${deadlineText}\n`;
      }
    } else {
      out += '\n_All scheduled matches have been completed!_\n';
    }

    if (completed.length > 0) {
      out += '\n✅ *COMPLETED MATCHES*\n';
      for (const f of completed) {
        const isHome = f.home_name === playerName;
        const opponent = isHome ? f.away_name : f.home_name;
        const myScore = isHome ? f.score_home : f.score_away;
        const oppScore = isHome ? f.score_away : f.score_home;
        let outcome = 'Draw 🤝';
        if (myScore > oppScore) outcome = 'Won 🏆';
        else if (myScore < oppScore) outcome = 'Lost ❌';
        if (f.status === 'forfeited') outcome += ' (Forfeit)';

        out += `▸ *[#${f.id}] Week ${f.week}* vs *${opponent}* ➔ *${myScore} ━ ${oppScore}* (${outcome})\n`;
      }
    }

    out += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    out += '📝 *Submit Result:* `!result <id> <score>`';
    return out;
  },

  /**
   * Formats result confirmation
   */
  formatResultSaved(fixture) {
    return `🏟️ *MATCH RESULT RECORDED*\n` +
           `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
           `⚽ *Week ${fixture.week} • Match #${fixture.id}*\n\n` +
           `🔴 *${fixture.home_name}*   ${fixture.score_home} ━ ${fixture.score_away}   *${fixture.away_name}* 🔵\n\n` +
           `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
           `📊 *Status:* Full Time (FT ✅)\n` +
           `📈 Standings updated! Type \`!table\` to view.`;
  },

  /**
   * Formats late player addition summary
   */
  formatLatePlayerAdded(result) {
    return `🌟 *NEW CONTENDER JOINED!*\n` +
           `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
           `👤 *Player:* *${result.player.name}*\n` +
           `📅 *Joined In:* Week ${result.currentWeek}\n` +
           `⚔️ *Fixtures Scheduled:* ${result.createdFixturesCount} matches\n\n` +
           `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
           `ℹ️ _All prior results & existing matchups remain 100% intact._\n` +
           `👉 Check schedule: \`!myfixtures ${result.player.name}\``;
  },

  /**
   * Help manual
   */
  formatHelp(isAdmin = false) {
    let help = `╔══════════════════════════════╗\n` +
               `   ⚽ *eLeagueBot • Official Guide*\n` +
               `╚══════════════════════════════╝\n\n` +
               `🎮 *MATCHDAY COMMANDS*\n` +
               `▸ \`#<id> <score>\` ➔ Quick submit (e.g. \`#1 3-1\` or \`1 3-1\`)\n` +
               `▸ \`!score <id> <score>\` ➔ Submit score by ID (e.g. \`!score 1 3-1\`)\n` +
               `▸ \`!result <P1> 3-1 <P2>\` ➔ Submit by name (\`!result Messi 3-1 Ronaldo\`)\n` +
               `▸ \`!table\` ➔ View current league standings\n` +
               `▸ \`!fixtures\` ➔ View all upcoming & completed matches\n` +
               `▸ \`!fixtures <week>\` ➔ View matches for a specific week (e.g. \`!fixtures 2\`)\n` +
               `▸ \`!myfixtures\` ➔ View your personal upcoming schedule & deadlines\n` +
               `▸ \`!claimplayer <Name>\` ➔ Link your WhatsApp to your player name\n` +
               `▸ \`!help\` or \`!hlp\` ➔ Display this command guide\n`;

    if (isAdmin) {
      help += `\n👑 *ADMIN CONTROLS*\n` +
              `▸ \`!addplayer <Name> [@phone]\` ➔ Register player before kickoff\n` +
              `▸ \`!generatefixtures [rounds]\` ➔ Generate 1 or 2 round schedule\n` +
              `▸ \`!setweek <num>\` ➔ Advance current active week (e.g. \`!setweek 2\`)\n` +
              `▸ \`!editresult <id> <score>\` ➔ Correct a recorded match score\n` +
              `▸ \`!revertresult <id>\` ➔ Reset played match back to pending\n` +
              `▸ \`!forfeit <id> <winner>\` ➔ Award a 3-0 walkover win\n` +
              `▸ \`!setdeadline <days>\` ➔ Set default match deadline duration\n` +
              `▸ \`!extenddeadline <id> <days>\` ➔ Extend deadline for a fixture\n` +
              `▸ \`!addlateplayer <Name>\` ➔ Safely integrate a player mid-season\n` +
              `▸ \`!setleaguename <Name>\` ➔ Customize league display name\n` +
              `▸ \`!setgroup\` ➔ Lock bot to current WhatsApp group\n` +
              `▸ \`!groupinfo\` ➔ View group binding & league stats\n` +
              `▸ \`!linkplayer <Name> <phone>\` ➔ Link WhatsApp number to player\n` +
              `▸ \`!addadmin <phone>\` ➔ Grant admin permissions\n` +
              `▸ \`!removeplayer <Name>\` ➔ Deactivate a player\n\n` +
              `📥 *ONGOING LEAGUE ONBOARDING*\n` +
              `▸ \`!importtable\` (multiline) ➔ Bulk import current league standings\n` +
              `▸ \`!setbaseline <name> <stats...>\` ➔ Set player baseline stats\n` +
              `▸ \`!backfill <wk> <P1> 3-1 <P2>\` ➔ Record historical past match\n` +
              `▸ \`!importfixtures <wk>\` (multiline) ➔ Import custom fixture list\n`;
    }

    return help;
  }
};

module.exports = MessageFormatter;
