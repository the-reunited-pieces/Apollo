import {
  type ApplicationCommandDataResolvable,
  ApplicationCommandOptionType,
  ApplicationCommandType,
} from 'discord.js';

export const commands: ApplicationCommandDataResolvable[] = [
  {
    type: ApplicationCommandType.ChatInput,
    name: 'dump',
    description: 'Dump your user data.',
    dmPermission: true,
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'data',
        description: 'What kind of data to dump',
        required: true,
        choices: [
          {
            name: 'egvs',
            value: 'egvs',
          },
          {
            name: 'dataRange',
            value: 'dataRange',
          },
          {
            name: 'events',
            value: 'events',
          },
          {
            name: 'alerts',
            value: 'alerts',
          },
        ],
      },
    ],
  },
];
