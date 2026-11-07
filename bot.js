const http = require('http');
const { Telegraf, Markup } = require('telegraf');
const { message } = require('telegraf/filters');
const crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_ID = Number(process.env.ADMIN_ID || 6066529085);
const PORT = process.env.PORT || 8080;
const PAGE_SIZE = 8;
const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : '')
).replace(/\/+$/, '');

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN সেট করা নেই!');
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error('MONGODB_URI সেট করা নেই!');
  process.exit(1);
}

// ---------- ডাটাবেস ----------
const mongo = new MongoClient(MONGODB_URI);
let videos;
let users;
let tokens;
let settings;

// ---------- ডাটা ----------
const CATEGORIES = [
  { id: 'action', label: '💥 Action' },
  { id: 'comedy', label: '😂 Comedy' },
  { id: 'romance', label: '❤️ Romance' },
  { id: 'horror', label: '👻 Horror' },
  { id: 'thriller', label: '😱 Thriller' },
  { id: 'drama', label: '🎭 Drama' },
  { id: 'scifi', label: '🚀 Sci-Fi' },
  { id: 'animation', label: '🧸 Animation' },
  { id: 'documentary', label: '🎥 Documentary' },
  { id: 'crime', label: '🕵️ Crime' },
  { id: 'fantasy', label: '🧙 Fantasy' },
  { id: 'family', label: '👨‍👩‍👧 Family' },
];

// ---------- হেল্পার ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const short = (t, n = 35) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
const isAdmin = (ctx) => ctx.from && ctx.from.id === ADMIN_ID;
const catLabel = (id) => (CATEGORIES.find((c) => c.id === id) || { label: id }).label;
const validCat = (id) => CATEGORIES.some((c) => c.id === id);

function toId(str) {
  try {
    return new ObjectId(str);
  } catch {
    return null;
  }
}

function chunk(arr, size) {
  const rows = [];
  for (let i = 0; i < arr.length; i += size) rows.push(arr.slice(i, i + size));
  return rows;
}

async function safeEdit(ctx, text, keyboard) {
  try {
    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
  } catch (err) {
    const msg = String((err && err.description) || (err && err.message) || '');
    if (!msg.includes('message is not modified')) throw err;
  }
}

function backMenu(target) {
  return Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', target)]]);
}

async function sendMedia(ctx, v, protect = false) {
  const opts = { caption: `🎬 ${v.title}`, protect_content: protect };
  if (v.kind === 'document') return ctx.replyWithDocument(v.fileId, opts);
  return ctx.replyWithVideo(v.fileId, opts);
}

async function getSetting(key, def) {
  const d = await settings.findOne({ _id: key });
  return d ? d.value : def;
}
const setSetting = (key, value) =>
  settings.updateOne({ _id: key }, { $set: { value } }, { upsert: true });

function validAdUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'https:' && str.length <= 500;
  } catch {
    return false;
  }
}

// ---------- ইউজার মেনু ----------
const WELCOME_TEXT =
  '🎬 <b>CineNova Play-তে স্বাগতম!</b>\n\n' +
  'Free ও Premium ভিডিও, মজার সব ক্যাটাগরি — এক জায়গায়।\n' +
  'নিচের মেনু থেকে বেছে নিন 👇';

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🎞 Categories', 'menu:categories')],
    [Markup.button.callback('🔥 Viral Videos', 'vl:viral:0')],
    [Markup.button.callback('ℹ️ Help', 'menu:help')],
  ]);
}

function categoriesMenu() {
  const buttons = CATEGORIES.map((c) =>
    Markup.button.callback(c.label, `vl:${c.id}:0`)
  );
  const rows = chunk(buttons, 2);
  rows.push([Markup.button.callback('⬅️ Back', 'menu:main')]);
  return Markup.inlineKeyboard(rows);
}

