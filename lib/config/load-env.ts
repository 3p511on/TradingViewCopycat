import * as dotenv from 'dotenv';

const lastArgument = process.argv[process.argv.length - 1];
if (!lastArgument?.includes('env:')) throw new Error('No env config provided');
const envFileId = lastArgument.split('env:')[1];

dotenv.config({ path: `.env.${envFileId}` })
