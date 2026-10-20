const FixtureRepo = require('../database/repositories/fixtureRepo');
const SettingsRepo = require('../database/repositories/settingsRepo');

const DeadlineService = {
  isOverdue(fixture) {
    if (fixture.status !== 'pending') return false;
    const deadline = new Date(fixture.deadline);
    return deadline.getTime() < Date.now();
  },

  formatDeadline(isoString) {
    if (!isoString) return 'No deadline';
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    const diffDays = Math.round(diffHours / 24);

    const dateStr = d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    if (diffMs < 0) {
      return `${dateStr} (⚠️ Overdue by ${Math.abs(diffDays)}d)`;
    }
    if (diffHours <= 24) {
      return `${dateStr} (⏳ in ${diffHours}h)`;
    }
    return `${dateStr} (${diffDays}d left)`;
  },

  setDeadlineDays(days) {
    if (isNaN(days) || days < 1) {
      throw new Error('Deadline days must be at least 1.');
    }
    SettingsRepo.set('deadline_days', String(days));
    return days;
  },

  extendFixtureDeadline(fixtureId, additionalDays) {
    if (isNaN(additionalDays) || additionalDays < 1) {
      throw new Error('Additional days must be a positive integer.');
    }
    const fixture = FixtureRepo.findById(fixtureId);
    if (!fixture) {
      throw new Error(`Fixture #${fixtureId} not found.`);
    }

    const currentDeadline = new Date(fixture.deadline);
    // If already overdue, extend from now; otherwise extend from current deadline
    const base = currentDeadline.getTime() < Date.now() ? new Date() : currentDeadline;
    base.setDate(base.getDate() + additionalDays);

    FixtureRepo.updateDeadline(fixture.id, base.toISOString());
    return FixtureRepo.findById(fixture.id);
  },

  getOverdueFixtures() {
    const allPending = FixtureRepo.getAll({ status: 'pending' });
    return allPending.filter(f => this.isOverdue(f));
  }
};

module.exports = DeadlineService;
