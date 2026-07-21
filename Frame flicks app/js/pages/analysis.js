// pages/analysis.js — computed stat cards from prospects + fuHistory, all
// charts as plain divs (no chart library). Smart Insights is heuristic-only,
// no AI call needed.

import { getProspects, getFuHistory } from '../storage.js';
import { escHtml } from '../format.js';

function barHtml(label, value, max, color) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return `
    <div class="bar-row">
      <span class="bar-label">${escHtml(label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${pct}%; background:${color || 'var(--accent)'};"></span></span>
      <span class="bar-value">${value}</span>
    </div>`;
}

export function init() {
  const prospects = getProspects();
  getFuHistory(); // available for future use / consistency with spec

  const total = prospects.length;
  const sentOrLater = prospects.filter((p) => p.status && p.status !== 'Not Sent');
  const sentCount = sentOrLater.length;
  const replied = prospects.filter((p) => p.status === 'Replied').length;
  const videoSent = prospects.filter((p) => p.pipe_video).length;
  const meetingDone = prospects.filter((p) => p.pipe_meeting).length;
  const interested = prospects.filter((p) => p.status === 'Interested').length;
  const closed = prospects.filter((p) => p.status === 'Closed').length;
  const notInterested = prospects.filter((p) => p.status === 'Not Interested').length;
  const noReply = prospects.filter((p) => p.status === 'No Reply').length;

  const respondedCount = replied + interested + closed + notInterested + noReply;
  const responseRate = sentCount ? Math.round((respondedCount / sentCount) * 100) : 0;

  document.getElementById('responseRateBig').textContent = `${responseRate}%`;
  document.getElementById('responseBreakdown').innerHTML = [
    barHtml('Sent', sentCount, total, 'var(--blue)'),
    barHtml('Replied', replied, total, 'var(--purple)'),
    barHtml('Video Sent', videoSent, total, 'var(--accent)'),
    barHtml('Meeting Done', meetingDone, total, 'var(--pink)'),
    barHtml('Interested', interested, total, 'var(--amber)'),
    barHtml('Closed', closed, total, 'var(--green)'),
  ].join('');

  // Conversion funnel
  const funnelMax = Math.max(1, sentCount);
  document.getElementById('conversionFunnel').innerHTML = [
    barHtml('DM Sent', sentCount, funnelMax, 'var(--blue)'),
    barHtml('Replied', replied, funnelMax, 'var(--purple)'),
    barHtml('Interested', interested, funnelMax, 'var(--amber)'),
    barHtml('Closed', closed, funnelMax, 'var(--green)'),
  ].join('');

  // Pipeline milestones
  const emailSent = prospects.filter((p) => p.pipe_email).length;
  const booked = prospects.filter((p) => p.pipe_booked).length;
  const pipeMax = Math.max(1, total);
  document.getElementById('pipelineMilestones').innerHTML = [
    barHtml('Initial Pitch Sent', emailSent, pipeMax, 'var(--blue)'),
    barHtml('Sample Video Sent', videoSent, pipeMax, 'var(--accent)'),
    barHtml('Video Call Done', meetingDone, pipeMax, 'var(--pink)'),
    barHtml('Booked Paid Client', booked, pipeMax, 'var(--green)'),
  ].join('');

  // Status breakdown
  const statusCounts = {};
  prospects.forEach((p) => { statusCounts[p.status || 'Not Sent'] = (statusCounts[p.status || 'Not Sent'] || 0) + 1; });
  const statusMax = Math.max(1, ...Object.values(statusCounts), 0);
  document.getElementById('statusBreakdown').innerHTML = Object.keys(statusCounts).length
    ? Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).map(([s, c]) => barHtml(s, c, statusMax)).join('')
    : '<p class="muted">No prospects yet.</p>';

  // Top platforms
  const platformCounts = {};
  prospects.forEach((p) => { if (p.platform) platformCounts[p.platform] = (platformCounts[p.platform] || 0) + 1; });
  const platformMax = Math.max(1, ...Object.values(platformCounts), 0);
  document.getElementById('topPlatforms').innerHTML = Object.keys(platformCounts).length
    ? Object.entries(platformCounts).sort((a, b) => b[1] - a[1]).map(([s, c]) => barHtml(s, c, platformMax, 'var(--blue)')).join('')
    : '<p class="muted">No data yet.</p>';

  // Top niches
  const nicheCounts = {};
  prospects.forEach((p) => { if (p.niche) nicheCounts[p.niche] = (nicheCounts[p.niche] || 0) + 1; });
  const nicheMax = Math.max(1, ...Object.values(nicheCounts), 0);
  document.getElementById('topNiches').innerHTML = Object.keys(nicheCounts).length
    ? Object.entries(nicheCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, c]) => barHtml(s, c, nicheMax, 'var(--purple)')).join('')
    : '<p class="muted">No data yet.</p>';

  // Smart insights — simple heuristics, no AI call
  const insights = [];
  if (total === 0) {
    insights.push({ icon: '👋', text: "You haven't added any prospects yet — head to the Prospects page to start building your pipeline." });
  } else {
    if (sentCount > 0) {
      const avgLabel = responseRate >= 30 ? 'well above' : responseRate >= 15 ? 'around' : 'below';
      insights.push({ icon: responseRate >= 20 ? '🔥' : '📈', text: `Your response rate is ${responseRate}%, which is ${avgLabel} the typical cold-outreach average of ~15-20%.` });
    }
    if (Object.keys(platformCounts).length) {
      const topPlatform = Object.entries(platformCounts).sort((a, b) => b[1] - a[1])[0];
      insights.push({ icon: '📱', text: `Most of your outreach is happening on ${topPlatform[0]} (${topPlatform[1]} prospects) — worth doubling down if it's converting well.` });
    }
    if (closed > 0) {
      const closedProspects = prospects.filter((p) => p.status === 'Closed');
      const closedPlatforms = {};
      closedProspects.forEach((p) => { if (p.platform) closedPlatforms[p.platform] = (closedPlatforms[p.platform] || 0) + 1; });
      if (Object.keys(closedPlatforms).length) {
        const topClosedPlatform = Object.entries(closedPlatforms).sort((a, b) => b[1] - a[1])[0];
        insights.push({ icon: '🏆', text: `Most of your closed clients came from ${topClosedPlatform[0]}.` });
      }
    }
    const overdue = prospects.filter((p) => p.followup && new Date(p.followup) < new Date(new Date().toDateString())).length;
    if (overdue > 0) {
      insights.push({ icon: '⏰', text: `You have ${overdue} overdue follow-up${overdue > 1 ? 's' : ''} — check the Follow-ups page to catch up.` });
    }
    if (sentCount === 0) {
      insights.push({ icon: '📬', text: 'None of your prospects have been marked as sent yet — update statuses as you reach out to unlock accurate response-rate tracking.' });
    }
  }

  document.getElementById('smartInsights').innerHTML = insights.length
    ? insights.map((i) => `<div class="insight-item"><span class="ii-icon">${i.icon}</span><span>${escHtml(i.text)}</span></div>`).join('')
    : '<p class="muted">Add more prospects and update their statuses to unlock insights.</p>';

  // Best days to reach out — groups prospects by the weekday they were
  // added/contacted on, and shows how often that day leads to a real
  // conversion (Interested or Closed), so you know when it's worth pushing.
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const byDay = WEEKDAYS.map(() => ({ total: 0, converted: 0 }));
  prospects.forEach((p) => {
    if (!p.date) return;
    const d = new Date(p.date);
    if (isNaN(d.getTime())) return;
    const day = byDay[d.getDay()];
    day.total += 1;
    if (p.status === 'Interested' || p.status === 'Closed') day.converted += 1;
  });
  const hasDayData = byDay.some((d) => d.total > 0);
  document.getElementById('bestOutreachDays').innerHTML = hasDayData
    ? WEEKDAYS.map((name, i) => {
        const d = byDay[i];
        const rate = d.total ? Math.round((d.converted / d.total) * 100) : 0;
        return barHtml(`${name} (${d.total})`, rate, 100, 'var(--accent)');
      }).join('') + '<p class="muted mt-16">Bars show conversion rate (Interested/Closed ÷ total reached out) for prospects added on that weekday.</p>'
    : '<p class="muted">Add more prospects to see which days convert best.</p>';
}
