const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require("discord.js");

function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName("chess")
      .setDescription("Create mini chess games.")
      .setDMPermission(false)
      .addSubcommand((subcommand) =>
        subcommand
          .setName("invite")
          .setDescription("Create a chess invitation with a time modal.")
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("panel")
          .setDescription("Send a fixed chess invitation panel.")
          .addChannelOption((option) =>
            option
              .setName("channel")
              .setDescription("Panel channel.")
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(false)
          )
      )
  ];
}

function hasPanelPermission(interaction) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

module.exports = {
  buildCommands,
  hasPanelPermission
};
