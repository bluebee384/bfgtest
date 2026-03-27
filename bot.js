const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, Events } = require('discord.js');
const http = require('http');

// ─── RAILWAY KEEP-ALIVE SERVER ─────────────────────────────────────────────
// Railway kills processes that don't bind a port. This tiny HTTP server
// satisfies that requirement and lets you see the bot is alive.
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is alive ✅');
}).listen(PORT, () => {
  console.log(`🌐 Keep-alive server on port ${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── CONFIG ────────────────────────────────────────────────────────────────
// All sensitive values come from Railway environment variables.
// Set these in your Railway project → Variables tab.
const CONFIG = {
  TOKEN:             process.env.DISCORD_TOKEN,
  WELCOME_CHANNEL_ID: process.env.WELCOME_CHANNEL_ID,
  EVENT_CHANNEL_ID:   process.env.EVENT_CHANNEL_ID,
  PREFIX: '!',
  SWEEP_EVERY_JOINS: 1000,  // run sweep every N joins
  SWEEP_MIN_USES:    3,     // delete invites with fewer than this many uses
};

if (!CONFIG.TOKEN) {
  console.error('❌ DISCORD_TOKEN env var is missing. Set it in Railway → Variables.');
  process.exit(1);
}
// ───────────────────────────────────────────────────────────────────────────

// Track invite cache: Map<guildId, Map<inviteCode, uses>>
const inviteCache = new Map();

// Join counter per guild for sweep triggering: Map<guildId, count>
const joinCounter = new Map();

// ─── SWEEP FUNCTION — delete low-use invites ────────────────────────────────
async function sweepDeadInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    const dead = invites.filter(inv => inv.uses < CONFIG.SWEEP_MIN_USES);

    if (dead.size === 0) {
      console.log(`🧹 [${guild.name}] Sweep triggered — no dead invites found.`);
      return { swept: 0, codes: [] };
    }

    const deletedCodes = [];
    for (const invite of dead.values()) {
      await invite.delete(`Auto-sweep: fewer than ${CONFIG.SWEEP_MIN_USES} uses after ${CONFIG.SWEEP_EVERY_JOINS} joins`);
      inviteCache.get(guild.id)?.delete(invite.code);
      deletedCodes.push(`\`${invite.code}\` (${invite.uses} uses)`);
    }

    console.log(`🧹 [${guild.name}] Swept ${deletedCodes.length} dead invite(s): ${deletedCodes.join(', ')}`);
    return { swept: deletedCodes.length, codes: deletedCodes };
  } catch (err) {
    console.error(`Sweep error in ${guild.name}:`, err);
    return { swept: 0, codes: [] };
  }
}

// ─── READY ─────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Cache all guild invites on startup
  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      inviteCache.set(guild.id, new Map(invites.map(i => [i.code, i.uses])));
    } catch {}
  }
});

// ─── INVITE CREATE — cache new invites ─────────────────────────────────────
client.on(Events.InviteCreate, invite => {
  const cache = inviteCache.get(invite.guild.id) ?? new Map();
  cache.set(invite.code, invite.uses);
  inviteCache.set(invite.guild.id, cache);
});

// ─── INVITE DELETE — remove from cache ─────────────────────────────────────
client.on(Events.InviteDelete, invite => {
  inviteCache.get(invite.guild.id)?.delete(invite.code);
});

