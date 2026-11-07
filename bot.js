const { Telegraf } = require('telegraf');
const { message } = require('telegraf/filters');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID || 6066529085);

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN সেট করা নেই!');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// /start (পরের ধাপে এটা ইনলাইন মেনু দিয়ে বদলানো হবে)
bot.start((ctx) => ctx.reply('🎬 CineNexus-এ স্বাগতম!'));

// অ্যাডমিন File ID হ্যান্ডলার
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
  console.log('CineNexus bot চালু হয়েছে ✅');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
