const {
  Client, GatewayIntentBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  PermissionsBitField, Events,
} = require('discord.js');
const http = require('http');

// ─── RAILWAY KEEP-ALIVE ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => { res.writeHead(200); res.end('Bot is alive ✅'); })
  .listen(PORT, () => console.log(`🌐 Keep-alive on port ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  TOKEN:              process.env.DISCORD_TOKEN,
  WELCOME_CHANNEL_ID: process.env.WELCOME_CHANNEL_ID,
  EVENT_CHANNEL_ID:   process.env.EVENT_CHANNEL_ID,
  PREFIX:             '!',
  SWEEP_EVERY_JOINS:  1000,
  SWEEP_MIN_USES:     3,
};

if (!CONFIG.TOKEN) { console.error('❌ DISCORD_TOKEN missing.'); process.exit(1); }

// ─── RUNTIME SETTINGS ────────────────────────────────────────────────────────
const settings = {
  welcomeChannelId: CONFIG.WELCOME_CHANNEL_ID,
  rulesChannelId:   null,
  generalChannelId: null,
  welcomeColor:     0xFFD700,
  welcomeBanner:    null,
  eventChannelId:   CONFIG.EVENT_CHANNEL_ID,
};

// ─── INVITE TRACKING ─────────────────────────────────────────────────────────
const inviteCache  = new Map(); // guildId -> Map<code, uses>
const joinCounter  = new Map(); // guildId -> total joins
const inviterStats = new Map(); // guildId -> Map<userId, inviteCount>

function trackInviter(guildId, userId) {
  if (!inviterStats.has(guildId)) inviterStats.set(guildId, new Map());
  const m = inviterStats.get(guildId);
  m.set(userId, (m.get(userId) ?? 0) + 1);
}

// ─── WIZARD STATE ────────────────────────────────────────────────────────────
const wizards = new Map(); // userId -> { type, step, data, channelId }

const WELCOME_STEPS = [
  {
    key: 'welcomeChannelId', label: 'Welcome Channel',
    prompt: '📌 **Step 1/6 — Welcome Channel**\nMention or paste the channel ID where join messages appear.',
    parse: v => v.replace(/[<#>]/g, '').trim(),
  },
  {
    key: 'rulesChannelId', label: 'Rules Channel',
    prompt: '📜 **Step 2/6 — Rules Channel**\nMention or paste your rules channel.',
    parse: v => v.replace(/[<#>]/g, '').trim(),
  },
  {
    key: 'generalChannelId', label: 'General Channel',
    prompt: '💬 **Step 3/6 — General Channel**\nMention or paste your general chat channel.',
    parse: v => v.replace(/[<#>]/g, '').trim(),
  },
  {
    key: 'welcomeColor', label: 'Embed Color', optional: true,
    prompt: '🎨 **Step 4/6 — Embed Color**\nHex color e.g. `#FFD700`. Type `skip` to keep current.',
    parse: v => {
      if (v.toLowerCase() === 'skip') return null;
      const n = parseInt(v.replace('#', ''), 16);
      return isNaN(n) ? null : n;
    },
  },
  {
    key: 'welcomeBanner', label: 'Banner URL', optional: true,
    prompt: '🖼️ **Step 5/6 — Banner Image**\nPaste a direct image URL. Type `skip` to leave blank.',
    parse: v => v.toLowerCase() === 'skip' ? null : v.trim(),
  },
  {
    key: '_preview', label: 'Preview',
    prompt: '👀 **Step 6/6 — Preview**\nLooking good? Reply `confirm` to save or `cancel` to discard.',
    parse: v => v.trim().toLowerCase(),
    isConfirm: true,
  },
];