// ─── GUILD MEMBER ADD — welcome + invite tracking ──────────────────────────
client.on(Events.GuildMemberAdd, async member => {
  const guild = member.guild;

  // Fetch fresh invites and detect which one was used
  let usedInvite = null;
  try {
    const newInvites = await guild.invites.fetch();
    const oldCache = inviteCache.get(guild.id) ?? new Map();

    for (const invite of newInvites.values()) {
      const oldUses = oldCache.get(invite.code) ?? 0;
      if (invite.uses > oldUses) {
        usedInvite = invite;
        break;
      }
    }

    // Update cache
    inviteCache.set(guild.id, new Map(newInvites.map(i => [i.code, i.uses])));

    // ── JOIN COUNTER + SWEEP TRIGGER ──────────────────────────────────────
    const count = (joinCounter.get(guild.id) ?? 0) + 1;
    joinCounter.set(guild.id, count);

    if (count % CONFIG.SWEEP_EVERY_JOINS === 0) {
      console.log(`🔢 [${guild.name}] Hit ${count} joins — triggering dead-invite sweep...`);
      const { swept, codes } = await sweepDeadInvites(guild);

      // Post sweep report to welcome channel so staff can see it
      const logChannel = guild.channels.cache.get(CONFIG.WELCOME_CHANNEL_ID);
      if (logChannel && swept > 0) {
        const sweepEmbed = new EmbedBuilder()
          .setColor(0xFF4444)
          .setTitle('🧹 Auto-Sweep Complete')
          .setDescription(
            `Triggered after **${count} total joins**.\n` +
            `Removed **${swept}** invite(s) with fewer than **${CONFIG.SWEEP_MIN_USES} uses**:\n\n` +
            codes.join('\n')
          )
          .setTimestamp();
        await logChannel.send({ embeds: [sweepEmbed] });
      }
    }
  } catch (err) {
    console.error('Invite tracking error:', err);
  }

  // ── WELCOME EMBED ──────────────────────────────────────────────────────
  const welcomeChannel = guild.channels.cache.get(CONFIG.WELCOME_CHANNEL_ID);
  if (!welcomeChannel) return;

  const inviterText = usedInvite?.inviter
    ? `Invited by **${usedInvite.inviter.tag}** using code \`${usedInvite.code}\` (${usedInvite.uses} uses)`
    : 'Invite source unknown';

  const welcomeEmbed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle(`🌟 Welcome to ${guild.name}!`)
    .setDescription(
      `Hey ${member}, glad you joined us! 🎉\n\n` +
      `You are member **#${guild.memberCount}**!\n\n` +
      `📜 **Please start by reading the rules** so you know what's allowed.\n` +
      `🎮 Then jump into the community — events, giveaways, and more await!\n\n` +
      `> *${inviterText}*`
    )
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setImage('https://i.imgur.com/your-banner-here.gif') // replace with your banner URL
    .addFields(
      { name: '📌 Read Rules', value: '<#RULES_CHANNEL_ID>', inline: true },
      { name: '🎁 Active Events', value: `<#${CONFIG.EVENT_CHANNEL_ID}>`, inline: true },
      { name: '💬 General Chat', value: '<#GENERAL_CHANNEL_ID>', inline: true },
    )
    .setFooter({ text: `${guild.name} • Have a great time! 🍊`, iconURL: guild.iconURL() })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('📜 Read Rules')
      .setStyle(ButtonStyle.Primary)
      .setCustomId('rules_btn'),
    new ButtonBuilder()
      .setLabel('🎮 Active Events')
      .setStyle(ButtonStyle.Success)
      .setCustomId('events_btn'),
  );

  await welcomeChannel.send({ content: `👋 Welcome ${member}!`, embeds: [welcomeEmbed], components: [row] });
});

// ─── ALL BUTTON INTERACTIONS ────────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'rules_btn') {
    await interaction.reply({ content: '📜 Head to <#RULES_CHANNEL_ID> and give them a read!', ephemeral: true });
  } else if (interaction.customId === 'events_btn') {
    await interaction.reply({ content: `🎁 Check out <#${CONFIG.EVENT_CHANNEL_ID}> for active events!`, ephemeral: true });
  } else if (interaction.customId === 'check_invite') {
    await interaction.reply({ content: '🔍 Use `!invites` to check invite stats, or DM a staff member!', ephemeral: true });
  } else if (interaction.customId === 'how_to_invite') {
    await interaction.reply({
      content:
        '📖 **How to Invite:**\n1. Go to **Server Settings → Invites**\n2. Create an invite link\n3. Share it with friends!\n4. Once you hit your goal, contact `@role` to claim your reward!',
      ephemeral: true,
    });
  }
});

