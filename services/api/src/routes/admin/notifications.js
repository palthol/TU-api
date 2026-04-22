import { postDiscordWebhook } from '../../services/discord.js';

const fmtMoney = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return '?';
  return x.toFixed(2);
};

const buildReminderLines = (rows) => {
  const overdue = (rows || []).filter((r) => r.reminder_bucket === 'overdue');
  const dueSoon = (rows || []).filter((r) => r.reminder_bucket === 'due_soon');
  const lines = [];
  lines.push(`**Overdue (${overdue.length})**`);
  if (!overdue.length) lines.push('— none');
  else {
    for (const r of overdue) {
      lines.push(
        `• ${r.name} — $${fmtMoney(r.actual_price)} due ${r.next_due_date} (${r.days_late}d late)`,
      );
    }
  }
  lines.push('');
  lines.push(`**Due soon (${dueSoon.length})**`);
  if (!dueSoon.length) lines.push('— none');
  else {
    for (const r of dueSoon) {
      lines.push(`• ${r.name} — $${fmtMoney(r.actual_price)} due ${r.next_due_date}`);
    }
  }
  return lines.join('\n');
};

/**
 * Admin-triggered notifications (e.g. Discord webhooks for billing reminders).
 * @param {import('express').Router} router
 * @param {{ supabase: import('@supabase/supabase-js').SupabaseClient | null }} ctx
 */
export function registerAdminNotificationRoutes(router, { supabase }) {
  router.post('/notifications/discord/payment-reminders', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
      if (!webhookUrl) return res.status(500).json({ ok: false, error: 'discord_webhook_not_configured' });

      const { data, error } = await supabase
        .from('view_member_payment_reminders')
        .select('name, next_due_date, days_late, reminder_bucket, actual_price')
        .order('next_due_date', { ascending: true });
      if (error) return res.status(400).json({ ok: false, error: error.message });

      const rows = data ?? [];
      const header = '**Payment reminders** (overdue + due in 3 days)\n';
      const body = buildReminderLines(rows);
      const content = `${header}\n${body}`;
      await postDiscordWebhook(webhookUrl, content);
      return res.json({ ok: true, posted: true, rowCount: rows.length });
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : 'server_error';
      if (String(msg).startsWith('discord_')) {
        return res.status(502).json({ ok: false, error: msg });
      }
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.post('/notifications/discord/daily-digest', async (req, res) => {
    try {
      if (!supabase) return res.status(500).json({ ok: false, error: 'supabase_not_configured' });
      const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
      if (!webhookUrl) return res.status(500).json({ ok: false, error: 'discord_webhook_not_configured' });

      const today = new Date().toISOString().slice(0, 10);

      const { data: reminderRows, error: remErr } = await supabase
        .from('view_member_payment_reminders')
        .select('name, next_due_date, days_late, reminder_bucket, actual_price')
        .order('next_due_date', { ascending: true });
      if (remErr) return res.status(400).json({ ok: false, error: remErr.message });

      const rows = reminderRows ?? [];
      const overdue = rows.filter((r) => r.reminder_bucket === 'overdue');
      const dueSoon = rows.filter((r) => r.reminder_bucket === 'due_soon');

      let leads24h = 0;
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count, error: leadErr } = await supabase
        .from('marketing_leads')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since);
      if (!leadErr && typeof count === 'number') leads24h = count;

      const reminderBlock = buildReminderLines(rows);
      const digest = [
        `**Temple Underground — daily digest (${today})**`,
        '',
        `New marketing leads (24h): **${leads24h}**`,
        `Open payment reminders: **${rows.length}** (${overdue.length} overdue, ${dueSoon.length} due soon)`,
        '',
        reminderBlock,
      ].join('\n');

      await postDiscordWebhook(webhookUrl, digest);
      return res.json({
        ok: true,
        posted: true,
        summary: {
          date: today,
          reminderTotal: rows.length,
          overdueCount: overdue.length,
          dueSoonCount: dueSoon.length,
          marketingLeads24h: leads24h,
        },
      });
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : 'server_error';
      if (String(msg).startsWith('discord_')) {
        return res.status(502).json({ ok: false, error: msg });
      }
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
