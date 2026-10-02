// Frame Flicks — home screen widget (small)
// Shows total earned (Paid income) and your next priority project deadline.
// Data source: your ClientTrack/Frame Flicks Supabase project.

// ---------- 1. FILL THESE IN ----------
const EMAIL = "YOUR_LOGIN_EMAIL";
const PASSWORD = "YOUR_LOGIN_PASSWORD";
// ---------------------------------------

const SUPABASE_URL = "https://vkuvdmqtlkrlanrzkfdz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrdXZkbXF0bGtybGFucnprZmR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxODc0NzMsImV4cCI6MjA5OTc2MzQ3M30.8jXiFrY-C4V5CpnLQpf_PHMr_YwsOS2CZrJWcd-RLx0";

const PRIORITY_RANK = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

async function login() {
  const req = new Request(`${SUPABASE_URL}/auth/v1/token?grant_type=password`);
  req.method = "POST";
  req.headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
  };
  req.body = JSON.stringify({ email: EMAIL, password: PASSWORD });
  const res = await req.loadJSON();
  if (!res.access_token) throw new Error("Login failed — check email/password");
  return res.access_token;
}

async function getIncome(accessToken) {
  const req = new Request(
    `${SUPABASE_URL}/rest/v1/app_data?select=value&key=eq.ve_ct_income`
  );
  req.headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
  };
  const rows = await req.loadJSON();
  if (!rows || !rows.length) return [];
  return rows[0].value || [];
}

function computeStats(income) {
  const totalEarned = income
    .filter((e) => e.status === "Paid")
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming = income
    .filter((e) => e.status !== "Paid" && e.dueDate)
    .map((e) => ({ ...e, due: new Date(e.dueDate) }))
    .filter((e) => !isNaN(e.due));

  upcoming.sort((a, b) => {
    const dateDiff = a.due - b.due;
    if (dateDiff !== 0) return dateDiff;
    const rankA = PRIORITY_RANK[a.priority] ?? 2;
    const rankB = PRIORITY_RANK[b.priority] ?? 2;
    return rankA - rankB;
  });

  const next = upcoming[0] || null;
  let dueLabel = "No upcoming deadlines";
  let projectLabel = "";
  if (next) {
    const diffDays = Math.round((next.due.setHours(0, 0, 0, 0) - today) / 86400000);
    projectLabel = next.project || next.client || "Untitled project";
    if (diffDays < 0) dueLabel = `${Math.abs(diffDays)}d overdue`;
    else if (diffDays === 0) dueLabel = "Due today";
    else if (diffDays === 1) dueLabel = "Due tomorrow";
    else dueLabel = `Due in ${diffDays} days`;
  }

  return { totalEarned, projectLabel, dueLabel };
}

function formatCurrency(n) {
  return "\u20b9" + Math.round(n).toLocaleString("en-IN");
}

function buildWidget(stats) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#111113");
  w.setPadding(16, 16, 16, 16);

  // Header
  const header = w.addStack();
  header.centerAlignContent();
  const icon = header.addText("\u25CF");
  icon.font = Font.systemFont(10);
  icon.textColor = new Color("#7F77DD");
  header.addSpacer(5);
  const label = header.addText("Frame flicks");
  label.font = Font.systemFont(10);
  label.textColor = new Color("#8A8A8E");

  w.addSpacer(10);

  // Total earned
  const earnedLabel = w.addText("Total earned");
  earnedLabel.font = Font.systemFont(10);
  earnedLabel.textColor = new Color("#8A8A8E");
  w.addSpacer(2);
  const earnedValue = w.addText(formatCurrency(stats.totalEarned));
  earnedValue.font = Font.mediumSystemFont(22);
  earnedValue.textColor = new Color("#5DCAA5");

  w.addSpacer();

  // Divider
  const divider = w.addStack();
  divider.size = new Size(0, 0.5);
  divider.backgroundColor = new Color("#2C2C2E");
  w.addSpacer(8);

  // Next deadline
  const projectText = w.addText(stats.projectLabel || "No projects");
  projectText.font = Font.mediumSystemFont(13);
  projectText.textColor = new Color("#F2F2F3");
  projectText.lineLimit = 1;
  w.addSpacer(1);
  const dueText = w.addText(stats.dueLabel);
  dueText.font = Font.systemFont(11);
  dueText.textColor = new Color("#F0997B");

  return w;
}

async function run() {
  try {
    const token = await login();
    const income = await getIncome(token);
    const stats = computeStats(income);
    const widget = buildWidget(stats);

    if (config.runsInWidget) {
      Script.setWidget(widget);
    } else {
      await widget.presentSmall();
    }
  } catch (err) {
    const w = new ListWidget();
    w.backgroundColor = new Color("#111113");
    const t = w.addText("Error: " + err.message);
    t.textColor = Color.red();
    t.font = Font.systemFont(11);
    if (config.runsInWidget) {
      Script.setWidget(w);
    } else {
      await w.presentSmall();
    }
  }
  Script.complete();
}

await run();