// ─── MESSAGE COMMANDS ───────────────────────────────────────────────────────
client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.content.startsWith(CONFIG.PREFIX)) return;

  const args = message.content.slice(CONFIG.PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  // ── !revoke <code> ──────────────────────────────────────────────────────
  if (cmd === 'revoke') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply('❌ You need **Manage Server** permission to use this.');
    }

    const code = args[0];
    if (!code) return message.reply('❌ Usage: `!revoke <invite_code>`');

    try {
      const invite = await message.guild.invites.fetch(code);
      await invite.delete(`Manually revoked by ${message.author.tag}`);
      inviteCache.get(message.guild.id)?.delete(code);

      const embed = new EmbedBuilder()
        .setColor(0xFF4444)
        .setTitle('🔒 Invite Revoked')
        .addFields(
          { name: 'Code', value: `\`${code}\``, inline: true },
          { name: 'Uses', value: `${invite.uses}`, inline: true },
          { name: 'Revoked By', value: message.author.tag, inline: true },
        )
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch {
      return message.reply(`❌ Could not find or revoke invite \`${code}\`. Check the code and try again.`);
    }
  }

  // ── !invites ────────────────────────────────────────────────────────────
  if (cmd === 'invites') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply('❌ You need **Manage Server** permission.');
    }

    try {
      const invites = await message.guild.invites.fetch();
      if (!invites.size) return message.reply('No active invites found.');

      const sorted = [...invites.values()].sort((a, b) => b.uses - a.uses).slice(0, 10);
      const desc = sorted.map((inv, i) =>
        `**${i + 1}.** \`${inv.code}\` — **${inv.uses}** uses — by ${inv.inviter?.tag ?? 'Unknown'}`
      ).join('\n');

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📋 Top Active Invites')
        .setDescription(desc)
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    } catch {
      return message.reply('❌ Could not fetch invites.');
    }
  }

  // ── !event ──────────────────────────────────────────────────────────────
  if (cmd === 'event') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply('❌ You need **Manage Server** permission.');
    }

    const eventChannel = message.guild.channels.cache.get(CONFIG.EVENT_CHANNEL_ID);
    if (!eventChannel) return message.reply('❌ EVENT_CHANNEL_ID env var not set or channel not found.');

    const eventEmbed = new EmbedBuilder()
      .setColor(0xFF8C00)
      .setTitle('🍊 Summer BloxFruit Event — Event Rewards')
      .setDescription(
        'To celebrate the game\'s activity, we\'ve launched an **OFFICIAL EVENT** where you can earn **FREE** Permanent fruits & Robux!\n\n' +
        '🏆 This is a **limited-time** event ending in **2 days** (March 30, 2026 12:00 PM) — don\'t miss it!'
      )
      .addFields(
        {
          name: '🎁 Event Rewards',
          value:
            '▶ `@role` = Permanent Yeti 🌀 / **2,500 Robux** 🟡\n' +
            '▶ `@role` = Permanent Kitsune 🌸 / **5,000 Robux** 🟡\n' +
            '▶ `@role` = Permanent Dragon 🐉 / **7,500 Robux** 🟡\n' +
            '▶ `@role` = All Permanent Fruits 🍊 / **10,000 Robux** 🟡',
        },
        {
          name: 'ℹ️ Event Guidelines',
          value:
            '🔑 Inviting alt accounts is **strictly prohibited**.\n' +
            '📋 Failure to follow Discord\'s ToS & Roblox Community Guidelines may result in removal.',
        },
        {
          name: '✉️ Claim Information',
          value: 'Once you\'ve completed your invites, contact an `@role` to redeem! 🤝',
        }
      )
      .setImage('https://i.imgur.com/your-event-banner.png') // replace with your banner
      .setFooter({ text: 'Summer BloxFruit Event • Limited Time!', iconURL: message.guild.iconURL() })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('✅ Check Invite')
        .setStyle(ButtonStyle.Success)
        .setCustomId('check_invite'),
      new ButtonBuilder()
        .setLabel('❓ How to Invite?')
        .setStyle(ButtonStyle.Secondary)
        .setCustomId('how_to_invite'),
    );

    await eventChannel.send({ embeds: [eventEmbed], components: [row] });
    return message.reply(`✅ Event embed posted in ${eventChannel}!`);
  }
});

client.login(CONFIG.TOKEN);