const EVENT_STEPS = [
  {
    key: 'eventChannelId', label: 'Event Channel',
    prompt: '📌 **Step 1/2 — Event Channel**\nMention or paste the channel ID to post the event in.',
    parse: v => v.replace(/[<#>]/g, '').trim(),
  },
  {
    key: '_preview', label: 'Confirm',
    prompt: '👀 **Step 2/2 — Ready!**\nReply `confirm` to post the event or `cancel` to exit.',
    parse: v => v.trim().toLowerCase(),
    isConfirm: true,
  },
];

// ─── WELCOME EMBED BUILDER ────────────────────────────────────────────────────
function buildWelcomeEmbed(member, data, guild) {
  const embed = new EmbedBuilder()
    .setColor(data.welcomeColor ?? 0xFFD700)
    .setTitle(`🌟 Welcome to ${guild.name}!`)
    .setDescription(
      `Hey ${member ?? '**New Member**'}, glad you joined! 🎉\n\n` +
      `You're member **#${guild.memberCount}**\n\n` +
      `📜 **Start by reading the rules** so you know what's what.\n` +
      `🎮 Then dive in — events, giveaways and more are waiting!`
    )
    .addFields(
      { name: '📌 Rules',        value: data.rulesChannelId   ? `<#${data.rulesChannelId}>`   : '*not set*', inline: true },
      { name: '🎁 Events',       value: data.eventChannelId   ? `<#${data.eventChannelId}>`   : '*not set*', inline: true },
      { name: '💬 General',      value: data.generalChannelId ? `<#${data.generalChannelId}>` : '*not set*', inline: true },
    )
    .setFooter({ text: `${guild.name} • good to have you 🍊`, iconURL: guild.iconURL() })
    .setTimestamp();

  if (data.welcomeBanner) embed.setImage(data.welcomeBanner);
  return embed;
}

// ─── EVENT — COMPONENTS V2 ────────────────────────────────────────────────────
async function postEventComponents(channel) {
  await channel.send({
    flags: 32768,
    components: [
      {
        type: 17,
        accent_color: 16351749,
        spoiler: false,
        components: [
          {
            type: 10,
            content: '<:buddha:1487034693651267664> Summer BloxFruit Event — Event Rewards',
          },
          {
            type: 12,
            items: [{ media: { url: 'attachment://WhatsApp_Image_2026-03-26_at_11.46.07_PM.jpeg' } }],
          },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 10,
            content:
              "<a:announce:1487055874521567272> To celebrate the games activity, we've launched an OFFICIAL EVENT where you can earn FREE Permanent fruits & Robux!\n" +
              '<a:flowignsand:1487055896243736658> This is a `limited-time` event and comes to an end <t:1774852200:R> ( <t:1774852200:f> ), so be sure to not miss this opportunity! <a:RobuxANIM:1487057805528666285>',
          },
          { type: 14, divider: true, spacing: 2 },
          {
            type: 10,
            content:
              '<:1442164148908851220:1487058441800519680> __ EVENT REWARDS:__ <:1442164148908851220:1487058441800519680>\n' +
              '> <:e_fc7201_0280:1487162459805716581> <@&1487126325536886914> <:e_fc7201_8100:1487165177009934346> Permanent Yeti <:Yeti:1487166315729780836> / 2,500 Robux <:e_fc7201_3444:1487166961212330205>\n' +
              '> <:e_f5e50c_6532:1487162569901736037> <@&1487126326749040893> <:e_f5e50c_7750:1487165218298663014> Permanent Kitsune <:KitsuneFruit:1487166342497960008> / 5,000 Robux <:e_f5e50c_8142:1487167022658879520>\n' +
              '> <:e_f8a047_1847:1487164857517342750> <@&1487126328279830710> <:e_f8a047_8717:1487165262863274045> Permanent Dragon <:dragon:1487166379122626723>/ 7,500 Robux <:e_f8a047_8533:1487167066057474069>\n' +
              '> <:e_faec69_9471:1487164889213567097> <@&1487126329294983294> <:e_faec69_2107:1487165319389778223> All Permanent Fruits <:perm:1487166401797029971> / 10,000 Robux <:e_faec69_1777:1487167121661104199>',
          },
          { type: 14 },
          {
            type: 10,
            content:
              '<:e_FFAE00_4916:1487105142997127250> EVENT GUIDELINES: <:e_FFAE00_4916:1487105142997127250>\n' +
              "<:buddha:1487034693651267664> <:wh:1487105260387307580> Inviting alternative accounts to the event is strictly prohibited. <:e_FFAE00_8931:1487105621080801461>\n" +
              "<:buddha:1487034693651267664> <:wh:1487105260387307580> Failure to follow Discord's Terms of Service and Roblox Community Guidelines may result in removal from the event.\n\n" +
              '<:e_FFAE00_4914:1487106191690698875> CLAIM INFORMATION: <:e_FFAE00_4914:1487106191690698875>\n' +
              "<:e_FFAE00_2239:1487106767551856640> Once you're completed your invites, contact an <@&1479764099607953532> to redeem! <:e_FFAE00_3461:1487107024318894233>",
          },
          { type: 14 },
          {
            type: 1,
            components: [
              {
                type: 2, style: 5,
                label: 'Check Invite',
                url: 'https://discohook.app',
                custom_id: 'p_277375998826123280',
                emoji: { name: '👋' },
              },
              {
                type: 2, style: 2,
                custom_id: 'p_284704454815518723',
                label: 'How to invite?',
                emoji: { name: '❔' },
              },
            ],
          },
        ],
      },
    ],
  });
}

// ─── WIZARD STATUS EMBED ──────────────────────────────────────────────────────
function wizardStatusEmbed(steps, currentStep, data, type) {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`🛠️ ${type} Setup Wizard`)
    .setDescription(`Step **${currentStep + 1}** of **${steps.length}** — type \`cancel\` anytime to exit.`)
    .addFields(
      steps.filter(s => s.key !== '_preview').map(s => ({
        name:   s.label,
        value:  data[s.key] != null
                  ? (typeof data[s.key] === 'number' ? `#${data[s.key].toString(16).toUpperCase()}` : String(data[s.key]).slice(0, 80))
                  : (s.optional ? '*skipped*' : '⏳ pending'),
        inline: true,
      }))
    )
    .setFooter({ text: 'respond in this channel to continue ↑' });
}

