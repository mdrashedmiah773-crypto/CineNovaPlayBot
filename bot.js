const http = require('http');
const { Telegraf, Markup } = require('telegraf');
const { message } = require('telegraf/filters');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID || 6066529085);
const PORT = process.env.PORT || 8080;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN সেট করা নেই!');
  process.exit(1);
}

// ---------- Fly.io হেলথ-চেকের জন্য ছোট ওয়েব সার্ভার ----------
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('CineNova Play bot is running');
  })
  .listen(PORT, '0.0.0.0', () => console.log(`HTTP server চালু: ${PORT}`));

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

// ---------- মেনু ----------
const WELCOME_TEXT =
  '🎬 <b>CineNova Play-তে স্বাগতম!</b>\n\n' +
  'Free ও Premium ভিডিও, মজার সব ক্যাটাগরি — এক জায়গায়।\n' +
  'নিচের মেনু থেকে বেছে নিন 👇';

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🎞 Categories', 'menu:categories')],
    [Markup.button.callback('🔥 Viral Videos', 'menu:viral')],
    [Markup.button.callback('ℹ️ Help', 'menu:help')],
  ]);
}

function categoriesMenu() {
  const buttons = CATEGORIES.map((c) =>
    Markup.button.callback(c.label, `cat:${c.id}`)
  );
  const rows = chunk(buttons, 2);
  rows.push([Markup.button.callback('⬅️ Back', 'menu:main')]);
  return Markup.inlineKeyboard(rows);
}

function backMenu(target) {
  return Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', target)]]);
}

// ---------- বট ----------
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => ctx.reply(WELCOME_TEXT, { parse_mode: 'HTML', ...mainMenu() }));
bot.command('menu', (ctx) =>
  ctx.reply(WELCOME_TEXT, { parse_mode: 'HTML', ...mainMenu() })
);

bot.action('menu:main', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, WELCOME_TEXT, mainMenu());
});

bot.action('menu:categories', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(ctx, '🎞 <b>একটি ক্যাটাগরি বেছে নিন:</b>', categoriesMenu());
});

bot.action(/^cat:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const cat = CATEGORIES.find((c) => c.id === ctx.match[1]);
  if (!cat) return;
  await safeEdit(
    ctx,
    `${cat.label}\n\n🚧 এই ক্যাটাগরির ভিডিও শীঘ্রই আসছে!`,
    backMenu('menu:categories')
  );
});

bot.action('menu:viral', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(
    ctx,
    '🔥 <b>Viral Videos</b>\n\n🚧 ভাইরাল ভিডিওর লিস্ট শীঘ্রই আসছে!',
    backMenu('menu:main')
  );
});

bot.action('menu:help', async (ctx) => {
  await ctx.answerCbQuery();
  await safeEdit(
    ctx,
    'ℹ️ <b>Help</b>\n\n/start — মেইন মেনু\n/menu — মেনু আবার দেখুন',
    backMenu('menu:main')
  );
});

// ---------- অ্যাডমিন File ID হ্যান্ডলার ----------
async function sendFileId(ctx, media) {
  if (ctx.from.id !== ADMIN_ID) {
    return ctx.reply('⛔ এই ফিচারটি শুধু অ্যাডমিনের জন্য।');
  }
  await ctx.reply(
    `✅ File ID:\n\n<code>${media.file_id}</code>\n\nUnique ID:\n<code>${media.file_unique_id}</code>`,
    {
      parse_mode: 'HTML',
      reply_parameters: { message_id: ctx.message.message_id },
    }
  );
}

bot.on(message('video'), (ctx) => sendFileId(ctx, ctx.message.video));
bot.on(message('document'), (ctx) => sendFileId(ctx, ctx.message.document));

bot.catch((err, ctx) => {
  console.error(`Error (update ${ctx.update.update_id}):`, err);
});

bot.launch({ dropPendingUpdates: true }, () => {
  console.log('CineNova Play bot চালু হয়েছে ✅');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