async function videoListView(key, page) {
  const filter = key === 'viral' ? { viral: true } : { category: key };
  const title = key === 'viral' ? '🔥 <b>Viral Videos</b>' : `<b>${catLabel(key)}</b>`;
  const back = key === 'viral' ? 'menu:main' : 'menu:categories';
  const total = await videos.countDocuments(filter);
  if (!total) {
    return {
      text: `${title}\n\n🚧 এই সেকশনে এখনো কোনো ভিডিও নেই।`,
      keyboard: backMenu(back),
    };
  }
  const maxPage = Math.ceil(total / PAGE_SIZE) - 1;
  const p = Math.min(Math.max(page, 0), maxPage);
  const items = await videos
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(p * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();
  const rows = items.map((v) => [
    Markup.button.callback(
      `${v.access === 'ad' ? '🔒' : '▶️'} ${short(v.title)}`,
      `v:${v._id}`
    ),
  ]);
  const nav = [];
  if (p > 0) nav.push(Markup.button.callback('⬅️ Prev', `vl:${key}:${p - 1}`));
  if (p < maxPage) nav.push(Markup.button.callback('Next ➡️', `vl:${key}:${p + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback('⬅️ Back', back)]);
  return {
    text: `${title}\n\nমোট ${total}টি ভিডিও — একটি বেছে নিন 👇`,
    keyboard: Markup.inlineKeyboard(rows),
  };
}

// ---------- অ্যাডমিন ----------
// একজনই অ্যাডমিন, তাই একটিই স্টেট। রিডিপ্লয় হলে স্টেট রিসেট হয়।
let adminState = null;

const ADMIN_TEXT = '🛠 <b>Admin Panel</b>\n\nকী করতে চান?';

function adminMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('➕ Upload Video', 'adm:upload'),
      Markup.button.callback('🗂 Manage Videos', 'ml:0'),
    ],
    [
      Markup.button.callback('📊 Stats', 'adm:stats'),
      Markup.button.callback('📢 Broadcast', 'adm:bc'),
    ],
    [
      Markup.button.callback('🚫 Ban User', 'adm:ban'),
      Markup.button.callback('✅ Unban User', 'adm:unban'),
    ],
    [Markup.button.callback('⚙️ Ad Settings', 'adm:ads')],
  ]);
}

function cancelMenu() {
  return Markup.inlineKeyboard([[Markup.button.callback('❌ Cancel', 'adm:panel')]]);
}

function categoryPicker(prefix, back) {
  const buttons = CATEGORIES.map((c) =>
    Markup.button.callback(c.label, `${prefix}${c.id}`)
  );
  const rows = chunk(buttons, 2);
  rows.push([Markup.button.callback('❌ Cancel', back)]);
  return Markup.inlineKeyboard(rows);
}

async function videoDetail(id) {
  const v = await videos.findOne({ _id: id });
  if (!v) return null;
  const sid = String(v._id);
  const text =
    `🎬 <b>${esc(v.title)}</b>\n\n` +
    `📂 ${catLabel(v.category)}\n` +
    `🔥 Viral: ${v.viral ? 'হ্যাঁ' : 'না'}\n` +
    `${v.access === 'ad' ? '🔒 Ad-unlock' : '🔓 Free'}\n` +
    `👁 Views: ${v.views || 0}\n` +
    `🗓 ${v.createdAt.toISOString().slice(0, 10)}`;
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('✏️ Title', `ed:t:${sid}`),
      Markup.button.callback('📂 Category', `ed:c:${sid}`),
    ],
    [
      Markup.button.callback('🔥 Viral on/off', `ed:v:${sid}`),
      Markup.button.callback('🔒/🔓 Access', `ed:a:${sid}`),
    ],
    [
      Markup.button.callback('▶️ Preview', `ed:p:${sid}`),
      Markup.button.callback('🗑 Delete', `dl:${sid}`),
    ],
    [Markup.button.callback('⬅️ Back', 'ml:0')],
  ]);
  return { text, keyboard };
}

async function showDetail(ctx, idStr, edit = true) {
  const id = toId(idStr);
  const d = id && (await videoDetail(id));
  if (!d) {
    const t = '❌ ভিডিওটি পাওয়া যায়নি।';
    return edit ? safeEdit(ctx, t, backMenu('ml:0')) : ctx.reply(t, backMenu('ml:0'));
  }
  return edit
    ? safeEdit(ctx, d.text, d.keyboard)
    : ctx.reply(d.text, { parse_mode: 'HTML', ...d.keyboard });
}

function adminAction(pattern, handler) {
  bot.action(pattern, async (ctx) => {
    if (!isAdmin(ctx)) {
      return ctx.answerCbQuery('⛔ শুধু অ্যাডমিনের জন্য।', { show_alert: true });
    }
    await ctx.answerCbQuery();
    await handler(ctx);
  });
}

// ---------- বট ----------
const bot = new Telegraf(BOT_TOKEN);

const bannedIds = new Set();
const knownUsers = new Set();

// ব্যান চেক + ইউজার সেভ
bot.use(async (ctx, next) => {
  const from = ctx.from;
  if (!from) return next();
  if (from.id !== ADMIN_ID && bannedIds.has(from.id)) {
    if (ctx.callbackQuery) {
      await ctx
        .answerCbQuery('⛔ আপনাকে ব্লক করা হয়েছে।', { show_alert: true })
        .catch(() => {});
    }
    return;
  }
  if (!knownUsers.has(from.id)) {
    knownUsers.add(from.id);
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ');
    await users
      .updateOne(
        { _id: from.id },
        {
          $set: { name, username: from.username || null, lastSeen: new Date() },
          $setOnInsert: { joinedAt: new Date(), banned: false },
        },
        { upsert: true }
      )
      .catch((e) => console.error('user save error:', e));
  }
  return next();
});

// ---------- কমান্ড ----------
bot.start((ctx) => ctx.reply(WELCOME_TEXT, { parse_mode: 'HTML', ...mainMenu() }));
bot.command('menu', (ctx) =>
  ctx.reply(WELCOME_TEXT, { parse_mode: 'HTML', ...mainMenu() })
);
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx)) return;
  adminState = null;
  await ctx.reply(ADMIN_TEXT, { parse_mode: 'HTML', ...adminMenu() });
});

// ---------- ইউজার বাটন ----------
bot.action('menu:main', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, WELCOME_TEXT, mainMenu());
});

bot.action('menu:categories', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, '🎞 <b>একটি ক্যাটাগরি বেছে নিন:</b>', categoriesMenu());
});

bot.action('menu:help', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(
    ctx,
    'ℹ️ <b>Help</b>\n\n/start — মেইন মেনু\n/menu — মেনু আবার দেখুন',
    backMenu('menu:main')
  );
});

bot.action(/^vl:([a-z]+):(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const key = ctx.match[1];
  if (key !== 'viral' && !validCat(key)) return;
  const view = await videoListView(key, Number(ctx.match[2]));
  await safeEdit(ctx, view.text, view.keyboard);
});

async function deliver(ctx, v) {
  try {
    await sendMedia(ctx, v, v.access === 'ad');
    await videos.updateOne(
      { _id: v._id },
      { $inc: { views: 1, ...(v.access === 'ad' ? { unlocks: 1 } : {}) } }
    );
  } catch (err) {
    console.error('sendMedia error:', err);
    await ctx.reply('⚠️ ভিডিওটি পাঠানো যায়নি। একটু পরে আবার চেষ্টা করুন।');
  }
}

async function startGate(ctx, v) {
  const adUrl = await getSetting('adUrl', null);
  if (!adUrl || !PUBLIC_URL) {
    console.warn('Ad gate বন্ধ: Ad Link বা PUBLIC_URL সেট নেই, ভিডিও সরাসরি দেওয়া হচ্ছে।');
    return deliver(ctx, v);
  }
  const wait = Number(await getSetting('waitSeconds', 10));
  const token = crypto.randomBytes(16).toString('hex');
  await tokens.insertOne({
    _id: token,
    userId: ctx.from.id,
    videoId: v._id,
    createdAt: new Date(),
    openedAt: null,
    used: false,
  });
  await ctx.reply(
    `🔒 <b>${esc(v.title)}</b>\n\nভিডিওটি আনলক করতে:\n` +
      `1️⃣ <b>Watch Ad</b> বাটনে চাপ দিয়ে অ্যাড পেজটি খুলুন\n` +
      `2️⃣ পেজে ${wait} সেকেন্ড থাকুন\n` +
      `3️⃣ এখানে ফিরে <b>Unlock Video</b> চাপুন`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url('📺 Watch Ad', `${PUBLIC_URL}/watch/${token}`)],
        [Markup.button.callback('🔓 Unlock Video', `uk:${token}`)],
      ]),
    }
  );
}

bot.action(/^v:([a-f0-9]{24})$/, async (ctx) => {
  const id = toId(ctx.match[1]);
  const v = id && (await videos.findOne({ _id: id }));
  if (!v) {
    return ctx.answerCbQuery('ভিডিওটি পাওয়া যায়নি।', { show_alert: true });
  }
  await ctx.answerCbQuery();
  if (v.access === 'ad') return startGate(ctx, v);
  return deliver(ctx, v);
});

bot.action(/^uk:([a-f0-9]{32})$/, async (ctx) => {
  const t = await tokens.findOne({ _id: ctx.match[1] });
  if (!t || t.userId !== ctx.from.id) {
    return ctx.answerCbQuery('⚠️ লিংকটির মেয়াদ শেষ। ভিডিওতে আবার ক্লিক করুন।', {
      show_alert: true,
    });
  }
  if (t.used) {
    return ctx.answerCbQuery('এই লিংকটি আগেই ব্যবহার হয়েছে।', { show_alert: true });
  }
  if (!t.openedAt) {
    return ctx.answerCbQuery('আগে "Watch Ad" চেপে অ্যাড পেজ খুলুন।', { show_alert: true });
  }
  const wait = Number(await getSetting('waitSeconds', 10));
  const elapsed = (Date.now() - t.openedAt.getTime()) / 1000;
  if (elapsed < wait) {
    return ctx.answerCbQuery(`⏳ আরও ${Math.ceil(wait - elapsed)} সেকেন্ড অপেক্ষা করুন।`, {
      show_alert: true,
    });
  }
  const claim = await tokens.updateOne(
    { _id: t._id, used: false },
    { $set: { used: true, usedAt: new Date() } }
  );
  if (!claim.modifiedCount) {
    return ctx.answerCbQuery('এই লিংকটি আগেই ব্যবহার হয়েছে।', { show_alert: true });
  }
  const v = await videos.findOne({ _id: t.videoId });
  if (!v) {
    return ctx.answerCbQuery('ভিডিওটি পাওয়া যায়নি।', { show_alert: true });
  }
  await ctx.answerCbQuery('✅ আনলক হয়েছে!');
  await deliver(ctx, v);
  await safeEdit(ctx, '✅ <b>আনলক হয়েছে!</b> ভিডিও উপরে/নিচে পাঠানো হয়েছে।', backMenu('menu:main')).catch(
    () => {}
  );
});

// ---------- অ্যাডমিন: প্যানেল ----------
adminAction('adm:panel', async (ctx) => {
  adminState = null;
  await safeEdit(ctx, ADMIN_TEXT, adminMenu());
});

// ---------- অ্যাডমিন: আপলোড ----------
adminAction('adm:upload', async (ctx) => {
  adminState = { step: 'video', data: {} };
  await safeEdit(
    ctx,
    '➕ <b>Upload</b>\n\nএকটি ভিডিও পাঠান (ভিডিও বা ফাইল হিসেবে)।',
    cancelMenu()
  );
});

adminAction(/^up:cat:([a-z]+)$/, async (ctx) => {
  if (!adminState || adminState.step !== 'category' || !validCat(ctx.match[1])) {
    return safeEdit(ctx, '⚠️ সেশন শেষ। /admin দিয়ে আবার শুরু করুন।', backMenu('adm:panel'));
  }
  adminState.data.category = ctx.match[1];
  adminState.step = 'viral';
  await safeEdit(
    ctx,
    '🔥 ভিডিওটি কি <b>Viral</b> লিস্টে থাকবে?',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🔥 হ্যাঁ, Viral', 'up:vir:1'),
        Markup.button.callback('না, Normal', 'up:vir:0'),
      ],
      [Markup.button.callback('❌ Cancel', 'adm:panel')],
    ])
  );
});

adminAction(/^up:vir:([01])$/, async (ctx) => {
  if (!adminState || adminState.step !== 'viral') {
    return safeEdit(ctx, '⚠️ সেশন শেষ। /admin দিয়ে আবার শুরু করুন।', backMenu('adm:panel'));
  }
  adminState.data.viral = ctx.match[1] === '1';
  adminState.step = 'access';
  await safeEdit(
    ctx,
    '🔐 অ্যাক্সেস টাইপ বেছে নিন:',
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🔓 Free', 'up:acc:free'),
        Markup.button.callback('🔒 Ad-unlock', 'up:acc:ad'),
      ],
      [Markup.button.callback('❌ Cancel', 'adm:panel')],
    ])
  );
});

adminAction(/^up:acc:(free|ad)$/, async (ctx) => {
  if (!adminState || adminState.step !== 'access') {
    return safeEdit(ctx, '⚠️ সেশন শেষ। /admin দিয়ে আবার শুরু করুন।', backMenu('adm:panel'));
  }
  const d = adminState.data;
  const doc = {
    title: d.title,
    category: d.category,
    viral: d.viral,
    access: ctx.match[1],
    fileId: d.fileId,
    fileUniqueId: d.fileUniqueId,
    kind: d.kind,
    views: 0,
    createdAt: new Date(),
  };
  const res = await videos.insertOne(doc);
  adminState = null;
  await safeEdit(
    ctx,
    `✅ <b>সেভ হয়েছে!</b>\n\n🎬 ${esc(doc.title)}\n📂 ${catLabel(doc.category)}\n` +
      `🔥 Viral: ${doc.viral ? 'হ্যাঁ' : 'না'}\n${doc.access === 'ad' ? '🔒 Ad-unlock' : '🔓 Free'}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Edit', `mv:${res.insertedId}`)],
      [
        Markup.button.callback('➕ আরেকটি Upload', 'adm:upload'),
        Markup.button.callback('⬅️ Panel', 'adm:panel'),
      ],
    ])
  );
});