// ─── AUTO SWEEP ───────────────────────────────────────────────────────────────
async function sweepDeadInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const dead    = invites.filter(i => i.uses < CONFIG.SWEEP_MIN_USES);
    if (!dead.size) return { swept: 0, codes: [] };

    const codes = [];
    for (const inv of dead.values()) {
      await inv.delete(`Auto-sweep: <${CONFIG.SWEEP_MIN_USES} uses`);
      inviteCache.get(guild.id)?.delete(inv.code);
      codes.push(`\`${inv.code}\` — ${inv.uses} use${inv.uses === 1 ? '' : 's'}`);
    }
    return { swept: codes.length, codes };
  } catch (err) {
    console.error('Sweep error:', err);
    return { swept: 0, codes: [] };
  }
}

// ─── READY ────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    try {
      const inv = await guild.invites.fetch();
      inviteCache.set(guild.id, new Map(inv.map(i => [i.code, i.uses])));
    } catch {}
  }
});

client.on(Events.InviteCreate, inv => {
  const c = inviteCache.get(inv.guild.id) ?? new Map();
  c.set(inv.code, inv.uses);
  inviteCache.set(inv.guild.id, c);
});

client.on(Events.InviteDelete, inv => {
  inviteCache.get(inv.guild.id)?.delete(inv.code);
});

