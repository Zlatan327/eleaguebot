const Parser = require('./parser');
const LeagueService = require('../services/leagueService');
const DeadlineService = require('../services/deadlineService');
const MessageFormatter = require('../services/messageFormatter');
const PlayerRepo = require('../database/repositories/playerRepo');
const FixtureRepo = require('../database/repositories/fixtureRepo');
const SettingsRepo = require('../database/repositories/settingsRepo');
const AdminRepo = require('../database/repositories/adminRepo');
const config = require('../config');

// In-memory rate limiting to prevent spam flooding and WhatsApp account bans
const userCooldowns = new Map();

function isRateLimited(senderId) {
  if (!senderId || process.env.NODE_ENV === 'test') return false;
  const now = Date.now();
  const last = userCooldowns.get(senderId) || 0;
  const cooldownMs = (config.rateLimitSeconds || 2) * 1000;
  if (now - last < cooldownMs) {
    return true;
  }
  userCooldowns.set(senderId, now);
  return false;
}

const CommandHandler = {
  /**
   * Main command execution router
   */
  async handle({ body, senderId, groupId, isGroup, quotedBody = null }) {
    const parsed = Parser.parseMessage(body, quotedBody);
    if (!parsed) return null;

    const { command, args, isReply, fixtureId: parsedFixtureId, score: parsedScore } = parsed;

    // Rate limit check
    if (isRateLimited(senderId)) {
      return null; // Silently drop spam queries
    }

    // Group Lock Check
    const lockedGroupId = SettingsRepo.get('league_group_id');
    if (lockedGroupId && isGroup && groupId !== lockedGroupId) {
      return null; // Ignore messages from non-registered groups
    }

    const isAdmin = AdminRepo.isAdmin(senderId);
    const currentWeek = SettingsRepo.getInt('current_week', 1);

    try {
      switch (command) {
        // ================= PUBLIC COMMANDS =================
        case 'table':
        case 'standings': {
          const standings = LeagueService.getStandings();
          return MessageFormatter.formatTable(standings, currentWeek);
        }

        case 'fixtures': {
          let weekFilter = null;
          if (args.length > 0 && !isNaN(parseInt(args[0], 10))) {
            weekFilter = parseInt(args[0], 10);
          }

          let fixtures;
          let title = 'LEAGUE FIXTURES';
          if (weekFilter) {
            fixtures = FixtureRepo.findByWeek(weekFilter);
            title = `WEEK ${weekFilter} FIXTURES`;
          } else {
            fixtures = FixtureRepo.getAll();
          }

          return MessageFormatter.formatFixtures(fixtures, title);
        }

        case 'myfixtures': {
          let player = null;
          if (args.length > 0) {
            const queryName = args.join(' ');
            player = PlayerRepo.findByNameOrFuzzy(queryName);
            if (!player) {
              return `❌ Player '${queryName}' not found.`;
            }
          } else if (senderId) {
            player = PlayerRepo.findByWhatsappId(senderId);
            if (!player) {
              return `❌ Your WhatsApp account is not linked to any player.\nUse \`!claimplayer <YourName>\` or \`!myfixtures <YourName>\`.`;
            }
          } else {
            return `Usage: \`!myfixtures <PlayerName>\``;
          }

          const fixtures = FixtureRepo.findByPlayer(player.id);
          return MessageFormatter.formatMyFixtures(player.name, fixtures);
        }

        case 'result': {
          let fixtureId = null;
          let homeName = null;
          let awayName = null;
          let scoreHome = null;
          let scoreAway = null;

          if (isReply && parsedFixtureId && parsedScore) {
            fixtureId = parsedFixtureId;
            scoreHome = parsedScore.home;
            scoreAway = parsedScore.away;
          } else if (args.length === 2 && !isNaN(parseInt(args[0], 10))) {
            fixtureId = parseInt(args[0], 10);
            const score = Parser.parseScore(args[1]);
            if (!score) return `❌ Invalid score format '${args[1]}'. Use format: 3-1`;
            scoreHome = score.home;
            scoreAway = score.away;
          } else if (args.length === 3) {
            homeName = args[0];
            const score = Parser.parseScore(args[1]);
            if (!score) return `❌ Invalid score format '${args[1]}'. Use format: 3-1`;
            awayName = args[2];
            scoreHome = score.home;
            scoreAway = score.away;
          } else {
            return `❌ *Invalid Result Format!*\n\n` +
                   `Supported formats:\n` +
                   `• \`!result <MatchID> <Score>\` → e.g. \`!result 3 2-1\`\n` +
                   `• \`!result <Player1> <Score> <Player2>\` → e.g. \`!result Messi 3-1 Ronaldo\`\n` +
                   `• Reply to fixture with \`3-1\``;
          }

          const updated = LeagueService.recordResult({
            fixtureId,
            homeName,
            awayName,
            scoreHome,
            scoreAway,
            senderId,
          });

          return MessageFormatter.formatResultSaved(updated);
        }

        case 'claimplayer': {
          if (args.length === 0) return 'Usage: `!claimplayer <YourRegisteredName>`';
          const targetName = args.join(' ');
          const player = PlayerRepo.findByNameOrFuzzy(targetName);
          if (!player) return `❌ Player '${targetName}' not found in the league.`;
          if (player.whatsapp_id && player.whatsapp_id !== senderId) {
            return `❌ Player '${player.name}' is already linked to another WhatsApp account. Ask an admin to re-link.`;
          }
          PlayerRepo.updateWhatsappId(player.id, senderId);
          return `✅ Successfully linked your WhatsApp account to player *${player.name}*. You can now submit results for your matches!`;
        }

        case 'claimadmin': {
          if (args.length === 0) return 'Usage: `!claimadmin <secret_token>`';
          const token = args[0];
          try {
            AdminRepo.claimAdmin(senderId, token, 'Verified Admin');
            return `👑 Admin privileges successfully granted to your account!`;
          } catch (e) {
            return `❌ ${e.message}`;
          }
        }

        case 'help':
        case 'rules': {
          return MessageFormatter.formatHelp(isAdmin);
        }

        // ================= ADMIN COMMANDS =================
        case 'addplayer': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          if (args.length === 0) return 'Usage: `!addplayer <PlayerName> [@phone]`';

          const name = args[0];
          const phone = args[1] || null;
          const player = LeagueService.addPlayer(name, phone);
          return `✅ Player *${player.name}* added to the league.`;
        }

        case 'addlateplayer': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          if (args.length === 0) return 'Usage: `!addlateplayer <PlayerName> [@phone]`';

          const name = args[0];
          const phone = args[1] || null;
          const result = LeagueService.addLatePlayer(name, phone);
          return MessageFormatter.formatLatePlayerAdded(result);
        }

        case 'generatefixtures': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          let rounds = 1;
          if (args.length > 0 && !isNaN(parseInt(args[0], 10))) {
            rounds = Math.max(1, parseInt(args[0], 10));
          }

          const res = LeagueService.generateFixtures(rounds);
          return `✅ *Fixtures Generated Successfully!*\n\n` +
                 `• Total Fixtures: ${res.totalFixtures}\n` +
                 `• Total Weeks: ${res.totalWeeks}\n` +
                 `• Rounds: ${res.rounds} (${res.rounds === 2 ? 'Home & Away' : 'Single'})\n\n` +
                 `View fixtures with \`!fixtures\`.`;
        }

        case 'setdeadline': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          if (args.length === 0 || isNaN(parseInt(args[0], 10))) {
            return 'Usage: `!setdeadline <days>` (e.g. `!setdeadline 3`)';
          }
          const days = parseInt(args[0], 10);
          DeadlineService.setDeadlineDays(days);
          return `✅ Global match deadline updated to *${days} days*.`;
        }

        case 'extenddeadline': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          if (args.length < 2 || isNaN(parseInt(args[0], 10)) || isNaN(parseInt(args[1], 10))) {
            return 'Usage: `!extenddeadline <fixtureId> <days>` (e.g. `!extenddeadline 4 2`)';
          }
          const fId = parseInt(args[0], 10);
          const days = parseInt(args[1], 10);
          const updated = DeadlineService.extendFixtureDeadline(fId, days);
          const formatted = DeadlineService.formatDeadline(updated.deadline);
          return `✅ Deadline for Match [#${updated.id}] (${updated.home_name} vs ${updated.away_name}) extended.\nNew Deadline: ${formatted}`;
        }

        case 'forfeit': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          if (args.length < 2 || isNaN(parseInt(args[0], 10))) {
            return 'Usage: `!forfeit <fixtureId> <winnerName>` (e.g. `!forfeit 4 Messi`)';
          }
          const fId = parseInt(args[0], 10);
          const winner = args[1];
          const updated = LeagueService.recordForfeit({
            fixtureId: fId,
            winnerName: winner,
            senderId,
          });
          return `⚠️ *Match Forfeited!*\n\nMatch [#${updated.id}] awarded as 3-0 walkover win to *${winner}*.\nUpdated table with \`!table\`.`;
        }

        case 'editresult': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          if (args.length < 2 || isNaN(parseInt(args[0], 10))) {
            return 'Usage: `!editresult <fixtureId> <score>` (e.g. `!editresult 4 2-1`)';
          }
          const fId = parseInt(args[0], 10);
          const score = Parser.parseScore(args[1]);
          if (!score) return `❌ Invalid score format '${args[1]}'. Use format: 3-1`;

          const updated = LeagueService.editResult(fId, score.home, score.away, senderId);
          return `✏️ *Match Result Corrected!*\n\nMatch [#${updated.id}] score updated to ${updated.home_name} *${updated.score_home} - ${updated.score_away}* ${updated.away_name}.`;
        }

        case 'revertresult': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          if (args.length === 0 || isNaN(parseInt(args[0], 10))) {
            return 'Usage: `!revertresult <fixtureId>` (e.g. `!revertresult 4`)';
          }
          const fId = parseInt(args[0], 10);
          const updated = LeagueService.revertResult(fId, senderId);
          return `🔄 Match [#${updated.id}] (${updated.home_name} vs ${updated.away_name}) has been reverted back to pending.`;
        }

        case 'setweek': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          if (args.length === 0 || isNaN(parseInt(args[0], 10))) {
            return 'Usage: `!setweek <number>` (e.g. `!setweek 2`)';
          }
          const newWeek = parseInt(args[0], 10);
          SettingsRepo.set('current_week', String(newWeek));
          return `✅ Current league week set to *Week ${newWeek}*.`;
        }

        case 'setgroup': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          if (!isGroup || !groupId) {
            return '❌ This command must be executed inside the target WhatsApp group.';
          }
          SettingsRepo.set('league_group_id', groupId);
          return `✅ Bot successfully locked to this group (*${groupId}*). It will now ignore league commands from other groups.`;
        }

        case 'addadmin': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          if (args.length === 0) return 'Usage: `!addadmin <phone_number>`';
          const target = args[0].replace(/[^0-9]/g, '');
          const jid = `${target}@c.us`;
          AdminRepo.addAdmin(jid, args[1] || 'Admin');
          return `✅ Added admin *${target}*.`;
        }

        case 'admins': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          const adminsList = AdminRepo.getAll();
          if (adminsList.length === 0) return 'No registered admins.';
          let text = '👑 *League Administrators:*\n';
          adminsList.forEach(a => {
            text += `• ${a.name || 'Admin'} (${a.whatsapp_id})\n`;
          });
          return text;
        }

        case 'linkplayer': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          if (args.length < 2) return 'Usage: `!linkplayer <PlayerName> <phone_or_mention>`';
          const pName = args[0];
          const rawPhone = args[1].replace(/[^0-9]/g, '');
          const jid = `${rawPhone}@c.us`;
          const updated = LeagueService.linkPlayer({ name: pName, whatsappId: jid, senderId });
          return `✅ Linked player *${updated.name}* to WhatsApp ID *${rawPhone}*.`;
        }

        case 'removeplayer': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          if (args.length === 0) return 'Usage: `!removeplayer <name>`';
          const name = args.join(' ');
          PlayerRepo.deactivate(name);
          return `⚠️ Player *${name}* deactivated from the league.`;
        }

        case 'setleaguename': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          if (args.length === 0) return 'Usage: `!setleaguename <League Name>`';
          const newName = args.join(' ').trim();
          SettingsRepo.set('league_name', newName);
          return `🏆 League name updated to *${newName}*! View with \`!table\` or check the web dashboard.`;
        }

        case 'unbindgroup':
        case 'resetgroup': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          SettingsRepo.delete('league_group_id');
          return `🔓 Bot successfully unlinked from this group. You can now move the bot to another WhatsApp group and run \`!setgroup\`.`;
        }

        case 'groupinfo': {
          const boundId = SettingsRepo.get('league_group_id');
          const leagueName = SettingsRepo.get('league_name', 'eFootball League');
          return `ℹ️ *League Group Info:*\n\n` +
                 `• League Name: *${leagueName}*\n` +
                 `• Current Chat ID: \`${groupId || senderId}\`\n` +
                 `• Bound Group ID: ${boundId ? `\`${boundId}\`` : '_None (Free mode)_'}\n` +
                 `• Status: ${boundId === groupId ? '✅ Locked to this group' : boundId ? '⚠️ Locked to another group' : '🔓 Unbound'}`;
        }

        // ================= ONGOING LEAGUE ONBOARDING COMMANDS =================
        case 'setbaseline': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          // Format: !setbaseline <Name> <P> <W> <D> <L> <GF> <GA> [PTS]
          if (args.length < 7) {
            return 'Usage: `!setbaseline <Name> <P> <W> <D> <L> <GF> <GA> [PTS]`\n' +
                   'e.g. `!setbaseline Messi 4 3 1 0 10 3 10`';
          }
          const [name, p, w, d, l, gf, ga, pts] = args;
          const updated = LeagueService.setPlayerBaseline({
            name,
            played: p,
            won: w,
            drawn: d,
            lost: l,
            gf,
            ga,
            points: pts !== undefined ? pts : null,
            senderId,
          });
          return `✅ Baseline stats recorded for *${updated.name}* (P:${p} W:${w} D:${d} L:${l} GF:${gf} GA:${ga} PTS:${updated.baseline_points}).\nCheck with \`!table\`.`;
        }

        case 'importtable': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          const lines = body.split(/\r?\n/).slice(1);
          if (lines.length === 0) {
            return 'Usage: Paste table lines below `!importtable`:\n\n' +
                   '!importtable\n' +
                   'Messi 5 4 1 0 12 3 13\n' +
                   'Ronaldo 5 3 1 1 10 5 10';
          }

          let count = 0;
          for (const line of lines) {
            const rowTokens = Parser.tokenize(line.trim());
            if (rowTokens.length >= 7) {
              const [name, p, w, d, l, gf, ga, pts] = rowTokens;
              LeagueService.setPlayerBaseline({
                name,
                played: p,
                won: w,
                drawn: d,
                lost: l,
                gf,
                ga,
                points: pts !== undefined ? pts : null,
                senderId,
              });
              count++;
            }
          }
          return `✅ Successfully imported baseline standings for *${count} players* into the league!\nView table with \`!table\`.`;
        }

        case 'backfill': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          // Format: !backfill <Week> <Home> <Score> <Away>
          // e.g. !backfill 1 Messi 3-1 Ronaldo
          if (args.length < 4) {
            return 'Usage: `!backfill <Week> <Home> <Score> <Away>`\n' +
                   'e.g. `!backfill 1 Messi 3-1 Ronaldo`';
          }
          const targetWeek = parseInt(args[0], 10);
          const home = args[1];
          const score = Parser.parseScore(args[2]);
          const away = args[3];

          if (!score) return `❌ Invalid score '${args[2]}'. Use format: 3-1`;

          const f = LeagueService.backfillMatch({
            week: targetWeek,
            homeName: home,
            awayName: away,
            scoreHome: score.home,
            scoreAway: score.away,
            senderId,
          });

          return `✅ Historical Match Backfilled!\n\n` +
                 `*Week ${f.week}:* ${home} *${score.home} - ${score.away}* ${away}\n` +
                 `Standings updated. View with \`!table\`.`;
        }

        case 'importfixtures': {
          if (!isAdmin) return '❌ Permission denied: Admin only command.';
          // Format: !importfixtures <Week>\nPlayerA vs PlayerB\nPlayerC vs PlayerD
          const lines = body.split(/\r?\n/);
          const firstLineTokens = Parser.tokenize(lines[0].trim());
          const targetWeek = firstLineTokens.length > 1 ? parseInt(firstLineTokens[1], 10) : currentWeek;

          const fixtureLines = lines.slice(1);
          if (fixtureLines.length === 0) {
            return 'Usage: Paste upcoming fixtures below `!importfixtures <Week>`:\n\n' +
                   '!importfixtures 4\n' +
                   'Messi vs Neymar\n' +
                   'Ronaldo vs Mbappe';
          }

          const created = LeagueService.importFixturesForWeek({
            week: targetWeek,
            lines: fixtureLines,
            senderId,
          });

          return `✅ *${created.length} Fixtures Imported for Week ${targetWeek}!*\nView with \`!fixtures ${targetWeek}\`.`;
        }

        default:
          return null;
      }
    } catch (err) {
      return `❌ *Error:* ${err.message}`;
    }
  }
};

module.exports = CommandHandler;
