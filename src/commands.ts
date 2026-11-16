import {
  type ApplicationCommandDataResolvable,
  ApplicationCommandType,
} from 'discord.js';

export const commands: ApplicationCommandDataResolvable[] = [
  {
    type: ApplicationCommandType.ChatInput,
    name: 'dump',
    description: 'Dump your user data.',
    dmPermission: true,
  },
];