// ─── MEMBER JOIN ──────────────────────────────────────────────────────────────
client.on(Events.GuildMemberAdd, async member => {
  const guild = member.guild;
  let usedInvite = null;

  try {
    const fresh    = await guild.invites.fetch();
    const oldCache = inviteCache.get(guild.id) ?? new Map();

    for (const inv of fresh.values()) {
      if (inv.uses > (oldCache.get(inv.code) ?? 0)) { usedInvite = inv; break; }
    }

    inviteCache.set(guild.id, new Map(fresh.map(i => [i.code, i.uses])));

    if (usedInvite?.inviter) trackInviter(guild.id, usedInvite.inviter.id);

    // sweep check
    const count = (joinCounter.get(guild.id) ?? 0) + 1;
    joinCounter.set(guild.id, count);

    if (count % CONFIG.SWEEP_EVERY_JOINS === 0) {
      const { swept, codes } = await sweepDeadInvites(guild);
      const logCh = guild.channels.cache.get(settings.welcomeChannelId);
      if (logCh && swept > 0) {
        await logCh.send({ embeds: [
          new EmbedBuilder()
            .setColor(0xFF4444)
            .setTitle('🧹 Auto-Sweep')
            .setDescription(`**${swept}** dead invite(s) removed after **${count} total joins**:\n\n${codes.join('\n')}`)
            .setTimestamp(),
        ]});
      }
    }
  } catch (err) { console.error('Invite tracking:', err); }

  const wCh = guild.channels.cache.get(settings.welcomeChannelId);
  if (!wCh) return;

  const inviterLine = usedInvite?.inviter
    ? `> invited by **${usedInvite.inviter.tag}** · code \`${usedInvite.code}\` · ${usedInvite.uses} uses`
    : '> invite source unknown';

  const embed = buildWelcomeEmbed(member, settings, guild);
  embed.setDescription(embed.data.description + `\n\n${inviterLine}`);
  embed.setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('📜 Read Rules').setStyle(ButtonStyle.Primary).setCustomId('rules_btn'),
    new ButtonBuilder().setLabel('🎮 Active Events').setStyle(ButtonStyle.Success).setCustomId('events_btn'),
  );

  await wCh.send({ content: `👋 Welcome ${member}!`, embeds: [embed], components: [row] });
});

// ─── BUTTONS ──────────────────────────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId === 'rules_btn')
    return interaction.reply({ content: settings.rulesChannelId ? `📜 <#${settings.rulesChannelId}>` : '📜 Check the rules channel!', ephemeral: true });
  if (interaction.customId === 'events_btn')
    return interaction.reply({ content: settings.eventChannelId ? `🎁 <#${settings.eventChannelId}>` : '🎁 Check the events channel!', ephemeral: true });
  if (interaction.customId === 'p_284704454815518723')
    return interaction.reply({ content: '📖 **How to invite:**\n1. Server Settings → Invites\n2. Create a link\n3. Share it\n4. Hit your goal, then contact staff to claim!', ephemeral: true });
});