// ---------- অ্যাডমিন: ম্যানেজ (লিস্ট / এডিট / ডিলিট) ----------
adminAction(/^ml:(\d+)$/, async (ctx) => {
  adminState = null;
  const total = await videos.countDocuments({});
  if (!total) {
    return safeEdit(ctx, '🗂 এখনো কোনো ভিডিও নেই।', backMenu('adm:panel'));
  }
  const maxPage = Math.ceil(total / PAGE_SIZE) - 1;
  const p = Math.min(Number(ctx.match[1]), maxPage);
  const items = await videos
    .find({})
    .sort({ createdAt: -1 })
    .skip(p * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();
  const rows = items.map((v) => [
    Markup.button.callback(
      `${v.viral ? '🔥' : ''}${v.access === 'ad' ? '🔒' : '🔓'} ${short(v.title)}`,
      `mv:${v._id}`
    ),
  ]);
  const nav = [];
  if (p > 0) nav.push(Markup.button.callback('⬅️ Prev', `ml:${p - 1}`));
  if (p < maxPage) nav.push(Markup.button.callback('Next ➡️', `ml:${p + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback('⬅️ Panel', 'adm:panel')]);
  await safeEdit(
    ctx,
    `🗂 <b>Manage Videos</b>\n\nমোট ${total}টি — একটি বেছে নিন:`,
    Markup.inlineKeyboard(rows)
  );
});

adminAction(/^mv:([a-f0-9]{24})$/, async (ctx) => {
  adminState = null;
  await showDetail(ctx, ctx.match[1]);
});

adminAction(/^ed:t:([a-f0-9]{24})$/, async (ctx) => {
  adminState = { step: 'edit_title', data: { id: ctx.match[1] } };
  await safeEdit(
    ctx,
    '✏️ নতুন <b>টাইটেল</b> লিখে পাঠান:',
    backMenu(`mv:${ctx.match[1]}`)
  );
});

adminAction(/^ed:c:([a-f0-9]{24})$/, async (ctx) => {
  await safeEdit(
    ctx,
    '📂 নতুন ক্যাটাগরি বেছে নিন:',
    categoryPicker(`ed:sc:${ctx.match[1]}:`, `mv:${ctx.match[1]}`)
  );
});

adminAction(/^ed:sc:([a-f0-9]{24}):([a-z]+)$/, async (ctx) => {
  const id = toId(ctx.match[1]);
  if (id && validCat(ctx.match[2])) {
    await videos.updateOne({ _id: id }, { $set: { category: ctx.match[2] } });
  }
  await showDetail(ctx, ctx.match[1]);
});

adminAction(/^ed:v:([a-f0-9]{24})$/, async (ctx) => {
  const id = toId(ctx.match[1]);
  if (id) {
    await videos.updateOne({ _id: id }, [{ $set: { viral: { $not: ['$viral'] } } }]);
  }
  await showDetail(ctx, ctx.match[1]);
});

adminAction(/^ed:a:([a-f0-9]{24})$/, async (ctx) => {
  const id = toId(ctx.match[1]);
  if (id) {
    await videos.updateOne({ _id: id }, [
      { $set: { access: { $cond: [{ $eq: ['$access', 'ad'] }, 'free', 'ad'] } } },
    ]);
  }
  await showDetail(ctx, ctx.match[1]);
});

adminAction(/^ed:p:([a-f0-9]{24})$/, async (ctx) => {
  const id = toId(ctx.match[1]);
  const v = id && (await videos.findOne({ _id: id }));
  if (!v) return;
  try {
    await sendMedia(ctx, v);
  } catch (err) {
    await ctx.reply(`⚠️ প্রিভিউ পাঠানো যায়নি: ${err.message}`);
  }
});

adminAction(/^dl:([a-f0-9]{24})$/, async (ctx) => {
  const id = toId(ctx.match[1]);
  const v = id && (await videos.findOne({ _id: id }));
  if (!v) return showDetail(ctx, ctx.match[1]);
  await safeEdit(
    ctx,
    `⚠️ <b>ডিলিট করবেন?</b>\n\n🎬 ${esc(v.title)}\n\nএটা আর ফেরানো যাবে না।`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ হ্যাঁ, ডিলিট', `dy:${ctx.match[1]}`),
        Markup.button.callback('❌ না', `mv:${ctx.match[1]}`),
      ],
    ])
  );
});

adminAction(/^dy:([a-f0-9]{24})$/, async (ctx) => {
  const id = toId(ctx.match[1]);
  if (id) await videos.deleteOne({ _id: id });
  await safeEdit(ctx, '🗑 ভিডিওটি ডিলিট হয়েছে।', backMenu('ml:0'));
});

// ---------- অ্যাডমিন: Ad Settings ----------
adminAction('adm:ads', async (ctx) => {
  adminState = null;
  const adUrl = await getSetting('adUrl', null);
  const wait = await getSetting('waitSeconds', 10);
  await safeEdit(
    ctx,
    '⚙️ <b>Ad Settings</b>\n\n' +
      `🔗 Ad Link: ${adUrl ? `<code>${esc(adUrl)}</code>` : '❌ সেট করা নেই'}\n` +
      `⏱ অপেক্ষার সময়: ${wait} সেকেন্ড\n` +
      `🌐 Gate URL: ${PUBLIC_URL ? `<code>${esc(PUBLIC_URL)}</code>` : '❌ সেট নেই'}`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback('🔗 Set Ad Link', 'ads:url'),
        Markup.button.callback('⏱ Set Wait Time', 'ads:wait'),
      ],
      [Markup.button.callback('🗑 Remove Ad Link', 'ads:rm')],
      [Markup.button.callback('⬅️ Panel', 'adm:panel')],
    ])
  );
});

adminAction('ads:url', async (ctx) => {
  adminState = { step: 'set_adurl', data: {} };
  await safeEdit(
    ctx,
    '🔗 আপনার <b>Adsterra Direct Link</b> পাঠান (https দিয়ে শুরু হতে হবে):',
    backMenu('adm:ads')
  );
});

adminAction('ads:wait', async (ctx) => {
  adminState = { step: 'set_wait', data: {} };
  await safeEdit(
    ctx,
    '⏱ অ্যাড পেজে কত <b>সেকেন্ড</b> অপেক্ষা করতে হবে? (৩ থেকে ৬০):',
    backMenu('adm:ads')
  );
});

adminAction('ads:rm', async (ctx) => {
  await settings.deleteOne({ _id: 'adUrl' });
  await safeEdit(
    ctx,
    '🗑 Ad Link মুছে ফেলা হয়েছে। নতুন লিংক না দেওয়া পর্যন্ত 🔒 ভিডিও সরাসরি যাবে।',
    backMenu('adm:ads')
  );
});

// ---------- অ্যাডমিন: স্ট্যাটস ----------
adminAction('adm:stats', async (ctx) => {
  const [totalUsers, bannedUsers, totalVideos, viralVideos, adVideos, agg] =
    await Promise.all([
      users.countDocuments({}),
      users.countDocuments({ banned: true }),
      videos.countDocuments({}),
      videos.countDocuments({ viral: true }),
      videos.countDocuments({ access: 'ad' }),
      videos
        .aggregate([
          { $group: { _id: null, views: { $sum: '$views' }, unlocks: { $sum: '$unlocks' } } },
        ])
        .toArray(),
    ]);
  const views = agg[0] ? agg[0].views : 0;
  const unlocks = agg[0] ? agg[0].unlocks : 0;
  await safeEdit(
    ctx,
    '📊 <b>Stats</b>\n\n' +
      `👥 ইউজার: ${totalUsers}\n🚫 ব্যান: ${bannedUsers}\n\n` +
      `🎬 ভিডিও: ${totalVideos}\n🔥 Viral: ${viralVideos}\n🔒 Ad-unlock: ${adVideos}\n` +
      `👁 মোট Views: ${views}\n🔓 মোট Unlock (অ্যাড দেখে): ${unlocks}`,
    backMenu('adm:panel')
  );
});

// ---------- অ্যাডমিন: ব্রডকাস্ট ----------
adminAction('adm:bc', async (ctx) => {
  adminState = { step: 'broadcast', data: {} };
  await safeEdit(
    ctx,
    '📢 <b>Broadcast</b>\n\nযে মেসেজটি সবাইকে পাঠাতে চান সেটি পাঠান (টেক্সট, ছবি বা ভিডিও — যা খুশি)।',
    cancelMenu()
  );
});

adminAction('bc:yes', async (ctx) => {
  if (!adminState || adminState.step !== 'bc_confirm') {
    return safeEdit(ctx, '⚠️ সেশন শেষ। /admin দিয়ে আবার শুরু করুন।', backMenu('adm:panel'));
  }
  const { chatId, messageId } = adminState.data;
  adminState = null;
  const targets = await users.find({ banned: { $ne: true } }).project({ _id: 1 }).toArray();
  await safeEdit(ctx, `📢 ${targets.length} জনকে পাঠানো শুরু হয়েছে...`, backMenu('adm:panel'));
  // আলাদা করে চালানো হয়, যাতে হ্যান্ডলার টাইমআউট না হয়
  (async () => {
    let ok = 0;
    let fail = 0;
    for (const u of targets) {
      try {
        await ctx.telegram.copyMessage(u._id, chatId, messageId);
        ok++;
      } catch {
        fail++;
      }
      await sleep(60);
    }
    await ctx.telegram
      .sendMessage(ADMIN_ID, `✅ ব্রডকাস্ট শেষ।\nসফল: ${ok}\nব্যর্থ: ${fail}`)
      .catch(() => {});
  })();
});

// ---------- অ্যাডমিন: ব্যান / আনব্যান ----------
adminAction('adm:ban', async (ctx) => {
  adminState = { step: 'ban', data: {} };
  await safeEdit(ctx, '🚫 যাকে ব্যান করবেন তার <b>Telegram ইউজার আইডি</b> (সংখ্যা) পাঠান:', cancelMenu());
});

adminAction('adm:unban', async (ctx) => {
  adminState = { step: 'unban', data: {} };
  await safeEdit(ctx, '✅ যাকে আনব্যান করবেন তার <b>Telegram ইউজার আইডি</b> (সংখ্যা) পাঠান:', cancelMenu());
});

// ---------- মেসেজ হ্যান্ডলার ----------
// ব্রডকাস্টের মেসেজ ধরা (যেকোনো ধরনের মেসেজ)
bot.on('message', async (ctx, next) => {
  if (!isAdmin(ctx) || !adminState || adminState.step !== 'broadcast') return next();
  if (ctx.message.text && ctx.message.text.startsWith('/')) return next();
  adminState = {
    step: 'bc_confirm',
    data: { chatId: ctx.chat.id, messageId: ctx.message.message_id },
  };
  const count = await users.countDocuments({ banned: { $ne: true } });
  await ctx.reply(
    `📢 এই মেসেজটি <b>${count}</b> জন ইউজারকে পাঠাবেন?`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ পাঠান', 'bc:yes'),
          Markup.button.callback('❌ বাতিল', 'adm:panel'),
        ],
      ]),
    }
  );
});

// অ্যাডমিনের টেক্সট ইনপুট (টাইটেল, ইউজার আইডি)
bot.on(message('text'), async (ctx, next) => {
  if (!isAdmin(ctx) || !adminState) return next();
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return next();
  const st = adminState;

  if (st.step === 'title') {
    st.data.title = text.slice(0, 100);
    st.step = 'category';
    return ctx.reply('📂 ক্যাটাগরি বেছে নিন:', categoryPicker('up:cat:', 'adm:panel'));
  }

  if (st.step === 'edit_title') {
    const id = toId(st.data.id);
    adminState = null;
    if (id) await videos.updateOne({ _id: id }, { $set: { title: text.slice(0, 100) } });
    return showDetail(ctx, String(st.data.id), false);
  }

  if (st.step === 'set_adurl') {
    if (!validAdUrl(text)) {
      return ctx.reply('⚠️ সঠিক https লিংক দিন (যেমন https://...)।', cancelMenu());
    }
    adminState = null;
    await setSetting('adUrl', text);
    return ctx.reply('✅ Ad Link সেভ হয়েছে।', backMenu('adm:ads'));
  }

  if (st.step === 'set_wait') {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 3 || n > 60) {
      return ctx.reply('⚠️ ৩ থেকে ৬০ এর মধ্যে একটি সংখ্যা দিন।', cancelMenu());
    }
    adminState = null;
    await setSetting('waitSeconds', n);
    return ctx.reply(`✅ অপেক্ষার সময় ${n} সেকেন্ড করা হয়েছে।`, backMenu('adm:ads'));
  }

  if (st.step === 'ban' || st.step === 'unban') {
    const uid = Number(text);
    if (!Number.isInteger(uid) || uid <= 0) {
      return ctx.reply('⚠️ সঠিক সংখ্যার ইউজার আইডি দিন।', cancelMenu());
    }
    if (uid === ADMIN_ID) {
      return ctx.reply('⚠️ নিজেকে ব্যান করা যায় না।', cancelMenu());
    }
    const ban = st.step === 'ban';
    adminState = null;
    await users.updateOne(
      { _id: uid },
      { $set: { banned: ban }, $setOnInsert: { joinedAt: new Date() } },
      { upsert: true }
    );
    if (ban) bannedIds.add(uid);
    else bannedIds.delete(uid);
    return ctx.reply(
      ban ? `🚫 ${uid} ব্যান হয়েছে।` : `✅ ${uid} আনব্যান হয়েছে।`,
      adminMenu()
    );
  }

  return next();
});

// ভিডিও/ফাইল: আপলোড স্টেপে থাকলে আপলোড, নইলে শুধু File ID দেখায়
async function handleMedia(ctx, media, kind) {
  if (!isAdmin(ctx)) return;
  if (adminState && adminState.step === 'video') {
    adminState = {
      step: 'title',
      data: { fileId: media.file_id, fileUniqueId: media.file_unique_id, kind },
    };
    return ctx.reply('✏️ ভিডিওর <b>টাইটেল</b> লিখে পাঠান:', {
      parse_mode: 'HTML',
      ...cancelMenu(),
    });
  }
  await ctx.reply(
    `✅ File ID:\n\n<code>${media.file_id}</code>\n\nUnique ID:\n<code>${media.file_unique_id}</code>`,
    {
      parse_mode: 'HTML',
      reply_parameters: { message_id: ctx.message.message_id },
    }
  );
}

bot.on(message('video'), (ctx) => handleMedia(ctx, ctx.message.video, 'video'));
bot.on(message('document'), (ctx) => handleMedia(ctx, ctx.message.document, 'document'));

// বাকি যেকোনো টেক্সটে
bot.on(message('text'), (ctx) => ctx.reply('মেনু দেখতে /start দিন 👇'));

bot.catch((err, ctx) => {
  console.error(`Error (update ${ctx.update.update_id}):`, err);
});

// ---------- ওয়েব সার্ভার (হেলথ-চেক + অ্যাড পেজ) ----------
function expiredPage() {
  return `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CineNova Play</title></head><body style="font-family:system-ui,sans-serif;background:#0f1222;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px;text-align:center"><div><h2>⚠️ লিংকটির মেয়াদ শেষ</h2><p>টেলিগ্রামে ফিরে ভিডিওতে আবার ক্লিক করুন।</p></div></body></html>`;
}

function renderWatchPage(token, adUrl, wait, botUser) {
  const adJson = JSON.stringify(adUrl).replace(/</g, '\\u003c');
  const safeBot = String(botUser).replace(/[^A-Za-z0-9_]/g, '');
  const w = Number(wait) || 10;
  return `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>CineNova Play</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#0f1222;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}
.card{max-width:420px;width:100%;background:#1a1f3a;border-radius:16px;padding:24px;text-align:center}
.muted{color:#9aa3c7;font-size:14px}
button,a.btn{display:block;width:100%;padding:14px;border:0;border-radius:12px;font-size:16px;font-weight:600;background:#ff4d4f;color:#fff;text-decoration:none;margin-top:16px;cursor:pointer;box-sizing:border-box}
#timer{font-size:44px;font-weight:700;margin:12px 0}
.hide{display:none}
</style>
</head>
<body>
<div class="card">
  <h2>🎬 CineNova Play</h2>
  <p class="muted">ভিডিও আনলক করতে নিচের ধাপগুলো অনুসরণ করুন</p>
  <div id="step1">
    <p>১. নিচের বাটনে চাপ দিয়ে অ্যাড পেজটি খুলুন</p>
    <button id="openBtn">📺 Open Ad</button>
  </div>
  <div id="step2" class="hide">
    <p>২. অ্যাড পেজে অন্তত <b>${w}</b> সেকেন্ড থাকুন, তারপর এখানে ফিরে আসুন</p>
    <div id="timer">${w}</div>
  </div>
  <div id="step3" class="hide">
    <p>✅ হয়ে গেছে! এবার টেলিগ্রামে ফিরে <b>Unlock Video</b> বাটন চাপুন।</p>
    <a class="btn" href="https://t.me/${safeBot}">টেলিগ্রামে ফিরুন</a>
  </div>
</div>
<script>
var TOKEN = "${token}";
var AD_URL = ${adJson};
var WAIT = ${w};
var started = false;

function startTimer() {
  document.getElementById('step2').className = '';
  var left = WAIT;
  var el = document.getElementById('timer');
  el.textContent = left;
  var iv = setInterval(function () {
    left--;
    el.textContent = left > 0 ? left : 0;
    if (left <= 0) {
      clearInterval(iv);
      document.getElementById('step2').className = 'hide';
      document.getElementById('step3').className = '';
    }
  }, 1000);
}

document.getElementById('openBtn').onclick = function () {
  var win = window.open(AD_URL, '_blank');
  var p = fetch('/api/opened/' + TOKEN, { method: 'POST' }).catch(function () {});
  if (!win) {
    p.then(function () { location.href = AD_URL; });
    return;
  }
  if (!started) { started = true; startTimer(); }
};
</script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const path = (req.url || '/').split('?')[0];

    let m = path.match(/^\/watch\/([a-f0-9]{32})$/);
    if (req.method === 'GET' && m) {
      const t = tokens ? await tokens.findOne({ _id: m[1] }) : null;
      const adUrl = settings ? await getSetting('adUrl', null) : null;
      res.setHeader('Cache-Control', 'no-store');
      if (!t || t.used || !adUrl) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(expiredPage());
      }
      const wait = Number(await getSetting('waitSeconds', 10));
      const botUser = (bot.botInfo && bot.botInfo.username) || 'CineNovaPlayBot';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(renderWatchPage(m[1], adUrl, wait, botUser));
    }

    m = path.match(/^\/api\/opened\/([a-f0-9]{32})$/);
    if (req.method === 'POST' && m) {
      if (tokens) {
        await tokens.updateOne(
          { _id: m[1], used: false, openedAt: null },
          { $set: { openedAt: new Date() } }
        );
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('CineNova Play bot is running');
  } catch (err) {
    console.error('HTTP error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('error');
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`HTTP server চালু: ${PORT}`));

// ---------- চালু ----------
async function main() {
  await mongo.connect();
  const db = mongo.db('cinenova');
  videos = db.collection('videos');
  users = db.collection('users');
  tokens = db.collection('tokens');
  settings = db.collection('settings');
  await videos.createIndex({ category: 1, createdAt: -1 });
  await videos.createIndex({ viral: 1, createdAt: -1 });
  await tokens.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 });
  const banned = await users.find({ banned: true }).project({ _id: 1 }).toArray();
  banned.forEach((u) => bannedIds.add(u._id));
  console.log('MongoDB সংযুক্ত ✅');

  bot
    .launch({ dropPendingUpdates: true }, () => {
      console.log('CineNova Play bot চালু হয়েছে ✅');
    })
    .catch((err) => {
      console.error('Bot launch error:', err);
      process.exit(1);
    });
}

main().catch((err) => {
  console.error('Startup error:', err);
  process.exit(1);
});

const shutdown = (sig) => {
  try {
    bot.stop(sig);
  } catch {}
  mongo.close().catch(() => {});
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