// ─── COMMANDS ─────────────────────────────────────────────────────────────────
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;

  // ── wizard replies ────────────────────────────────────────────────────────
  const wizard = wizards.get(message.author.id);
  if (wizard && message.channel.id === wizard.channelId) {
    const steps = wizard.type === 'welcome' ? WELCOME_STEPS : EVENT_STEPS;
    const step  = steps[wizard.step];

    if (message.content.trim().toLowerCase() === 'cancel') {
      wizards.delete(message.author.id);
      return message.channel.send({ embeds: [new EmbedBuilder().setColor(0xFF4444).setTitle('❌ Cancelled').setDescription('Nothing was saved.').setTimestamp()] });
    }

    if (step.isConfirm) {
      if (step.parse(message.content) !== 'confirm') {
        wizards.delete(message.author.id);
        return message.channel.send({ embeds: [new EmbedBuilder().setColor(0xFF4444).setTitle('❌ Cancelled').setDescription('Nothing was saved.').setTimestamp()] });
      }

      Object.assign(settings, wizard.data);
      wizards.delete(message.author.id);

      if (wizard.type === 'welcome') {
        return message.channel.send({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Welcome settings saved!').setTimestamp()] });
      } else {
        const eCh = message.guild.channels.cache.get(wizard.data.eventChannelId ?? settings.eventChannelId);
        if (!eCh) return message.channel.send('⚠️ Channel not found.');
        await postEventComponents(eCh);
        return message.channel.send({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅ Event posted!').setDescription(`Posted in <#${eCh.id}>`).setTimestamp()] });
      }
    }

    const parsed = step.parse(message.content);
    if (!parsed && !step.optional)
      return message.channel.send(`⚠️ Invalid input for **${step.label}**, try again.`);
    if (parsed !== null) wizard.data[step.key] = parsed;
    wizard.step++;

    const next = steps[wizard.step];
    if (!next) { wizards.delete(message.author.id); return; }

    if (next.isConfirm) {
      const embeds = [new EmbedBuilder().setColor(0x5865F2).setDescription(next.prompt)];
      if (wizard.type === 'welcome') embeds.push(buildWelcomeEmbed(null, { ...settings, ...wizard.data }, message.guild));
      embeds.push(wizardStatusEmbed(steps, wizard.step, { ...settings, ...wizard.data }, wizard.type === 'welcome' ? 'Welcome' : 'Event'));
      return message.channel.send({ embeds });
    }

    return message.channel.send({ embeds: [
      new EmbedBuilder().setColor(0x5865F2).setDescription(next.prompt),
      wizardStatusEmbed(steps, wizard.step, { ...settings, ...wizard.data }, wizard.type === 'welcome' ? 'Welcome' : 'Event'),
    ]});
  }

  if (!message.content.startsWith(CONFIG.PREFIX)) return;

  const args = message.content.slice(CONFIG.PREFIX.length).trim().split(/\s+/);
  const cmd  = args.shift().toLowerCase();

  const hasPerm = () => message.member.permissions.has(PermissionsBitField.Flags.ManageGuild);
  const noPerms = () => message.reply('❌ You need **Manage Server** permission.');
  const isAdmin = () => message.member.permissions.has(PermissionsBitField.Flags.Administrator);

  // ── !setwelcome ────────────────────────────────────────────────────────────
  if (cmd === 'setwelcome') {
    if (!hasPerm()) return noPerms();
    if (wizards.has(message.author.id)) return message.reply('⚠️ You have an active wizard. Type `cancel` first.');
    wizards.set(message.author.id, { type: 'welcome', step: 0, data: {}, channelId: message.channel.id });
    return message.channel.send({ embeds: [
      new EmbedBuilder().setColor(0x5865F2).setTitle('🛠️ Welcome Setup').setDescription('Let\'s set up your welcome embed step by step.\n\n' + WELCOME_STEPS[0].prompt),
      wizardStatusEmbed(WELCOME_STEPS, 0, settings, 'Welcome'),
    ]});
  }

  // ── !setevent ──────────────────────────────────────────────────────────────
  if (cmd === 'setevent') {
    if (!hasPerm()) return noPerms();
    if (wizards.has(message.author.id)) return message.reply('⚠️ You have an active wizard. Type `cancel` first.');
    wizards.set(message.author.id, { type: 'event', step: 0, data: {}, channelId: message.channel.id });
    return message.channel.send({ embeds: [
      new EmbedBuilder().setColor(0xFF8C00).setTitle('🛠️ Event Setup').setDescription('Which channel should the event be posted in?\n\n' + EVENT_STEPS[0].prompt),
      wizardStatusEmbed(EVENT_STEPS, 0, settings, 'Event'),
    ]});
  }

  // ── !revoke <uses> <amount> ──────────────────────────────────────────────
  if (cmd === 'revoke') {
    if (!hasPerm()) return noPerms();

    const maxUses = parseInt(args[0]);
    const amount  = parseInt(args[1]);
    if (isNaN(maxUses) || isNaN(amount) || amount < 1 || maxUses < 0)
      return message.reply('❌ Usage: `!revoke <uses> <amount>`\nExample: `!revoke 3 100` — deletes up to 100 invites with 3 or fewer uses.');

    try {
      const all     = await message.guild.invites.fetch();
      const targets = [...all.values()].filter(i => i.uses <= maxUses).slice(0, amount);

      if (!targets.length)
        return message.reply(`❌ No invites found with **${maxUses}** or fewer uses.`);

      const working = await message.reply(`⏳ Revoking **${targets.length}** invite(s)...`);

      let deleted = 0, failed = 0;
      for (const inv of targets) {
        try {
          await inv.delete(`Bulk revoke by ${message.author.tag}`);
          inviteCache.get(message.guild.id)?.delete(inv.code);
          deleted++;
        } catch { failed++; }
      }

      await working.delete().catch(() => {});
      return message.reply({ embeds: [
        new EmbedBuilder()
          .setColor(deleted > 0 ? 0xFF4444 : 0xFFA500)
          .setTitle('🔒 Bulk Revoke Done')
          .addFields(
            { name: 'Requested', value: `${amount}`,         inline: true },
            { name: 'Matched',   value: `${targets.length}`, inline: true },
            { name: 'Deleted',   value: `${deleted}`,        inline: true },
            { name: 'Max Uses',  value: `≤ ${maxUses}`,      inline: true },
            { name: 'Failed',    value: `${failed}`,         inline: true },
            { name: 'By',        value: message.author.tag,  inline: true },
          )
          .setTimestamp(),
      ]});
    } catch (err) {
      console.error(err);
      return message.reply('❌ Something went wrong fetching invites.');
    }
  }

  // ── !invites — personal invite stats (or @mention) ──────────────────────
  if (cmd === 'invites') {
    try {
      const target    = message.mentions.users.first() ?? message.author;
      const guildStats = inviterStats.get(message.guild.id);
      const count      = guildStats?.get(target.id) ?? 0;

      // also count from live invite data
      const allInvites = await message.guild.invites.fetch();
      const theirLinks = allInvites.filter(i => i.inviter?.id === target.id);
      const liveUses   = theirLinks.reduce((sum, i) => sum + i.uses, 0);

      const total = Math.max(count, liveUses);

      // figure out which tier they're at
      const tiers = [
        { req: 1,   label: 'Permanent Yeti',         emoji: '<:Yeti:1487166315729780836>',             robux: '2,500'  },
        { req: 3,   label: 'Permanent Kitsune',       emoji: '<:KitsuneFruit:1487166342497960008>',     robux: '5,000'  },
        { req: 6,   label: 'Permanent Dragon',        emoji: '<:dragon:1487166379122626723>',           robux: '7,500'  },
        { req: 10,  label: 'All Permanent Fruits',    emoji: '<:perm:1487166401797029971>',             robux: '10,000' },
      ];

      const earned  = tiers.filter(t => total >= t.req);
      const current = earned[earned.length - 1] ?? null;
      const next    = tiers.find(t => total < t.req) ?? null;

      const progressBar = (val, max, len = 10) => {
        const filled = Math.min(Math.round((val / max) * len), len);
        return '█'.repeat(filled) + '░'.repeat(len - filled);
      };

      const nextText = next
        ? `\`${progressBar(total, next.req)}\` **${total}/${next.req}** — ${next.emoji} **${next.label}**`
        : '🏆 All tiers unlocked!';

      const rewardText = current
        ? `${current.emoji} **${current.label}** — **${current.robux} Robux**`
        : '*No reward yet — start inviting!*';

      const activeLinks = theirLinks.size;

      const embed = new EmbedBuilder()
        .setColor(0xF9A81D)
        .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL({ dynamic: true }) })
        .setTitle('📨 Invite Stats')
        .addFields(
          { name: '👥 Total Invites',   value: `**${total}**`,       inline: true },
          { name: '🔗 Active Links',    value: `**${activeLinks}**`, inline: true },
          { name: '🏅 Current Reward',  value: rewardText,           inline: false },
          { name: '⏭️ Next Reward',     value: nextText,             inline: false },
        )
        .setFooter({ text: `${message.guild.name} • BloxFruit Event`, iconURL: message.guild.iconURL() })
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return message.reply('❌ Could not fetch invite stats.');
    }
  }

  // ── !invitelb — invite leaderboard ────────────────────────────────────────
  if (cmd === 'invitelb') {
    try {
      const allInvites = await message.guild.invites.fetch();

      // aggregate uses per inviter from live data
      const liveMap = new Map();
      for (const inv of allInvites.values()) {
        if (!inv.inviter) continue;
        liveMap.set(inv.inviter.id, (liveMap.get(inv.inviter.id) ?? 0) + inv.uses);
      }

      // merge with in-memory stats
      const merged = new Map(liveMap);
      const gStats = inviterStats.get(message.guild.id);
      if (gStats) {
        for (const [id, count] of gStats.entries()) {
          merged.set(id, Math.max(merged.get(id) ?? 0, count));
        }
      }

      if (!merged.size)
        return message.reply('No invite data yet — nobody has joined via invite.');

      const sorted = [...merged.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

      const medals = ['🥇', '🥈', '🥉'];
      const rows   = await Promise.all(sorted.map(async ([id, count], i) => {
        const user  = await client.users.fetch(id).catch(() => null);
        const name  = user ? user.tag : `Unknown (${id})`;
        const medal = medals[i] ?? `**${i + 1}.**`;
        const bar   = '█'.repeat(Math.min(Math.round((count / sorted[0][1]) * 8), 8)) +
                      '░'.repeat(8 - Math.min(Math.round((count / sorted[0][1]) * 8), 8));
        return `${medal} **${name}**\n> \`${bar}\` **${count}** invite${count === 1 ? '' : 's'}`;
      }));

      const embed = new EmbedBuilder()
        .setColor(0xF9A81D)
        .setTitle('🏆 Invite Leaderboard')
        .setDescription(rows.join('\n\n'))
        .setFooter({ text: `${message.guild.name} • top ${sorted.length} inviters`, iconURL: message.guild.iconURL() })
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return message.reply('❌ Could not build leaderboard.');
    }
  }

  // ── !counts — total invite uses across the whole server ─────────────────
  if (cmd === 'counts') {
    try {
      const all        = await message.guild.invites.fetch();
      const totalUses  = all.reduce((sum, i) => sum + i.uses, 0);
      const totalLinks = all.size;

      // breakdown by inviter
      const byInviter = new Map();
      for (const inv of all.values()) {
        if (!inv.inviter) continue;
        byInviter.set(inv.inviter.id, {
          tag:   inv.inviter.tag,
          uses:  (byInviter.get(inv.inviter.id)?.uses ?? 0) + inv.uses,
          links: (byInviter.get(inv.inviter.id)?.links ?? 0) + 1,
        });
      }

      const topInviters = [...byInviter.values()]
        .sort((a, b) => b.uses - a.uses)
        .slice(0, 5)
        .map((v, i) => {
          const medals = ['🥇','🥈','🥉'];
          return `${medals[i] ?? `**${i+1}.**`} **${v.tag}** — **${v.uses}** uses across **${v.links}** link${v.links === 1 ? '' : 's'}`;
        })
        .join('\n');

      const embed = new EmbedBuilder()
        .setColor(0xF9A81D)
        .setTitle('📊 Server Invite Count')
        .addFields(
          { name: '🔗 Total Active Links', value: `**${totalLinks}**`,           inline: true },
          { name: '👥 Total Uses',         value: `**${totalUses}**`,            inline: true },
          { name: '📈 Avg Uses per Link',  value: totalLinks > 0 ? `**${(totalUses / totalLinks).toFixed(1)}**` : '**0**', inline: true },
          { name: '🏅 Top Inviters',       value: topInviters || '*no data yet*', inline: false },
        )
        .setFooter({ text: `${message.guild.name} • live data`, iconURL: message.guild.iconURL() })
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return message.reply('❌ Could not fetch invite data.');
    }
  }


  // ── !help ──────────────────────────────────────────────────────────────────
  if (cmd === 'help') {
    const isStaff = hasPerm();
    const isAdminUser = isAdmin();

    const embed = new EmbedBuilder()
      .setColor(0xF9A81D)
      .setTitle('\u{1F34A} BloxFruit Bot \u2014 Commands')
      .setDescription('All commands use the `!` prefix.')
      .addFields(
        {
          name: '\u{1F4E8} Invites',
          value: '`!invites` \u2014 your personal invite stats + reward progress\n`!invites @user` \u2014 check someone else stats\n`!invitelb` \u2014 top 10 invite leaderboard\n`!counts` \u2014 total invite links & uses across the whole server',
        },
        {
          name: '\u{1F512} Moderation',
          value: isStaff
            ? '`!revoke <uses> <amount>` \u2014 bulk delete invites\nExample: `!revoke 3 100` deletes up to 100 invites with 3 or fewer uses'
            : '*requires Manage Server*',
        },
        {
          name: '\u{1F6E0}\uFE0F Setup',
          value: isStaff
            ? '`!setwelcome` \u2014 set up the welcome embed\n`!setevent` \u2014 post the BloxFruit event embed'
            : '*requires Manage Server*',
        },
        {
          name: '\u{1F527} Utility',
          value: isAdminUser
            ? '`!test` \u2014 full health check on the bot'
            : '*requires Administrator*',
        },
        {
          name: '\u2699\uFE0F Automatic',
          value: `\u{1F44B} Welcome message on every join\n\u{1F9F9} Every **${CONFIG.SWEEP_EVERY_JOINS}** joins — removes invites with fewer than **${CONFIG.SWEEP_MIN_USES}** uses`,
        },
      )
      .setFooter({ text: `${message.guild.name} \u2022 BloxFruit Event Bot`, iconURL: message.guild.iconURL() })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // ── !test — admin only ─────────────────────────────────────────────────────
  if (cmd === 'test') {
    if (!isAdmin()) return message.reply('❌ You need **Administrator** permission.');

    const ping    = client.ws.ping;
    const wCh     = message.guild.channels.cache.get(settings.welcomeChannelId);
    const eCh     = message.guild.channels.cache.get(settings.eventChannelId);
    const cached  = inviteCache.get(message.guild.id);
    let canFetch  = false;
    try { await message.guild.invites.fetch(); canFetch = true; } catch {}
    let canSend = false;
    if (wCh) {
      const p = wCh.permissionsFor(message.guild.members.me);
      canSend = p?.has('SendMessages') && p?.has('EmbedLinks');
    }

    const checks = [
      { name: '🏓 Latency',            ok: ping < 500,   value: `${ping}ms` },
      { name: '👋 Welcome Channel',    ok: !!wCh,        value: wCh ? `<#${wCh.id}>` : 'not set — run `!setwelcome`' },
      { name: '🎁 Event Channel',      ok: !!eCh,        value: eCh ? `<#${eCh.id}>` : 'not set — run `!setevent`' },
      { name: '📋 Invite Cache',       ok: !!cached,     value: cached ? `${cached.size} invite(s) cached` : 'empty — restart may help' },
      { name: '🔑 Invite Permissions', ok: canFetch,     value: canFetch ? 'can read invites ✓' : 'missing Manage Guild' },
      { name: '✉️ Can Send Welcome',   ok: canSend,      value: canSend ? 'send + embed ✓' : wCh ? 'missing perms in that channel' : 'channel not set' },
      { name: '🧹 Auto-Sweep',         ok: true,         value: `every ${CONFIG.SWEEP_EVERY_JOINS} joins · removes <${CONFIG.SWEEP_MIN_USES} uses` },
    ];

    const allGood = checks.every(c => c.ok);
    return message.reply({ embeds: [
      new EmbedBuilder()
        .setColor(allGood ? 0x57F287 : 0xFF4444)
        .setTitle(allGood ? '✅ All Good' : '⚠️ Some Checks Failed')
        .setDescription(checks.map(c => `${c.ok ? '✅' : '❌'} **${c.name}**\n> ${c.value}`).join('\n\n'))
        .setFooter({ text: `checked by ${message.author.tag}` })
        .setTimestamp(),
    ]});
  }
});

client.login(CONFIG.TOKEN);
